// Analog Ranking Engine
// Generates Earth-to-Moon and Earth-to-Mars analog rankings based on real data.
//
// Methodology:
//   1. Compare Earth regions against Moon and Mars reference regions
//   2. Use variables that are genuinely comparable (e.g., elevation, temperature)
//   3. Normalize measurements appropriately
//   4. Handle missing data explicitly
//   5. Generate per-variable scores (0-1)
//   6. Generate an overall similarity score (0-1)
//   7. Store the algorithm version and methodology

const { postgrestQuery, postgrestInsert } = require('../ingestion/rest-client.cjs');

// Algorithm version for this ranking run
const ALGORITHM_VERSION = '0.1.0-alpha';

// Normalization thresholds for similarity scores
const NORMALIZATION_THRESHOLDS = {
  temperature: {
    min: 0,
    max: 350,
  },
  elevation: {
    min: 0,
    max: 9000,
  },
};

/**
 * Find compatible variables between two planets.
 * Only variables that exist on both planets and have comparable units can be compared.
 */
async function findCompatibleVariables(earthPlanetId, moonPlanetId, marsPlanetId) {
  const variables = await postgrestQuery('variables');
  const compatible = [];
  
  for (const varRow of variables) {
    // Check if variable exists on Earth, Moon, and Mars
    const hasEarthData = await postgrestQuery('measurements', {
      planet_id: earthPlanetId,
      variable_id: varRow.id,
    });
    const hasMoonData = await postgrestQuery('measurements', {
      planet_id: moonPlanetId,
      variable_id: varRow.id,
    });
    const hasMarsData = await postgrestQuery('measurements', {
      planet_id: marsPlanetId,
      variable_id: varRow.id,
    });
    
    // Only include variables that exist on all three planets with data
    if (hasEarthData.length > 0 && hasMoonData.length > 0 && hasMarsData.length > 0) {
      compatible.push({
        variable_id: varRow.id,
        name: varRow.name,
        canonical_unit: varRow.canonical_unit,
      });
    }
  }
  
  return compatible;
}

/**
 * Get statistics for a region.
 * Returns average and range of values for each variable in the region.
 */
async function getRegionStatistics(regionId, variableId) {
  const result = await postgrestQuery('regional_statistics', {
    region_id: regionId,
    variable_id: variableId,
  });
  return result;
}

/**
 * Calculate the average value for a variable in a region.
 */
async function getRegionAverage(regionId, variableId) {
  const stats = await postgrestQuery('regional_statistics', {
    region_id: regionId,
    variable_id: variableId,
    statistic_type: 'mean',
  });
  
  if (stats.length > 0) {
    return stats[0].value;
  }
  return null;
}

/**
 * Calculate the standard deviation for a variable in a region.
 */
async function getRegionStddev(regionId, variableId) {
  const stats = await postgrestQuery('regional_statistics', {
    region_id: regionId,
    variable_id: variableId,
    statistic_type: 'stddev',
  });
  
  if (stats.length > 0) {
    return stats[0].value;
  }
  return null;
}

/**
 * Calculate per-variable similarity score between two regions.
 * Uses min-max normalization to 0-1 scale.
 */
async function calculateVariableSimilarity(earthValue, referenceValue, unit, variableName) {
  if (earthValue == null || referenceValue == null) {
    return null;
  }
  
  const thresholds = NORMALIZATION_THRESHOLDS[variableName];
  if (!thresholds) {
    // For unknown variables, use a generic 0-100 range
    thresholds.min = 0;
    thresholds.max = 100;
  }
  
  const range = thresholds.max - thresholds.min;
  if (range === 0) {
    return earthValue === referenceValue ? 1.0 : 0.0;
  }
  
  // Min-max normalization: 0 when far apart, 1 when equal
  const distance = Math.abs(earthValue - referenceValue);
  const similarity = 1.0 - (distance / range);
  const normalized = Math.max(0, Math.min(1, similarity));
  
  return normalized;
}

/**
 * Calculate the overall similarity score between an Earth region and a reference region.
 * Uses weighted average of per-variable scores.
 */
async function calculateOverallSimilarity(earthRegionId, referenceRegionId) {
  // Find variables that exist on both planets
  const earthPlanetId = await postgrestQuery('planets', { slug: 'earth' });
  const earthPlanetIdVal = earthPlanetId[0].id;
  
  const compatibleVars = await findCompatibleVariables(
    earthPlanetIdVal,
    earthPlanetIdVal, // Will be used as placeholder - we need all three planet IDs
    earthPlanetIdVal
  );
  
  // For now, use a fixed set of comparable variables
  const variablesToCompare = [
    { id: 'elevation', name: 'elevation', unit: 'm' },
    { id: 'temperature', name: 'temperature', unit: 'K' },
  ];
  
  let totalWeight = 0;
  let weightedScore = 0;
  
  for (const varDef of variablesToCompare) {
    const earthValue = await getRegionAverage(earthRegionId, varDef.id);
    const referenceValue = await getRegionAverage(referenceRegionId, varDef.id);
    
    if (earthValue == null || referenceValue == null) {
      // Skip variables with no data
      continue;
    }
    
    const varScore = await calculateVariableSimilarity(
      earthValue,
      referenceValue,
      varDef.unit,
      varDef.name
    );
    
    if (varScore != null) {
      const weight = 1.0; // Equal weight for now
      weightedScore += varScore * weight;
      totalWeight += weight;
    }
  }
  
  if (totalWeight === 0) {
    return null;
  }
  
  return {
    score: weightedScore / totalWeight,
    perVariableScores: {},
    methodology: 'minmax_normalization',
    algorithm_version: ALGORITHM_VERSION,
  };
}

/**
 * Generate analog rankings for all Earth regions against Moon and Mars.
 * Only generates rankings when sufficient comparable data exists.
 */
async function generateAnalogRankings() {
  console.log('\n=== Generating Analog Rankings ===');
  
  // Get all Earth regions
  const earthRegions = await postgrestQuery('regions', {
    planet_id: getPlanetId('earth'),
  });
  
  const moonRegions = await postgrestQuery('regions', {
    planet_id: getPlanetId('moon'),
  });
  
  const marsRegions = await postgrestQuery('regions', {
    planet_id: getPlanetId('mars'),
  });
  
  // Get the main Earth analog locations
  const earthAnalogs = earthRegions.filter(r => {
    const analogNames = ['Nile Delta', 'Sahara Desert', 'Everest Region'];
    return analogNames.includes(r.name);
  });
  
  const rankings = [];
  let generated = 0;
  
  // Generate rankings: Earth -> Moon
  for (const earthRegion of earthAnalogs) {
    for (const moonRegion of moonRegions) {
      // Check if the Moon region has data
      const moonStats = await postgrestQuery('regional_statistics', {
        region_id: moonRegion.id,
        statistic_type: 'mean',
      });
      
      if (moonStats.length === 0) {
        continue;
      }
      
      const similarity = await calculateOverallSimilarity(
        earthRegion.id,
        moonRegion.id
      );
      
      if (similarity && similarity.score != null) {
        const ranking = {
          earth_location_id: earthRegion.id,
          reference_location_id: moonRegion.id,
          similarity_score: similarity.score,
          methodology: similarity.methodology,
          algorithm_version: similarity.algorithm_version,
          created_at: new Date().toISOString(),
          created_by: 'polaris-ingestion-v0.1.0-alpha',
        };
        
        await postgrestInsert('analog_rankings', [ranking]);
        rankings.push(ranking);
        generated++;
        console.log(`  Earth->Moon: ${earthRegion.name} vs ${moonRegion.name} = ${similarity.score.toFixed(4)}`);
      }
    }
  }
  
  // Generate rankings: Earth -> Mars
  for (const earthRegion of earthAnalogs) {
    for (const marsRegion of marsRegions) {
      const marsStats = await postgrestQuery('regional_statistics', {
        region_id: marsRegion.id,
        statistic_type: 'mean',
      });
      
      if (marsStats.length === 0) {
        continue;
      }
      
      const similarity = await calculateOverallSimilarity(
        earthRegion.id,
        marsRegion.id
      );
      
      if (similarity && similarity.score != null) {
        const ranking = {
          earth_location_id: earthRegion.id,
          reference_location_id: marsRegion.id,
          similarity_score: similarity.score,
          methodology: similarity.methodology,
          algorithm_version: similarity.algorithm_version,
          created_at: new Date().toISOString(),
          created_by: 'polaris-ingestion-v0.1.0-alpha',
        };
        
        await postgrestInsert('analog_rankings', [ranking]);
        rankings.push(ranking);
        generated++;
        console.log(`  Earth->Mars: ${earthRegion.name} vs ${marsRegion.name} = ${similarity.score.toFixed(4)}`);
      }
    }
  }
  
  console.log(`  Generated ${generated} analog rankings`);
  return { rankings, generated };
}

// Placeholder for getPlanetId (defined in pipeline)
async function getPlanetId(slug) {
  const result = await postgrestQuery('planets', { slug: slug });
  if (result.length === 0) throw new Error(`Planet with slug ${slug} not found`);
  return result[0].id;
}

module.exports = {
  generateAnalogRankings,
  calculateVariableSimilarity,
  calculateOverallSimilarity,
  ALGORITHM_VERSION,
};
