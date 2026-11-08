// Remove the duplicate rows produced by the first (non-idempotent) runs so the
// pipeline can be re-run from a clean state. Only touches rows this ingestion
// created: non-demo measurements, all provenance, and all regional statistics.
// The 7 original `quality_flag='demo'` rows are left untouched.
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

const DRY = !process.argv.includes('--apply');

async function count(table, query = '') {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${query}`, {
    method: 'HEAD',
    headers: { ...H, Prefer: 'count=exact' },
  });
  return r.headers.get('content-range')?.split('/')[1];
}

async function remove(table, query) {
  const r = await fetch(`${URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(`DELETE ${table} failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return true;
}

(async () => {
  console.log(`mode: ${DRY ? 'DRY RUN' : 'APPLY'}`);

  const before = {
    measurements_non_demo: await count('measurements', '&quality_flag=neq.demo'),
    measurements_demo: await count('measurements', '&quality_flag=eq.demo'),
    provenance: await count('provenance'),
    regional_statistics: await count('regional_statistics'),
  };
  console.log('before:', before);

  if (DRY) {
    console.log('dry run — re-run with --apply to delete');
    return;
  }

  // Order matters: provenance references measurement ids, so remove it first.
  await remove('provenance', 'id=gt.00000000-0000-0000-0000-000000000000');
  console.log('  deleted provenance');

  await remove('regional_statistics', 'id=gt.00000000-0000-0000-0000-000000000000');
  console.log('  deleted regional_statistics');

  await remove('measurements', 'quality_flag=neq.demo');
  console.log('  deleted non-demo measurements');

  const after = {
    measurements_non_demo: await count('measurements', '&quality_flag=neq.demo'),
    measurements_demo: await count('measurements', '&quality_flag=eq.demo'),
    measurements_total: await count('measurements'),
    provenance: await count('provenance'),
    regional_statistics: await count('regional_statistics'),
  };
  console.log('after:', after);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
