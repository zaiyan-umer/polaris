// NASA Planetary Data System (PDS) Search API client
// Source: https://nasa-pds.github.io/pds-api/specifications/search-v1.1.0-redoc.html
//         https://nasa-pds.github.io/pds-api/guides/search/endpoints.html
//
// The PDS Search API is a catalogue of PDS4 products (bundles, collections and
// observational products). It returns metadata and links to product files; it
// does not stream the observational payload itself.
//
// Verified base URL:
//   https://pds.nasa.gov/api/search/1/
//
// Verified query syntax (LDD field paths, not free text):
//   ?q=(geom:Geometry_Target_Identification.geom:name eq "Mars")&limit=10
//   ?q=(pds:Primary_Result_Summary.pds:processing_level eq "Raw")&limit=10
//
// Response shape (verified):
//   { summary: { hits: N, properties: [...] }, data: [ { id, type, title, ... } ] }

const { fetchWithRetry } = require('../http.cjs');

const PDS_API_BASE = 'https://pds.nasa.gov/api/search/1/';

/**
 * Search PDS products.
 * @param {string} q  PDS query expression, e.g. '(geom:Geometry_Target_Identification.geom:name eq "Mars")'
 * @param {number} limit
 * @param {string[]} [fields]  Field paths to return, e.g. ['product_id','title']
 */
async function searchPdsProducts(q, limit = 10, fields = null) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (fields && fields.length) {
    params.append('fields', fields.join(','));
  }

  const response = await fetchWithRetry(`${PDS_API_BASE}products?${params}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PDS product search error: HTTP ${response.status} - ${body.slice(0, 200)}`);
  }

  return response.json();
}

/**
 * List the PDS product classes usable with /classes/{class}.
 */
async function listPdsClasses() {
  const response = await fetchWithRetry(`${PDS_API_BASE}classes`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`PDS classes error: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * List the searchable LDD property names.
 * Useful for discovering valid `q` field paths instead of guessing them.
 */
async function listPdsProperties() {
  const response = await fetchWithRetry(`${PDS_API_BASE}properties`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`PDS properties error: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Search products for a planetary target by name.
 * @param {'Mars'|'Moon'|'Mercury'|'Venus'} targetName
 */
async function searchPdsByTarget(targetName, limit = 10) {
  return searchPdsProducts(
    `(geom:Geometry_Target_Identification.geom:name eq "${targetName}")`,
    limit,
    ['product_id', 'title', 'type'],
  );
}

module.exports = {
  PDS_API_BASE,
  searchPdsProducts,
  searchPdsByTarget,
  listPdsClasses,
  listPdsProperties,
};
