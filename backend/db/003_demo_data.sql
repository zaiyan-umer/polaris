-- 003_demo_data.sql
-- Development seed ONLY (not a migration). Seed data for the schema in
-- 001_schema.sql, plus the canonical catalog in 002_reference_data.sql.
--
-- Duplicate protection (re-running this file for the same seed is safe):
--   - locations:   UNIQUE(name, planet_id) + ON CONFLICT (name, planet_id) DO NOTHING
--   - dataset_variables: PRIMARY KEY(dataset_id, variable_id)
--   - measurements: NOT EXISTS guard on (location_id, dataset_id, variable_id)
--
--| Tycho Crater coordinates are UNRESOLVED. The location is inserted below with
--| NULL latitude, longitude, and datum pending verified PDS/Selenographic values.


-- ------------------------------------------------------------------
-- Demo locations (10, excluding Tycho Crater pending verified coords)
-- ------------------------------------------------------------------
INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Nile Delta', planets.id, 30.8008, 31.2409, 'WGS84', 'Egypt'
FROM planets WHERE planets.slug = 'earth' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Sahara Desert', planets.id, 18.0, 2.0, 'WGS84', 'Central Sahara'
FROM planets WHERE planets.slug = 'earth' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Everest Region', planets.id, 27.9881, 86.9250, 'WGS84', 'Himalayas'
FROM planets WHERE planets.slug = 'earth' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Mare Tranquillitatis', planets.id, 0.67408, 23.47297, 'LRO_Selenographic', 'Apollo 11 landing site'
FROM planets WHERE planets.slug = 'moon' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Mare Imbrium', planets.id, 28.0, 7.0, 'LRO_Selenographic', 'Lunar mare'
FROM planets WHERE planets.slug = 'moon' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Valles Marineris', planets.id, -10.9089, -60.9488, 'MOLA areoid', 'Mars'
FROM planets WHERE planets.slug = 'mars' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Olympus Mons', planets.id, 18.65, -133.4833, 'MOLA areoid', 'Mars'
FROM planets WHERE planets.slug = 'mars' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Hellas Planitia', planets.id, -42.1, 70.4, 'MOLA areoid', 'Mars'
FROM planets WHERE planets.slug = 'mars' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Aeolis Mons (Shrinking)', planets.id, -5.9243, 137.4282, 'MOLA areoid', 'Mars'
FROM planets WHERE planets.slug = 'mars' ON CONFLICT (name, planet_id) DO NOTHING;

INSERT INTO locations (name, planet_id, latitude_deg, longitude_deg, datum, description)
SELECT 'Tycho Crater', planets.id, null, null, null, 'COORDS PENDING: unverified datum 95.5116,18.5253; location kept with NULL coords/datum pending verification'
FROM planets WHERE planets.slug = 'moon' ON CONFLICT (name, planet_id) DO NOTHING;

-- ------------------------------------------------------------------
-- Dataset -> Variable links (development sample)
-- ------------------------------------------------------------------
INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'm', 30
FROM datasets d
JOIN variables v ON v.name = 'elevation'
WHERE d.short_name = 'DEM' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'deg', 30
FROM datasets d
JOIN variables v ON v.name = 'slope'
WHERE d.short_name = 'DEM' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'K', 1000
FROM datasets d
JOIN variables v ON v.name = 'temperature'
WHERE d.short_name = 'MODIS' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'K', 5000
FROM datasets d
JOIN variables v ON v.name = 'temperature'
WHERE d.short_name = 'Diviner' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'K', 3000
FROM datasets d
JOIN variables v ON v.name = 'temperature'
WHERE d.short_name = 'TES' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'reflectance', 15
FROM datasets d
JOIN variables v ON v.name = 'mineralogy'
WHERE d.short_name = 'ASTER' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'reflectance', 140
FROM datasets d
JOIN variables v ON v.name = 'mineralogy'
WHERE d.short_name = 'M3' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'reflectance', 18
FROM datasets d
JOIN variables v ON v.name = 'mineralogy'
WHERE d.short_name = 'CRISM' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'J/m^2/K/s^1/2', 1000
FROM datasets d
JOIN variables v ON v.name = 'thermal_inertia'
WHERE d.short_name = 'Thermal_Inertia_Derived_Earth' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'm', 30
FROM datasets d
JOIN variables v ON v.name = 'terrain_roughness'
WHERE d.short_name = 'Terrain_Roughness_Derived_Earth' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

INSERT INTO dataset_variables (dataset_id, variable_id, native_unit, native_resolution_m)
SELECT d.id, v.id, 'm', 250
FROM datasets d
JOIN variables v ON v.name = 'terrain_roughness'
WHERE d.short_name = 'MOLAS' ON CONFLICT (dataset_id, variable_id) DO NOTHING;

-- ------------------------------------------------------------------
-- Demo measurements (quality_flag='demo'); placeholders only
-- All measurements now carry planet_id (= location's planet), and every one
-- is guarded against duplicates.
-- ------------------------------------------------------------------
INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       15.0, 'm', 15.0, 30, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Nile Delta' AND d.short_name = 'DEM' AND v.name = 'elevation'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       0.3, 'deg', 0.3, 30, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Nile Delta' AND d.short_name = 'DEM' AND v.name = 'slope'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       303.5, 'K', 303.5, 1000, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Nile Delta' AND d.short_name = 'MODIS' AND v.name = 'temperature'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       410.0, 'K', 410.0, 5000, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Mare Tranquillitatis' AND d.short_name = 'Diviner' AND v.name = 'temperature'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       -4200.0, 'm', -4200.0, 250, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Valles Marineris' AND d.short_name = 'MOLA' AND v.name = 'elevation'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       210.0, 'K', 210.0, 3000, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Valles Marineris' AND d.short_name = 'TES' AND v.name = 'temperature'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       0.28, 'volpct', 0.35, 15, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Valles Marineris' AND d.short_name = 'CRISM' AND v.name = 'mineralogy'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

INSERT INTO measurements (location_id, dataset_id, variable_id, planet_id, value, value_unit, native_value, native_resolution_m, quality_flag, recorded_at, created_at)
SELECT l.id, d.id, v.id, l.planet_id,
       1200.0, 'm', 1200.0, 250, 'demo', NOW(), NOW()
FROM locations l
JOIN datasets d ON d.planet_id = l.planet_id
JOIN dataset_variables dv ON dv.dataset_id = d.id
JOIN variables v ON v.id = dv.variable_id
WHERE l.name = 'Aeolis Mons (Shrinking)' AND d.short_name = 'MOLAS' AND v.name = 'terrain_roughness'
  AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.location_id = l.id AND m.dataset_id = d.id AND m.variable_id = v.id);

-- Tycho Crater deliberately NOT inserted (coords pending verification).

