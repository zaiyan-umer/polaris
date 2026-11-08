-- 004_phase4_expansion.sql
-- Phase 4: Expanded planetary data architecture
-- Creates the seven new tables for the planetary analog data system:
--   regions, dataset_versions, dataset_assets,
--   regional_statistics, provenance, analog_rankings,
--   analog_variable_scores
--
-- Deployment requirement (Supabase):
-- The `regions`, `dataset_assets`, and `regional_statistics` tables use
-- PostGIS geometry types. PostGIS must be enabled on the target database
-- BEFORE executing this file:
--
--   CREATE EXTENSION IF NOT EXISTS postgis;
--
-- This file does NOT create the extension itself. PostGIS is a deployment
-- prerequisite and must be enabled at the project/Supabase level.
--
-- CRS / SRID documentation:
-- The schema stores CRS metadata as TEXT descriptors. These are NOT SRID
-- identifiers and do NOT create spatial reference system entries. The
-- following descriptors are documented for human consumption:
--
--   'WGS84'               - Earth (EPSG:4326, geodetic horizontal CRS)
--   'LRO_Selenographic'   - Moon (planetocentric mean-Earth frame, DE421)
--   'MOLA_areoid'         - Mars (vertical datum, GMM2 gravity potential
--                           surface) - NOT a horizontal CRS. Uses Mars
--                           coordinate framework for elevation reference.
--
-- NOTE: If spatial reference system registration is required, it must be
-- done by a superuser via:
--   INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
--   VALUES (...);
-- See docs/database-architecture.md section 6 for details.

-- ============================================================================
-- PART 1: PostGIS extension prerequisite
-- ============================================================================
-- Before running this file, ensure the PostGIS extension is enabled:
--
--   CREATE EXTENSION IF NOT EXISTS postgis;
--
-- This migration does not (and cannot) modify the extension itself because
-- creating extensions requires superuser privileges. See
-- docs/database-architecture.md section 6 for the full deployment guide.

-- ============================================================================
-- Table 1: regions
-- Spatial regions (points or polygons) for comparisons.
-- ============================================================================
CREATE TABLE regions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id       UUID NOT NULL REFERENCES planets(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  region_type     TEXT NOT NULL CHECK (region_type IN ('point', 'polygon', 'multipolygon')),
  geom            GEOMETRY NOT NULL,
  datum           TEXT,  -- Planet-local reference frame (e.g. WGS84, LRO_Selenographic, MOLA_areoid)
  bounding_box    GEOMETRY,  -- Bounding box in the region's native CRS (PostGIS geometry)
  description     TEXT,
  classification  TEXT,  -- e.g. 'continental', 'sedimentary basin', 'crater', 'mountain'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Index for planet-filtered queries + name uniqueness per planet
  CONSTRAINT idx_regions_planet UNIQUE (planet_id, name),

  -- Check: region_type must be one of the allowed values
  CONSTRAINT regions_region_type_check
    CHECK (region_type IN ('point', 'polygon', 'multipolygon')),

  -- Check: geometry matches region type
  CONSTRAINT regions_geom_type_check
    CHECK ((region_type = 'point') = (ST_GeometryType(geom) LIKE 'ST_Point%')),

  -- Check: datum is required when geometry is present
  CONSTRAINT regions_datum_required_check
    CHECK (datum IS NOT NULL OR geom IS NULL)
);

-- Index for spatial queries
CREATE INDEX idx_regions_geom ON regions USING GIST (geom);


-- ============================================================================
-- Table 2: dataset_versions
-- Track the provenance of a dataset (same short_name can have multiple versions).
-- ============================================================================
CREATE TABLE dataset_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id              UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_type             TEXT NOT NULL CHECK (source_type IN ('instrument', 'derived', 'service', 'ontology')),
  source_crs              TEXT,  -- Planet-local CRS descriptor of the source product
  native_unit             TEXT,  -- Unit as delivered by the source
  native_resolution_m     DOUBLE PRECISION,  -- Source grid resolution in meters
  file_format             TEXT,  -- e.g. 'GeoTIFF', 'NetCDF', 'SAFE', 'JPEG2000'
  file_size_bytes         BIGINT,  -- Download size of the original file
  md5_checksum            TEXT,  -- MD5 checksum of the source file
  download_url            TEXT,  -- Direct download URL for the asset
  metadata_url            TEXT,  -- URL to the original metadata (CDS/UMM/GEMD)
  acquisition_start       TIMESTAMPTZ,  -- Start of acquisition window
  acquisition_end         TIMESTAMPTZ,  -- End of acquisition window
  processing_level        TEXT,  -- e.g. 'L2A', 'L3', 'L4', 'collection 1'
  version_identifier      TEXT,  -- Human-readable version string (e.g. 'v1.0', '20261108')
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one row per dataset per version_identifier
  -- source_type is retained as descriptive source metadata (not a version ID).
  CONSTRAINT dataset_versions_dataset_version_unique
    UNIQUE (dataset_id, version_identifier),

  -- Index for dataset lookups
  CONSTRAINT idx_dataset_versions_dataset UNIQUE (dataset_id),

  -- RLS: enable row-level security. Public metadata is readable by anon and
  -- authenticated users; no INSERT/UPDATE/DELETE policies defined, so only the
  -- backend service role may write.
  ALTER TABLE dataset_versions ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: public metadata is readable by anon and authenticated users.
  CREATE POLICY dataset_versions_select ON dataset_versions
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Index for source CRS lookups
CREATE INDEX idx_dataset_versions_source_crs ON dataset_versions(source_crs);


-- ============================================================================
-- Table 3: dataset_assets
-- Individual raster/scalar assets (granules) belonging to a dataset version.
-- ============================================================================
CREATE TABLE dataset_assets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id      UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  product_id              TEXT,  -- Product identifier (API-specific)
  platform                TEXT,  -- e.g. 'Sentinel-2B', 'LRO', 'MGS', 'MRO'
  instrument              TEXT,  -- e.g. 'MSI', 'LOLA', 'MOLA', 'TES', 'CRISM', 'HiRISE'
  acquisition_start       TIMESTAMPTZ,  -- Product acquisition window start
  acquisition_end         TIMESTAMPTZ,  -- Product acquisition window end
  bounds                  GEOMETRY,  -- Bounding box of the product (PostGIS geometry)
  native_crs              TEXT,  -- CRS of the asset grid
  native_resolution_m     DOUBLE PRECISION,  -- Grid resolution (meters)
  file_format             TEXT,  -- e.g. 'GeoTIFF', 'NetCDF', 'SAFE', 'JP2', 'ECMWF'
  file_size_bytes         BIGINT,  -- Download size
  download_url            TEXT,  -- Direct download URL
  metadata_url            TEXT,  -- URL to product metadata
  md5_checksum            TEXT,  -- MD5 checksum
  availability_status     TEXT NOT NULL
    CHECK (availability_status IN ('available', 'processing', 'incomplete', 'retracted')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT,  -- Ingestion pipeline/API that created it
  processing_notes        TEXT,  -- Notes on processing applied

  -- Constraint: one row per product per version
  CONSTRAINT dataset_assets_dataset_version_product_unique
    UNIQUE (dataset_version_id, product_id),

  -- Index for dataset version lookups
  CONSTRAINT idx_dataset_assets_version UNIQUE (dataset_version_id),

  -- RLS: enable row-level security. Public asset metadata is readable by anon
  -- and authenticated users; no INSERT/UPDATE/DELETE policies defined, so only
  -- the backend service role may write.
  ALTER TABLE dataset_assets ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: asset metadata is readable by anon and authenticated users.
  CREATE POLICY dataset_assets_select ON dataset_assets
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Indexes for status and platform filtering
CREATE INDEX idx_dataset_assets_platform ON dataset_assets(platform);
CREATE INDEX idx_dataset_assets_status ON dataset_assets(availability_status);

-- Index for spatial asset queries
CREATE INDEX idx_dataset_assets_bounds ON dataset_assets USING GIST (bounds);


-- ============================================================================
-- Table 4: regional_statistics
-- Aggregated statistics computed from raster assets or observation series.
-- ============================================================================
CREATE TABLE regional_statistics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id           UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  dataset_asset_id    UUID REFERENCES dataset_assets(id) ON DELETE CASCADE,
  variable_id         UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  statistic_type      TEXT NOT NULL
    CHECK (statistic_type IN ('mean', 'min', 'max', 'stddev', 'percentile',
                              'count', 'range', 'temporal_mean', 'temporal_stddev')),
  percentile          DOUBLE PRECISION,  -- Percentile value (e.g. 90 for 'percentile_90')
  value               DOUBLE PRECISION,  -- Numeric value
  unit                TEXT NOT NULL,  -- Unit of the statistic
  sample_count        BIGINT,  -- Number of samples ingested
  temporal_start      TIMESTAMPTZ,  -- Start of temporal window
  temporal_end        TIMESTAMPTZ,  -- End of temporal window
  methodology         TEXT,  -- Calculation method description
  processing_version  TEXT,  -- Version of the processing pipeline
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,  -- Pipeline that computed it

  -- Constraint: count statistics require a sample count
  CONSTRAINT regional_stats_value_sample_count_check
    CHECK (value IS NULL OR sample_count IS NOT NULL)

  -- RLS: enable row-level security. Public statistical data is readable by anon
  -- and authenticated users; no INSERT/UPDATE/DELETE policies defined, so only
  -- the backend service role may write.
  ALTER TABLE regional_statistics ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: statistics are readable by anon and authenticated users.
  CREATE POLICY regional_statistics_select ON regional_statistics
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Indexes for variable, asset, and type filtering
CREATE INDEX idx_regional_stats_variable ON regional_statistics(variable_id);
CREATE INDEX idx_regional_stats_dataset_asset ON regional_statistics(dataset_asset_id);
CREATE INDEX idx_regional_stats_type ON regional_statistics(statistic_type);

-- Composite index for region + variable + type drill-down
CREATE INDEX idx_regional_stats_region_variable_type
  ON regional_statistics(region_id, variable_id, statistic_type);

-- Index for region lookups (non-unique; multiple statistics per region are allowed)
CREATE INDEX idx_regional_stats_region ON regional_statistics(region_id);


-- ============================================================================
-- Table 5: provenance
-- Full provenance trail for every derived measurement/statistics record.
-- ============================================================================
CREATE TABLE provenance (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type             TEXT NOT NULL CHECK (record_type IN ('measurement', 'regional_statistics', 'asset')),
  target_id               UUID NOT NULL,  -- ID of the record being traced
  source_type             TEXT NOT NULL CHECK (source_type IN ('api', 'manual', 'derived')),
  source_name             TEXT,  -- Name of the source (e.g. 'NASA POWER', 'Copernicus STAC')
  source_url              TEXT,  -- Original API endpoint or manifest URL
  record_id               TEXT,  -- API-specific record identifier
  retrieval_timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_params       TEXT,  -- JSON object of processing parameters used
  processing_version      TEXT,  -- Version of the processing pipeline
  transformation          TEXT,  -- Description of transformations applied
  validation_status       TEXT NOT NULL
    CHECK (validation_status IN ('pending', 'verified', 'rejected', 'flagged')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: one provenance row per record/source combination
  CONSTRAINT provenance_record_source_unique
    UNIQUE (record_type, target_id, source_type, record_id),

  -- Index for record type lookups
  CONSTRAINT idx_provenance_record_type UNIQUE (record_type),

  -- RLS: enable row-level security. Provenance records are public scientific
  -- data readable by anon and authenticated users; no INSERT/UPDATE/DELETE
  -- policies defined, so only the backend service role may write.
  ALTER TABLE provenance ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: provenance records are readable by anon and authenticated users.
  CREATE POLICY provenance_select ON provenance
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Indexes for target and source lookups
CREATE INDEX idx_provenance_target ON provenance(target_id);
CREATE INDEX idx_provenance_source_name ON provenance(source_name);


-- ============================================================================
-- Table 6: analog_rankings
-- Analog comparison between Earth locations and planetary reference locations.
-- ============================================================================
CREATE TABLE analog_rankings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earth_location_id      UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  reference_location_id  UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  similarity_score       DOUBLE PRECISION,  -- Overall similarity (0.0–1.0)
  methodology            TEXT,  -- Algorithm description
  algorithm_version      TEXT,  -- Ranking algorithm version
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             TEXT,  -- Generation pipeline

  -- Constraint: similarity score must be in [0, 1] if present
  CONSTRAINT analog_rankings_similarity_check
    CHECK (similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1))

  -- RLS: enable row-level security. Analog rankings are public scientific data
  -- readable by anon and authenticated users; no INSERT/UPDATE/DELETE policies
  -- defined, so only the backend service role may write.
  ALTER TABLE analog_rankings ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: rankings are readable by anon and authenticated users.
  CREATE POLICY analog_rankings_select ON analog_rankings
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Index for earth location lookups (non-unique; multiple rankings per location are allowed)
CREATE INDEX idx_analog_rankings_earth ON analog_rankings(earth_location_id);

-- Index for reference location lookups
CREATE INDEX idx_analog_rankings_reference ON analog_rankings(reference_location_id);


-- ============================================================================
-- Table 7: analog_variable_scores
-- Per-variable similarity scores supporting an analog_rankings record.
-- ============================================================================
CREATE TABLE analog_variable_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ranking_id          UUID NOT NULL REFERENCES analog_rankings(id) ON DELETE CASCADE,
  variable_id         UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  earth_value         DOUBLE PRECISION,  -- Earth location value
  reference_value     DOUBLE PRECISION,  -- Reference location value
  score               DOUBLE PRECISION,  -- 0.0–1.0 similarity score for this variable
  normalization       TEXT,  -- e.g. 'minmax', 'zscore', 'relative'
  weight              DOUBLE PRECISION,  -- Weight applied to this variable
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: score must be in [0, 1] if present
  CONSTRAINT analog_variable_scores_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 1))

  -- RLS: enable row-level security. Per-variable scores are public scientific
  -- data readable by anon and authenticated users; no INSERT/UPDATE/DELETE
  -- policies defined, so only the backend service role may write.
  ALTER TABLE analog_variable_scores ENABLE ROW LEVEL SECURITY;

  -- SELECT policy: scores are readable by anon and authenticated users.
  CREATE POLICY analog_variable_scores_select ON analog_variable_scores
    FOR SELECT TO anon, authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: no policies defined. Only the backend service role
  -- (using a service-role key) may write.
);

-- Index for variable lookups
CREATE INDEX idx_analog_variable_scores_variable ON analog_variable_scores(variable_id);


-- ============================================================================
-- Triggers for data integrity
-- ============================================================================

-- Trigger 1: Validate analog_rankings planet pairing
-- Ensures that earth_location_id references a region on Earth (planet slug = 'earth')
-- and reference_location_id references a region on Moon or Mars.
CREATE OR REPLACE FUNCTION check_analog_rankings_planet_consistency()
RETURNS TRIGGER AS $$
DECLARE
  earth_planet_id UUID;
  ref_planet_id UUID;
BEGIN
  SELECT planet_id INTO earth_planet_id
  FROM regions WHERE id = NEW.earth_location_id;
  IF earth_planet_id IS NULL THEN
    RAISE EXCEPTION 'analog_rankings: earth_location_id does not reference a valid region';
  END IF;
  IF (SELECT slug FROM planets WHERE id = earth_planet_id) != 'earth' THEN
    RAISE EXCEPTION 'analog_rankings: earth_location_id must reference a region on Earth (planet slug = ''earth'')';
  END IF;

  SELECT planet_id INTO ref_planet_id
  FROM regions WHERE id = NEW.reference_location_id;
  IF ref_planet_id IS NULL THEN
    RAISE EXCEPTION 'analog_rankings: reference_location_id does not reference a valid region';
  END IF;
  IF (SELECT slug FROM planets WHERE id = ref_planet_id) NOT IN ('moon', 'mars') THEN
    RAISE EXCEPTION 'analog_rankings: reference_location_id must reference a region on Moon or Mars (planet slug in (''moon'', ''mars''))';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_analog_rankings_planet_consistency
BEFORE INSERT OR UPDATE ON analog_rankings
FOR EACH ROW EXECUTE FUNCTION check_analog_rankings_planet_consistency();


-- Trigger 2: Validate provenance target_id against the correct target table
-- based on record_type.
CREATE OR REPLACE FUNCTION check_provenance_target_exists()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.record_type = 'measurement' THEN
    IF NOT EXISTS (SELECT 1 FROM measurements WHERE id = NEW.target_id) THEN
      RAISE EXCEPTION 'provenance: target record does not exist for record_type = ''measurement'' (measurements.id = %)', NEW.target_id;
    END IF;
  ELSIF NEW.record_type = 'regional_statistics' THEN
    IF NOT EXISTS (SELECT 1 FROM regional_statistics WHERE id = NEW.target_id) THEN
      RAISE EXCEPTION 'provenance: target record does not exist for record_type = ''regional_statistics'' (regional_statistics.id = %)', NEW.target_id;
    END IF;
  ELSIF NEW.record_type = 'asset' THEN
    IF NOT EXISTS (SELECT 1 FROM dataset_assets WHERE id = NEW.target_id) THEN
      RAISE EXCEPTION 'provenance: target record does not exist for record_type = ''asset'' (dataset_assets.id = %)', NEW.target_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'provenance: unknown record_type = %', NEW.record_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_provenance_target_exists
BEFORE INSERT OR UPDATE ON provenance
FOR EACH ROW EXECUTE FUNCTION check_provenance_target_exists();


-- ============================================================================
-- Deployment note
-- ============================================================================
-- To deploy these tables, run:
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   \i 004_phase4_expansion.sql
--
-- All tables use the default UUID generation and timestamp defaults.
-- Columns using PostGIS types (regions.geom, dataset_assets.bounds,
-- regional_statistics geospatial metadata) require PostGIS to be enabled.
-- See docs/database-architecture.md section 6 for the full deployment guide
-- and SRID registration steps.
-- The `datum` column in `regions` stores a planet-local reference frame
-- descriptor. NOTE: 'MOLA_areoid' is a vertical datum (elevation reference,
-- GMM2), NOT a horizontal CRS. Horizontal coordinate frames for Mars use
-- Mars2000/IAU2000 (SRID 7030) and are documented separately.