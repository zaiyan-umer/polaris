
-- 004_phase4_expansion.sql
-- Phase 4: Expanded planetary data architecture
--
-- Creates seven new tables:
-- regions, dataset_versions, dataset_assets,
-- regional_statistics, provenance, analog_rankings,
-- analog_variable_scores.
--
-- PREREQUISITE:
-- PostGIS must be enabled before executing this migration:
-- CREATE EXTENSION IF NOT EXISTS postgis;
--
-- CRS / SRID documentation:
-- These are descriptive TEXT values, not SRID identifiers.
--
-- WGS84              - Earth (EPSG:4326)
-- LRO_Selenographic  - Moon (planetocentric mean-Earth frame, DE421)
-- MOLA_areoid        - Mars vertical datum (GMM2 gravity potential surface)
--
-- MOLA_areoid is NOT a horizontal CRS.
-- This migration does not register custom SRIDs.

-- ============================================================================
-- TABLE 1: regions
-- ============================================================================

CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id UUID NOT NULL REFERENCES planets(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  region_type TEXT NOT NULL,
  geom GEOMETRY NOT NULL,
  datum TEXT NOT NULL,
  bounding_box GEOMETRY,
  description TEXT,
  classification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT idx_regions_planet
    UNIQUE (planet_id, name),

  CONSTRAINT regions_region_type_check
    CHECK (region_type IN ('point', 'polygon', 'multipolygon')),

  CONSTRAINT regions_geom_type_check
    CHECK (
      (region_type = 'point' AND ST_GeometryType(geom) = 'ST_Point')
      OR
      (region_type = 'polygon' AND ST_GeometryType(geom) = 'ST_Polygon')
      OR
      (region_type = 'multipolygon' AND ST_GeometryType(geom) = 'ST_MultiPolygon')
    )
);

CREATE INDEX idx_regions_geom
ON regions USING GIST (geom);


-- ============================================================================
-- TABLE 2: dataset_versions
-- ============================================================================

CREATE TABLE dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('instrument', 'derived', 'service', 'ontology')),
  source_crs TEXT,
  native_unit TEXT,
  native_resolution_m DOUBLE PRECISION,
  file_format TEXT,
  file_size_bytes BIGINT,
  md5_checksum TEXT,
  download_url TEXT,
  metadata_url TEXT,
  acquisition_start TIMESTAMPTZ,
  acquisition_end TIMESTAMPTZ,
  processing_level TEXT,
  version_identifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dataset_versions_dataset_version_unique
    UNIQUE (dataset_id, version_identifier)
);

CREATE INDEX idx_dataset_versions_source_crs
ON dataset_versions(source_crs);


-- ============================================================================
-- TABLE 3: dataset_assets
-- ============================================================================

CREATE TABLE dataset_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id UUID NOT NULL
    REFERENCES dataset_versions(id) ON DELETE CASCADE,
  product_id TEXT,
  platform TEXT,
  instrument TEXT,
  acquisition_start TIMESTAMPTZ,
  acquisition_end TIMESTAMPTZ,
  bounds GEOMETRY,
  native_crs TEXT,
  native_resolution_m DOUBLE PRECISION,
  file_format TEXT,
  file_size_bytes BIGINT,
  download_url TEXT,
  metadata_url TEXT,
  md5_checksum TEXT,
  availability_status TEXT NOT NULL
    CHECK (availability_status IN ('available', 'processing', 'incomplete', 'retracted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  processing_notes TEXT,

  CONSTRAINT dataset_assets_dataset_version_product_unique
    UNIQUE (dataset_version_id, product_id)
);

CREATE INDEX idx_dataset_assets_platform
ON dataset_assets(platform);

CREATE INDEX idx_dataset_assets_status
ON dataset_assets(availability_status);

CREATE INDEX idx_dataset_assets_bounds
ON dataset_assets USING GIST (bounds);


-- ============================================================================
-- TABLE 4: regional_statistics
-- ============================================================================

CREATE TABLE regional_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  dataset_asset_id UUID REFERENCES dataset_assets(id) ON DELETE CASCADE,
  variable_id UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  statistic_type TEXT NOT NULL
    CHECK (
      statistic_type IN (
        'mean', 'min', 'max', 'stddev', 'percentile',
        'count', 'range', 'temporal_mean', 'temporal_stddev'
      )
    ),
  percentile DOUBLE PRECISION,
  value DOUBLE PRECISION,
  unit TEXT NOT NULL,
  sample_count BIGINT,
  temporal_start TIMESTAMPTZ,
  temporal_end TIMESTAMPTZ,
  methodology TEXT,
  processing_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,

  CONSTRAINT regional_stats_value_sample_count_check
    CHECK (value IS NULL OR sample_count IS NOT NULL)
);

CREATE INDEX idx_regional_stats_variable
ON regional_statistics(variable_id);

CREATE INDEX idx_regional_stats_dataset_asset
ON regional_statistics(dataset_asset_id);

CREATE INDEX idx_regional_stats_type
ON regional_statistics(statistic_type);

CREATE INDEX idx_regional_stats_region_variable_type
ON regional_statistics(region_id, variable_id, statistic_type);

CREATE INDEX idx_regional_stats_region
ON regional_statistics(region_id);


-- ============================================================================
-- TABLE 5: provenance
-- ============================================================================

CREATE TABLE provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type TEXT NOT NULL
    CHECK (record_type IN ('measurement', 'regional_statistics', 'asset')),
  target_id UUID NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('api', 'manual', 'derived')),
  source_name TEXT,
  source_url TEXT,
  record_id TEXT,
  retrieval_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_params TEXT,
  processing_version TEXT,
  transformation TEXT,
  validation_status TEXT NOT NULL
    CHECK (validation_status IN ('pending', 'verified', 'rejected', 'flagged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULLS NOT DISTINCT requires PostgreSQL 15 or newer.
-- Prevents duplicate provenance combinations even when record_id is NULL.
CREATE UNIQUE INDEX provenance_record_source_unique_idx
ON provenance (record_type, target_id, source_type, record_id)
NULLS NOT DISTINCT;

CREATE INDEX idx_provenance_target
ON provenance(target_id);

CREATE INDEX idx_provenance_source_name
ON provenance(source_name);


-- ============================================================================
-- TABLE 6: analog_rankings
-- ============================================================================

CREATE TABLE analog_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earth_location_id UUID NOT NULL
    REFERENCES regions(id) ON DELETE RESTRICT,
  reference_location_id UUID NOT NULL
    REFERENCES regions(id) ON DELETE RESTRICT,
  similarity_score DOUBLE PRECISION,
  methodology TEXT,
  algorithm_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,

  CONSTRAINT analog_rankings_similarity_check
    CHECK (
      similarity_score IS NULL
      OR (similarity_score >= 0 AND similarity_score <= 1)
    )
);

CREATE INDEX idx_analog_rankings_earth
ON analog_rankings(earth_location_id);

CREATE INDEX idx_analog_rankings_reference
ON analog_rankings(reference_location_id);


-- ============================================================================
-- TABLE 7: analog_variable_scores
-- ============================================================================

CREATE TABLE analog_variable_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ranking_id UUID NOT NULL
    REFERENCES analog_rankings(id) ON DELETE CASCADE,
  variable_id UUID NOT NULL REFERENCES variables(id) ON DELETE RESTRICT,
  earth_value DOUBLE PRECISION,
  reference_value DOUBLE PRECISION,
  score DOUBLE PRECISION,
  normalization TEXT,
  weight DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT analog_variable_scores_ranking_variable_unique
    UNIQUE (ranking_id, variable_id),

  CONSTRAINT analog_variable_scores_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 1))
);

CREATE INDEX idx_analog_variable_scores_variable
ON analog_variable_scores(variable_id);


-- ============================================================================
-- TRIGGER 1: Prevent changing a region's planet after it is ranked
-- ============================================================================

CREATE OR REPLACE FUNCTION check_regions_planet_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.planet_id IS DISTINCT FROM OLD.planet_id THEN
    IF EXISTS (
      SELECT 1
      FROM analog_rankings
      WHERE earth_location_id = OLD.id
         OR reference_location_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'Cannot change planet_id for region % because it participates in analog_rankings',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_regions_planet_change
BEFORE UPDATE OF planet_id ON regions
FOR EACH ROW
EXECUTE FUNCTION check_regions_planet_change();


-- ============================================================================
-- TRIGGER 2: Validate Earth / Moon / Mars pairing in analog_rankings
-- ============================================================================

CREATE OR REPLACE FUNCTION check_analog_rankings_planet_consistency()
RETURNS TRIGGER AS $$
DECLARE
  earth_planet_id UUID;
  ref_planet_id UUID;
  earth_slug TEXT;
  ref_slug TEXT;
BEGIN
  SELECT planet_id
  INTO earth_planet_id
  FROM regions
  WHERE id = NEW.earth_location_id;

  IF earth_planet_id IS NULL THEN
    RAISE EXCEPTION
      'analog_rankings: earth_location_id does not reference a valid region';
  END IF;

  SELECT slug
  INTO earth_slug
  FROM planets
  WHERE id = earth_planet_id;

  IF earth_slug IS DISTINCT FROM 'earth' THEN
    RAISE EXCEPTION
      'analog_rankings: earth_location_id must reference a region on Earth';
  END IF;

  SELECT planet_id
  INTO ref_planet_id
  FROM regions
  WHERE id = NEW.reference_location_id;

  IF ref_planet_id IS NULL THEN
    RAISE EXCEPTION
      'analog_rankings: reference_location_id does not reference a valid region';
  END IF;

  SELECT slug
  INTO ref_slug
  FROM planets
  WHERE id = ref_planet_id;

  IF ref_slug IS NULL OR ref_slug NOT IN ('moon', 'mars') THEN
    RAISE EXCEPTION
      'analog_rankings: reference_location_id must reference a Moon or Mars region';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_analog_rankings_planet_consistency
BEFORE INSERT OR UPDATE ON analog_rankings
FOR EACH ROW
EXECUTE FUNCTION check_analog_rankings_planet_consistency();


-- ============================================================================
-- TRIGGER 3: Validate provenance target references
-- ============================================================================

CREATE OR REPLACE FUNCTION check_provenance_target_exists()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.record_type = 'measurement' THEN
    IF NOT EXISTS (
      SELECT 1 FROM measurements WHERE id = NEW.target_id
    ) THEN
      RAISE EXCEPTION
        'provenance: measurement target does not exist: %',
        NEW.target_id;
    END IF;

  ELSIF NEW.record_type = 'regional_statistics' THEN
    IF NOT EXISTS (
      SELECT 1 FROM regional_statistics WHERE id = NEW.target_id
    ) THEN
      RAISE EXCEPTION
        'provenance: regional_statistics target does not exist: %',
        NEW.target_id;
    END IF;

  ELSIF NEW.record_type = 'asset' THEN
    IF NOT EXISTS (
      SELECT 1 FROM dataset_assets WHERE id = NEW.target_id
    ) THEN
      RAISE EXCEPTION
        'provenance: dataset_assets target does not exist: %',
        NEW.target_id;
    END IF;

  ELSE
    RAISE EXCEPTION
      'provenance: unknown record_type: %',
      NEW.record_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_provenance_target_exists
BEFORE INSERT OR UPDATE ON provenance
FOR EACH ROW
EXECUTE FUNCTION check_provenance_target_exists();


-- ============================================================================
-- ROW LEVEL SECURITY
-- All seven new tables are publicly readable.
-- No anon/authenticated write policies are created.
-- ============================================================================

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE regional_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE analog_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analog_variable_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY regions_select
ON regions FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY dataset_versions_select
ON dataset_versions FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY dataset_assets_select
ON dataset_assets FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY regional_statistics_select
ON regional_statistics FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY provenance_select
ON provenance FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY analog_rankings_select
ON analog_rankings FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY analog_variable_scores_select
ON analog_variable_scores FOR SELECT TO anon, authenticated
USING (true);


-- ============================================================================
-- END OF PHASE 4 MIGRATION
-- ============================================================================
