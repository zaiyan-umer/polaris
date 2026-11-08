// Read-only verification of the Polaris database contents.
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
  const vars = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    vars[m[1]] = val;
  }
  return vars;
}

const env = loadEnv();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const TABLES = [
  'planets', 'locations', 'datasets', 'dataset_variables', 'variables',
  'dataset_versions', 'dataset_assets', 'measurements', 'regions',
  'regional_statistics', 'provenance', 'analog_rankings', 'analog_variable_scores',
];

async function count(table, query = '') {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${query}`, {
    method: 'HEAD',
    headers: { ...H, Prefer: 'count=exact' },
  });
  return r.headers.get('content-range')?.split('/')[1] ?? 'ERR';
}

/** Fetch every row of a table, following PostgREST's 1000-row page limit. */
async function fetchAll(table, select = '*', query = '') {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const sep = query ? '&' : '&';
    const r = await fetch(
      `${URL}/rest/v1/${table}?select=${select}${sep}${query}limit=${pageSize}&offset=${offset}`,
      { headers: H }
    );
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

(async () => {
  console.log('=== Table counts ===');
  for (const t of TABLES) {
    console.log(' ', t.padEnd(24), await count(t));
  }

  const [ds, vars, meas] = await Promise.all([
    fetchAll('datasets', 'id,short_name,source_type,planet_id'),
    fetchAll('variables', 'id,name,canonical_unit'),
    fetchAll('measurements', 'id,dataset_id,variable_id,location_id,planet_id,value,value_unit,quality_flag,recorded_at'),
  ]);

  const dsName = Object.fromEntries(ds.map(d => [d.id, d.short_name]));
  const varName = Object.fromEntries(vars.map(v => [v.id, v.name]));
  const planetName = { 'f0ea8f3a-018f-4be3-8d6a-60f5e6387d52': 'Earth', 'b9d6afa8-2e6e-451a-8eaa-519463da3f42': 'Moon', '6f185144-3114-4d90-9bbc-6d4c15dc110f': 'Mars' };

  console.log(`\n=== Measurements (${meas.length}) by dataset / variable / quality ===`);
  const byKey = {};
  for (const m of meas) {
    const k = `${planetName[m.planet_id] ?? '?'}|${dsName[m.dataset_id] ?? '?'}|${varName[m.variable_id] ?? '?'}|${m.quality_flag}`;
    byKey[k] = (byKey[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(byKey).sort()) console.log('  ', k.padEnd(48), n);

  console.log('\n=== Duplicate check (location|dataset|variable|epoch|value) ===');
  const seen = new Set();
  let dupes = 0;
  for (const m of meas) {
    const k = `${m.location_id}|${m.dataset_id}|${m.variable_id}|${Date.parse(m.recorded_at)}|${m.value}`;
    if (seen.has(k)) dupes++;
    else seen.add(k);
  }
  console.log('  duplicate rows:', dupes);

  console.log('\n=== Value ranges per source ===');
  const ranges = {};
  for (const m of meas) {
    const k = `${dsName[m.dataset_id]}|${varName[m.variable_id]}`;
    if (!ranges[k]) ranges[k] = { min: Infinity, max: -Infinity, n: 0 };
    ranges[k].min = Math.min(ranges[k].min, m.value);
    ranges[k].max = Math.max(ranges[k].max, m.value);
    ranges[k].n++;
  }
  for (const [k, r] of Object.entries(ranges).sort()) {
    console.log('  ', k.padEnd(32), `n=${String(r.n).padStart(5)}  min=${r.min.toFixed(2).padStart(10)}  max=${r.max.toFixed(2).padStart(10)}  unit=${varName[Object.keys(varName).find(v => varName[v] === k.split('|')[1])] ? '' : ''}`);
  }

  console.log('\n=== Unit check (must equal canonical) ===');
  const unitErrors = [];
  for (const m of meas) {
    const v = vars.find(x => x.id === m.variable_id);
    if (v && m.value_unit !== v.canonical_unit) {
      unitErrors.push(`${dsName[m.dataset_id]}: ${m.value_unit} != ${v.canonical_unit}`);
    }
  }
  console.log('  mismatches:', unitErrors.length, unitErrors.slice(0, 3).join('; '));

  console.log('\n=== Provenance ===');
  const prov = await fetchAll('provenance', 'record_type,source_name,validation_status');
  const bySource = {};
  for (const p of prov) {
    const k = `${p.source_name}|${p.record_type}|${p.validation_status}`;
    bySource[k] = (bySource[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(bySource).sort()) console.log('  ', k.padEnd(58), n);

  console.log('\n=== Regional statistics ===');
  const stats = await fetchAll('regional_statistics', 'region_id,variable_id,statistic_type,value,unit,sample_count');
  const byVar = {};
  for (const s of stats) {
    const k = `${varName[s.variable_id]}|${s.statistic_type}`;
    byVar[k] = (byVar[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(byVar).sort()) console.log('  ', k.padEnd(34), n);

  console.log('\n=== Sample rows ===');
  for (const m of meas.filter(x => x.quality_flag !== 'demo').slice(0, 6)) {
    console.log('  ', (planetName[m.planet_id] ?? '?').padEnd(6), (dsName[m.dataset_id] ?? '?').padEnd(12), (varName[m.variable_id] ?? '?').padEnd(12), String(m.value).padStart(10), m.value_unit.padEnd(6), m.quality_flag.padEnd(8), m.recorded_at);
  }

  console.log('\n=== Orphan checks ===');
  const measIds = new Set(meas.map(m => m.id));
  const provMeas = prov.filter(p => p.record_type === 'measurement');
  console.log('  provenance rows:', prov.length, ' measurement targets present:', provMeas.length, '/', measIds.size);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
