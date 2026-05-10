#!/usr/bin/env node
/**
 * Script 1: GPX → GeoJSON
 *
 * Reads all *.gpx files from /data/tracks/
 * Parses track points and converts to a GeoJSON LineString
 * Outputs /public/route.geojson
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const TRACKS_DIR = path.join(__dirname, '..', 'data', 'tracks');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'route.geojson');

function parseGpxFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['trkpt', 'trkseg', 'trk'].includes(name),
  });
  const result = parser.parse(xml);

  const coordinates = [];

  const gpx = result.gpx;
  if (!gpx || !gpx.trk) return coordinates;

  const tracks = Array.isArray(gpx.trk) ? gpx.trk : [gpx.trk];

  for (const trk of tracks) {
    const segments = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
    for (const seg of segments) {
      if (!seg || !seg.trkpt) continue;
      const points = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
      for (const pt of points) {
        const lon = parseFloat(pt['@_lon']);
        const lat = parseFloat(pt['@_lat']);
        if (!isNaN(lat) && !isNaN(lon)) {
          const coord = [lon, lat];
          if (pt.ele !== undefined) {
            const ele = parseFloat(pt.ele);
            if (!isNaN(ele)) coord.push(ele);
          }
          coordinates.push(coord);
        }
      }
    }
  }

  return coordinates;
}

function main() {
  if (!fs.existsSync(TRACKS_DIR)) {
    console.error(`Tracks directory not found: ${TRACKS_DIR}`);
    process.exit(1);
  }

  const gpxFiles = fs.readdirSync(TRACKS_DIR)
    .filter(f => f.toLowerCase().endsWith('.gpx'))
    .sort()
    .map(f => path.join(TRACKS_DIR, f));

  if (gpxFiles.length === 0) {
    console.warn('No GPX files found in', TRACKS_DIR);
  }

  let allCoordinates = [];

  for (const file of gpxFiles) {
    console.log(`Processing: ${path.basename(file)}`);
    const coords = parseGpxFile(file);
    console.log(`  → ${coords.length} track points`);
    allCoordinates = allCoordinates.concat(coords);
  }

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Waldo Expedition Route',
          description: 'GPS track exported from Gaia GPS',
          generated: new Date().toISOString(),
          pointCount: allCoordinates.length,
        },
        geometry: {
          type: 'LineString',
          coordinates: allCoordinates,
        },
      },
    ],
  };

  // Also expose the last known position as a separate feature
  if (allCoordinates.length > 0) {
    const last = allCoordinates[allCoordinates.length - 1];
    geojson.features.push({
      type: 'Feature',
      properties: {
        name: 'Last Known Position',
        type: 'current-position',
        updated: new Date().toISOString(),
      },
      geometry: {
        type: 'Point',
        coordinates: last,
      },
    });
  }

  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`Total track points: ${allCoordinates.length}`);
}

main();
