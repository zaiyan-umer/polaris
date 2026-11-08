# Data Processing Pipeline
# Planetary Analog Discovery System

Document version: 1.0
Last updated: November 2026

This document defines the data processing pipeline for the Planetary Analog
Discovery System. It covers the end-to-end flow from source API metadata
ingestion, through asset download, to scientific data processing and
statistics generation, preserving full data provenance.

---

## 1. Pipeline Overview

The pipeline has three distinct stages:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: METADATA INGESTION                                            │
│  Pull metadata from source APIs (CMR, STAC, PDS, POWER, AppEEARS)       │
│  → Store in dataset_versions, dataset_assets, provenance tables         │
│  → NO raster data downloaded at this stage                              │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: ASSET DOWNLOADING                                             │
│  For each metadata record, download the source raster via the API URL   │
│  → Stage file locally or in object storage                              │
│  → Verify MD5 checksum, file size, availability_status                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: SCIENTIFIC DATA PROCESSING                                    │
│  Open raster with GDAL/xarray/numpy                                     │
│  → Subset to region of interest                                         │
│  → Compute regional statistics                                          │
│  → Write to regional_statistics table                                   │
│  → Record provenance trail                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Stage 1: Metadata Ingestion

### 2.1 Source APIs

| API | Endpoint pattern | Data stored |
|---|---|---|
| NASA CMR | `https://cmr.earthdata.nasa.gov/search/granules` | Collection metadata, granule metadata, download URLs |
| Copernicus STAC | `https://stac.dataspace.copernicus.eu/v1/collections/{id}/items` | Item metadata, asset URLs, band statistics |
| NASA PDS Search API | `https://pds.nasa.gov/api/search/1/products` | Product metadata, data set URIs |
| NASA POWER | `https://power.larc.nasa.gov/api/temporal/...` | Parameter metadata, daily/climatology values |
| AppEEARS | `https://appeears.earthdatacloud.nasa.gov/api/task` | Area request submission, product layer metadata |

### 2.2 Ingestion Steps

1. **Query the source API** with the appropriate parameter set
2. **Parse the response** into structured metadata
3. **Deduplicate** using a high-entropy key (e.g. granule_id, product_uuid, or
   record_id + retrieval_timestamp)
4. **Store metadata** in the appropriate table:
   - `dataset_versions` for dataset-level metadata
   - `dataset_assets` for asset-level metadata
   - `provenance` for full traceability
5. **Record retrieval timestamp** in provenance at the time of ingestion

### 2.3 Idempotency

The ingestion pipeline is idempotent by design:

- Records are identified by a stable key (granule_id, product_uuid, or
  record_id + source_name)
- On re-ingestion, existing records are updated in place, not duplicated
- `availability_status` is updated to reflect the current state of the asset

---

## 3. Stage 2: Asset Downloading

### 3.1 Download Steps

1. **Query `dataset_assets`** for records with `availability_status = 'available'`
2. **Download the raster** via the `download_url` using HTTPS
3. **Stage the file** in a temporary location (local disk or object storage)
4. **Verify integrity**:
   - Check `file_size_bytes` matches the downloaded size
   - Compute MD5 and compare with `md5_checksum`
5. **Update `availability_status`**:
   - 'available' → 'processing'
   - 'incomplete' → 'processing'
   - 'retracted' → leave unchanged
6. **Record provenance** for the downloaded asset, including the pipeline
   version and download timestamp

### 3.2 Error Handling

| Error | Action |
|---|---|
| Network failure | Retry with exponential backoff (up to 5 attempts) |
| MD5 mismatch | Mark asset 'retracted', skip processing |
| File size mismatch | Mark asset 'retracted', skip processing |
| Invalid file format | Mark asset 'incomplete', record in `processing_notes` |
| HTTP 404 / 403 | Mark asset 'retracted' with error logged in provenance |

---

## 4. Stage 3: Scientific Data Processing

### 4.1 Processing Steps

1. **Open the raster** using GDAL or xarray
2. **Read band metadata** (resolution, CRS, nodata value, data type)
3. **Interpret band values**:
   - For each band, map to a `variable` by `band_id` or band name
   - Convert native units to canonical units using stored conversion factors
4. **Subset to a region** using `ST_Intersects` to determine the spatial
   extent of interest
5. **Compute statistics** for the region:
   - **Mean**: average pixel value weighted by pixel area
   - **Minimum / Maximum**: min/max pixel value
   - **Stddev**: population or sample standard deviation
   - **Percentiles**: 10th, 50th, 90th for the region
   - **Sample count**: number of valid (non-nodata) pixels
   - **Temporal range**: if the asset spans a time window, record start/end
6. **Write to `regional_statistics`**:
   - One row per (region, asset, variable, statistic_type)
   - Include `unit`, `methodology`, `processing_version`
7. **Record provenance** for the computed statistics:
   - Data source (API name)
   - Source URL
   - Processing parameters
   - Processing version
   - Validation status

### 4.2 Statistics Computations

| Statistic | Formula | Notes |
|---|---|---|
| mean | `sum(v_i) / n` | Area-weighted |
| min | `min(v_i)` | |
| max | `max(v_i)` | |
| stddev | `sqrt(sum((v_i - mean)^2) / n)` | Population stddev |
| percentile_p | value at p% of sorted values | Linear interpolation between closest ranks |
| count | `n` | Number of valid pixels |
| range | `max(v_i) - min(v_i)` | |
| temporal_mean | `mean(t_i)` | Time-weighted |
| temporal_stddev | `stddev(t_i)` | Time-weighted temporal variability |

### 4.3 Unit Conversions

The conversion from native to canonical units is performed in the processing
stage:

- Determine the native unit from `dataset_versions.native_unit` or
  `dataset_assets.native_resolution_m`
- Apply the appropriate conversion factor
- Store the converted value in `value` and the canonical unit in `unit`
- The conversion factor and provenance are recorded in `provenance`

---

## 5. Provenance Tracking

### 5.1 What is Tracked

Every derived measurement and statistics record traces back to:

| Field | Description |
|---|---|
| `record_type` | measurement, regional_statistics, asset |
| `target_id` | ID of the record being traced |
| `source_type` | api, manual, derived |
| `source_name` | e.g. 'NASA POWER', 'Copernicus STAC' |
| `source_url` | Original API endpoint |
| `record_id` | API-specific record identifier |
| `retrieval_timestamp` | When the original data was retrieved |
| `processing_params` | JSON of processing parameters |
| `processing_version` | Pipeline version |
| `transformation` | Description of transformations |
| `validation_status` | pending, verified, rejected, flagged |

### 5.2 Provenance Linkage

The pipeline links derived records to their sources through:

- `regional_statistics.dataset_asset_id` → `dataset_assets.id`
- `regional_statistics.variable_id` → `variables.id`
- `provenance.target_id` → `regional_statistics.id`

This allows full traceability from any statistic back to:
- The original source API
- The source product
- The processing algorithm
- The pipeline version
- The ingestion timestamp

---

## 6. Pipeline Versions and Reprocessing

### 6.1 Pipeline Versioning

Each pipeline run records its version in:

- `dataset_assets.processing_notes`
- `regional_statistics.processing_version`
- `provenance.processing_version`

The pipeline version is a semantic version (e.g. `v1.2.3`) and is stored in
a version manifest (e.g. `docs/processing-versions.md`).

### 6.2 Reprocessing

To reprocess a region:

1. Identify the relevant `regional_statistics` records
2. Mark them for reprocessing (or delete and re-ingest)
3. Re-run Stage 3 for the affected assets
4. Update `processing_version` and `provenance.processing_version`

All reprocessing operations are recorded in `provenance` with
`validation_status = 'reprocessed'`.

---

## 7. Data Flow Summary

```
Source API ──► Metadata ──► dataset_versions, dataset_assets, provenance
                              │
                              ▼
                    Asset Download (file staged)
                              │
                              ▼
                    Scientific Processing (GDAL/xarray/numpy)
                              │
                              ▼
                    regional_statistics (statistics written)
                              │
                              ▼
                    provenance (traceability recorded)
```

---

## 8. Pipeline Concurrency and Rate Limits

| API | Rate limit | Handling |
|---|---|---|
| NASA POWER | None documented | Default 1 req/sec, 5 concurrent |
| NASA CMR | 1500 hits/day (documented) | Rate-limit awareness, retry on 429 |
| Copernicus STAC | None documented | Thread pool of 10 |
| NASA PDS Search | None documented | Default 1 req/sec |
| AppEEARS | Rate limited by spatial/temporal extent | Request throttling, job polling |

The pipeline enforces rate limits via a token bucket or similar mechanism.

---

## 9. Appendix: Example: NASA POWER Processing

### 9.1 Acquisition

1. Query NASA POWER API with location (longitude, latitude) and parameter
   (e.g. `T2M`, `ALLSKY_SFC_SW_DWN`)
2. Parse response: `properties.parameter` (daily values dict), `header` (API version)
3. Store metadata in `dataset_versions`, `dataset_assets`, `provenance`

### 9.2 Processing

1. Open the time series for each variable
2. Slice to the region time window
3. Compute:
   - `mean`: mean of daily values
   - `min`: minimum daily value
   - `max`: maximum daily value
   - `temporal_stddev`: stddev of daily values
   - `count`: number of valid days
4. Write to `regional_statistics`

---

## 10. Appendix: Example: Copernicus STAC Processing

### 10.1 Acquisition

1. Query Copernicus STAC API for Sentinel-2 L2A items with cloud cover < 20%
2. Parse item properties (datetime, platform, instruments, gsd, bbox, assets)
3. Store metadata in `dataset_versions`, `dataset_assets`, `provenance`

### 10.2 Processing

1. Download the specified asset (e.g. `B02_10m` GeoTIFF)
2. Read band metadata from the file
3. Define region of interest (from `regions` table)
4. For each band (B02, B03, B04, etc.):
   - Open the band as a raster
   - Subset to the region extent
   - Compute mean, min, max, stddev, percentile 90
   - Compute valid pixel count
5. Write to `regional_statistics` (one row per band per statistic)

---

*End of document*
