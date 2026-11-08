-- 004_phase4_expansion.sql
-- Phase 4: Expanded planetary data architecture
-- Creates the seven new tables for the planetary analog data system:
--   regions, dataset_versions, dataset_assets,
--   regional_statistics, provenance, analog_rankings,
--   analog_variable_scores
--
-- These tables are designed to be added AFTER the existing 6-table schema
-- (001_schema.sql, 002_reference_data.sql, 003_demo_data.sql).
-- The existing tables and all their data are preserved.
--
-- IMPORTANT deployment note:
-- The `regions`, `dataset_assets`, and `regional_statistics` tables use
-- PostGIS `geometry` types. PostGIS must be enabled on the target database:
--
--   CREATE EXTENSION IF NOT EXISTS postgis;
--
-- This is a one-time deployment step. This SQL file does not (and cannot)
-- create the extension itself, because creating extensions requires
-- superuser privileges and is normally handled at the project level.
-- See docs/database-architecture.md section 6 for details.
--
-- CRS / SRID documentation:
-- The schema supports arbitrary planet-local CRS per table. The canonical
-- reference frame identifiers are documented in the column comments:
--   'WGS84'                 - Earth (EPSG:4326)
--   'LRO_Selenographic'     - Moon (IAU/IAG lunar ME frame, DE421)
--   'MOLA areoid'           - Mars (IAU2000 areoid, GMM2)
--
-- NOTE: If custom SRID registration is required, this file does NOT include
-- it. SRID registration must be done by a superuser via:
--   INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
--   VALUES (...);
-- See docs/database-architecture.md section 6 for details.

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
  bounding_box    BOX,   -- Bounding box in the region's native CRS
  description     TEXT,
  classification  TEXT,  -- e.g. 'continental', 'sedimentary basin', 'crater', 'mountain'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Index for planet-filtered queries
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
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id            UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_type           TEXT NOT NULL CHECK (source_type IN ('instrument', 'derived', 'service', 'ontology')),
  source_crs            TEXT,  -- Planet-local CRS of the source product
  native_unit           TEXT,  -- Unit as delivered by the source
  native_resolution_m   DOUBLE PRECISION,  -- Source grid resolution in meters
  file_format           TEXT,  -- e.g. 'GeoTIFF', 'NetCDF', 'SAFE', 'JPEG2000'
  file_size_bytes       BIGINT,  -- Download size of the original file
  md5_checksum          TEXT,  -- MD5 checksum of the source file
  download_url          TEXT,  -- Direct download URL for the asset
  metadata_url          TEXT,  -- URL to the original metadata (CDS/UMM/GEMD)
  acquisition_start     TIMESTAMPTZ,  -- Start of acquisition window
  acquisition_end       TIMESTAMPTZ,  -- End of acquisition window
  processing_level      TEXT,  -- e.g. 'L2A', 'L3', 'L4', 'collection 1'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: one row per dataset per source_type
  CONSTRAINT dataset_versions_dataset_source_type_unique
    UNIQUE (dataset_id, source_type),

  -- Index for dataset lookups
  CONSTRAINT idx_dataset_versions_dataset UNIQUE (dataset_id)
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
  bounds                  BOX,  -- Geographic bounding box of the product
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
  CONSTRAINT idx_dataset_assets_version UNIQUE (dataset_version_id)
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
    CHECK (value IS NULL OR sample_count IS NOT NULL),

  -- Index for region lookups
  CONSTRAINT idx_regional_stats_region UNIQUE (region_id)
);

-- Indexes for variable, asset, and type filtering
CREATE INDEX idx_regional_stats_variable ON regional_statistics(variable_id);
CREATE INDEX idx_regional_stats_dataset_asset ON regional_statistics(dataset_asset_id);
CREATE INDEX idx_regional_stats_type ON regional_statistics(statistic_type);

-- Composite index for region + variable + type drill-down
CREATE INDEX idx_regional_stats_region_variable_type
  ON regional_statistics(region_id, variable_id, statistic_type);


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
  CONSTRAINT idx_provenance_record_type UNIQUE (record_type)
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
    CHECK (similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1)),

  -- Index for earth location lookups
  CONSTRAINT idx_analog_rankings_earth UNIQUE (earth_location_id)
);

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
    CHECK (score IS NULL OR (score >= 0 AND score <= 1)),

  -- Index for ranking lookups
  CONSTRAINT idx_analog_variable_scores_ranking UNIQUE (ranking_id)
);

-- Index for variable lookups
CREATE INDEX idx_analog_variable_scores_variable ON analog_variable_scores(variable_id);


-- ============================================================================
-- Deployment note
-- ============================================================================
-- To deploy these tables, run:
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   \i 004_phase4_expansion.sql
--
-- All tables use the default UUID generation and timestamp defaults.
-- The `geom`, `bounds`, and bounding_box columns require PostGIS to be
-- enabled. If PostGIS is not available, these columns will fail to create.
-- See docs/database-architecture.md section 6 for the complete PostGIS
-- deployment guide and SRID registration steps.
