// Remove duplicate regional_statistics rows produced by earlier non-idempotent
// runs. Keeps the lowest id per (region_id, variable_id, statistic_type).
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

async function fetchAll() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(
      `${URL}/rest/v1/regional_statistics?select=id,region_id,variable_id,statistic_type&limit=1000&offset=${offset}`,
      { headers: H }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

(async () => {
  const rows = await fetchAll();
  console.log('total regional_statistics rows:', rows.length);

  const seen = new Set();
  const toDelete = [];
  for (const r of rows) {
    const key = `${r.region_id}|${r.variable_id}|${r.statistic_type}`;
    if (seen.has(key)) toDelete.push(r.id);
    else seen.add(key);
  }
  console.log('duplicates to remove:', toDelete.length);

  if (process.argv.includes('--apply') && toDelete.length > 0) {
    // delete in chunks of 100 ids
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunkIds = toDelete.slice(i, i + 100).map(id => `"${id}"`).join(',');
      const r = await fetch(`${URL}/rest/v1/regional_statistics?id=in.(${chunkIds})`, {
        method: 'DELETE',
        headers: H,
      });
      if (!r.ok) throw new Error(`DELETE failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    console.log('deleted');
  } else if (!process.argv.includes('--apply')) {
    console.log('dry run — pass --apply to delete');
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
