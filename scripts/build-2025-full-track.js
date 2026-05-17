#!/usr/bin/env node
/**
 * Build: 2025 Full Track (GeoJSON)
 *
 * Merges daily GeoJSON files from background/2025/daily-geojson into
 * a single LineString track and writes:
 *   docs/supplement/full_track_2025.geojson
 */

'use strict';

const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, '..', 'background', '2025', 'daily-geojson');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'supplement');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'full_track_2025.geojson');

function parseDayIndex(fileName) {
  const match = fileName.match(/^d(\d+)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number.parseInt(match[1], 10);
}

function compareInputFiles(a, b) {
  const dayA = parseDayIndex(a);
  const dayB = parseDayIndex(b);
  if (dayA !== dayB) return dayA - dayB;
  return a.localeCompare(b);
}

function sameCoord(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;
  if (a[1] !== b[1]) return false;

  const aHasAlt = a.length > 2;
  const bHasAlt = b.length > 2;
  if (aHasAlt || bHasAlt) {
    return a[2] === b[2];
  }

  return true;
}

function appendCoord(target, coord) {
  if (!Array.isArray(coord) || coord.length < 2) return;
  if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;

  const last = target[target.length - 1];
  if (!last || !sameCoord(last, coord)) {
    target.push(coord);
  }
}

function extractLineCoords(feature) {
  if (!feature || !feature.geometry) return [];

  const { type, coordinates } = feature.geometry;
  if (!coordinates) return [];

  if (type === 'LineString' && Array.isArray(coordinates)) {
    return coordinates;
  }

  if (type === 'MultiLineString' && Array.isArray(coordinates)) {
    return coordinates.flat();
  }

  return [];
}

function readTrackCoords(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  const features = Array.isArray(data.features) ? data.features : [];
  const coords = [];

  for (const feature of features) {
    const lineCoords = extractLineCoords(feature);
    for (const coord of lineCoords) {
      appendCoord(coords, coord);
    }
  }

  return coords;
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  const sourceFiles = fs.readdirSync(INPUT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.geojson'))
    .sort(compareInputFiles);

  if (sourceFiles.length === 0) {
    console.error(`No .geojson files found in: ${INPUT_DIR}`);
    process.exit(1);
  }

  const mergedCoords = [];
  const includedFiles = [];

  console.log('Building merged 2025 full track...');

  for (const fileName of sourceFiles) {
    const filePath = path.join(INPUT_DIR, fileName);
    try {
      const coords = readTrackCoords(filePath);
      if (coords.length === 0) {
        console.warn(`  Skipped (no line coords): ${fileName}`);
        continue;
      }

      for (const coord of coords) {
        appendCoord(mergedCoords, coord);
      }
      includedFiles.push(fileName);
      console.log(`  Included: ${fileName} (${coords.length} points)`);
    } catch (error) {
      console.warn(`  Skipped (invalid GeoJSON): ${fileName} :: ${error.message}`);
    }
  }

  if (mergedCoords.length < 2) {
    console.error('Merged track has fewer than 2 coordinates; aborting output.');
    process.exit(1);
  }

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Waldo Full Track 2025',
          sourceDirectory: 'background/2025/daily-geojson',
          sourceFileCount: includedFiles.length,
          sourceFiles: includedFiles,
          pointCount: mergedCoords.length,
          generated: new Date().toISOString(),
        },
        geometry: {
          type: 'LineString',
          coordinates: mergedCoords,
        },
      },
    ],
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));

  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`Source files: ${includedFiles.length}`);
  console.log(`Merged points: ${mergedCoords.length}`);
}

main();
