-- 002_reference_data.sql
-- Canonical reference records: planets, variables, and the source dataset catalog.
-- Run AFTER 001_schema.sql.
-- Re-running is safe only after TRUNCATE (the tables are ref-managed foreign keys).
--
-- NOTE on "is_imagery": no imagery is modelled (the original flag is removed).
-- NOTE on native_*: native unit / resolution moved to dataset_variables (per variable).


-- ------------------------------------------------------------------
-- Planets
-- ------------------------------------------------------------------
INSERT INTO planets (name, slug, body_type) VALUES
  ('Earth', 'earth', 'terrestrial'),
  ('Moon', 'moon', 'satellite'),
  ('Mars', 'mars', 'terrestrial');

-- ------------------------------------------------------------------
-- Variables (canonical harmonised vocabulary)
--   canonical_unit = target unit for cross-planet comparison.
--   mineralogy's canonical unit is 'volpct', but native reflectance data must
--   be spectrally unmixed before ingestion; see the issue log below.
-- ------------------------------------------------------------------
INSERT INTO variables (name, canonical_unit, definition) VALUES
  ('elevation',           'm',            'Vertical distance above the planet reference datum'),
  ('slope',               'deg',          'Inclination of the surface relative to horizontal'),
  ('temperature',         'K',            'Retrieved / brightness surface temperature'),
  ('mineralogy',          'volpct',       'Spectral mineral abundance (vol%)'),
  ('thermal_inertia',     'J/m^2/K/s^1/2','Material thermal inertia'),
  ('terrain_roughness',   'm',            'Height variability of the surface over a local footprint');

-- ------------------------------------------------------------------
-- Datasets (source instruments / derived products)
-- ------------------------------------------------------------------
-- native_crs is retained as the dataset-level coordinate reference.
-- NOTE on native_crs:
--   - WGS84        : Earth (valid CRS; unchanged).
--   - 'SELENE_LOLA'    : was an instrument/mission designation, NOT a CRS.
--                        Replaced with the lunar planetocentric mean-Earth (ME)
--                        frame per the LOLA RDR (IAU/IAG WG on Cartographic
--                        Coordinates and Rotational Elements; DE421 MOON_ME model).
--   - 'MOLA'/'TES'/'MOLAS': instrument names, NOT a CRS. Replaced with the MOLA
--                        areoid (gravity potential reference surface, GMM2),
--                        IAU2000 areocentric frame.
--   - 'LRO_Selenographic' (Diviner) retained as a frame designation (LRO selenographic).
INSERT INTO datasets (planet_id, short_name, description, source_url, source_type, native_crs) VALUES
  ((SELECT id FROM planets WHERE slug = 'earth'), 'DEM',
   'Copernicus DEM (Earth elevation)',
   'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html', 'derived', 'WGS84'),

  ((SELECT id FROM planets WHERE slug = 'moon'), 'LOLA',
   'Lunar Orbital Laser Altimeter (Moon elevation)',
   'https://lunar.gsfc.nasa.gov/LOLA/LOLA.html', 'instrument', 'Lunar planetocentric ME frame (IAU/IAG DE421)'),

  ((SELECT id FROM planets WHERE slug = 'mars'), 'MOLA',
   'Mars Orbital Laser Altimeter (Mars elevation)',
   'https://pds-geosciences.wustl.edu/mro/mro-m-mola-7-expr-1-1-1-label.pdf', 'instrument', 'MOLA areoid (IAU2000)'),

  ((SELECT id FROM planets WHERE slug = 'earth'), 'MODIS',
   'MODIS surface temperature (Earth)',
   'https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD11A1', 'instrument', 'WGS84'),

  ((SELECT id FROM planets WHERE slug = 'moon'), 'Diviner',
   'Diviner Lunar Radiometer Experiment (Moon temperature)',
   'https://pds.nasa.gov/missions/lunar-reconnaissance-orbiter', 'instrument', 'LRO_Selenographic'),

  ((SELECT id FROM planets WHERE slug = 'mars'), 'TES',
   'Thermal Emission Spectrometer (Mars Global Surveyor)',
   'https://tes.jpl.nasa.gov/', 'instrument', 'MOLA areoid (IAU2000)'),

  ((SELECT id FROM planets WHERE slug = 'earth'), 'ASTER',
   'ASTER mineral absorption features (Earth)',
   'https://search.earthdata.nasa.gov/search?q=AST_05.004', 'instrument', 'WGS84'),

  ((SELECT id FROM planets WHERE slug = 'moon'), 'M3',
   'Moon Mineralogy Mapper (Moon mineralogy)',
   'https://m3.jpl.nasa.gov/', 'instrument', 'Lunar planetocentric ME frame (IAU/IAG DE421)'),

  ((SELECT id FROM planets where slug = 'mars'), 'CRISM',
   'Compact Reconnaissance Imaging Spectrometer for Mars (Mars mineralogy)',
   'https://crism.org/', 'instrument', 'MOLA areoid (IAU2000)'),

  ((SELECT id FROM planets WHERE slug = 'earth'), 'Thermal_Inertia_Derived_Earth',
   'Earth thermal inertia, NASA POWER Tropical-Daily (LES database); from MODIS/ASTER emissivity',
   'https://power.larc.nasa.gov/docs/services/api/temporal/daily/', 'derived', 'WGS84'),

  ((SELECT id FROM planets WHERE slug = 'earth'), 'Terrain_Roughness_Derived_Earth',
   'Earth terrain roughness, derived from DEM',
   'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html', 'derived', 'WGS84'),

  ((SELECT id FROM planets WHERE slug = 'mars'), 'MOLAS',
   'MOLA based terrain roughness (Mars)',
   'https://pds-geosciences.wustl.edu/mro/mro-m-mola-7-expr-1-1-1-label.pdf', 'derived', 'MOLA areoid (IAU2000)');

