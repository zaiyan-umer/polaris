// ============================================================================
// PostgREST client for Supabase (server-side only)
// ============================================================================
//
// Single home for the database helpers used by the ingestion pipeline.
// The Supabase REST API is reachable from this environment; a direct Postgres
// driver connection is not (DNS), so all access goes through PostgREST.
//
// SECURITY: writes use the service-role key from SUPABASE_SECRET_KEY. That key
// must never reach frontend code, and RLS policies are left untouched.
//
// PostgREST operators: https://postgrest.org/en/stable/references/api.html#operators
// Valid: eq. neq. gt. gte. lt. lte. like. ilike. in. cs. cd. ov. sl. sr. nxr. nxl.
// A filter object { column: { op: value } } becomes column=op.value.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SECRET_KEY must be set in environment variables. ' +
    'Server-side writes require a service-role key. Frontend code must never receive this key.'
  );
}

const OPERATORS = {
  eq: 'eq.',
  neq: 'neq.',
  gt: 'gt.',
  gte: 'gte.',
  lt: 'lt.',
  lte: 'lte.',
  like: 'like.',
  ilike: 'ilike.',
  in: 'in.',
  cs: 'cs.',
  cd: 'cd.',
  ov: 'ov.',
  sl: 'sl.',
  sr: 'sr.',
  nxr: 'nxr.',
  nxl: 'nxl.',
};

/** Escape a value used inside an `in.(...)` list. */
function escapeInValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/,/g, '\\,');
}

/**
 * Build a PostgREST query string from a filter object.
 *   { slug: 'earth' }                     -> slug=eq.earth
 *   { planet_id: { eq: uuid } }           -> planet_id=eq.<uuid>
 *   { id: { in: [a, b] } }                -> id=in.(a,b)
 */
function buildPostgrestQuery(filters = {}) {
  const params = new URLSearchParams();

  for (const [column, condition] of Object.entries(filters)) {
    if (condition == null) continue;

    if (typeof condition === 'object' && !Array.isArray(condition)) {
      for (const [op, rawValue] of Object.entries(condition)) {
        const operator = OPERATORS[op];
        if (!operator) throw new Error(`Unknown PostgREST operator "${op}" for column "${column}"`);
        if (op === 'in') {
          if (!Array.isArray(rawValue)) {
            throw new Error(`Operator "in" for column "${column}" requires an array`);
          }
          params.append(column, `${operator}(${rawValue.map(escapeInValue).join(',')})`);
        } else {
          params.append(column, `${operator}${rawValue}`);
        }
      }
    } else {
      params.append(column, `eq.${condition}`);
    }
  }

  return params.toString();
}

function authHeaders({ prefer = null, contentType = 'application/json' } = {}) {
  const h = { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` };
  if (contentType) h['Content-Type'] = contentType;
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function readError(response) {
  const body = await response.text();
  return `HTTP ${response.status} ${response.statusText}: ${body.slice(0, 400)}`;
}

/**
 * GET rows. Always returns an array (possibly empty).
 * `options.select` restricts the returned columns (PostgREST `select`).
 */
async function postgrestQuery(table, filters = {}, options = {}) {
  const qs = buildPostgrestQuery(filters);
  const finalParams = new URLSearchParams();
  if (qs) {
    for (const [k, v] of new URLSearchParams(qs)) finalParams.append(k, v);
  }
  if (options.select) finalParams.append('select', options.select);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${finalParams.toString()}`, {
    method: 'GET',
    headers: authHeaders({ contentType: null }),
  });
  if (!response.ok) throw new Error(`Query failed for ${table}: ${await readError(response)}`);
  return response.json();
}

/** POST rows, returning nothing. Atomic for the batch. */
async function postgrestInsert(table, records) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: authHeaders({ prefer: 'return=minimal' }),
    body: JSON.stringify(records),
  });
  if (!response.ok) throw new Error(`Insert failed for ${table}: ${await readError(response)}`);
  return true;
}

/** POST rows and return the created representations (with generated ids). */
async function postgrestInsertReturning(table, records) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: authHeaders({ prefer: 'return=representation' }),
    body: JSON.stringify(records),
  });
  if (!response.ok) throw new Error(`Insert failed for ${table}: ${await readError(response)}`);
  return response.json();
}

/**
 * Upsert rows.
 *
 * `onConflict` is PostgREST's onConflict query parameter (comma-separated
 * unique-constraint columns). Duplicate handling goes in the Prefer header:
 *   resolution=ignore-duplicates -> ON CONFLICT DO NOTHING
 *   resolution=merge-duplicates   -> ON CONFLICT DO UPDATE
 */
async function postgrestUpsert(table, records, { onConflict = null, ignoreDuplicates = true } = {}) {
  const params = new URLSearchParams();
  if (onConflict) params.append('on_conflict', onConflict);
  const qs = params.toString();
  const prefer = `resolution=${ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'},return=minimal`;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'POST',
    headers: authHeaders({ prefer }),
    body: JSON.stringify(records),
  });
  if (!response.ok) throw new Error(`Upsert failed for ${table}: ${await readError(response)}`);
  return true;
}

/** DELETE rows matching a filter. */
async function postgrestDelete(table, filters = {}) {
  const qs = buildPostgrestQuery(filters);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'DELETE',
    headers: authHeaders({ contentType: null }),
  });
  if (!response.ok) throw new Error(`Delete failed for ${table}: ${await readError(response)}`);
  return true;
}

/** Exact row count for a filter, using PostgREST's count preference. */
async function postgrestCount(table, filters = {}) {
  const qs = buildPostgrestQuery(filters);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id${qs ? '&' + qs : ''}`, {
    method: 'HEAD',
    headers: { ...authHeaders({ contentType: null }), Prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`Count failed for ${table}: ${await readError(response)}`);
  const range = response.headers.get('content-range');
  if (!range) return null;
  const total = range.split('/')[1];
  return total === '*' ? null : Number(total);
}

// ============================================================================
// Validation
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a measurement record against the schema's declared constraints
 * (composite FKs, canonical-unit FK, range CHECKs) before writing, so a bad row
 * fails with a readable message instead of an opaque PostgREST 400.
 *
 * @returns {string[]} problems; empty means valid
 */
function validateMeasurementRecord(record, { variablesById = {}, locationsById = {}, datasetsById = {} } = {}) {
  const errors = [];

  if (!UUID_RE.test(String(record.planet_id || ''))) errors.push('planet_id is required and must be a uuid');
  if (!UUID_RE.test(String(record.location_id || ''))) errors.push('location_id is required and must be a uuid');
  if (!UUID_RE.test(String(record.dataset_id || ''))) errors.push('dataset_id is required and must be a uuid');
  if (!UUID_RE.test(String(record.variable_id || ''))) errors.push('variable_id is required and must be a uuid');

  if (record.value == null || !Number.isFinite(Number(record.value))) {
    errors.push(`value is required and must be finite, got ${record.value}`);
  }
  if (typeof record.value_unit !== 'string' || record.value_unit.length === 0) {
    errors.push('value_unit is required');
  }
  if (!record.recorded_at || Number.isNaN(Date.parse(record.recorded_at))) {
    errors.push(`recorded_at is required and must be a valid timestamp, got ${record.recorded_at}`);
  }

  if (errors.length > 0) return errors;

  const variable = variablesById[record.variable_id];
  if (variable && record.value_unit !== variable.canonical_unit) {
    errors.push(
      `value_unit "${record.value_unit}" != canonical unit "${variable.canonical_unit}" for variable "${variable.name}"`
    );
  }

  const location = locationsById[record.location_id];
  if (location && location.planet_id !== record.planet_id) {
    errors.push(`location belongs to planet ${location.planet_id}, not ${record.planet_id}`);
  }
  const dataset = datasetsById[record.dataset_id];
  if (dataset && dataset.planet_id !== record.planet_id) {
    errors.push(`dataset belongs to planet ${dataset.planet_id}, not ${record.planet_id}`);
  }

  return errors;
}

module.exports = {
  SUPABASE_URL,
  OPERATORS,
  buildPostgrestQuery,
  postgrestQuery,
  postgrestInsert,
  postgrestInsertReturning,
  postgrestUpsert,
  postgrestDelete,
  postgrestCount,
  validateMeasurementRecord,
};
