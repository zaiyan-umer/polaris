// Copernicus Data Space Ecosystem client
// Sources:
//   STAC API:  https://documentation.dataspace.copernicus.eu/APIs/STAC.html
//   DEM (COG): https://copernicus-dem-30m.s3.amazonaws.com/  (AWS Open Data)
//
// The STAC API at stac.dataspace.copernicus.eu is a catalogue: it returns
// collection and item metadata. It does not serve the DEM pixels directly.
//
// The Copernicus DEM GLO-30 pixels are public on AWS S3 as Cloud Optimised
// GeoTIFFs (COG), one 1x1 degree tile per object. They can be read over HTTP
// with range requests using the `geotiff` package, which is how this project
// extracts real elevations without pulling a 48 MB tile into memory.
//
// Verified:
//   https://stac.dataspace.copernicus.eu/v1/collections?limit=100
//   https://copernicus-dem-30m.s3.amazonaws.com/<tile>/<tile>.tif   (HTTP 200, image/tiff)

const { fetchWithRetry } = require('../http.cjs');

const COPERNICUS_STAC_BASE = 'https://stac.dataspace.copernicus.eu/v1/';
const COPERNICUS_DEM_BUCKET = 'https://copernicus-dem-30m.s3.amazonaws.com/';
const COPERNICUS_DEM_COLLECTION = 'cop-dem-glo-30';

/**
 * List Copernicus STAC collections.
 * @param {number} limit
 */
async function listStacCollections(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetchWithRetry(`${COPERNICUS_STAC_BASE}collections?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Copernicus STAC collections error: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Search STAC items in a collection within a bounding box.
 * @param {string} collection  e.g. 'sentinel-2-l2a'
 * @param {{minLon:number,minLat:number,maxLon:number,maxLat:number}} bounds
 * @param {number} limit
 */
async function searchStacItems(collection, bounds = null, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bounds) {
    params.append('bbox', `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`);
  }
  const response = await fetchWithRetry(`${COPERNICUS_STAC_BASE}collections/${encodeURIComponent(collection)}/items?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Copernicus STAC items error: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Build the Copernicus DEM GLO-30 COG tile name for a coordinate.
 * Tiles are named by their south-west corner:
 *   Copernicus_DSM_COG_10_N30_00_E031_00_DEM
 */
function demTileName(latitude, longitude) {
  const ns = latitude >= 0 ? 'N' : 'S';
  const ew = longitude >= 0 ? 'E' : 'W';
  const lat = Math.abs(Math.floor(latitude));
  const lon = Math.abs(Math.floor(longitude));
  return `Copernicus_DSM_COG_10_${ns}${String(lat).padStart(2, '0')}_00_${ew}${String(lon).padStart(3, '0')}_00_DEM`;
}

/**
 * Full HTTPS URL for a Copernicus DEM GLO-30 tile.
 */
function demTileUrl(latitude, longitude) {
  const name = demTileName(latitude, longitude);
  return `${COPERNICUS_DEM_BUCKET}${name}/${name}.tif`;
}

module.exports = {
  COPERNICUS_STAC_BASE,
  COPERNICUS_DEM_BUCKET,
  COPERNICUS_DEM_COLLECTION,
  listStacCollections,
  searchStacItems,
  demTileName,
  demTileUrl,
};
