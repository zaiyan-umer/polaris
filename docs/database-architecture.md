# Planetary Analog Data Architecture

Document version: 1.0
Last updated: November 2026
Purpose: Architecture specification for the Planetary Analog Discovery System
          (NASA Space Apps project: "planetary-supabase-db" expansion)

This document defines the expanded database schema and data model for the
Planetary Analog Discovery System. It covers spatial locations, dataset
assets, scientific variables, regional statistics, analog comparison, and
data provenance for Earth, Moon, and Mars.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [New Tables and Columns](#2-new-tables-and-columns)
3. [Expanded Relational Architecture](#3-expanded-relational-architecture)
4. [Index Strategy](#4-index-strategy)
5. [Constraints and Validations](#5-constraints-and-validations)
6. [PostGIS Spatial Integration](#6-postgis-spatial-integration)
7. [Relationship Diagram (Entity-Relationship)](#7-relationship-diagram)

---

## 1. Design Principles

The following principles govern the expanded schema:

1. **Planet independence** — Earth, Moon, and Mars each have distinct
   coordinate reference systems (CRS), datums, and physical units. The schema
   must support arbitrary CRS per location and per dataset, not assume WGS84.

2. **Separated concerns** — A dataset is not a granule; a granule is not a
   measurement; a measurement is not a statistical summary. Each concept has
   its own table.

3. **Source fidelity** — The raw source product metadata (as returned by the
   source API) is preserved in full, in a dedicated provenance table, so no
   scientific claim can be traced back to its origin.

4. **Explicit conversions** — Where a native unit differs from the canonical
   unit, the conversion factor and provenance are recorded, never implied.

5. **Planet-consistent records** — A measurement's `planet_id` must equal its
   location's `planet_id` and its dataset's `planet_id`. This is enforced by
   composite foreign keys.

6. **Idempotent ingestion** — All ingestion pipelines are idempotent. Running
   twice produces no duplicate rows.

7. **No fabricated values** — Every numeric field must trace to a real source
   product, a pipeline version, and a retrieval timestamp. Placeholder values
   are forbidden.

---

## 2. New Tables and Columns

### 2.1 `regions`

Spatial regions (points or polygons) for comparisons. Expands the existing
`locations` concept into a full spatial region model.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Region identifier |
| `planet_id` | UUID | NOT NULL, FK → planets(id) ON DELETE RESTRICT | Owning planet |
| `name` | TEXT | NOT NULL | Human-readable name |
| `region_type` | TEXT | NOT NULL, CHECK IN ('point','polygon','multipolygon') | Geometry kind |
| `geom` | GEOMETRY | NOT NULL | PostGIS geometry; POINT or POLYGON |
| `datum` | TEXT | Nullable | Planet-local reference frame (e.g. WGS84, LRO_Selenographic, MOLA_areoid) |
| `bounding_box` | BOX | Nullable | Bounding box in the region's native CRS |
| `description` | TEXT | Nullable | Description |
| `classification` | TEXT | Nullable | e.g. 'continental','sedimentary basin', 'crater', 'mountain' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record insertion time |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last modification time |

**Indexes:**
- `idx_regions_planet` ON `regions`(planet_id)
- `idx_regions_type` ON `regions`(region_type)
- `idx_regions_geom` ON `regions` USING GIST(geom)

**Constraints:**
- CHECK: `region_type` IN ('point','polygon','multipolygon')
- CHECK: `(region_type = 'point') = (ST_GeometryType(geom) LIKE 'ST_Point%')`
- CHECK: `datum IS NOT NULL` when `geom IS NOT NULL`

**Notes:**
- The `geom` column stores geometry data using the PostGIS extension.
- Earth locations use `datum='WGS84'`; lunar locations use
  `datum='LRO_Selenographic'`; Martian locations use `datum='MOLA_areoid'`.
- The `bounding_box` column stores a `BOX` (PostGIS) in the region's native CRS.

---

### 2.2 `dataset_versions`

Track the provenance of a dataset (the same short_name can have multiple
versions over time). Each version represents one source product.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Version identifier |
| `dataset_id` | UUID | NOT NULL, FK → datasets(id) ON DELETE CASCADE | Owning dataset concept |
| `source_type` | TEXT | NOT NULL, CHECK IN ('instrument','derived','service','ontology') | Source provenance |
| `source_crs` | TEXT | Nullable | Planet-local CRS of the source product (e.g. 'WGS84','LRO_Selenographic','MOLA_areoid') |
| `native_unit` | TEXT | Nullable | Unit as delivered by the source |
| `native_resolution_m` | DOUBLE PRECISION | Nullable | Source grid resolution in meters (for gridded data) |
| `file_format` | TEXT | Nullable | e.g. 'GeoTIFF','NetCDF','SAFE','JPEG2000' |
| `file_size_bytes` | BIGINT | Nullable | Download size of the original file |
| `md5_checksum` | TEXT | Nullable | MD5 checksum of the source file |
| `download_url` | TEXT | Nullable | Direct download URL for the asset |
| `metadata_url` | TEXT | Nullable | URL to the original metadata (CDS/UMM/GEMD) |
| `acquisition_start` | TIMESTAMPTZ | Nullable | Start of acquisition window |
| `acquisition_end` | TIMESTAMPTZ | Nullable | End of acquisition window |
| `processing_level` | TEXT | Nullable | E.g. 'L2A','L3','L4','collection 1' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Retrieval timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last modification time |

**Indexes:**
- `idx_dataset_versions_dataset` ON `dataset_versions`(dataset_id)
- `idx_dataset_versions_platform` ON `dataset_versions`(source_crs)

**Constraints:**
- UNIQUE (dataset_id, source_type) — one row per dataset per source type

---

### 2.3 `dataset_assets`

Individual raster/scalar assets (granules) belonging to a dataset version.
Track downloadable assets and their metadata.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Asset identifier |
| `dataset_version_id` | UUID | NOT NULL, FK → dataset_versions(id) ON DELETE CASCADE | Owning version |
| `product_id` | TEXT | Nullable | Product identifier (API-specific) |
| `platform` | TEXT | Nullable | e.g. 'Sentinel-2B','LRO','MGS','MRO' |
| `instrument` | TEXT | Nullable | e.g. 'MSI','LOLA','MOLA','TES','CRISM','HiRISE' |
| `acquisition_start` | TIMESTAMPTZ | Nullable | Product acquisition window start |
| `acquisition_end` | TIMESTAMPTZ | Nullable | Product acquisition window end |
| `bounds` | BOX | Nullable | Geographic bounding box of the product |
| `native_crs` | TEXT | Nullable | CRS of the asset grid |
| `native_resolution_m` | DOUBLE PRECISION | Nullable | Grid resolution (meters) |
| `file_format` | TEXT | Nullable | e.g. 'GeoTIFF','NetCDF','SAFE','JP2','ECMWF' |
| `file_size_bytes` | BIGINT | Nullable | Download size |
| `download_url` | TEXT | Nullable | Direct download URL |
| `metadata_url` | TEXT | Nullable | URL to product metadata |
| `md5_checksum` | TEXT | Nullable | MD5 checksum |
| `availability_status` | TEXT | NOT NULL, CHECK IN ('available','processing','incomplete','retracted') | Pipeline status |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Ingestion timestamp |
| `created_by` | TEXT | Nullable | Ingestion pipeline/API that created it |
| `processing_notes` | TEXT | Nullable | Notes on processing applied |

**Indexes:**
- `idx_dataset_assets_version` ON `dataset_assets`(dataset_version_id)
- `idx_dataset_assets_platform` ON `dataset_assets`(platform)
- `idx_dataset_assets_status` ON `dataset_assets`(availability_status)

**Constraints:**
- UNIQUE (dataset_version_id, product_id) — one row per product per version

---

### 2.4 `regional_statistics`

Aggregated statistics computed from raster assets or observation series.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Statistic identifier |
| `region_id` | UUID | NOT NULL, FK → regions(id) ON DELETE CASCADE | Owning region |
| `dataset_asset_id` | UUID | NOT NULL, FK → dataset_assets(id) ON DELETE CASCADE | Source asset (nullable if derived from a series) |
| `variable_id` | UUID | NOT NULL, FK → variables(id) ON DELETE RESTRICT | Variable being summarized |
| `statistic_type` | TEXT | NOT NULL, CHECK IN ('mean','min','max','stddev','percentile','count','range','temporal_mean','temporal_stddev') | Type of statistic |
| `percentile` | DOUBLE PRECISION | Nullable | Percentile value (e.g. 90 for 'percentile_90') |
| `value` | DOUBLE PRECISION | Nullable | Numeric value |
| `unit` | TEXT | NOT NULL | Unit of the statistic (sources override `variables.canonical_unit` if different) |
| `sample_count` | BIGINT | Nullable | Number of samples ingested |
| `temporal_start` | TIMESTAMPTZ | Nullable | Start of temporal window |
| `temporal_end` | TIMESTAMPTZ | Nullable | End of temporal window |
| `methodology` | TEXT | Nullable | Calculation method description |
| `processing_version` | TEXT | Nullable | Version of the processing pipeline |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Generation timestamp |
| `created_by` | TEXT | Nullable | Pipeline that computed it |

**Indexes:**
- `idx_regional_stats_region` ON `regional_statistics`(region_id)
- `idx_regional_stats_variable` ON `regional_statistics`(variable_id)
- `idx_regional_stats_dataset_asset` ON `regional_statistics`(dataset_asset_id)
- `idx_regional_stats_type` ON `regional_statistics`(statistic_type)
- `idx_regional_stats_region_variable_type` ON `regional_statistics`(region_id, variable_id, statistic_type)

**Constraints:**
- CHECK: `statistic_type IN ('mean','min','max','stddev','percentile','count','range','temporal_mean','temporal_stddev')`
- CHECK: `percentile IS NULL OR (percentile >= 0 AND percentile <= 100)`
- CHECK: `value IS NULL OR sample_count IS NOT NULL` (count statistics require a sample count)

---

### 2.5 `provenance`

Full provenance trail for every derived measurement/statistics record.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Provenance record identifier |
| `record_type` | TEXT | NOT NULL, CHECK IN ('measurement','regional_statistics','asset') | Type of record being traced |
| `target_id` | UUID | NOT NULL | ID of the record being traced |
| `source_type` | TEXT | NOT NULL, CHECK IN ('api','manual','derived') | Origin of the source data |
| `source_name` | TEXT | Nullable | Name of the source (e.g. 'NASA POWER','Copernicus STAC') |
| `source_url` | TEXT | Nullable | Original API endpoint or manifest URL |
| `record_id` | TEXT | Nullable | API-specific record identifier (e.g. granule_id) |
| `retrieval_timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | When the original data was retrieved |
| `processing_params` | TEXT | Nullable | JSON object of processing parameters used |
| `processing_version` | TEXT | Nullable | Version of the processing pipeline |
| `transformation` | TEXT | Nullable | Description of transformations applied |
| `validation_status` | TEXT | NOT NULL, CHECK IN ('pending','verified','rejected','flagged') | Validation status |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record creation time |

**Indexes:**
- `idx_provenance_record_type` ON `provenance`(record_type)
- `idx_provenance_target` ON `provenance`(target_id)
- `idx_provenance_source_name` ON `provenance`(source_name)

**Constraints:**
- UNIQUE (record_type, target_id, source_type, record_id) — one provenance row per record/source

---

### 2.6 `analog_rankings`

Analog comparison between Earth locations and planetary reference locations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Ranking identifier |
| `earth_location_id` | UUID | NOT NULL, FK → regions(id) ON DELETE RESTRICT | Earth candidate location |
| `reference_location_id` | UUID | NOT NULL, FK → regions(id) ON DELETE RESTRICT | Planetary reference location |
| `similarity_score` | DOUBLE PRECISION | Nullable | Overall similarity (0.0–1.0) |
| `methodology` | TEXT | Nullable | Algorithm description |
| `algorithm_version` | TEXT | Nullable | Ranking algorithm version |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Ranking generation timestamp |
| `created_by` | TEXT | Nullable | Generation pipeline |

**Indexes:**
- `idx_analog_rankings_earth` ON `analog_rankings`(earth_location_id)
- `idx_analog_rankings_reference` ON `analog_rankings`(reference_location_id)

**Constraints:**
- CHECK: `similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1)`

**Notes:**
- Each ranking row links one Earth location to one reference location.
- Individual variable scores are stored in a separate table (see below).
- The ranking model is intentionally decoupled from the scoring algorithm so that new algorithms can be plugged in without schema changes.

---

### 2.7 `analog_variable_scores`

Per-variable similarity scores supporting an `analog_rankings` record.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Score identifier |
| `ranking_id` | UUID | NOT NULL, FK → analog_rankings(id) ON DELETE CASCADE | Owning ranking |
| `variable_id` | UUID | NOT NULL, FK → variables(id) ON DELETE RESTRICT | Variable compared |
| `earth_value` | DOUBLE PRECISION | Nullable | Earth location value |
| `reference_value` | DOUBLE PRECISION | Nullable | Reference location value |
| `score` | DOUBLE PRECISION | Nullable | 0.0–1.0 similarity score for this variable |
| `normalization` | TEXT | Nullable | e.g. 'minmax','zscore','relative' |
| `weight` | DOUBLE PRECISION | Nullable | Weight applied to this variable |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Score generation timestamp |

**Indexes:**
- `idx_analog_variable_scores_ranking` ON `analog_variable_scores`(ranking_id)
- `idx_analog_variable_scores_variable` ON `analog_variable_scores`(variable_id)

**Constraints:**
- CHECK: `score IS NULL OR (score >= 0 AND score <= 1)`

---

## 3. Expanded Relational Architecture

### 3.1 Complete Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  planets    │───────│  regions    │       │ variables   │
│             │       │             │       │             │
│  id (PK)    │───────│  id (PK)    │       │  id (PK)    │
│  name       │       │  planet_id  │───────│  name       │
│  slug       │       │  region_type│       │  canonical_unit│
│  body_type  │       │  geom       │       │  definition │
│  created_at │       │  datum      │       │  created_at │
└─────────────┘       │  description│       └─────────────┘
                      │  classification│
                      │  created_at   │
                      │  updated_at   │
                      └──┬──────────┬─┘
                         │         │
                         │         │
                         ▼         ▼
┌─────────────┐       ┌─────────────┐
│  datasets   │       │  dataset_versions │
│             │       │                   │
│  id (PK)    │       │  id (PK)        │
│  planet_id  │───────┴──────┬──────────┴──┤
│  short_name │              │              │
│  description│              │              │
│  source_url │              │              │
│  source_type│              │              │
│  native_crs │              │              │
│  created_at │              │              │
└─────────────┘              │  source_crs  │
                             │  native_unit │
                             │  native_res  │
                             │  file_format │
                             │  file_size   │
                             │  md5_checksum│
                             │  download_url│
                             │  metadata_url│
                             │  availability│
                             │  created_at  │
                             └──────────────┘
                                   │
                                   ▼
                        ┌──────────────────┐
                        │  dataset_assets  │
                        │                  │
                        │  id (PK)         │
                        │  dataset_version │
                        │  product_id      │
                        │  platform        │
                        │  instrument      │
                        │  bounds (BOX)    │
                        │  native_crs      │
                        │  file_format     │
                        │  file_size       │
                        │  download_url    │
                        │  md5_checksum    │
                        │  status          │
                        │  created_at      │
                        └────────┬─────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────┐
│  dataset_variables                                       │
│  (dataset_id, variable_id) PK: native_unit,              │
│  native_resolution_m                                    │
└────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────┐
│  measurements                                         │
│  (dataset_id, variable_id) PK: composite FK              │
│  location_id, planet_id, value, value_unit,              │
│  native_value, native_resolution_m, quality_flag,         │
│  recorded_at, created_at                                  │
└────────────────────────────────────────────────────────────┘

                                │
                                ▼
┌────────────────────────────────────────────────────────────┐
│  regional_statistics                                   │
│  (region_id, dataset_asset_id, variable_id,             │
│   statistic_type, percentile, value, unit,              │
│   sample_count, temporal_start, temporal_end,            │
│   methodology, processing_version)                        │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  provenance                                          │
│  (record_type, target_id, source_type, source_name,      │
│   source_url, record_id, retrieval_timestamp,            │
│   processing_params, processing_version, transformation,  │
│   validation_status)                                      │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  analog_rankings                                    │
│  (earth_location_id, reference_location_id,              │
│   similarity_score, methodology, algorithm_version)       │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  analog_variable_scores                               │
│  (ranking_id, variable_id, earth_value, reference_value, │
│   score, normalization, weight)                          │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Index Strategy

The following indexes are recommended for the new and expanded tables:

| Table | Index | Type | Rationale |
|---|---|---|---|
| `regions` | `idx_regions_planet` | B-tree | Planet-filtered region queries |
| `regions` | `idx_regions_type` | B-tree | Filter by point/polygon |
| `regions` | `idx_regions_geom` | GIST | Spatial queries |
| `regions` | `idx_regions_bbox` | GIST | Bounding box queries |
| `dataset_versions` | `idx_dataset_versions_dataset` | B-tree | Version lookups |
| `dataset_versions` | `idx_dataset_versions_source_crs` | B-tree | CRS-based filtering |
| `dataset_assets` | `idx_dataset_assets_version` | B-tree | Version → assets |
| `dataset_assets` | `idx_dataset_assets_platform` | B-tree | Platform filtering |
| `dataset_assets` | `idx_dataset_assets_status` | B-tree | Pipeline status filtering |
| `dataset_assets` | `idx_dataset_assets_asset` | GIST | Spatial asset queries |
| `regional_statistics` | `idx_regional_stats_region` | B-tree | Region aggregation |
| `regional_statistics` | `idx_regional_stats_variable` | B-tree | Variable filtering |
| `regional_statistics` | `idx_regional_stats_dataset_asset` | B-tree | Asset → statistics |
| `regional_statistics` | `idx_regional_stats_type` | B-tree | Statistic type filtering |
| `regional_statistics` | `idx_regional_stats_region_variable_type` | Composite | Region+variable+type drill-down |
| `analog_rankings` | `idx_analog_rankings_earth` | B-tree | Earth location rankings |
| `analog_rankings` | `idx_analog_rankings_reference` | B-tree | Reference location rankings |
| `analog_variable_scores` | `idx_analog_variable_scores_ranking` | B-tree | Ranking score lookup |
| `analog_variable_scores` | `idx_analog_variable_scores_variable` | B-tree | Variable-level lookup |

**Geometry indexes:** All `geom` columns use GiST indexes (PostGIS). For
spatial queries, use `ST_DWithin`, `ST_Intersects`, and `ST_Within`.

---

## 5. Constraints and Validations

| Constraint type | Table | Rule |
|---|---|---|
| `CHECK` | `regions` | `region_type` IN ('point','polygon','multipolygon') |
| `CHECK` | `regions` | `(region_type = 'point') = (ST_GeometryType(geom) LIKE 'ST_Point%')` |
| `CHECK` | `regions` | `datum IS NOT NULL` when `geom IS NOT NULL` |
| `CHECK` | `regions` | `latitude IS NOT NULL` when `region_type = 'point'` (if separate columns used) |
| `CHECK` | `measurements` | `value_unit = variables.canonical_unit` (enforced by composite FK) |
| `CHECK` | `measurements` | `dataset_variables.dataset_id = measurements.dataset_id` and `variable_id` cross-check enforced by composite FKs |
| `CHECK` | `regional_statistics` | `statistic_type IN ('mean','min','max','stddev','percentile','count','range','temporal_mean','temporal_stddev')` |
| `CHECK` | `regional_statistics` | `percentile IS NULL OR (percentile >= 0 AND percentile <= 100)` |
| `CHECK` | `regional_statistics` | `value IS NULL OR sample_count IS NOT NULL` |
| `CHECK` | `analog_rankings` | `similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1)` |
| `CHECK` | `analog_variable_scores` | `score IS NULL OR (score >= 0 AND score <= 1)` |
| `CHECK` | `dataset_assets` | `availability_status IN ('available','processing','incomplete','retracted')` |
| `CHECK` | `provenance` | `source_type IN ('api','manual','derived')` |
| `CHECK` | `provenance` | `record_type IN ('measurement','regional_statistics','asset')` |
| `CHECK` | `provenance` | `validation_status IN ('pending','verified','rejected','flagged')` |
| `UNIQUE` | `dataset_versions` | (dataset_id, source_type) — one version per dataset per source type |
| `UNIQUE` | `dataset_assets` | (dataset_version_id, product_id) — one row per product per version |
| `UNIQUE` | `provenance` | (record_type, target_id, source_type, record_id) |
| `FOREIGN KEY` | All FKs | `ON DELETE RESTRICT` for parent references |
| `FOREIGN KEY` | All FKs | `ON UPDATE CASCADE` for consistency |
| `DEFAULT` | `created_at` | `NOW()` for all new records |
| `DEFAULT` | `updated_at` | `NOW()` for all records (or application-managed) |

---

## 6. PostGIS Spatial Integration

### 6.1 Extension activation

The PostGIS extension must be enabled in the Supabase project:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

This is a one-time operation per Supabase project. The extension provides:
- `geometry` and `geography` types
- Spatial predicates (`ST_Intersects`, `ST_DWithin`, `ST_Within`, `ST_Covers`, etc.)
- Spatial indexing (`GIST` indexes)
- Geometry constructors (`ST_GeomFromText`, `ST_SetSRID`, etc.)

### 6.2 Geometry column types

The `geom` column in `regions` is of type `geometry(GeoType, SRID)`, where:

- `GeoType` is `POINT` for point regions, `POLYGON` for polygon regions, or
  `MULTIPOLYGON` for multipolygon regions.
- `SRID` is the Spatial Reference System Identifier (e.g. 4326=EPSG:4326=WGS84,
  7030=Mars2000/IAU2000 (Mars), 1000127=IAU/IAG Lunar ME frame DE421).

For each planet, the canonical SRID should be:
| Body | SRID | Definition |
|---|---|---|
| Earth | 4326 | WGS84 (EPSG:4326) |
| Moon | 1000127 | IAU/IAG Lunar ME frame (DE421) |
| Mars | 7030 | Mars2000/IAU2000 (Mars) |

### 6.3 Point vs polygon storage

- **Point locations**: `geom` = `POINT(<lon> <lat>)`, point regions are
  orthogonal, and the `geom` column stores a single coordinate pair.
- **Polygon regions**: `geom` = `POLYGON((<x1 y1>, <x2 y2>, ... <xn yn>, <x1 y1>))`.
  Used for geographic region boundaries.

### 6.4 Bounding box

The `bounding_box` column stores a PostGIS `BOX` type in the region's native CRS.
It is a degenerate (single-point) box for point regions and a full bounding box
for polygon regions.

---

## 7. Relationship Diagram (Entity-Relationship)

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  planets    │       │  regions    │       │ variables   │
│             │       │             │       │             │
│  id (PK)    │───────┴──────┬──────┴───┬───┴───┬───────┴───┬───┤
│  name       │              │         │      │       │      │
│  slug       │              │         │      │       │      │
│  body_type  │              │         │      │       │      │
│  created_at │              │         │      │       │      │
└─────────────┘              │         │      │       │      │
                             │         │      │       │      │
                             ▼         ▼      ▼       ▼      ▼
                     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                     │  measurements                                  │
                     │  (dataset_id, variable_id) PK:                │
                     │  location_id, planet_id, value,               │
                     │  value_unit, native_value,                    │
                     │  native_resolution_m, quality_flag,           │
                     │  recorded_at, created_at                      │
                     └───────────────────────────────────────────────┘
```

(For a full visual diagram, please see the companion file
`docs/entity-relationship-diagram.md`.)

---

## 8. Data Processing Pipeline Overview

The pipeline has three distinct stages:

1. **Metadata ingestion** — Pull metadata from source APIs (CMR, STAC, PDS,
   POWER, AppEEARS) and store in provenance and dataset asset tables
   without downloading raster data.

2. **Asset downloading** — For each metadata record, download the source
   raster file via the API's download URL. Stage the file in temporary local
   or object storage.

3. **Scientific data processing** — Using a processing pipeline (e.g. GDAL,
   xarray, numpy), open the raster, subset to the region of interest, compute
   regional statistics, and write results to `regional_statistics`.

Each stage records its operations in `provenance` for full traceability.

---

*End of document*
