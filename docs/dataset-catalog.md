# Polaris Dataset Catalog

What is actually in the database: which measurements exist, which tables hold
them, where they came from, and what is still missing.

Last verified against the live database: **2026-11-08**

---

## 1. At a glance

| table | rows | what it holds |
|---|---:|---|
| `planets` | 3 | Earth, Moon, Mars |
| `locations` | 10 | The comparison sites, with coordinates and datum |
| `datasets` | 13 | Source instruments and derived products |
| `dataset_variables` | 16 | Which variables each dataset provides, at what native unit and resolution |
| `variables` | 6 | The canonical comparison vocabulary |
| `dataset_versions` | 5 | Registered versions of the ingested datasets |
| `dataset_assets` | 0 | Downloadable product files (empty — see §6) |
| `measurements` | 2,372 | **The actual observations** (2,365 real, 7 demo) |
| `regions` | 9 | Point regions matching the measurement locations |
| `regional_statistics` | 36 | Aggregates computed from the measurements |
| `provenance` | 2,365 | One row per real measurement, with its source |
| `analog_rankings` | 0 | Not populated |
| `analog_variable_scores` | 0 | Not populated |

---

## 2. Coverage matrix

Real measurements by planet and variable. "demo" rows are the original
development placeholders from `003_demo_data.sql` and are **not** real
observations.

| variable | Earth | Moon | Mars |
|---|---:|---:|---:|
| elevation | **3** real | **800** real | **1,469** real |
| temperature | **93** real | 1 demo | 1 demo |
| mineralogy | 1 demo | 0 | 1 demo |
| slope | 1 demo | 0 | 0 |
| terrain_roughness | 1 demo | 0 | 1 demo |

**2,365 of 2,372 measurements are real.** The seven demo rows are flagged
`quality_flag = 'demo'` and must be excluded from any scientific calculation.

---

## 3. The real data, in detail

### 3.1 Elevation — 2,272 measurements

The only variable with real data on all three bodies.

| dataset | planet | locations | rows | unit | source |
|---|---|---|---:|---|---|
| `DEM` | Earth | Nile Delta, Sahara Desert, Everest Region | 3 | m | Copernicus DEM GLO-30 |
| `LOLA` | Moon | Mare Tranquillitatis, Mare Imbrium | 800 | m | LRO Lunar Orbiter Laser Altimeter |
| `MOLA` | Mars | Valles Marineris, Olympus Mons, Hellas Planitia, Aeolis Mons | 1,469 | m | MGS Mars Orbital Laser Altimeter |

**Resolution differs by source, and this matters:**

- **DEM** rows are a single pixel per site (30 m resolution). They give a point
  elevation, not a terrain profile.
- **LOLA** and **MOLA** rows are genuine point clouds — individual laser shots
  within a ~0.1° box around each site. These support terrain analysis
  (spread, roughness, min/max), not just a single value.

Observed ranges:

| dataset | min (m) | max (m) |
|---|---:|---:|
| DEM (Earth) | 8.04 | 8,719.03 |
| LOLA (Moon) | -2,553.21 | -1,903.82 |
| MOLA (Mars) | -6,400.92 | 19,841.95 |

Lunar elevations are relative to the LOLA reference radius (the value is
`Pt_Radius - Geoid`, both read from the same source row). Martian elevations
are metres above the MOLA areoid. Earth elevations are metres above the
EGM2008 geoid. **The reference surfaces differ**, so cross-planet comparisons
are of relative relief, not of absolute height above a common datum.

### 3.2 Temperature — 93 measurements

| dataset | planet | locations | rows | unit | source |
|---|---|---|---:|---|---|
| `NASA_POWER` | Earth | Nile Delta, Sahara Desert, Everest Region | 93 | K | NASA POWER daily reanalysis |

31 daily mean 2 m air temperatures (2024-01-01 to 2024-01-31) at each of the
three Earth sites. Converted from the source unit (°C) to kelvin on ingestion.

Observed range: 258.02 K to 295.82 K.

**There is no real temperature data for the Moon or Mars.** Both are single
demo rows (410 K and 210 K).

---

## 4. Where each kind of data lives

### `measurements` — the observations

    id, planet_id, location_id, dataset_id, variable_id,
    value, value_unit, native_value, native_resolution_m,
    quality_flag, recorded_at, created_at

- `value` — the observation in the canonical unit (always equal to
  `variables.canonical_unit`, enforced by a composite foreign key).
- `native_value` — the value in the unit the source reported, before any
  conversion. For POWER this is °C; for LOLA and MOLA it is identical to
  `value` because those sources already report metres.
- `quality_flag` — `sensor` (direct instrument measurement), `derived`
  (processed product or reanalysis), or `demo` (placeholder).
- `recorded_at` — the observation time, distinct from `created_at`.

### `variables` — the comparison vocabulary

    id, name, canonical_unit, definition

Six entries: `elevation` (m), `slope` (deg), `temperature` (K),
`mineralogy` (volpct), `thermal_inertia` (J/m^2/K/s^1/2),
`terrain_roughness` (m).

`canonical_unit` is the single target unit for cross-planet comparison. Every
measurement's `value_unit` must match it.

### `datasets` — the sources

    id, planet_id, short_name, description, source_url,
    source_type, native_crs

`source_type` is `instrument` or `derived`. `native_crs` records the coordinate
reference frame the source uses (WGS84, the lunar planetocentric ME frame, or
the MOLA areoid).

### `dataset_variables` — dataset/variable bindings

    dataset_id, variable_id, native_unit, native_resolution_m

Records the unit and resolution **as the source reports them**, which may
differ from the canonical unit and from the per-observation
`measurements.native_resolution_m`.

### `locations` — the sites

    id, planet_id, name, latitude_deg, longitude_deg, datum, description

Ten sites. `datum` records the planet-local reference frame (WGS84,
LRO_Selenographic, MOLA areoid). Tycho Crater has NULL coordinates and is
excluded from spatial queries.

### `regions` — analysis regions

Point geometries matching the measurement locations, stored in a common
EPSG:4326 storage CRS with the true frame recorded in `datum`.

### `regional_statistics` — aggregates

    region_id, variable_id, statistic_type, value, unit,
    sample_count, methodology

36 rows: mean, min, max and stddev for each region and variable, computed from
non-demo measurements only.

### `provenance` — lineage

    record_type, target_id, source_type, source_name, source_url,
    record_id, retrieval_timestamp, processing_params,
    processing_version, transformation, validation_status

One row per real measurement, recording the source, the source's own record
identifier, and the transformation applied.

---

## 5. Sources

| source | endpoint | provides | auth |
|---|---|---|---|
| NASA POWER | `power.larc.nasa.gov/api/temporal/daily/point` | Earth daily temperature | none |
| Copernicus DEM GLO-30 | `copernicus-dem-30m.s3.amazonaws.com` | Earth elevation (COG tiles) | none |
| NASA PDS ODE — LOLA RDR | `oderest.rsl.wustl.edu/livegds` | Moon elevation | none |
| NASA PDS ODE — MOLA PEDR | `oderest.rsl.wustl.edu/livegds` | Mars elevation | none |
| NASA CMR | `cmr.earthdata.nasa.gov/search` | MODIS collection metadata | none |

All sources are queried live. Nothing in `measurements` is hardcoded.

---

## 6. Known gaps and limitations

These are real limitations, not oversights:

1. **Temperature exists on one planet.** Moon and Mars temperature are demo
   placeholders. Any cross-planet temperature comparison is currently
   impossible.
2. **No geology or mineralogy.** All three mineralogy rows are demo.
3. **No slope or terrain roughness measurements**, although both could be
   derived from the elevation point clouds already in the database.
4. **`dataset_assets` is empty.** Link-only records were deliberately removed;
   a URL is not a measurement. Asset rows should only be added alongside real
   values.
5. **Elevation reference frames differ** between bodies (see §3.1).
6. **`analog_rankings` and `analog_variable_scores` are empty.** No similarity
   scoring has been run.
7. **The Earth DEM is one pixel per site**, so Earth terrain analysis is much
   coarser than the Moon and Mars point clouds.
8. **MODIS land-surface temperature is not ingested.** LP DAAC requires an
   Earthdata login. The CMR stage currently registers collection metadata only.

---

## 7. Querying the data

### All real measurements (excluding placeholders)

    SELECT m.value, m.value_unit, m.quality_flag, m.recorded_at,
           d.short_name AS dataset, l.name AS location, v.name AS variable
    FROM measurements m
    JOIN datasets d ON d.id = m.dataset_id
    JOIN locations l ON l.id = m.location_id
    JOIN variables v ON v.id = m.variable_id
    WHERE m.quality_flag <> 'demo';

### Elevation point clouds for the Moon and Mars

    SELECT l.name AS site, m.value, m.recorded_at
    FROM measurements m
    JOIN locations l ON l.id = m.location_id
    JOIN datasets d ON d.id = m.dataset_id
    JOIN variables v ON v.id = m.variable_id
    WHERE v.name = 'elevation'
      AND d.short_name IN ('LOLA', 'MOLA')
      AND m.quality_flag <> 'demo'
    ORDER BY l.name, m.recorded_at;

### Per-site terrain summary (already computed)

    SELECT l.name AS site, v.name AS variable,
           s.statistic_type, s.value, s.unit, s.sample_count
    FROM regional_statistics s
    JOIN regions r ON r.id = s.region_id
    JOIN locations l ON l.name = r.name
    JOIN variables v ON v.id = s.variable_id
    WHERE s.statistic_type = 'mean';

### Full lineage for a measurement

    SELECT p.source_name, p.source_url, p.record_id,
           p.transformation, p.retrieval_timestamp
    FROM provenance p
    WHERE p.record_type = 'measurement'
      AND p.target_id = '<measurement uuid>';

---

## 8. How the data gets in

The ingestion pipeline lives in `backend/src/ingestion/`:

    ingest-real-data.cjs        orchestration and the per-source stages
    rest-client.cjs             PostgREST client and schema validation
    http.cjs                    retrying HTTP helper
    clients/power-api.cjs       NASA POWER
    clients/copernicus-api.cjs  Copernicus STAC + DEM COG tiles
    clients/ode-api.cjs         ODE catalogue and GDS point data
    clients/pds-api.cjs         PDS Search API
    clients/cmr-api.cjs         NASA CMR

Run it:

    node src/ingestion/services/ingest-real-data.cjs            # dry run
    node src/ingestion/services/ingest-real-data.cjs --execute  # write

Every run is idempotent: measurements are keyed on
(location, dataset, variable, observation time, value) and existing rows are
skipped. Verify the result with:

    node src/ingestion/verify-db.cjs
