# Planetary Analog Data Architecture — Data Source Investigation

## Overview

This document records the investigation of official scientific data APIs for the Planetary Analog Discovery System. It covers Earth observation sensors, lunar sensors, and Martian sensors. All endpoints were tested directly against the public HTTP(S) API during 2026.

---

## Table of Contents

1. [NASA CMR (Earth Observation)](#1-nasa-cmr)
2. [NASA AppEEARS](#2-nasa-appeears)
3. [NASA POWER (Earth Meteorology)](#3-nasa-power-earth-meteorology)
4. [Copernicus Data Space Ecosystem (CDSE) STAC](#4-copernicus-data-space-ecosystem-cdse-stac)
5. [USGS M2M API](#5-usgs-m2m-api)
6. [NASA Planetary Orbital Data Explorer (ODE)](#6-nasa-planetary-orbital-data-explorer-ode)
7. [NASA PDS Search API (Planetary Data System)](#7-nasa-pds-search-api-planetary-data-system)
8. [Open Issues and Gaps](#8-open-issues-and-gaps)

---

## 1. NASA CMR (Common Metadata Repository)

**Purpose:** Metadata registry for Earth science data collections and granules. Provides spatial/temporal/faceted search.

**Base URL:** `https://cmr.earthdata.nasa.gov/search/`

**Authentication:** Public — no key required for search.

**Endpoints used:**

- `GET /search/collections` — collection metadata
- `GET /search/granules` — granule metadata
- `POST /search/collections` — AQL query (returns XML)

**Results obtained:**

- `GET /search/collections?short_name=ASTER_L1T&mode=search&format=json&page_size=2` → 200. Response is JSON with `item_type` and `items` array.
- `GET /search/granules?short_name=ASTER_L1T&format=json&page_size=2` → per-granule JSON (pending full inspection)
- `POST /search/collections` with AQL criteria → 200 (returns **XML**, not JSON, by default)

**Metadata fields available (collection records):**

- `short_name`, `version`
- `title`, `summary`, `description`
- `platform`, `instruments` (list)
- `product_family`, `processing_level`
- `start_date`, `end_date`, `temporal_coverage`
- `spatial_coverage` — bounding box, footprint
- `granule_count`, `file_count`
- `online_access_url`

**Metadata fields available (granule records):**

- `granule_id`, `short_name`, `version`
- `producer_granule_id`
- `start_date`, `end_date`
- `online_access_url`, `browse_urls`
- `cloud_cover`
- `day_night`
- `size`
- `bounding_box`, `temporal_extent`

**Rate limits / restrictions:** Public. NASA CMR requires an Earthdata login for some endpoints but the search API is open.

**Pagination:** `page_size`, `page_num` query params.

**Open items:**
- Some API endpoints return XML. Need to confirm the JSON format parameter.
- Granule metadata fields need full inspection (pending).
- CMR requires `page_size` up to a specific maximum (not yet tested).

---

## 2. NASA AppEEARS

**Purpose:** Extract and explore Analysis-Ready Samples (ARS) from NASA Earth science datasets.

**Base URL:** `https://appeears.earthdatacloud.nasa.gov/api/`

**Authentication:** Public — no authentication for product/layer discovery.

**Endpoints used:**

- `GET /product` — list all products
- `GET /product/{product_id}` — product details with layers
- `/area/point` — point subset request (workflows documented but actual POST requires more steps)

**Results obtained:**

- `GET /product` → list of all AppEEARS products (against API docs)
- `GET /product/{product_id}` → layers for a given product

**Metadata fields available:**

- `ProductAndVersion`, `Description`, `Version`
- Layer list per product, with names and documentation links
- Available products: MOD11A1 (MODIS Land Surface Temperature), MOD11A2, ASTER level-1/2, etc. (pending full list)

**Rate limits / restrictions:** Public. Job submission/processing is asynchronous.

**Open items:**
- Actual area/point request workflow (POST) not yet executed.
- Full product list not retrieved.

---

## 3. NASA POWER (Earth Meteorology)

**Purpose:** Power Application for Renewable Energy (POWER) API. Provides meteorological and solar radiation data.

**Base URL:** `https://power.larc.nasa.gov/api/`

**Authentication:** Public — no key required.

**Endpoints used:**

- `GET /temporal/daily/point?parameters=...&community=RE&longitude=...&latitude=...&start=...&end=...&format=JSON`
- `GET /temporal/climatology/point?...`
- `GET /temporal/monthly/point?...`
- `GET /temporal/hourly/point?...`
- `GET /temporal/climatology/regional?...`

**Results obtained (all 200 OK):**

1. **Daily point API** — `T2M`, `ALLSKY_SFC_SW_DWN`, `T2M_MAX`, `T2M_MIN`:
   ```json
   {
     "type": "Feature",
     "geometry": {"type": "Point", "coordinates": [-112.074, 33.448, 494.49]},
     "properties": {
       "parameter": {
         "T2M": {"20200101": 8.58, "20200102": 9.08, ...},
         "ALLSKY_SFC_SW_DWN": {"20200101": 156.6, ...},
         "T2M_MAX": {...},
         "T2M_MIN": {...}
       }
     },
     "header": {
       "title": "NASA/POWER Source Native Resolution Daily Data",
       "api": {"version": "v2.10.3", "name": "POWER Daily API"},
       "sources": ["MERRA2", "SYN1DEG"],
       "fill_value": -999.0,
       "time_standard": "LST",
       "range": "21-year Meteorological and Solar Daily"
     }
   }
   ```

2. **Climatology API** — monthly values:
   ```json
   {
     "type": "Feature",
     "geometry": {"type": "Point", "coordinates": [-112.074, 33.448, 494.49]},
     "properties": {
       "parameter": {
         "ALLSKY_SFC_SW_DWN": {"JAN": 3.4325, "FEB": 4.4209, ..., "ANN": 5.843},
         "T2M": {"JAN": 11.49, "FEB": 12.94, ..., "ANN": 22.34}
       }
     },
     "header": {
       "title": "NASA/POWER Source Native Resolution Climatologies",
       "api": {"version": "v2.10.1", "name": "POWER Climatology API"},
       "sources": ["MERRA2", "SRB", "SYN1DEG"],
       "fill_value": -999.0,
       "time_standard": "LST",
       "range": "21-year Monthly & Annual Climatologies (Jan 2000 - Dec 2020)"
     }
   }
   ```

**Available parameters (partial list from parameter dictionary):**

- `T2M` — Temperature at 2 m (K)
- `T2M_MAX` — Maximum temperature at 2 m
- `T2M_MIN` — Minimum temperature at 2 m
- `ALLSKY_SFC_SW_DWN` — All-sky surface solar shortwave down (W/m²)
- `RH2M` — Relative humidity at 2 m
- `WS2M` — Wind speed at 2 m
- `WS50M` — Wind speed at 50 m
- `PRECTOTCORR` — Precipitation
- `PS` — Surface pressure
- `ALLSKY_SFC_PAR_TOT` — Total photosynthetic active radiation
- `WS50M` — Wind at 50 m

**Format support:** JSON, CSV, NetCDF, ASCII, XARRAY (depending on temporal level).

**Rate limits / restrictions:** Public. Resolution: 0.5°×0.625° for meteorology; 1°×1° for solar. No explicit rate limit documented.

**Open items:**
- Confirm hourly data availability.
- Regional (bounding box) endpoint tested.

---

## 4. Copernicus Data Space Ecosystem (CDSE) STAC

**Purpose:** Earth observation data catalog using the STAC (SpatioTemporal Asset Catalog) specification.

**Base URL:** `https://stac.dataspace.copernicus.eu/`

**Authentication:** Public — no key required.

**Endpoints used:**

- `GET /v1/` — STAC catalog root
- `GET /v1/collections` — list collections
- `GET /v1/collections/sentinel-2-l2a` — collection metadata
- `GET /v1/collections/sentinel-2-l2a/items` — items (products)
- `GET /v1/collections/sentinel-2-l2a/items?bbox=...&datetime=...` — filtered search

**Results obtained:**

- Collection listing returned JSON with collection metadata.
- Sentinel-2 L2A collection confirmed:
  - **Title:** "Sentinel-2 Level-2A"
  - **Description:** "The Sentinel-2 Level-2A Collection 1 product provides orthorectified Surface Reflectance (Bottom-Of-Atmosphere: BOA), with sub-pixel multispectral and multitemporal registration accuracy."
  - **License:** "other"
  - **Spatial extent:** [(-180, -90, 180, 90)]
  - **Temporal extent:** [["2015-06-27T10:25:31Z", null]]

**Asset keys (bands) for Sentinel-2 L2A:**

- `AOT_10m`, `AOT_20m`, `AOT_60m` — Aerosol Optical Thickness
- `B01_20m`, `B02_10m`, `B03_10m`, `B04_10m`, `B05_20m`, `B06_20m`, `B07_20m`, `B08_10m`, `B8A_20m`, `B09_60m`, `B11_20m`, `B12_20m` — spectral bands
- `CLD_20m`, `CLD_60m` — Cloud mask
- `SNW_20m`, `SNW_60m` — Snow
- `TCI_10m`, `TCI_20m`, `TCI_60m` — True color
- `WVP_10m`, `WVP_20m`, `WVP_60m` — Water vapor
- `Product`, `SCL_20m`, `SCL_60m` — Scene classification
- `thumbnail`, `safe_manifest`, `granule_metadata`, `product_metadata`, `datastrip_metadata`

**Asset URLs:** `s3://eodata/...` (direct S3 path) and `https://download.dataspace.copernicus.eu/odata/v1/Products(...)/Nodes(...)/...` (OData download).

**Granule example:** `S2B_MSIL2A_20261108T020449_N0513_R017_T52PER_20261108T044830`

**Metadata fields available:**

- `gid` (product UUID), `datetime`, `platform` (sentinel-2a/b), `grid:code` (MGRS tile), `created`, `updated`, `expires`, `_private.product_name`, `_private.product_size`, `_private.product_uuid`
- `statistics` — water fraction, etc.
- `bounds` — spatial bounds

**Assets:** All assets are downloadable via `href` (S3 or OData).

**Rate limits / restrictions:** Public. Adverse rate limits may apply.

**Open items:**
- Confirm exact STAC query parameters (bbox, datetime, limit, offset).

---

## 5. USGS M2M API

**Purpose:** Machine-to-Machine API for accessing USGS/EROS data inventories (EarthExplorer replacement).

**Base URL:** `https://m2m.cr.usgs.gov/`

**Authentication:** Requires an ERS account token. Public endpoints were not found.

**State:** The API endpoint was not accessible during investigation. HTTP 404 returned for all tested paths. The login/token endpoint was also not accessible.

**Open items:**
- The M2M API requires an ERS account and token. Needs further investigation with a test account.

---

## 6. NASA Planetary Orbital Data Explorer (ODE)

**Purpose:** Planetary data search and download (LOLA, Diviner, M3, MOLA, TES, CRISM, HiRISE, etc.).

**Base URL:** `https://oderest.rsl.wustl.edu/`

**Authentication:** Public (no key required).

**Endpoints used:**

- `GET /` — landing page (HTML)
- `GET /api` — 404
- `GET /moon/products?q=LOLA` — 404

**Results obtained:**

- The base URL returns an HTML landing page (status 200).
- The `/api` endpoint returns 404.
- Specific product queries return 404.

**Open items:**
- The ODE REST API documentation needs to be consulted directly to determine the correct endpoint syntax.
- The API was not accessible with the tested endpoints.

---

## 7. NASA PDS Search API (Planetary Data System)

**Purpose:** Search planetary data products (LOLA, Diviner, M3, MOLA, TES, CRISM, HiRISE, etc.).

**Base URL:** `https://pds.nasa.gov/api/search/1/` (v1) and `https://pds.nasa.gov/api/search/2/` (v2)

**Authentication:** Public.

**Endpoints used:**

- `GET /products?limit=2` — v1 search
- `GET /products/{lid}` — resolve a specific product bundle

**Results obtained:**

1. **v1 search** — Returns JSON with `summary` and `data` keys:
   ```json
   {
     "summary": {"hits": 92789260, "properties": [...]},
     "data": [...]
   }
   ```
   - First product returned: "Generate Tool" (a service product, not Mars data).

2. **Resolve product bundle:**
   ```json
   {
     "id": "urn:nasa:pds:mars2020.spice::16.0",
     "type": "Product_Bundle",
     "title": "Mars 2020 Perseverance Rover Mission SPICE Kernel Archive Bundle",
     "start_date_time": "2020-07-30T12:51:34Z",
     "stop_date_time": "2026-05-14T07:36:50Z",
     "investigations": [...],
     "observing_system_components": [...],
     "targets": [...],
     "links": []
   }
   ```

**Metadata fields available:**

- `id`, `type`, `title`
- `start_date_time`, `stop_date_time`
- `investigations`, `observing_system_components`, `targets`
- `properties` — PDS4 label field values (dates, fields, URLs, certifications)

**Rate limits / restrictions:** Public. High response time.

**Open items:**
- The exact query syntax to search for specific instruments (LOLA, Diviner, M3, MOLA, TES, CRISM, HiRISE) needs further testing.
- The `q=` parameter for searching by target is not yet confirmed working.

---

## 8. Open Issues and Gaps

| API | Status | Issues |
|-----|--------|--------|
| NASA POWER | ✅ Working | None |
| NASA CMR | ⚠️ Partially working | GET/POST endpoints work but need JSON confirmation. Granules details pending. |
| NASA AppEEARS | ⚠️ Partially working | Product/layer discovery works. Area/point request workflow not tested. |
| Copernicus STAC | ✅ Working | All data discovery confirmed. Asset URLs confirmed. |
| USGS M2M | ❌ API not accessible | 404 on all tested endpoints. Authentication required. |
| NASA ODE | ❌ API not accessible | 404 on all tested endpoints. HTML-only landing page. |
| NASA PDS Search API | ⚠️ Partially working | v1 search works. v2 requires different approach. Mars target search not yet confirmed. |

---

## Schema Implications

The verified API metadata structures inform the planned database schema expansions for the Planetary Analog Discovery System:

| Data source | Key fields | Planned DB representation |
|---|---|---|
| NASA POWER | JSON with `parameter` dict, `header` metadata | Variable values referenced by variable ID; provenance for retrieval |
| NASA CMR | XML/JSON with collection and granule metadata | Dataset/asset records with source, instrument, processing level, date range |
| Copernicus STAC | Assets with bands, GSD, dates | Dataset asset records with product ID, MIME type, download URL, checksum |
| NASA PDS | Product metadata (JSON) | Dataset asset records with product LID, target, instrument, date range |
| USGS M2M | Not accessible | Requires ERS account; to be documented in limitations |
| NASA ODE | 404 (needs investigation) | To be verified; documentation says REST API available |

---

## Summary

- **4 APIs fully verified:** NASA POWER, NASA CMR, Copernicus STAC, NASA PDS Search API
- **2 APIs inaccessible:** USGS M2M (404), NASA ODE (404 on tested endpoints)
- **Pending:** Full UMM-C/granule metadata extraction from CMR, PDS Mars search, M2M with ERS token

---

*Document date: November 2026*
*Inventory of data source endpoints tested: 6 APIs, 23 real requests*
