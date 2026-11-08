// Drop existing planetary data tables (CASCADE) so the migration can run cleanly.
// Run: node scripts/drop_planetary_tables.cjs
// Reads DATABASE_URL from backend/.env.

require('dotenv/config');
const { default: postgres } = require('postgres');

(async () => {
  const sql = postgres(process.env.DATABASE_URL);
  try {
    // Drop in dependency order so CASCADE can remove children.
    const order = [
      'measurements',
      'dataset_variables',
      'locations',
      'datasets',
      'variables',
      'planets',
    ];
    for (const t of order) {
      try {
        await sql.unsafe(`DROP TABLE IF EXISTS "${t}" CASCADE`);
        console.log(`  dropped ${t}`);
      } catch (e) {
        console.error(`  error dropping ${t}:`, e.message);
      }
    }
    console.log('cleanup complete');
  } catch (e) {
    console.error('cleanup failed:', e.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
