#!/usr/bin/env node
/**
 * Script 2: Waldo Events → GeoJSON
 *
 * Reads all *.json files from /data/events/
 * Converts each event into a GeoJSON Point Feature
 * Outputs /docs/waldo-events.geojson
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EVENTS_DIR = path.join(__dirname, '..', 'data', 'events');
const OUTPUT_FILE = path.join(__dirname, '..', 'docs', 'waldo-events.geojson');

const VALID_TYPES = new Set(['fuel', 'camp', 'sighting', 'incident', 'ferry']);
const VALID_MOODS = new Set(['optimistic', 'cautious', 'concerned', 'content', 'feral']);

function validateEvent(event, date, index) {
  const warnings = [];

  if (!VALID_TYPES.has(event.type)) {
    warnings.push(`event[${index}].type "${event.type}" is not a recognized type (${[...VALID_TYPES].join(', ')})`);
  }
  if (event.mood && !VALID_MOODS.has(event.mood)) {
    warnings.push(`event[${index}].mood "${event.mood}" is not a recognized mood (${[...VALID_MOODS].join(', ')})`);
  }
  if (typeof event.lat !== 'number' || typeof event.lon !== 'number') {
    warnings.push(`event[${index}] missing valid lat/lon`);
  }
  if (!event.title) {
    warnings.push(`event[${index}] missing title`);
  }

  return warnings;
}

function processEventFile(filePath) {
  const basename = path.basename(filePath);
  let data;

  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`  ERROR: Could not parse ${basename}: ${err.message}`);
    return [];
  }

  const { day, date, events } = data;

  if (!Array.isArray(events) || events.length === 0) {
    console.warn(`  WARN: No events in ${basename}`);
    return [];
  }

  const features = [];

  events.forEach((event, i) => {
    const warnings = validateEvent(event, date, i);
    warnings.forEach(w => console.warn(`  WARN [${basename}]: ${w}`));

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [event.lon, event.lat],
      },
      properties: {
        day: day || null,
        date: date || null,
        type: event.type,
        title: event.title || '',
        thought: event.thought || '',
        mood: event.mood || '',
        status: event.status || '',
      },
    });
  });

  return features;
}

function main() {
  if (!fs.existsSync(EVENTS_DIR)) {
    console.error(`Events directory not found: ${EVENTS_DIR}`);
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(EVENTS_DIR)
    .filter(f => f.toLowerCase().endsWith('.json'))
    .sort()
    .map(f => path.join(EVENTS_DIR, f));

  if (jsonFiles.length === 0) {
    console.warn('No event JSON files found in', EVENTS_DIR);
  }

  let allFeatures = [];

  for (const file of jsonFiles) {
    console.log(`Processing: ${path.basename(file)}`);
    const features = processEventFile(file);
    console.log(`  → ${features.length} event(s)`);
    allFeatures = allFeatures.concat(features);
  }

  const geojson = {
    type: 'FeatureCollection',
    features: allFeatures,
    generated: new Date().toISOString(),
    totalEvents: allFeatures.length,
  };

  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`Total events: ${allFeatures.length}`);
}

main();
