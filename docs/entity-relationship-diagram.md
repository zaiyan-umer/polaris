# Entity-Relationship Diagram
# Planetary Analog Discovery System — Expanded Schema

This document describes the entity-relationship (ER) diagram for the expanded
Planetary Analog Discovery System. It is a companion to
`docs/database-architecture.md`.

---

## Scope

The schema is organized into eight functional areas:

| Area | Tables |
|---|---|
| **Core planetary data** | planets, regions, variables |
| **Dataset metadata** | datasets, dataset_versions, dataset_assets |
| **Observations** | measurements |
| **Regional statistics** | regional_statistics |
| **Data provenance** | provenance |
| **Analog ranking** | analog_rankings, analog_variable_scores |
| **Reference data** | (preserved from original: dataset_variables) |

---

## Entity-Relationship Diagram

```
                 ┌────────────┐
                 │   planets  │
                 │  id (PK)   │
                 │  name      │
                 │  slug      │
                 │  body_type │
                 └─────┬──────┘
                       │ 1
                       │
                       │ N
                 ┌─────┴──────┐
                 │   regions  │
                 │  id (PK)   │
                 │  planet_id │
                 │  type      │
                 │  geom      │
                 └─────┬──────┘
   ┌───────────────────┼───────────────────┐
   │                   │                   │
   │ 1                 │ N                 │ N
   ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  datasets   │    │ dataset_assets│    │  variables  │
│  id (PK)    │    │  id (PK)    │    │  id (PK)    │
│  planet_id  │    │  version_id │    │  name       │
│  short_name │    │  product_id │    │  canonical  │
│  description│    │  platform   │    │  unit       │
│  source_url │    │  instrument │    │  defn       │
│  source_type│    │  bounds     │    │  created_at │
│  native_crs │    │  status     │    └─────────────┘
│  created_at │    │  created_at │
└─────────────┘    └─────────────┘
        │                  │
        │ 1                │ 1
        │                  │
        ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│ dataset_variables (composite PK)                             │
│ dataset_id + variable_id                                     │
│ native_unit, native_resolution_m                             │
└──────────────────────────────────────────────────────────────┘
        │
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ measurements (composite FK)                                  │
│ dataset_id + variable_id + location_id + planet_id (PK)      │
│ value, value_unit, native_value, native_resolution_m,        │
│ quality_flag, recorded_at, created_at                        │
└──────────────────────────────────────────────────────────────┘

        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ regional_statistics                                          │
│ region_id, dataset_asset_id, variable_id,                    │
│ statistic_type, percentile, value, unit,                     │
│ sample_count, temporal_start, temporal_end,                  │
│ methodology, processing_version                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ provenance                                                   │
│ record_type, target_id, source_type, source_name,            │
│ record_id, retrieval_timestamp, processing_params,           │
│ processing_version, transformation, validation_status        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ analog_rankings                                              │
│ earth_location_id, reference_location_id,                    │
│ similarity_score, methodology, algorithm_version             │
└──────────────────────────────────────────────────────────────┘
        │
        │ 1
        ▼
┌──────────────────────────────────────────────────────────────┐
│ analog_variable_scores                                       │
│ ranking_id (PK/FK), variable_id, earth_value,                │
│ reference_value, score, normalization, weight                │
└──────────────────────────────────────────────────────────────┘
```

---

## Cardinality Summary

| Relationship | Cardinality | Table(s) |
|---|---|---|
| planet → regions | 1 : N | planets → regions |
| planet → datasets | 1 : N | planets → datasets |
| dataset → dataset_versions | 1 : N | datasets → dataset_versions |
| dataset_version → dataset_assets | 1 : N | dataset_versions → dataset_assets |
| dataset → dataset_variables | 1 : N | datasets → dataset_variables |
| dataset → measurements | 1 : N | datasets → measurements |
| dataset → regional_statistics | 1 : N | datasets → regional_statistics |
| location → measurements | 1 : N | locations → measurements |
| region → regional_statistics | 1 : N | regions → regional_statistics |
| dataset_asset → regional_statistics | 1 : N | dataset_assets → regional_statistics |
| variable → measurements | 1 : N | variables → measurements |
| variable → dataset_variables | 1 : N | variables → dataset_variables |
| variable → regional_statistics | 1 : N | variables → regional_statistics |
| variable → analog_variable_scores | 1 : N | variables → analog_variable_scores |
| earth_region → analog_rankings | 1 : N | regions → analog_rankings |
| reference_region → analog_rankings | 1 : N | regions → analog_rankings |
| ranking → analog_variable_scores | 1 : N | analog_rankings → analog_variable_scores |
| measurement → provenance | 1 : 1 | measurements → provenance |
| regional_statistics → provenance | 1 : 1 | regional_statistics → provenance |

---

## Entity Descriptions

### planets (preserved)

The core planetary reference table. One row per celestial body with
observational characteristics.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| name | TEXT | Planet name |
| slug | TEXT | URL-safe identifier |
| body_type | TEXT | e.g. 'terrestrial planet', 'moon' |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Record modification time |

### regions (new)

Spatial regions for comparisons. Supports point or polygon geometry.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| planet_id | UUID | FK → planets |
| name | TEXT | Human-readable name |
| region_type | TEXT | 'point', 'polygon', 'multipolygon' |
| geom | GEOMETRY | PostGIS geometry |
| datum | TEXT | Planet-local CRS (e.g. WGS84, LRO_Selenographic, MOLA_areoid) |
| bounding_box | BOX | Bounding box in native CRS |
| description | TEXT | Description |
| classification | TEXT | e.g. 'continent', 'crater', 'sedimentary basin' |
| created_at | TIMESTAMPTZ | Creation time |
| updated_at | TIMESTAMPTZ | Last modification time |

### dataset_versions (new)

Tracks source product versions. One row per dataset per source_type.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| dataset_id | UUID | FK → datasets |
| source_type | TEXT | 'instrument', 'derived', 'service', 'ontology' |
| source_crs | TEXT | Planet-local CRS of source |
| native_unit | TEXT | Unit as delivered by source |
| native_resolution_m | DOUBLE PRECISION | Grid resolution in meters |
| file_format | TEXT | e.g. 'GeoTIFF', 'NetCDF', 'SAFE', 'JP2' |
| file_size_bytes | BIGINT | Download size |
| md5_checksum | TEXT | MD5 checksum |
| download_url | TEXT | Direct download URL |
| metadata_url | TEXT | Source metadata URL |
| acquisition_start | TIMESTAMPTZ | Acquisition window start |
| acquisition_end | TIMESTAMPTZ | Acquisition window end |
| processing_level | TEXT | e.g. 'L2A', 'L3', 'L4' |
| created_at | TIMESTAMPTZ | Retrieval timestamp |
| updated_at | TIMESTAMPTZ | Last modification |

### dataset_assets (new)

Individual raster assets for a dataset version.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| dataset_version_id | UUID | FK → dataset_versions |
| product_id | TEXT | API-specific product identifier |
| platform | TEXT | e.g. 'Sentinel-2B', 'LRO', 'MGS' |
| instrument | TEXT | e.g. 'MSI', 'LOLA', 'MOLA' |
| bounds | BOX | Product bounding box |
| native_crs | TEXT | Asset CRS |
| native_resolution_m | DOUBLE PRECISION | Grid resolution |
| file_format | TEXT | e.g. 'GeoTIFF', 'NetCDF', 'SAFE', 'JP2' |
| file_size_bytes | BIGINT | Download size |
| download_url | TEXT | Direct download URL |
| metadata_url | TEXT | Product metadata URL |
| md5_checksum | TEXT | MD5 checksum |
| availability_status | TEXT | 'available', 'processing', 'incomplete', 'retracted' |
| created_at | TIMESTAMPTZ | Ingestion timestamp |
| created_by | TEXT | Ingestion pipeline/API |
| processing_notes | TEXT | Pipeline processing notes |

### variables (preserved)

Variable definitions shared across datasets and measurements.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| name | TEXT | Variable name |
| canonical_unit | TEXT | Canonical unit |
| definition | TEXT | Definition |
| created_at | TIMESTAMPTZ | Creation time |
| updated_at | TIMESTAMPTZ | Last modification |

### measurements (preserved)

Native measurements from dataset assets.

| Column | Type | Description |
|---|---|---|
| dataset_id | UUID | FK |
| variable_id | UUID | FK |
| location_id | UUID | FK |
| planet_id | UUID | FK |
| value | DOUBLE PRECISION | Converted value |
| value_unit | TEXT | Value unit |
| native_value | DOUBLE PRECISION | Native source value |
| native_resolution_m | DOUBLE PRECISION | Native resolution |
| quality_flag | TEXT | e.g. 'good', 'marginal', 'retracted' |
| recorded_at | TIMESTAMPTZ | Observation timestamp |
| created_at | TIMESTAMPTZ | Record creation |

### regional_statistics (new)

Aggregated statistics from raster assets or observation series.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| region_id | UUID | FK → regions |
| dataset_asset_id | UUID | FK → dataset_assets |
| variable_id | UUID | FK → variables |
| statistic_type | TEXT | 'mean', 'min', 'max', 'stddev', 'percentile', 'count', 'range', 'temporal_mean', 'temporal_stddev' |
| percentile | DOUBLE PRECISION | Percentile (0–100) |
| value | DOUBLE PRECISION | Statistic value |
| unit | TEXT | Statistic unit |
| sample_count | BIGINT | Number of samples |
| temporal_start | TIMESTAMPTZ | Temporal window start |
| temporal_end | TIMESTAMPTZ | Temporal window end |
| methodology | TEXT | Calculation method |
| processing_version | TEXT | Pipeline version |
| created_at | TIMESTAMPTZ | Generation time |
| created_by | TEXT | Pipeline that computed it |

### provenance (new)

Full traceability for derived data.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| record_type | TEXT | 'measurement', 'regional_statistics', 'asset' |
| target_id | UUID | ID of the record being traced |
| source_type | TEXT | 'api', 'manual', 'derived' |
| source_name | TEXT | Source API name |
| source_url | TEXT | Original endpoint |
| record_id | TEXT | API-specific ID |
| retrieval_timestamp | TIMESTAMPTZ | When original data was retrieved |
| processing_params | TEXT | JSON of processing parameters |
| processing_version | TEXT | Pipeline version |
| transformation | TEXT | Transformation description |
| validation_status | TEXT | 'pending', 'verified', 'rejected', 'flagged' |
| created_at | TIMESTAMPTZ | Record creation time |

### analog_rankings (new)

Earth–planetary analog comparison.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| earth_location_id | UUID | FK → regions (Earth) |
| reference_location_id | UUID | FK → regions (planetary reference) |
| similarity_score | DOUBLE PRECISION | Overall similarity (0–1) |
| methodology | TEXT | Algorithm description |
| algorithm_version | TEXT | Algorithm version |
| created_at | TIMESTAMPTZ | Ranking generation time |
| created_by | TEXT | Generation pipeline |

### analog_variable_scores (new)

Per-variable scores for an analog ranking.

| Column | Type | Description |
|---|---|---|
| id | UUID | PK |
| ranking_id | UUID | FK → analog_rankings |
| variable_id | UUID | FK → variables |
| earth_value | DOUBLE PRECISION | Earth value |
| reference_value | DOUBLE PRECISION | Reference value |
| score | DOUBLE PRECISION | 0–1 similarity |
| normalization | TEXT | e.g. 'minmax', 'zscore', 'relative' |
| weight | DOUBLE PRECISION | Variable weight |
| created_at | TIMESTAMPTZ | Score generation time |

---

## Notes on Preserved Tables

The following tables are preserved from the original schema and unchanged:

- `dataset_variables` — composite primary key on (dataset_id, variable_id),
  with native_unit and native_resolution_m.
- `datasets` — planet_id, short_name, description, source_url, source_type,
  native_crs.
- `measurements` — composite FK (dataset_id, variable_id, location_id,
  planet_id), value, value_unit, native_value, native_resolution_m,
  quality_flag, recorded_at, created_at.

All existing rows, seed data, and API contracts remain intact. The new tables
are designed to reference the preserved tables without modifying them.

---

*End of document*
