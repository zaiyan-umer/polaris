// NASA PDS Geosciences Node - Orbital Data Explorer (ODE) REST client
// Sources:
//   ODE REST V2.1.6 manual : https://oderest.rsl.wustl.edu/
//   ODE API FAQ            : https://ode.rsl.wustl.edu/MArs/pagehelp/...
//
// ODE is the search/download front end for PDS planetary orbital data. Two
// interfaces are used here:
//
//  1. /live2   - catalogue queries (IIPT sets, feature names, product metadata)
//  2. /livegds - Granular Data System: returns SUBSETS OF ACTUAL POINT DATA
//                for MGS MOLA, LRO LOLA, LRO Diviner and MESSENGER MLA.
//                This is the interface that yields real measurements rather
//                than catalogue metadata.
//
// Verified:
//   https://oderest.rsl.wustl.edu/live2/?query=iipt&results=c&output=JSON
//   https://oderest.rsl.wustl.edu/livegds?query=lolardr&results=vsi&maxlat=..&minlat=..&westernlon=..&easternlon=..
//   https://oderest.rsl.wustl.edu/livegds?query=molapedr&results=vsi&...
//
// IMPORTANT (verified): MOLA PEDR longitudes are 0-360 degrees east, while
// LOLA RDR longitudes are -180..180. Passing a negative longitude to MOLA
// returns "Invalid Lat/Lon Bounding Box".
//
// IMPORTANT (verified): a GDS query is asynchronous server-side and takes
// roughly 10-15 s for a 0.1-0.15 degree box. Queries are therefore issued one
// at a time and their result files downloaded afterwards.

const { fetchWithRetry } = require('../http.cjs');

const ODE_LIVE_BASE = 'https://oderest.rsl.wustl.edu/live2/';
const ODE_GDS_BASE = 'https://oderest.rsl.wustl.edu/livegds';

// GDS query identifiers (verified against the ODE IIPT listing)
const GDS_QUERIES = {
  LOLA_RDR: 'lolardr',
  MOLA_PEDR: 'molapedr',
  DIVINER_RDR: 'divinerrdr',
  MLA_RDR: 'mlardr',
};

/**
 * Query the ODE catalogue (IIPT sets, feature classes, feature names).
 * @param {'iipt'|'featureclasses'|'featurenames'} query
 * @param {'moon'|'mars'|'mercury'|'venus'} target
 */
async function queryOdeCatalog(query, target = null, results = 'c') {
  const params = new URLSearchParams({ query, results, output: 'JSON' });
  if (target) params.append('target', target);

  const response = await fetchWithRetry(`${ODE_LIVE_BASE}?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ODE catalogue error: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Query the ODE Granular Data System for point observations in a bounding box.
 *
 * @param {'lolardr'|'molapedr'|'divinerrdr'|'mlardr'} queryType
 * @param {{minLat:number,maxLat:number,minLon:number,maxLon:number}} bbox
 *        Longitudes must already be in the convention the instrument expects
 *        (MOLA: 0-360 east, LOLA/Diviner: -180..180).
 * @param {'vsi'|'c'|'cm'} results  vsi returns the downloadable result files
 * @returns {Promise<{status:string,count:number,note:string,files:string[],raw:string}>}
 */
async function queryOdeGds(queryType, bbox, results = 'vsi') {
  const params = new URLSearchParams({
    query: queryType,
    results,
    output: 'XML',
    maxlat: String(bbox.maxLat),
    minlat: String(bbox.minLat),
    westernlon: String(bbox.minLon),
    easternlon: String(bbox.maxLon),
  });

  const response = await fetchWithRetry(`${ODE_GDS_BASE}?${params}`, {
    headers: { Accept: 'application/xml' },
  });
  if (!response.ok) {
    throw new Error(`ODE GDS error: HTTP ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  return parseGdsResponse(raw);
}

/**
 * Parse the ODE GDS XML response into a small, typed object.
 * The response is simple, flat XML, so a targeted parse is sufficient and
 * avoids pulling in an XML dependency.
 */
function parseGdsResponse(xml) {
  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };

  const status = pick('Status');
  const count = pick('Count');
  const note = pick('StatusNote');
  const files = [...xml.matchAll(/<URL>([^<]+)<\/URL>/g)].map(m => m[1]);

  return {
    status,
    count: count == null ? null : Number(count),
    note,
    files,
    raw: xml,
  };
}

/**
 * Pick the point-data CSV out of a GDS result file list.
 * ODE emits several files per query (shapefiles, labels, images); the
 * `_pts_csv.csv` object holds one row per laser shot.
 */
function pickPointsCsv(files) {
  return files.find(u => u.includes('_pts_csv.csv')) ?? null;
}

/**
 * Pick the topography CSV out of a GDS result file list.
 */
function pickTopoCsv(files) {
  return files.find(u => u.includes('_topo_csv.csv')) ?? null;
}

/**
 * Download and parse a GDS point CSV.
 * @returns {{header:string[], rows:string[][]}}
 */
async function fetchPointCsv(url) {
  // ODE rejects a narrow Accept header on the generated result files with
  // HTTP 406, so request them without an explicit content type.
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`GDS file error: HTTP ${response.status} for ${url}`);
  }
  const text = await response.text();
  return parseCsv(text);
}

/**
 * Minimal CSV parser. The GDS CSVs are comma-separated with a single header
 * line and no quoted fields, so a split is sufficient. Values are trimmed
 * because the PDS generator pads numeric columns with spaces.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const split = (line) => line.split(',').map(c => c.trim());
  return {
    header: split(lines[0]),
    rows: lines.slice(1).map(split),
  };
}

/**
 * Map a LOLA RDR point row to a typed record.
 *
 * Elevation is derived from the laser ranging geometry:
 *   Pt_Radius is the distance from the point to the lunar centre (km)
 *   Geoid     is the reference radius for the same observation (km)
 *   elevation = (Pt_Radius - Geoid) * 1000   -> metres
 *
 * Both columns are read from the same row, so the reference surface is the
 * one the instrument team used rather than a hard-coded constant.
 */
function mapLolaPoint(header, row) {
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const num = (name) => {
    const i = idx(name);
    if (i < 0) return null;
    const v = Number(row[i]);
    return Number.isFinite(v) ? v : null;
  };
  const str = (name) => {
    const i = idx(name);
    return i >= 0 ? row[i] : null;
  };

  const radiusKm = num('Pt_Radius');
  const geoidKm = num('Geoid');

  return {
    utc: str('Coordinated_Universal_Time'),
    longitude: num('Pt_Longitude'),
    latitude: num('Pt_Latitude'),
    radiusKm,
    geoidKm,
    elevationM: radiusKm != null && geoidKm != null ? (radiusKm - geoidKm) * 1000 : null,
    qualityFlag: num('Flg'),
  };
}

/**
 * Map a MOLA PEDR point row to a typed record.
 * MOLA PEDR reports `TOPOGRAPHY` directly in metres above the MOLA areoid.
 */
function mapMolaPoint(header, row) {
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const num = (name) => {
    const i = idx(name);
    if (i < 0) return null;
    const v = Number(row[i]);
    return Number.isFinite(v) ? v : null;
  };
  const str = (name) => {
    const i = idx(name);
    return i >= 0 ? row[i] : null;
  };

  return {
    utc: str('UTC'),
    longitudeEast: num('LONG_EAST'),
    latitude: num('LAT_NORTH'),
    elevationM: num('TOPOGRAPHY'),
    orbit: str('ORBIT'),
  };
}

module.exports = {
  ODE_LIVE_BASE,
  ODE_GDS_BASE,
  GDS_QUERIES,
  queryOdeCatalog,
  queryOdeGds,
  parseGdsResponse,
  pickPointsCsv,
  pickTopoCsv,
  fetchPointCsv,
  parseCsv,
  mapLolaPoint,
  mapMolaPoint,
};
