// Read-only database state inspection for Polaris
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
  const vars = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[m[1]] = val;
  }
  return vars;
}

const env = loadEnv();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;

if (!URL || !KEY) {
  console.error('Missing env. URL set:', !!URL, 'KEY set:', !!KEY);
  process.exit(1);
}

const TABLES = [
  'planets', 'locations', 'datasets', 'dataset_variables', 'variables',
  'dataset_versions', 'dataset_assets', 'measurements', 'regions',
  'regional_statistics', 'provenance', 'analog_rankings', 'analog_variable_scores',
];

(async () => {
  console.log('URL:', URL);
  for (const t of TABLES) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=*`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) {
      console.log(t.padEnd(24), 'HTTP', r.status, (await r.text()).slice(0, 120));
      continue;
    }
    const d = await r.json();
    console.log(t.padEnd(24), Array.isArray(d) ? d.length : typeof d);
  }

  console.log('\n--- planets ---');
  const p = await (await fetch(`${URL}/rest/v1/planets?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  console.log(JSON.stringify(p, null, 2));

  console.log('\n--- datasets ---');
  const ds = await (await fetch(`${URL}/rest/v1/datasets?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  console.log(JSON.stringify(ds, null, 2));

  console.log('\n--- variables ---');
  const v = await (await fetch(`${URL}/rest/v1/variables?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  console.log(JSON.stringify(v, null, 2));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
