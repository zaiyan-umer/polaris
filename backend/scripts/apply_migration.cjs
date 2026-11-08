// Apply the planetary data harmonization SQL migration against Supabase.
// Reads the connection string from backend/.env (DATABASE_URL), so no password
// needs to be hard-coded here.
//
// This postgres driver only allows a *single* SQL statement per call
// (max: 1, see UNSAFE_TRANSACTION). Each file is therefore parsed into its
// individual statements (comment lines and BEGIN/COMMIT wrappers are dropped)
// and each statement is executed separately.
//
// Files executed (in dependency order):
//   001_schema.sql      - tables, constraints, indexes (no INSERTs)
//   002_reference_data.sql - planets, variables, dataset catalog
//   003_demo_data.sql   - dev-only placeholder locations + measurements

require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { default: postgres } = require('postgres');

const root = path.resolve(__dirname, '..');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set in backend/.env');
  process.exit(1);
}
const sql = postgres(dbUrl, { max: 1, idle_timeout: 10, connect_timeout: 10 });

const FILES = [
  path.join(root, 'db', '001_schema.sql'),
  path.join(root, 'db', '002_reference_data.sql'),
  path.join(root, 'db', '003_demo_data.sql'),
];

/**
 * Remove SQL comment blocks (slash-star block comments) and line comments
 * (two dashes). Multi-line comments are stripped entirely; line comments strip from "--" to the end of the line.
 * to the end of the line.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\n[ \t]*\n/g, '\n');
}

/**
 * Split SQL text into statements, tracking parentheses and single-quoted
 * strings so that nested parens (default gen_random_uuid(), multi-row
 * VALUES lists) do not split a statement in the middle.
 */
function splitStatements(text) {
  // Strip comments before splitting so that comment-only text is not
  // passed to the driver as statements.
  const cleaned = stripComments(text);
  const stmts = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (ch === "'" && cleaned[i + 1] === "'") {
        cur += "''";
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      cur += ch;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      const s = cur.trim();
      if (s) stmts.push(s);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const last = cur.trim();
  if (last) stmts.push(last);
  return stmts;
}

/**
 * Execute one SQL file: strips comment lines (and BEGIN/COMMIT wrappers
 * that may still be present), then runs each statement individually.
 */
async function applyFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const stmts = splitStatements(text);
  console.log(`[DEBUG] ${path.basename(filePath)}: ${stmts.length} statements`);
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i].trim();
    if (!stmt) continue;
    console.log(`  [${i}] len=${stmt.length} | ${stmt.substring(0, 70)}...`);
  }
  for (const raw of stmts) {
    const stmt = raw.trim();
    if (!stmt) continue;
    try {
      await sql.unsafe(stmt);
      console.log('  applied: ' + stmt.substring(0, 60) + '...');
    } catch (err) {
      console.error('  FAILED on: ' + stmt.substring(0, 80) + '...');
      if (err.detail) console.error('  detail:', err.detail);
      throw err;
    }
  }
}

(async () => {
  try {
    for (const file of FILES) {
      console.log('Applying ' + path.basename(file) + ' ...');
      await applyFile(file);
    }
    console.log('Migration complete: all statements applied.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
