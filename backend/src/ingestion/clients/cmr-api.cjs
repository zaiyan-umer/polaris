// NASA CMR (Common Metadata Repository) API Client
// Source: https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html
//
// CMR is a catalogue: it returns collection and granule METADATA. It does not
// return radiometric measurements. Use it to register dataset versions and
// dataset assets (with download URLs), never as a source of `measurements`.
//
// Verified endpoints:
//   GET https://cmr.earthdata.nasa.gov/search/collections.json?short_name=..
//   GET https://cmr.earthdata.nasa.gov/search/granules.json?short_name=..&bounding_box=..
//
// Response shape (verified):
//   collections -> { feed: { entry: [ { short_name, version_id, processing_level_id,
//                                        id, title, links[], time_start, ... } ] } }
//   granules    -> { feed: { entry: [ { id, title, time_start, links[], ... } ] } }

const { fetchWithRetry } = require('../http.cjs');

const CMR_BASE = 'https://cmr.earthdata.nasa.gov/search/';

/**
 * Search CMR collections by short name.
 * @param {string} shortName  e.g. 'MOD11A1'
 * @param {number} pageSize
 */
async function searchCmrCollections(shortName, pageSize = 10) {
  const params = new URLSearchParams({
    short_name: shortName,
    page_size: String(pageSize),
  });

  const response = await fetchWithRetry(`${CMR_BASE}collections.json?${params}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CMR collection search error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Search CMR granules for a collection within a bounding box.
 * @param {string} collectionShortName  e.g. 'MOD11A1'
 * @param {{minLon:number,minLat:number,maxLon:number,maxLat:number}} bounds
 * @param {string} [temporal]  ISO interval, e.g. '2024-01-01T00:00:00Z,2024-01-31T23:59:59Z'
 * @param {number} pageSize
 */
async function searchCmrGranules(collectionShortName, bounds = null, temporal = null, pageSize = 10) {
  const params = new URLSearchParams({
    short_name: collectionShortName,
    page_size: String(pageSize),
  });

  if (bounds) {
    // CMR expects west,south,east,north
    params.append('bounding_box', `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`);
  }
  if (temporal) {
    params.append('temporal', temporal);
  }

  const response = await fetchWithRetry(`${CMR_BASE}granules.json?${params}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CMR granule search error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Extract the first "data" download link from a CMR granule entry.
 * CMR marks downloadable links with rel ending in '#data#' or type 'application/x-hdfeos'.
 */
function extractDataLink(granule) {
  const links = granule?.links ?? [];
  const preferred = links.find(l => (l.rel || '').includes('#data#') && l.href)
    || links.find(l => l.href && (l.type || '').includes('hdf'))
    || links.find(l => l.href && l.href.startsWith('s3://'));
  return preferred?.href ?? null;
}

/**
 * Normalise a CMR collection entry into the fields Polaris stores.
 */
function mapCmrCollection(entry) {
  return {
    shortName: entry.short_name ?? null,
    versionId: entry.version_id ?? null,
    processingLevel: entry.processing_level_id ?? null,
    conceptId: entry.id ?? null,
    title: entry.title ?? null,
    timeStart: entry.time_start ?? null,
    timeEnd: entry.time_end ?? null,
    doi: entry.links?.find(l => (l.href || '').startsWith('https://doi.org/'))?.href ?? null,
  };
}

module.exports = {
  CMR_BASE,
  searchCmrCollections,
  searchCmrGranules,
  extractDataLink,
  mapCmrCollection,
};
