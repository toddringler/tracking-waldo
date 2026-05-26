#!/usr/bin/env node
/**
 * Script 1: GPX → GeoJSON
 *
 * Reads all *.gpx files from /data/tracks/
 * Parses track points and converts each GPX into its own GeoJSON file
 * Outputs /docs/routes/*.geojson and /docs/route-files.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const TRACKS_DIR = path.join(__dirname, '..', 'data', 'tracks');
const ROUTES_DIR = path.join(__dirname, '..', 'docs', 'routes');
const INDEX_FILE = path.join(__dirname, '..', 'docs', 'route-files.json');
const LEGACY_OUTPUT_FILE = path.join(__dirname, '..', 'docs', 'route.geojson');

function fileMtimeIso(filePath) {
  return fs.statSync(filePath).mtime.toISOString();
}

function latestMtimeIso(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return null;

  let latest = 0;
  for (const filePath of filePaths) {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    if (mtimeMs > latest) latest = mtimeMs;
  }

  if (latest <= 0) return null;
  return new Date(latest).toISOString();
}

function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === next) {
      return false;
    }
  }

  fs.writeFileSync(filePath, next);
  return true;
}

function getDeltaSeconds() {
  const raw = process.env.DELTA_SECONDS;
  if (raw === undefined || raw === '') return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`Ignoring invalid DELTA_SECONDS value: ${raw}`);
    return null;
  }

  return Math.floor(parsed);
}

function shouldIncludeByMtime(filePath, cutoffMs) {
  if (cutoffMs === null) return true;
  const stat = fs.statSync(filePath);
  return stat.mtimeMs <= cutoffMs;
}

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

  const deltaSeconds = getDeltaSeconds();
  const cutoffMs = deltaSeconds === null ? null : Date.now() - (deltaSeconds * 1000);

  const gpxFiles = fs.readdirSync(TRACKS_DIR)
    .filter(f => f.toLowerCase().endsWith('.gpx'))
    .filter((f) => shouldIncludeByMtime(path.join(TRACKS_DIR, f), cutoffMs))
    .sort()
    .map(f => path.join(TRACKS_DIR, f));

  if (gpxFiles.length === 0) {
    console.warn('No GPX files found in', TRACKS_DIR);
  }

  if (deltaSeconds !== null) {
    console.log(`Using mtime filter: include files modified at or before now - ${deltaSeconds}s`);
  }

  if (!fs.existsSync(ROUTES_DIR)) {
    fs.mkdirSync(ROUTES_DIR, { recursive: true });
  }

  // Remove stale per-track outputs so deleted GPX files do not linger in docs/routes.
  fs.readdirSync(ROUTES_DIR)
    .filter(name => name.toLowerCase().endsWith('.geojson'))
    .forEach((name) => {
      fs.unlinkSync(path.join(ROUTES_DIR, name));
    });

  // Remove legacy merged route artifact.
  if (fs.existsSync(LEGACY_OUTPUT_FILE)) {
    fs.unlinkSync(LEGACY_OUTPUT_FILE);
    console.log(`Removed legacy artifact: ${path.relative(path.join(__dirname, '..'), LEGACY_OUTPUT_FILE)}`);
  }

  const parsedTracks = [];
  for (const file of gpxFiles) {
    console.log(`Processing: ${path.basename(file)}`);
    const coords = parseGpxFile(file);
    console.log(`  → ${coords.length} track points`);
    parsedTracks.push({ file, coords });
  }

  let totalPoints = 0;
  let totalKm = 0;

  const latestTrackWithCoords = (() => {
    for (let i = parsedTracks.length - 1; i >= 0; i -= 1) {
      if (parsedTracks[i].coords.length > 0) return i;
    }
    return -1;
  })();

  const manifest = {
    generated: latestMtimeIso(gpxFiles),
    tracks: [],
  };

  parsedTracks.forEach((track, index) => {
    const sourceFile = path.basename(track.file);
    const sourceMtime = fileMtimeIso(track.file);
    const fileStem = path.basename(track.file, path.extname(track.file));
    const outputName = `${fileStem}.geojson`;
    const outputPath = path.join(ROUTES_DIR, outputName);

    const coords = track.coords;
    const trackDistanceKm = totalDistanceKm(coords);
    totalPoints += coords.length;
    totalKm += trackDistanceKm;

    const geojson = {
      type: 'FeatureCollection',
      features: [],
    };

    if (coords.length > 0) {
      geojson.features.push({
        type: 'Feature',
        properties: {
          name: `Waldo Expedition Route — ${fileStem}`,
          description: `GPS track exported from Gaia GPS (${sourceFile})`,
          sourceFile,
          generated: sourceMtime,
          pointCount: coords.length,
          distanceKm: Number(trackDistanceKm.toFixed(3)),
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      });
    }

    if (index === latestTrackWithCoords && coords.length > 0) {
      const last = coords[coords.length - 1];
      geojson.features.push({
        type: 'Feature',
        properties: {
          name: 'Last Known Position',
          type: 'current-position',
          sourceFile,
          updated: sourceMtime,
        },
        geometry: {
          type: 'Point',
          coordinates: last,
        },
      });
    }

    writeJsonIfChanged(outputPath, geojson);
    manifest.tracks.push({
      sourceFile,
      geojson: `routes/${outputName}`,
      pointCount: coords.length,
      distanceKm: Number(trackDistanceKm.toFixed(3)),
    });

    console.log(`  Output: ${path.relative(path.join(__dirname, '..'), outputPath)}`);
  });

  writeJsonIfChanged(INDEX_FILE, manifest);
  console.log(`\nOutput: ${INDEX_FILE}`);
  console.log(`Total track points: ${totalPoints}`);
  console.log(`Total distance: ${totalKm.toFixed(3)} km`);
}

main();
