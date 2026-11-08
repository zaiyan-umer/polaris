// ============================================================================
// Polaris — real scientific data ingestion
// ============================================================================
//
// Extracts real observations from five public sources and writes them into the
// existing 13-table Supabase schema. Nothing in this file fabricates a value:
// every row that reaches `measurements` is derived from an HTTP response, and
// the source identifier is carried into `provenance`.
//
//   NASA POWER    Earth  temperature   (MERRA-2 reanalysis, degC -> K)
//   Copernicus    Earth  elevation     (DEM GLO-30 COG tiles, metres)
//   ODE/LOLA      Moon   elevation     (LOLA RDR laser altimetry, metres)
//   ODE/MOLA      Mars   elevation     (MOLA PEDR laser altimetry, metres)
//   NASA CMR      Earth  metadata      (MOD11A1 collection + granules -> assets)
//
// Sources are queried for the coordinates already present in `locations`, so no
// location is invented either.
//
// Usage:
//   node src/ingestion/services/ingest-real-data.cjs            # dry run
//   node src/ingestion/services/ingest-real-data.cjs --execute  # write
//
// Idempotent: re-running skips rows that already exist.

const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Environment
// ----------------------------------------------------------------------------

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.env'), 'utf8');
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
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;

const {
  postgrestQuery,
  postgrestInsert,
  postgrestInsertReturning,
  postgrestUpsert,
  postgrestCount,
  validateMeasurementRecord,
} = require('../rest-client.cjs');

const {
  fetchPowerTemperatureData,
  parsePowerDailyResponse,
  POWER_API_BASE,
} = require('../clients/power-api.cjs');
const { fetchWithRetry } = require('../http.cjs');
const { demTileName, demTileUrl } = require('../clients/copernicus-api.cjs');
const {
  queryOdeGds,
  pickPointsCsv,
  fetchPointCsv,
  mapLolaPoint,
  mapMolaPoint,
  ODE_GDS_BASE,
} = require('../clients/ode-api.cjs');
const { searchCmrCollections, searchCmrGranules, extractDataLink, CMR_BASE } = require('../clients/cmr-api.cjs');

const DRY_RUN = !process.argv.includes('--execute');

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------

const POWER_DATE_START = '20240101';
const POWER_DATE_END = '20240131';
const GDS_BBOX_DEG = 0.1;          // half-width of the altimetry query box
const MAX_POINTS_PER_LOCATION = 400; // cap on altimetry rows written per location
const BATCH_SIZE = 200;

// ----------------------------------------------------------------------------
// Small utilities
// ----------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

function toIsoUtc(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** MOLA PEDR uses 0-360 east longitude; the schema stores -180..180. */
function to180(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  return l === -180 ? 180 : l;
}

function stats(values) {
  const n = values.length;
  if (n === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    count: n,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    stddev: Math.sqrt(variance),
  };
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// ----------------------------------------------------------------------------
// Catalogue access (get-or-create)
// ----------------------------------------------------------------------------

class Catalogue {
  constructor() {
    this.planets = [];
    this.locations = [];
    this.datasets = [];
    this.variables = [];
    this.datasetVariables = [];
    this.locationsById = {};
    this.datasetsById = {};
    this.variablesById = {};
    this.datasetIdBySlug = {};
  }

  async load() {
    [this.planets, this.locations, this.datasets, this.variables, this.datasetVariables] =
      await Promise.all([
        postgrestQuery('planets'),
        postgrestQuery('locations'),
        postgrestQuery('datasets'),
        postgrestQuery('variables'),
        postgrestQuery('dataset_variables'),
      ]);

    for (const l of this.locations) this.locationsById[l.id] = l;
    for (const d of this.datasets) {
      this.datasetsById[d.id] = d;
      this.datasetIdBySlug[d.short_name] = d.id;
    }
    for (const v of this.variables) this.variablesById[v.id] = v;
  }

  planet(slug) {
    return this.planets.find(p => p.slug === slug);
  }

  datasetBySlug(slug) {
    const id = this.datasetIdBySlug[slug];
    return id ? this.datasetsById[id] : null;
  }

  variableByName(name) {
    return this.variables.find(v => v.name === name) ?? null;
  }

  locationsOn(planetSlug) {
    const p = this.planet(planetSlug);
    return this.locations.filter(l => l.planet_id === p.id);
  }
}

/** Get or create a dataset. `datasets` has no unique key on short_name, so this
 *  is a read-then-insert guarded by (short_name, planet_id). */
async function ensureDataset(cat, spec) {
  const existing = cat.datasets.find(
    d => d.short_name === spec.slug && d.planet_id === cat.planet(spec.planetSlug).id
  );
  if (existing) return existing;

  const created = await postgrestInsertReturning('datasets', [{
    planet_id: cat.planet(spec.planetSlug).id,
    short_name: spec.slug,
    description: spec.description,
    source_url: spec.source_url,
    source_type: spec.source_type,
    native_crs: spec.native_crs,
  }]);
  const row = created[0];
  cat.datasets.push(row);
  cat.datasetsById[row.id] = row;
  cat.datasetIdBySlug[row.short_name] = row.id;
  return row;
}

/** Bind a dataset to a variable (PK is (dataset_id, variable_id)). */
async function ensureDatasetVariable(cat, datasetId, variableId, nativeUnit, nativeResolutionM) {
  const exists = cat.datasetVariables.some(
    dv => dv.dataset_id === datasetId && dv.variable_id === variableId
  );
  if (exists) return;

  await postgrestUpsert('dataset_variables', [{
    dataset_id: datasetId,
    variable_id: variableId,
    native_unit: nativeUnit,
    native_resolution_m: nativeResolutionM,
  }], { onConflict: 'dataset_id,variable_id' });

  cat.datasetVariables.push({ dataset_id: datasetId, variable_id: variableId });
}

/** Register a dataset version (unique on (dataset_id, version_identifier)). */
async function ensureDatasetVersion(cat, spec) {
  const existing = await postgrestQuery('dataset_versions', {
    dataset_id: { eq: spec.dataset_id },
    version_identifier: { eq: spec.version_identifier },
  });
  if (existing.length > 0) return existing[0];

  const created = await postgrestInsertReturning('dataset_versions', [{
    dataset_id: spec.dataset_id,
    source_type: spec.source_type,
    source_crs: spec.source_crs ?? null,
    native_unit: spec.native_unit ?? null,
    native_resolution_m: spec.native_resolution_m ?? null,
    file_format: spec.file_format ?? null,
    download_url: spec.download_url ?? null,
    metadata_url: spec.metadata_url ?? null,
    acquisition_start: spec.acquisition_start ?? null,
    acquisition_end: spec.acquisition_end ?? null,
    processing_level: spec.processing_level ?? null,
    version_identifier: spec.version_identifier,
  }]);
  return created[0];
}

// ----------------------------------------------------------------------------
// Measurement writes
// ----------------------------------------------------------------------------

/**
 * Insert measurements idempotently.
 *
 * `measurements` has no unique constraint, so idempotency is enforced here: we
 * load the keys already present for (location, dataset, variable) and skip any
 * candidate whose (recorded_at, value) pair is already stored. The pair is a
 * faithful natural key for these sources because each source row carries its
 * own observation timestamp.
 *
 * @returns {{inserted:number, skipped:number, failed:number, errors:string[],
 *            rows:object[]}}
 */
async function writeMeasurements(cat, candidates) {
  const result = { inserted: 0, skipped: 0, failed: 0, errors: [], rows: [] };
  if (candidates.length === 0) return result;

  const keys = candidates.map(c => ({
    location_id: c.location_id,
    dataset_id: c.dataset_id,
    variable_id: c.variable_id,
  }));
  const uniqueCombos = [];
  const seen = new Set();
  for (const k of keys) {
    const key = `${k.location_id}|${k.dataset_id}|${k.variable_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCombos.push(k);
    }
  }

  const existing = new Set();
  // Normalise the timestamp before keying: PostgREST returns timestamptz as
  // "2024-01-01T00:00:00+00:00" while the candidate is built as
  // "2024-01-01T00:00:00.000Z". Comparing epoch milliseconds makes the natural
  // key stable across both spellings, which is what makes a re-run a no-op.
  const naturalKeyOf = (timestamp, value) => `${Date.parse(timestamp)}|${value}`;

  for (const combo of uniqueCombos) {
    const rows = await postgrestQuery('measurements', {
      location_id: { eq: combo.location_id },
      dataset_id: { eq: combo.dataset_id },
      variable_id: { eq: combo.variable_id },
    }, { select: 'recorded_at,value' });
    for (const r of rows) existing.add(naturalKeyOf(r.recorded_at, r.value));
  }

  const toInsert = [];
  for (const c of candidates) {
    const naturalKey = naturalKeyOf(c.recorded_at, c.value);
    if (existing.has(naturalKey)) {
      result.skipped++;
      continue;
    }
    const errors = validateMeasurementRecord(c, {
      variablesById: cat.variablesById,
      locationsById: cat.locationsById,
      datasetsById: cat.datasetsById,
    });
    if (errors.length > 0) {
      result.failed++;
      result.errors.push(`${c.source_label}: ${errors.join('; ')}`);
      continue;
    }
    toInsert.push({ ...c, naturalKey });
  }

  if (DRY_RUN) {
    result.inserted = toInsert.length;
    result.rows = toInsert;
    return result;
  }

  for (const batch of chunk(toInsert, BATCH_SIZE)) {
    // Only real columns may be sent: PostgREST rejects unknown keys, and the
    // candidate objects also carry provenance-only metadata.
    const payload = batch.map(c => ({
      planet_id: c.planet_id,
      location_id: c.location_id,
      dataset_id: c.dataset_id,
      variable_id: c.variable_id,
      value: c.value,
      value_unit: c.value_unit,
      native_value: c.native_value ?? null,
      native_resolution_m: c.native_resolution_m ?? null,
      quality_flag: c.quality_flag ?? null,
      recorded_at: c.recorded_at,
    }));
    try {
      const created = await postgrestInsertReturning('measurements', payload);
      result.inserted += created.length;
      result.rows.push(...created);
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(`batch of ${batch.length} failed: ${err.message}`);
      if (result.errors.length <= 3) {
        console.log(`    insert error: ${err.message}`);
      }
    }
  }
  return result;
}

/** Write provenance rows for a set of created targets. */
async function writeProvenance(entries) {
  if (entries.length === 0) return { inserted: 0, skipped: 0, failed: 0, errors: [] };
  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  if (DRY_RUN) {
    result.inserted = entries.length;
    return result;
  }

  for (const batch of chunk(entries, BATCH_SIZE)) {
    try {
      await postgrestUpsert('provenance', batch, {
        onConflict: 'record_type,target_id,source_type,record_id',
      });
      result.inserted += batch.length;
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(`provenance batch failed: ${err.message}`);
    }
  }
  return result;
}

// ----------------------------------------------------------------------------
// Stage 1 — reference data (datasets, variables, versions)
// ----------------------------------------------------------------------------

async function stageReference(cat) {
  console.log('\n=== Stage 1: reference data ===');

  const power = await ensureDataset(cat, {
    slug: 'NASA_POWER',
    planetSlug: 'earth',
    description: 'NASA POWER daily meteorological reanalysis (MERRA-2 based), temperature',
    source_url: 'https://power.larc.nasa.gov/',
    source_type: 'derived',
    native_crs: 'WGS84',
  });
  console.log(`  dataset NASA_POWER -> ${power.id}`);

  const dem = cat.datasetBySlug('DEM');
  const lola = cat.datasetBySlug('LOLA');
  const mola = cat.datasetBySlug('MOLA');
  const modis = cat.datasetBySlug('MODIS');

  const temperature = cat.variableByName('temperature');
  const elevation = cat.variableByName('elevation');

  await ensureDatasetVariable(cat, dem.id, elevation.id, 'm', 30);
  await ensureDatasetVariable(cat, lola.id, elevation.id, 'm', 25);
  await ensureDatasetVariable(cat, mola.id, elevation.id, 'm', 100);
  await ensureDatasetVariable(cat, power.id, temperature.id, 'K', 55000);
  console.log('  dataset_variables bound');

  const versions = {};
  versions.dem = await ensureDatasetVersion(cat, {
    dataset_id: dem.id,
    version_identifier: 'GLO-30',
    source_type: 'derived',
    source_crs: 'WGS84',
    native_unit: 'm',
    native_resolution_m: 30,
    file_format: 'GeoTIFF (Cloud Optimised)',
    download_url: 'https://copernicus-dem-30m.s3.amazonaws.com/',
    metadata_url: 'https://spacedata.copernicus.eu/web/cscda/dataset-details?articleId=394198',
    processing_level: 'GLO-30',
  });
  versions.lola = await ensureDatasetVersion(cat, {
    dataset_id: lola.id,
    version_identifier: 'RDR',
    source_type: 'instrument',
    source_crs: 'Lunar planetocentric ME frame (IAU/IAG DE421)',
    native_unit: 'm',
    native_resolution_m: 25,
    file_format: 'PDS4 RDR (via ODE GDS)',
    download_url: ODE_GDS_BASE,
    metadata_url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm',
    processing_level: 'RDR',
  });
  versions.mola = await ensureDatasetVersion(cat, {
    dataset_id: mola.id,
    version_identifier: 'PEDR',
    source_type: 'instrument',
    source_crs: 'MOLA areoid (IAU2000)',
    native_unit: 'm',
    native_resolution_m: 100,
    file_format: 'PDS3 PEDR (via ODE GDS)',
    download_url: ODE_GDS_BASE,
    metadata_url: 'https://pds-geosciences.wustl.edu/missions/mgs/mola.html',
    processing_level: 'PEDR',
  });
  versions.power = await ensureDatasetVersion(cat, {
    dataset_id: power.id,
    version_identifier: 'POWER-Daily-v2.10.3',
    source_type: 'derived',
    source_crs: 'WGS84',
    native_unit: 'K',
    native_resolution_m: 55000,
    file_format: 'JSON (REST)',
    download_url: POWER_API_BASE,
    metadata_url: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
    acquisition_start: new Date(`${POWER_DATE_START.slice(0, 4)}-${POWER_DATE_START.slice(4, 6)}-${POWER_DATE_START.slice(6, 8)}T00:00:00Z`).toISOString(),
    acquisition_end: new Date(`${POWER_DATE_END.slice(0, 4)}-${POWER_DATE_END.slice(4, 6)}-${POWER_DATE_END.slice(6, 8)}T00:00:00Z`).toISOString(),
    processing_level: 'daily',
  });
  console.log('  dataset_versions registered:', Object.keys(versions).join(', '));

  return { power, dem, lola, mola, modis, temperature, elevation, versions };
}

// ----------------------------------------------------------------------------
// Stage 2 — NASA POWER (Earth temperature)
// ----------------------------------------------------------------------------

async function stagePower(cat, refs) {
  console.log('\n=== Stage 2: NASA POWER (Earth temperature) ===');
  const out = { fetched: 0, inserted: 0, skipped: 0, failed: 0, errors: [] };

  const candidates = [];
  for (const loc of cat.locationsOn('earth')) {
    if (loc.latitude_deg == null || loc.longitude_deg == null) continue;

    let response;
    try {
      response = await fetchPowerTemperatureData(
        loc.latitude_deg, loc.longitude_deg, POWER_DATE_START, POWER_DATE_END
      );
    } catch (err) {
      out.failed++;
      out.errors.push(`${loc.name}: POWER request failed: ${err.message}`);
      continue;
    }

    const records = parsePowerDailyResponse(response);
    const t2m = records.filter(r => r.parameter === 'T2M' && !r.is_fill);
    out.fetched += t2m.length;

    for (const r of t2m) {
      const celsius = r.value;
      const kelvin = celsius + 273.15;
      candidates.push({
        planet_id: loc.planet_id,
        location_id: loc.id,
        dataset_id: refs.power.id,
        variable_id: refs.temperature.id,
        value: Number(kelvin.toFixed(4)),
        value_unit: 'K',
        native_value: celsius,
        native_resolution_m: 55000,
        quality_flag: 'derived',
        recorded_at: toIsoUtc(`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}T00:00:00Z`),
        source_label: `POWER ${loc.name} ${r.date}`,
        source_name: 'NASA POWER',
        source_url: POWER_API_BASE,
        source_record_id: `POWER:T2M:${loc.name}:${r.date}`,
        transformation: `degC -> K (+273.15); source unit ${r.unit}`,
      });
    }
  }

  const written = await writeMeasurements(cat, candidates);
  out.inserted = written.inserted;
  out.skipped = written.skipped;
  out.failed += written.failed;
  out.errors.push(...written.errors);

  for (const row of written.rows) {
    out.inserted && refs.provenance.push({
      record_type: 'measurement',
      target_id: row.id,
      source_type: 'api',
      source_name: 'NASA POWER',
      source_url: POWER_API_BASE,
      record_id: `POWER:T2M:${row.location_id}:${row.recorded_at}`,
      processing_params: JSON.stringify({ parameter: 'T2M', community: 'AG', start: POWER_DATE_START, end: POWER_DATE_END }),
      processing_version: 'polaris-ingest-1.0',
      transformation: 'degC -> K (+273.15)',
      validation_status: 'verified',
    });
  }

  console.log(`  fetched ${out.fetched} daily T2M values; inserted ${out.inserted}, skipped ${out.skipped}, failed ${out.failed}`);
  return out;
}

// ----------------------------------------------------------------------------
// Stage 3 — Copernicus DEM (Earth elevation)
// ----------------------------------------------------------------------------

async function readDemWindow(lat, lon) {
  const { fromUrl } = await import('geotiff');
  const name = demTileName(lat, lon);
  const url = demTileUrl(lat, lon);

  const head = await fetchWithRetry(url, { method: 'HEAD' });
  const lastModified = head.headers.get('last-modified');

  // The COG is read with HTTP range requests, any of which can drop. Retry the
  // whole open+read sequence rather than the individual byte ranges.
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const tiff = await fromUrl(url);
      const image = await tiff.getImage(0);

      const width = image.getWidth();
      const height = image.getHeight();
      const [minX, minY, maxX, maxY] = image.getBoundingBox();
      const resX = (maxX - minX) / width;
      const resY = (maxY - minY) / height;

      const px = Math.min(width - 1, Math.max(0, Math.floor((lon - minX) / resX)));
      const py = Math.min(height - 1, Math.max(0, Math.floor((maxY - lat) / Math.abs(resY))));

      const x0 = Math.max(0, px - 2);
      const x1 = Math.min(width, px + 3);
      const y0 = Math.max(0, py - 2);
      const y1 = Math.min(height, py + 3);

      const raster = await image.readRasters({ window: [x0, y0, x1, y1] });
      const data = raster[0];
      const w = x1 - x0;

      const values = [];
      for (let j = 0; j < y1 - y0; j++) {
        for (let i = 0; i < w; i++) values.push(data[j * w + i]);
      }

      return {
        tile: name,
        url,
        lastModified,
        center: data[(py - y0) * w + (px - x0)],
        values,
        pixel: { px, py },
        window: [x0, y0, x1, y1],
      };
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
  throw lastError;
}

async function stageDem(cat, refs) {
  console.log('\n=== Stage 3: Copernicus DEM GLO-30 (Earth elevation) ===');
  const out = { fetched: 0, inserted: 0, skipped: 0, failed: 0, errors: [] };

  const candidates = [];
  for (const loc of cat.locationsOn('earth')) {
    if (loc.latitude_deg == null || loc.longitude_deg == null) continue;

    let dem;
    try {
      dem = await readDemWindow(loc.latitude_deg, loc.longitude_deg);
    } catch (err) {
      out.failed++;
      out.errors.push(`${loc.name}: DEM read failed: ${err.message}`);
      console.log(`    DEM error for ${loc.name}: ${err.message}`);
      continue;
    }

    out.fetched++;
    const recordedAt = toIsoUtc(dem.lastModified) ?? nowIso();
    candidates.push({
      planet_id: loc.planet_id,
      location_id: loc.id,
      dataset_id: refs.dem.id,
      variable_id: refs.elevation.id,
      value: Number(dem.center.toFixed(3)),
      value_unit: 'm',
      native_value: Number(dem.center.toFixed(3)),
      native_resolution_m: 30,
      quality_flag: 'derived',
      recorded_at: recordedAt,
      source_label: `Copernicus DEM ${loc.name} ${dem.tile}`,
      source_name: 'Copernicus DEM GLO-30',
      source_url: dem.url,
      source_record_id: `COP-DEM:${dem.tile}:${loc.name}`,
      transformation: 'none (metres above EGM2008 geoid, as distributed)',
    });
  }

  const written = await writeMeasurements(cat, candidates);
  Object.assign(out, { inserted: written.inserted, skipped: written.skipped, failed: out.failed + written.failed });
  out.errors.push(...written.errors);

  for (const row of written.rows) {
    refs.provenance.push({
      record_type: 'measurement',
      target_id: row.id,
      source_type: 'api',
      source_name: 'Copernicus DEM GLO-30',
      source_url: demTileUrl(cat.locationsById[row.location_id]?.latitude_deg ?? 0, cat.locationsById[row.location_id]?.longitude_deg ?? 0),
      record_id: `COP-DEM:${row.location_id}:${row.recorded_at}`,
      processing_params: JSON.stringify({ product: 'Copernicus DEM GLO-30', resolution_m: 30, tile: demTileName(cat.locationsById[row.location_id]?.latitude_deg ?? 0, cat.locationsById[row.location_id]?.longitude_deg ?? 0) }),
      processing_version: 'polaris-ingest-1.0',
      transformation: 'none (source already in metres)',
      validation_status: 'verified',
    });
  }

  console.log(`  tiles read ${out.fetched}; inserted ${out.inserted}, skipped ${out.skipped}, failed ${out.failed}`);
  return out;
}

// ----------------------------------------------------------------------------
// Stage 4/5 — ODE altimetry (LOLA on the Moon, MOLA on Mars)
// ----------------------------------------------------------------------------

async function ingestAltimetry(cat, refs, { planetSlug, queryType, datasetId, mapper, label, sourceName }) {
  console.log(`\n=== ${label} ===`);
  const out = { fetched: 0, inserted: 0, skipped: 0, failed: 0, errors: [] };
  const candidates = [];

  for (const loc of cat.locationsOn(planetSlug)) {
    if (loc.latitude_deg == null || loc.longitude_deg == null) {
      // No coordinates means no bounding box to query: a skip, not a failure.
      out.skipped++;
      out.errors.push(`${loc.name}: no coordinates, skipped`);
      continue;
    }

    const bbox = {
      minLat: loc.latitude_deg - GDS_BBOX_DEG,
      maxLat: loc.latitude_deg + GDS_BBOX_DEG,
      minLon: loc.longitude_deg - GDS_BBOX_DEG,
      maxLon: loc.longitude_deg + GDS_BBOX_DEG,
    };
    // MOLA PEDR expects 0-360 east longitudes.
    if (queryType === 'molapedr') {
      bbox.minLon = bbox.minLon < 0 ? bbox.minLon + 360 : bbox.minLon;
      bbox.maxLon = bbox.maxLon < 0 ? bbox.maxLon + 360 : bbox.maxLon;
    }

    let gds;
    try {
      gds = await queryOdeGds(queryType, bbox, 'vsi');
    } catch (err) {
      out.failed++;
      out.errors.push(`${loc.name}: GDS query failed: ${err.message}`);
      continue;
    }
    if (gds.status !== 'Success' || !gds.count) {
      out.failed++;
      out.errors.push(`${loc.name}: GDS returned ${gds.status} (${gds.note ?? 'no note'})`);
      continue;
    }

    const csvUrl = pickPointsCsv(gds.files);
    if (!csvUrl) {
      out.failed++;
      out.errors.push(`${loc.name}: no point CSV in GDS result`);
      continue;
    }

    let parsed;
    try {
      parsed = await fetchPointCsv(csvUrl);
    } catch (err) {
      out.failed++;
      out.errors.push(`${loc.name}: point CSV download failed: ${err.message}`);
      continue;
    }

    const points = parsed.rows.map(r => mapper(parsed.header, r)).filter(p => p.elevationM != null);
    out.fetched += points.length;

    const sample = points.slice(0, MAX_POINTS_PER_LOCATION);
    for (const p of sample) {
      const recordedAt = toIsoUtc(p.utc);
      if (!recordedAt) continue;
      candidates.push({
        planet_id: loc.planet_id,
        location_id: loc.id,
        dataset_id: datasetId,
        variable_id: refs.elevation.id,
        value: Number(p.elevationM.toFixed(3)),
        value_unit: 'm',
        native_value: Number(p.elevationM.toFixed(3)),
        native_resolution_m: queryType === 'molapedr' ? 100 : 25,
        quality_flag: 'sensor',
        recorded_at: recordedAt,
        source_label: `${label} ${loc.name} ${p.utc}`,
        source_name: sourceName,
        source_url: csvUrl,
        source_record_id: `${queryType}:${p.utc}:${p.longitude ?? p.longitudeEast}`,
        transformation: queryType === 'molapedr'
          ? 'none (MOLA PEDR TOPOGRAPHY is metres above the MOLA areoid)'
          : 'elevation_m = (Pt_Radius_km - Geoid_km) * 1000 (LOLA RDR columns)',
      });
    }

    console.log(`  ${loc.name}: ${points.length} points, writing ${sample.length}`);
  }

  const written = await writeMeasurements(cat, candidates);
  out.inserted = written.inserted;
  out.skipped = written.skipped;
  out.failed += written.failed;
  out.errors.push(...written.errors);

  for (const row of written.rows) {
    refs.provenance.push({
      record_type: 'measurement',
      target_id: row.id,
      source_type: 'api',
      source_name: sourceName,
      source_url: ODE_GDS_BASE,
      record_id: `${queryType}:${row.recorded_at}`,
      processing_params: JSON.stringify({ gds_query: queryType, bbox_deg: GDS_BBOX_DEG, max_points: MAX_POINTS_PER_LOCATION }),
      processing_version: 'polaris-ingest-1.0',
      transformation: queryType === 'molapedr'
        ? 'none (source already in metres above the MOLA areoid)'
        : 'elevation_m = (Pt_Radius - Geoid) * 1000',
      validation_status: 'verified',
    });
  }

  console.log(`  inserted ${out.inserted}, skipped ${out.skipped}, failed ${out.failed}`);
  return out;
}

// ----------------------------------------------------------------------------
// Stage 6 — NASA CMR (MODIS collection + granules -> metadata assets)
// ----------------------------------------------------------------------------

async function stageCmr(cat, refs) {
  console.log('\n=== Stage 6: NASA CMR (MODIS metadata) ===');
  const out = { collections: 0, granules: 0, inserted: 0, failed: 0, errors: [] };

  let collection;
  try {
    const result = await searchCmrCollections('MOD11A1', 1);
    collection = result?.feed?.entry?.[0];
  } catch (err) {
    out.failed++;
    out.errors.push(`CMR collection search failed: ${err.message}`);
    return out;
  }
  if (!collection) {
    out.errors.push('CMR returned no MOD11A1 collection');
    out.failed++;
    return out;
  }
  out.collections = 1;
  console.log(`  collection ${collection.short_name} v${collection.version_id} (${collection.processing_level_id})`);

  const versionIdentifier = `${collection.short_name}.${collection.version_id}`;
  const version = await ensureDatasetVersion(cat, {
    dataset_id: refs.modis.id,
    version_identifier: versionIdentifier,
    source_type: 'instrument',
    source_crs: 'WGS84',
    native_unit: 'K',
    native_resolution_m: 1000,
    file_format: 'HDF-EOS',
    download_url: collection.links?.find(l => (l.href || '').startsWith('https://doi.org/'))?.href ?? null,
    metadata_url: `${CMR_BASE}collections.json?short_name=${collection.short_name}`,
    acquisition_start: collection.time_start ?? null,
    acquisition_end: collection.time_end ?? null,
    processing_level: `L${collection.processing_level_id}`,
  });
  console.log(`  dataset_version ${versionIdentifier} -> ${version.id}`);

  // Granules for the Earth locations that have coordinates.
  const earth = cat.locationsOn('earth').filter(l => l.latitude_deg != null && l.longitude_deg != null);
  const assets = [];
  for (const loc of earth) {
    const bounds = {
      minLon: loc.longitude_deg - 0.5,
      minLat: loc.latitude_deg - 0.5,
      maxLon: loc.longitude_deg + 0.5,
      maxLat: loc.latitude_deg + 0.5,
    };
    let result;
    try {
      result = await searchCmrGranules('MOD11A1', bounds, null, 10);
    } catch (err) {
      out.errors.push(`${loc.name}: granule search failed: ${err.message}`);
      out.failed++;
      continue;
    }
    const entries = result?.feed?.entry ?? [];
    out.granules += entries.length;

    for (const granule of entries) {
      const downloadUrl = extractDataLink(granule);
      assets.push({
        dataset_version_id: version.id,
        product_id: granule.id ?? null,
        platform: 'Terra',
        instrument: 'MODIS',
        acquisition_start: granule.time_start ?? null,
        acquisition_end: granule.time_end ?? null,
        native_crs: 'WGS84',
        native_resolution_m: 1000,
        file_format: 'HDF-EOS',
        download_url: downloadUrl,
        metadata_url: `${CMR_BASE}granules.json?short_name=MOD11A1`,
        availability_status: downloadUrl ? 'available' : 'incomplete',
        created_by: 'polaris-ingest-1.0',
        processing_notes: `CMR granule for ${loc.name}; Earthdata login required to download.`,
      });
    }
  }

  if (!DRY_RUN) {
    for (const batch of chunk(assets, BATCH_SIZE)) {
      try {
        await postgrestUpsert('dataset_assets', batch, {
          onConflict: 'dataset_version_id,product_id',
        });
        out.inserted += batch.length;
      } catch (err) {
        out.failed += batch.length;
        out.errors.push(`asset batch failed: ${err.message}`);
      }
    }
  } else {
    out.inserted = assets.length;
  }

  // Provenance for the assets (needs real ids, so read them back).
  if (!DRY_RUN && assets.length > 0) {
    const productIds = assets.map(a => a.product_id).filter(Boolean);
    const existing = await postgrestQuery('dataset_assets', {
      dataset_version_id: { eq: version.id },
      product_id: { in: productIds },
    }, { select: 'id,product_id' });
    for (const row of existing) {
      refs.provenance.push({
        record_type: 'asset',
        target_id: row.id,
        source_type: 'api',
        source_name: 'NASA CMR',
        source_url: `${CMR_BASE}granules.json?short_name=MOD11A1`,
        record_id: row.product_id,
        processing_params: JSON.stringify({ collection: 'MOD11A1', provider: 'LPCLOUD' }),
        processing_version: 'polaris-ingest-1.0',
        transformation: 'none (catalogue metadata)',
        validation_status: 'verified',
      });
    }
  }

  console.log(`  granules ${out.granules}; assets upserted ${out.inserted}, failed ${out.failed}`);
  return out;
}

// ----------------------------------------------------------------------------
// Stage 7 — regions + regional statistics
// ----------------------------------------------------------------------------

async function stageRegions(cat, refs) {
  console.log('\n=== Stage 7: regions and regional statistics ===');
  const out = { regions: 0, statistics: 0, failed: 0, errors: [] };

  const regions = [];
  for (const loc of cat.locations) {
    if (loc.latitude_deg == null || loc.longitude_deg == null) continue;
    const datum = loc.datum ?? 'unknown';
    regions.push({
      planet_id: loc.planet_id,
      name: loc.name,
      region_type: 'point',
      // Stored in a common 4326 storage CRS; `datum` records the real frame.
      geom: `SRID=4326;POINT(${loc.longitude_deg} ${loc.latitude_deg})`,
      datum,
      description: loc.description ?? null,
      classification: 'observation-site',
    });
  }

  const regionIdByName = {};
  if (!DRY_RUN) {
    for (const region of regions) {
      try {
        await postgrestUpsert('regions', [region], { onConflict: 'planet_id,name' });
      } catch (err) {
        out.failed++;
        out.errors.push(`region ${region.name} failed: ${err.message}`);
      }
    }
    const stored = await postgrestQuery('regions', {}, { select: 'id,name,planet_id' });
    for (const r of stored) regionIdByName[`${r.planet_id}|${r.name}`] = r.id;
  }
  out.regions = regions.length;

  // Statistics per region, computed from the measurements of the matching
  // location. Region <-> location is by name and planet.
  const statRows = [];
  // Demo rows are placeholders and must never feed a scientific aggregate.
  const measurements = await postgrestQuery('measurements', {
    quality_flag: { neq: 'demo' },
  }, { select: 'location_id,variable_id,value,recorded_at' });
  const byLocationVariable = new Map();
  for (const m of measurements) {
    const key = `${m.location_id}|${m.variable_id}`;
    if (!byLocationVariable.has(key)) byLocationVariable.set(key, []);
    byLocationVariable.get(key).push(m.value);
  }

  for (const loc of cat.locations) {
    if (loc.latitude_deg == null || loc.longitude_deg == null) continue;
    const regionId = regionIdByName[`${loc.planet_id}|${loc.name}`];
    if (!regionId) continue;

    for (const variable of cat.variables) {
      const values = byLocationVariable.get(`${loc.id}|${variable.id}`) ?? [];
      if (values.length === 0) continue;
      const s = stats(values);
      for (const [type, value] of [['mean', s.mean], ['min', s.min], ['max', s.max], ['stddev', s.stddev]]) {
        statRows.push({
          region_id: regionId,
          variable_id: variable.id,
          statistic_type: type,
          value: Number(value.toFixed(4)),
          unit: variable.canonical_unit,
          sample_count: s.count,
          methodology: 'arithmetic over ingested point measurements',
          processing_version: 'polaris-ingest-1.0',
          created_by: 'polaris-ingest-1.0',
        });
      }
    }
  }

  if (!DRY_RUN) {
    // regional_statistics has no unique constraint, so guard against re-runs.
    const existing = await postgrestQuery('regional_statistics', {}, {
      select: 'region_id,variable_id,statistic_type',
    });
    const existingKeys = new Set(
      existing.map(e => `${e.region_id}|${e.variable_id}|${e.statistic_type}`)
    );
    const toInsert = statRows.filter(
      s => !existingKeys.has(`${s.region_id}|${s.variable_id}|${s.statistic_type}`)
    );
    for (const batch of chunk(toInsert, BATCH_SIZE)) {
      try {
        await postgrestInsert('regional_statistics', batch);
        out.statistics += batch.length;
      } catch (err) {
        out.failed += batch.length;
        out.errors.push(`statistics batch failed: ${err.message}`);
      }
    }
  } else {
    out.statistics = statRows.length;
  }

  console.log(`  regions ${out.regions}; statistics ${out.statistics}, failed ${out.failed}`);
  return out;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('=== Polaris real-data ingestion ===');
  console.log(`mode: ${DRY_RUN ? 'DRY RUN (nothing written)' : 'EXECUTE (writes to Supabase)'}`);
  console.log(`sources: NASA POWER, Copernicus DEM GLO-30, ODE/LOLA, ODE/MOLA, NASA CMR`);

  const cat = new Catalogue();
  await cat.load();
  console.log(`catalogue: ${cat.planets.length} planets, ${cat.locations.length} locations, ${cat.datasets.length} datasets, ${cat.variables.length} variables`);

  const refs = await stageReference(cat);
  refs.provenance = [];

  // A failure in one source must not abort the others: each stage reports its
  // own errors and the run continues.
  const runStage = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`  ${name} FAILED: ${err.message}`);
      return { errors: [`${name} failed: ${err.message}`], failed: 1, inserted: 0, skipped: 0, fetched: 0 };
    }
  };

  const power = await runStage('POWER', () => stagePower(cat, refs));
  const dem = await runStage('Copernicus DEM', () => stageDem(cat, refs));
  const lola = await runStage('LOLA', () => ingestAltimetry(cat, refs, {
    planetSlug: 'moon',
    queryType: 'lolardr',
    datasetId: refs.lola.id,
    mapper: mapLolaPoint,
    label: 'ODE/LOLA RDR (Moon elevation)',
    sourceName: 'NASA PDS ODE — LOLA RDR',
  }));
  const mola = await runStage('MOLA', () => ingestAltimetry(cat, refs, {
    planetSlug: 'mars',
    queryType: 'molapedr',
    datasetId: refs.mola.id,
    mapper: mapMolaPoint,
    label: 'ODE/MOLA PEDR (Mars elevation)',
    sourceName: 'NASA PDS ODE — MOLA PEDR',
  }));
  const cmr = await runStage('CMR', () => stageCmr(cat, refs));
  const regions = await runStage('regions', () => stageRegions(cat, refs));

  const provenance = await writeProvenance(refs.provenance);

  console.log('\n=== Summary ===');
  console.log(`  POWER      fetched ${power.fetched}, inserted ${power.inserted}, skipped ${power.skipped}, failed ${power.failed}`);
  console.log(`  Copernicus tiles ${dem.fetched}, inserted ${dem.inserted}, skipped ${dem.skipped}, failed ${dem.failed}`);
  console.log(`  LOLA       points ${lola.fetched}, inserted ${lola.inserted}, skipped ${lola.skipped}, failed ${lola.failed}`);
  console.log(`  MOLA       points ${mola.fetched}, inserted ${mola.inserted}, skipped ${mola.skipped}, failed ${mola.failed}`);
  console.log(`  CMR        collections ${cmr.collections}, granules ${cmr.granules}, assets ${cmr.inserted}, failed ${cmr.failed}`);
  console.log(`  regions    ${regions.regions}, statistics ${regions.statistics}, failed ${regions.failed}`);
  console.log(`  provenance inserted ${provenance.inserted}, failed ${provenance.failed}`);

  const allErrors = [power, dem, lola, mola, cmr, regions].flatMap(s => s.errors ?? []);
  if (allErrors.length > 0) {
    console.log(`\n=== Errors (${allErrors.length}) ===`);
    allErrors.slice(0, 25).forEach(e => console.log('  - ' + e));
    if (allErrors.length > 25) console.log(`  ... and ${allErrors.length - 25} more`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Re-run with --execute to write.');
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('\nFATAL:', err);
    process.exit(1);
  });
}

module.exports = { main };
