-- 001_schema.sql
-- Planetary data harmonization schema (Earth / Moon / Mars).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f 001_schema.sql
--
-- NOTE: this file contains ONLY schema. Seed data lives in 002_reference_data.sql
-- and dev-only placeholder data in 003_demo_data.sql.
--
-- Design rules:
--   1. Composite FKs enforce:
--        - location and dataset are on the same planet as the measurement
--        - the (dataset, variable) pair exists in dataset_variables
--        - measurements.value_unit matches variables.canonical_unit
--   2. native_unit and native_resolution_m live in dataset_variables (one per
--      dataset-variable pair). datasets.native_resolution_m is removed.
--   3. measurements.native_resolution_m is kept: an individual observation can
--      carry a genuinely different native resolution (e.g. a derived/resampled
--      product, per-beam footprint, aggregation) that differs from the nominal
--      dataset-variable resolution. See the field comment on that column.
--   4. Location coordinates are NULLable; a CHECK enforces valid ranges when set.
--   5. recorded_at (observation time) is separate from created_at (insertion time).
--   6. Scientific records are protected by RESTRICT: deleting a dataset, location,
--      variable, or binding while measurements/reference rows depend on it fails.
--      See the deletion-policy table below.
--   7. Planet/var/dataset consistency is enforced by composite keys, not by triggers.


-- ---------------------------------------------------------------------------
-- Planets
-- ---------------------------------------------------------------------------
-- Celestial body metadata: Earth, Moon, Mars (and any future bodies).
CREATE TABLE planets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  body_type  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Locations: planet-specific comparison points
-- ---------------------------------------------------------------------------
-- "datum" records the planet-local reference frame:
--   WGS84       for Earth
--   LRO_Selenographic  for the Moon (Diviner, LOLA on LRO)
--   MOLA areoid for Mars
-- Deletion policy: RESTRICT. A location row with measurements cannot be deleted,
-- ensuring no measurement is orphaned.
CREATE TABLE locations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id      UUID NOT NULL REFERENCES planets(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  latitude_deg   DOUBLE PRECISION,
  longitude_deg  DOUBLE PRECISION,
  datum          TEXT,                        -- nullable; if unknown, store NULL
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT locations_planet_unique UNIQUE (id, planet_id),
  CONSTRAINT locations_name_planet_key UNIQUE (name, planet_id),
  CHECK (latitude_deg IS NULL OR latitude_deg BETWEEN -90 AND 90),
  CHECK (longitude_deg IS NULL OR longitude_deg BETWEEN -180 AND 180)
);

-- ---------------------------------------------------------------------------
-- Variables: canonical harmonised vocabulary
-- ---------------------------------------------------------------------------
-- canonical_unit is the single target unit for a variable. The unique pair
-- (id, canonical_unit) is the target of the measurements composite FK below,
-- which enforces that every measurement's value_unit equals the variable's
-- canonical unit.
CREATE TABLE variables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  canonical_unit TEXT NOT NULL,
  definition    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT variables_id_canonical_unit UNIQUE (id, canonical_unit)
);

-- ---------------------------------------------------------------------------
-- Datasets: source instruments / derived products
-- ---------------------------------------------------------------------------
-- native_unit and native_resolution_m have been moved here into
-- dataset_variables, because a single dataset can serve several variables and
-- each may carry its own native unit / resolution. datasets.native_resolution_m
-- was removed as redundant with dataset_variables.native_resolution_m.
-- Deletion policy: RESTRICT. A dataset row that still has measurements or
-- dataset_variable bindings cannot be deleted.
CREATE TABLE datasets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id      UUID NOT NULL REFERENCES planets(id) ON DELETE RESTRICT,
  short_name     TEXT NOT NULL,
  description    TEXT,
  source_url     TEXT,
  source_type    TEXT NOT NULL CHECK (source_type IN ('instrument', 'derived')),
  native_crs     TEXT,                       -- dataset-level CRS (same for all vars)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, planet_id)
);

-- ---------------------------------------------------------------------------
-- Dataset -> Variable bindings
-- ---------------------------------------------------------------------------
-- One row per (dataset, variable) pair. Native unit / resolution live here.
-- Deletion policy: RESTRICT. A binding row cannot be deleted while a dataset or
-- variable that it binds is referenced elsewhere.
CREATE TABLE dataset_variables (
  dataset_id       UUID NOT NULL REFERENCES datasets(id) ON DELETE RESTRICT,
  variable_id      UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  native_unit      TEXT,
  native_resolution_m DOUBLE PRECISION,
  PRIMARY KEY (dataset_id, variable_id)
);

-- ---------------------------------------------------------------------------
-- Measurements: the actual, harmonised observations
-- ---------------------------------------------------------------------------
-- Deletion policy: measurements are the leaf table; no FK references them, so
-- they can be deleted freely (e.g. a retracted observation). However, every
-- FK into measurements uses RESTRICT so that deleting a parent fails when a
-- measurement still points at it.
CREATE TABLE measurements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id         UUID NOT NULL REFERENCES planets(id) ON DELETE RESTRICT,
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  dataset_id        UUID NOT NULL REFERENCES datasets(id) ON DELETE RESTRICT,
  variable_id       UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  -- Planetary consistency (location and dataset must share this planet):
  -- both FKs capture measurements.planet_id against locations.planet_id and
  -- datasets.planet_id, so the three must agree.
  FOREIGN KEY (location_id, planet_id) REFERENCES locations(id, planet_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (dataset_id, planet_id) REFERENCES datasets(id, planet_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
  -- The variable must be supported by this dataset:
  FOREIGN KEY (dataset_id, variable_id) REFERENCES dataset_variables(dataset_id, variable_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Canonical-unit enforcement: value_unit must equal this variable's
  -- canonical_unit. The pair (variable_id, value_unit) is bound to the unique
  -- pair (variables.id, variables.canonical_unit), so mismatched units are
  -- rejected by the database (no app-level check needed).
  FOREIGN KEY (variable_id, value_unit) REFERENCES variables(id, canonical_unit)
      ON DELETE RESTRICT ON UPDATE CASCADE,
  value             DOUBLE PRECISION NOT NULL,
  value_unit        TEXT NOT NULL,            -- harmonised unit (== variables.canonical_unit)
  native_value      DOUBLE PRECISION,         -- original source value
  -- Per-observation native resolution. This is the resolution of *this*
  -- observation (e.g. a derived/resampled measurement, per-beam footprint, or
  -- aggregation), and may differ from the nominal dataset-variable resolution
  -- (dataset_variables.native_resolution_m). Example: a 30 m DEM-derived
  -- slope measurement has native_resolution_m = 30, but a MODIS-aggregated
  -- temperature product measurement may carry a coarser native_resolution_m.
  native_resolution_m DOUBLE PRECISION,
  quality_flag      TEXT,                     -- 'demo' | 'verified' | 'sensor' | 'derived' | ...
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- observation time
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- insertion time
);

-- Indexes -------------------------------------------------------------------
CREATE INDEX idx_locations_planet ON locations(planet_id);
CREATE INDEX idx_locations_datum  ON locations(datum);
CREATE INDEX idx_measurements_location        ON measurements(location_id);
CREATE INDEX idx_measurements_dataset         ON measurements(dataset_id);
CREATE INDEX idx_measurements_variable        ON measurements(variable_id);
CREATE INDEX idx_measurements_recorded_at     ON measurements(recorded_at);
CREATE INDEX idx_measurements_planet          ON measurements(planet_id);

