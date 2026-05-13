#!/usr/bin/env node
/**
 * Script 1: GPX → GeoJSON
 *
 * Reads all *.gpx files from /data/tracks/
 * Parses track points and converts to a GeoJSON LineString
 * Outputs /docs/route.geojson
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const TRACKS_DIR = path.join(__dirname, '..', 'data', 'tracks');
const OUTPUT_FILE = path.join(__dirname, '..', 'docs', 'route.geojson');

function haversineDistanceKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const R = 6371; // Earth mean radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistanceKm(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineDistanceKm(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

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

  const totalKm = totalDistanceKm(allCoordinates);

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
          distanceKm: Number(totalKm.toFixed(3)),
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
  console.log(`Total distance: ${totalKm.toFixed(3)} km`);
}

main();
