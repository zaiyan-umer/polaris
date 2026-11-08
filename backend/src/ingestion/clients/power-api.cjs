// NASA POWER API Client
// Source: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
//
// Provides daily surface meteorological observations and climatological
// parameters (temperature, precipitation, humidity, wind, solar radiation)
// derived from the MERRA-2 reanalysis.
//
// Endpoint (verified):
//   GET https://power.larc.nasa.gov/api/temporal/daily/point
//   ?parameters=T2M,T2M_MAX,T2M_MIN&community=AG&longitude=..&latitude=..
//   &start=YYYYMMDD&end=YYYYMMDD&format=JSON
//
// Response shape (verified):
//   {
//     "type": "Feature",
//     "geometry": {"type":"Point","coordinates":[lon,lat,elevation_m]},
//     "properties": {
//       "parameter": {"T2M": {"20240101": 16.17, ...}, ...},
//       "parameters": {"T2M": {"units": "C", "longname": "..."}, ...}
//     },
//     "header": {"fill_value": -999.0, "time_standard": "LST", ...}
//   }
//
// NOTE: POWER reports temperatures in degrees Celsius. The canonical unit in
// the Polaris schema is kelvin, so every value must be converted
// (K = C + 273.15) before it is stored in `measurements`.

const { fetchWithRetry } = require('../http.cjs');

const POWER_API_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point';

// POWER reports -999.0 for missing values; treat as missing, never as a number.
const POWER_FILL_VALUE = -999.0;

/**
 * Fetch daily meteorological data from the NASA POWER API.
 * @param {number} latitude  Decimal degrees, -90..90
 * @param {number} longitude Decimal degrees, -180..180
 * @param {string} startDate  YYYYMMDD
 * @param {string} endDate    YYYYMMDD
 * @param {string} parameters Comma-separated POWER parameter names
 */
async function fetchPowerDailyData(latitude, longitude, startDate, endDate, parameters = 'T2M') {
  const params = new URLSearchParams({
    parameters,
    community: 'AG',
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start: startDate,
    end: endDate,
    format: 'JSON',
  });

  const response = await fetchWithRetry(`${POWER_API_BASE}?${params}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`POWER API error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch daily air temperature (T2M, T2M_MAX, T2M_MIN) for a point.
 * Returns the raw POWER response; temperatures are in degrees Celsius.
 */
async function fetchPowerTemperatureData(latitude, longitude, startDate, endDate) {
  return fetchPowerDailyData(latitude, longitude, startDate, endDate, 'T2M,T2M_MAX,T2M_MIN');
}

/**
 * Fetch daily solar radiation (ALLSKY_SFC_SW_DWN) for a point.
 */
async function fetchPowerSolarData(latitude, longitude, startDate, endDate) {
  return fetchPowerDailyData(latitude, longitude, startDate, endDate, 'ALLSKY_SFC_SW_DWN');
}

/**
 * Flatten a POWER daily response into per-day records.
 * Each record carries the source unit and the raw value so the caller can
 * perform an explicit, auditable unit conversion.
 *
 * @returns {Array<{parameter:string, date:string, value:number|null,
 *                  unit:string, is_fill:boolean}>}
 */
function parsePowerDailyResponse(response) {
  const out = [];
  const parameters = response?.properties?.parameter ?? {};
  const units = response?.properties?.parameters ?? {};

  for (const [parameter, series] of Object.entries(parameters)) {
    if (!series || typeof series !== 'object') continue;
    const unit = units?.[parameter]?.units ?? null;
    for (const [date, rawValue] of Object.entries(series)) {
      const isFill = rawValue === POWER_FILL_VALUE || rawValue == null || Number.isNaN(rawValue);
      out.push({
        parameter,
        date,
        value: isFill ? null : Number(rawValue),
        unit,
        is_fill: isFill,
      });
    }
  }
  return out;
}

module.exports = {
  POWER_API_BASE,
  POWER_FILL_VALUE,
  fetchPowerDailyData,
  fetchPowerTemperatureData,
  fetchPowerSolarData,
  parsePowerDailyResponse,
};
