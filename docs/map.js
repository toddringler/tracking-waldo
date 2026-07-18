/**
 * map.js — Waldo Expedition Tracking System
 *
 * Renders the expedition route, Waldo events, and current position
 * using Mapbox GL JS. Loads data from pre-built GeoJSON files.
 */

'use strict';

// ---------------------------------------------------------------------------
// Mapbox token
// Set your token in docs/config.js (see that file for instructions).
// ---------------------------------------------------------------------------
const MAPBOX_TOKEN =
  (window.WALDO_CONFIG && window.WALDO_CONFIG.mapboxToken) ||
  document.getElementById('map')?.dataset?.mapboxToken ||
  '';

// ---------------------------------------------------------------------------
// Type → display config
// ---------------------------------------------------------------------------
const EVENT_CONFIG = {
  fuel:     { color: '#e36b00', emoji: '⛽', label: 'Fuel Stop' },
  camp:     { color: '#2ea043', emoji: '⛺', label: 'Camp' },
  sighting: { color: '#1f6feb', emoji: '👁️', label: 'Sighting' },
  incident: { color: '#da3633', emoji: '⚠️', label: 'Incident' },
  ferry:    { color: '#8b5cf6', emoji: '⛴️', label: 'Ferry' },
};

const MOOD_EMOJI = {
  optimistic: '😎',
  cautious:   '🤔',
  concerned:  '😟',
  content:    '😌',
  feral:      '🤪',
};

const PHOTO_BASE_PATH = 'events/photos/';
const VIDEO_BASE_PATH = 'events/videos/';
const MIGRATION_2025_TRACK_PATH = 'supplement/full_track_2025.geojson';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let map;
let routeVisible = true;
let eventsVisible = true;
let migration2025Visible = false;
let routeData = null;
let eventsData = null;
let migration2025Data = null;
let loadingTimeoutId = null;
const LOADING_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Initialise map
// ---------------------------------------------------------------------------
function initMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  loadingTimeoutId = window.setTimeout(() => {
    showError('Map is taking longer than expected to load. Check your connection and reload if needed.');
    hideLoading();
  }, LOADING_TIMEOUT_MS);

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: [-149.9003, 61.2181], // Anchorage default
    zoom: 5,
    attributionControl: false,
  });

  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'bottom-right');
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left');

  map.on('load', onMapLoad);
}

// ---------------------------------------------------------------------------
// Map load — fetch data and add layers
// ---------------------------------------------------------------------------
async function onMapLoad() {
  let migrationTrackLoadError = null;

  try {
    [routeData, eventsData] = await Promise.all([
      loadRouteData(),
      fetchJSON('waldo-events.geojson'),
    ]);
  } catch (err) {
    showError(`Failed to load map data: ${err.message}`);
    hideLoading();
    return;
  }

  try {
    migration2025Data = await fetchJSON(MIGRATION_2025_TRACK_PATH);
  } catch (err) {
    migrationTrackLoadError = err;
  }

  addRouteLayer(routeData);
  addEventsLayer(eventsData);
  addCurrentPositionLayer(routeData);
  addMigration2025Layer(migration2025Data);
  updateMigration2025ToggleButton(migration2025Data !== null);

  if (migrationTrackLoadError) {
    console.warn(`2025 migration track unavailable: ${migrationTrackLoadError.message}`);
  }

  populateSidebar(eventsData);
  updateStats(routeData, eventsData);
  fitToData(routeData, eventsData);

  hideLoading();
}

// ---------------------------------------------------------------------------
// Add route line layer
// ---------------------------------------------------------------------------
function addRouteLayer(data) {
  map.addSource('route', { type: 'geojson', data });

  // Route glow (wide, dim)
  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'route',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
        'line-color': '#000000',
      'line-width': 10,
      'line-opacity': 0.15,
      'line-blur': 4,
    },
  });

  // Route line
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
        'line-color': '#000000',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4],
      'line-opacity': 0.9,
    },
  });

  // Direction arrows
  map.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 120,
      'text-field': '▶',
      'text-size': 14,
      'text-rotation-alignment': 'map',
      'text-keep-upright': false,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#f0a500', 'text-opacity': 0.7 },
  });
}

// ---------------------------------------------------------------------------
// Add Waldo events layer
// ---------------------------------------------------------------------------
function addEventsLayer(data) {
  map.addSource('events', { type: 'geojson', data });

  // Event circles
  map.addLayer({
    id: 'events-circle-outer',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['*', ['coalesce', ['get', 'scale'], 1], 6], 12, ['*', ['coalesce', ['get', 'scale'], 1], 14]],
      'circle-color': [
        'match', ['get', 'type'],
        'fuel',     '#e36b00',
        'camp',     '#2ea043',
        'sighting', '#1f6feb',
        'incident', '#da3633',
        'ferry',    '#8b5cf6',
        '#f0a500',
      ],
      'circle-opacity': 0.2,
      'circle-stroke-width': 0,
    },
  });

  map.addLayer({
    id: 'events-circle',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['*', ['coalesce', ['get', 'scale'], 1], 4], 12, ['*', ['coalesce', ['get', 'scale'], 1], 10]],
      'circle-color': [
        'match', ['get', 'type'],
        'fuel',     '#e36b00',
        'camp',     '#2ea043',
        'sighting', '#1f6feb',
        'incident', '#da3633',
        'ferry',    '#8b5cf6',
        '#f0a500',
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#0d1117',
    },
  });

  // Click → popup
  map.on('click', 'events-circle', (e) => {
    const feature = e.features[0];
    const coords = feature.geometry.coordinates.slice();
    showEventPopup(coords, feature.properties);
  });

  map.on('mouseenter', 'events-circle', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'events-circle', () => {
    map.getCanvas().style.cursor = '';
  });
}

// ---------------------------------------------------------------------------
// Add optional 2025 migration layer
// ---------------------------------------------------------------------------
function addMigration2025Layer(data) {
  if (!data || !Array.isArray(data.features) || data.features.length === 0) {
    return;
  }

  map.addSource('migration-2025', { type: 'geojson', data });

  map.addLayer({
    id: 'migration-2025-line',
    type: 'line',
    source: 'migration-2025',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      visibility: migration2025Visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#000000',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 10, 3.5],
      'line-opacity': 0.85,
      'line-dasharray': [2, 1.5],
    },
  });
}

// ---------------------------------------------------------------------------
// Add current position marker
// ---------------------------------------------------------------------------
function addCurrentPositionLayer(data) {
  const currentFeatures = (data.features || []).filter(
    f => f.properties?.type === 'current-position'
  );
  const currentFeature = currentFeatures[currentFeatures.length - 1];
  if (!currentFeature) return;

  map.addSource('current-pos', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [currentFeature] },
  });

  // Pulsing outer ring
  map.addLayer({
    id: 'current-pos-pulse',
    type: 'circle',
    source: 'current-pos',
    paint: {
      'circle-radius': 18,
      'circle-color': '#f0a500',
      'circle-opacity': 0.15,
    },
  });

  map.addLayer({
    id: 'current-pos-circle',
    type: 'circle',
    source: 'current-pos',
    paint: {
      'circle-radius': 8,
      'circle-color': '#f0a500',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#0d1117',
    },
  });

  // Update stat
  const [lon, lat] = currentFeature.geometry.coordinates;
  document.getElementById('stat-position').textContent =
    `${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°W`;
}

// ---------------------------------------------------------------------------
// Popup rendering
// ---------------------------------------------------------------------------
function showEventPopup(coords, props) {
  const config = EVENT_CONFIG[props.type] || { color: '#f0a500', emoji: '📍', label: props.type };
  const moodEmoji = MOOD_EMOJI[props.mood] || '';
  const photoFilename = normalizePhotoFilename(props.photoFilename);
  const media = buildEventMedia(photoFilename);
  const mediaLabel = media.kind === 'video' ? '🎬 View Video' : '📷 View Photo';
  const photoCaption = props.photoCaption || props.title || 'Event photo';
  const photoNote = props.photoNote || '';

  const html = `
    <div class="popup-inner">
      <div class="popup-type-badge ${props.type}">
        ${config.emoji} ${config.label}
      </div>
      <div class="popup-title">${escapeHtml(props.title)}</div>
      <div class="popup-day">
        Day ${props.day || '?'} · ${props.date || ''}
      </div>
      ${props.thought ? `<div class="popup-thought">"${escapeHtml(props.thought)}"</div>` : ''}
      <div class="popup-meta">
        ${props.mood ? `<span class="popup-mood">${moodEmoji} ${escapeHtml(props.mood)}</span>` : ''}
      </div>
      ${media.url ? `<button class="btn popup-photo-btn" data-photo-url="${escapeHtml(media.url)}" data-photo-kind="${escapeHtml(media.kind)}" data-photo-caption="${escapeHtml(photoCaption)}" data-photo-note="${escapeHtml(photoNote)}">${mediaLabel}</button>` : ''}
      ${props.status ? `<div class="popup-status">${escapeHtml(props.status)}</div>` : ''}
    </div>
  `;

  const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '340px', offset: 12 })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);

  const popupEl = popup.getElement();
  const photoBtn = popupEl.querySelector('.popup-photo-btn');
  if (photoBtn) {
    photoBtn.addEventListener('click', () => {
      openPhotoOverlay(
        photoBtn.dataset.photoUrl || '',
        photoBtn.dataset.photoCaption || 'Event photo',
        photoBtn.dataset.photoKind || 'image',
        photoBtn.dataset.photoNote || ''
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Sidebar event list
// ---------------------------------------------------------------------------
function populateSidebar(data) {
  const container = document.getElementById('sidebar-content');
  const features = data?.features || [];

  if (features.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--color-text-muted);">No events yet.</p>';
    return;
  }

  container.innerHTML = features.map((f, i) => {
    const p = f.properties;
    const config = EVENT_CONFIG[p.type] || { color: '#f0a500', emoji: '📍' };
    return `
      <div class="event-card" data-index="${i}" onclick="flyToEvent(${i})">
        <div class="event-card-header">
          <div class="event-dot ${p.type}"></div>
          <div class="event-card-title">${escapeHtml(p.title)}</div>
        </div>
        <div class="event-card-day">Day ${p.day || '?'} · ${config.emoji} ${p.type}</div>
        ${p.thought ? `<div class="event-card-thought">"${escapeHtml(p.thought)}"</div>` : ''}
      </div>
    `;
  }).join('');
}

function flyToEvent(index) {
  const feature = eventsData?.features?.[index];
  if (!feature) return;
  const [lon, lat] = feature.geometry.coordinates;
  map.flyTo({ center: [lon, lat], zoom: 10, duration: 1000 });
  setTimeout(() => showEventPopup([lon, lat], feature.properties), 800);
}

// Expose globally for onclick
window.flyToEvent = flyToEvent;

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------
function updateStats(routeData, eventsData) {
  const lineFeatures = (routeData?.features || []).filter(f => f.geometry?.type === 'LineString');

  let points = 0;
  let distanceKm = 0;
  lineFeatures.forEach((feature) => {
    const coordinates = feature?.geometry?.coordinates || [];
    points += coordinates.length;
    const distanceKmProp = Number(feature?.properties?.distanceKm);
    distanceKm += Number.isFinite(distanceKmProp) ? distanceKmProp : totalDistanceKm(coordinates);
  });

  // Find max day
  const maxDay = eventsData?.features?.reduce((max, f) => {
    const d = f.properties?.day || 0;
    return d > max ? d : max;
  }, 0);

  document.getElementById('stat-day').textContent = maxDay > 0 ? maxDay : '—';
  document.getElementById('stat-distance').textContent =
    distanceKm > 0
      ? `${Math.round(distanceKm).toLocaleString()} km`
      : '—';
  document.getElementById('stat-points').textContent = points.toLocaleString();
}

// ---------------------------------------------------------------------------
// Fit map to data
// ---------------------------------------------------------------------------
function fitToData(routeData, eventsData) {
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoints = false;

  const lineFeatures = (routeData?.features || []).filter(f => f.geometry?.type === 'LineString');
  lineFeatures.forEach((lineFeature) => {
    lineFeature.geometry.coordinates.forEach(coord => {
      bounds.extend(coord);
      hasPoints = true;
    });
  });

  eventsData?.features?.forEach(f => {
    bounds.extend(f.geometry.coordinates);
    hasPoints = true;
  });

  if (hasPoints) {
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1000 });
  }
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('sidebar-close').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

document.getElementById('btn-route').addEventListener('click', function () {
  routeVisible = !routeVisible;
  this.classList.toggle('active', routeVisible);
  ['route-glow', 'route-line', 'route-arrows'].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', routeVisible ? 'visible' : 'none');
    }
  });
});

document.getElementById('btn-events').addEventListener('click', function () {
  eventsVisible = !eventsVisible;
  this.classList.toggle('active', eventsVisible);
  ['events-circle-outer', 'events-circle'].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', eventsVisible ? 'visible' : 'none');
    }
  });
});

document.getElementById('btn-legend').addEventListener('click', function () {
  const legend = document.getElementById('legend');
  legend.classList.toggle('visible');
  this.classList.toggle('active', legend.classList.contains('visible'));
});

document.getElementById('btn-fit').addEventListener('click', () => {
  if (routeData && eventsData) fitToData(routeData, eventsData);
});

const migrationToggleBtn = document.getElementById('toggle-2025-track-btn');
if (migrationToggleBtn) {
  migrationToggleBtn.addEventListener('click', function () {
    if (!map.getLayer('migration-2025-line')) return;

    migration2025Visible = !migration2025Visible;
    map.setLayoutProperty('migration-2025-line', 'visibility', migration2025Visible ? 'visible' : 'none');
    this.classList.toggle('toggle-on', migration2025Visible);
    this.setAttribute('aria-pressed', String(migration2025Visible));
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  return resp.json();
}

function updateMigration2025ToggleButton(isAvailable) {
  const btn = document.getElementById('toggle-2025-track-btn');
  if (!btn) return;

  btn.disabled = !isAvailable;
  btn.classList.toggle('toggle-on', migration2025Visible);
  btn.setAttribute('aria-pressed', String(migration2025Visible));
  btn.title = isAvailable
    ? 'Toggle 2025 migration track'
    : '2025 migration track unavailable';
}

async function loadRouteData() {
  const manifest = await fetchJSON('route-files.json');
  const routeFiles = Array.isArray(manifest?.tracks)
    ? manifest.tracks.map(track => track.geojson).filter(Boolean)
    : [];

  if (routeFiles.length === 0) {
    throw new Error('route-files.json did not include any track files.');
  }

  const settled = await Promise.allSettled(routeFiles.map(file => fetchJSON(file)));
  const collections = settled
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);

  if (collections.length === 0) {
    throw new Error('No route GeoJSON files could be loaded.');
  }

  return {
    type: 'FeatureCollection',
    features: collections.flatMap(collection => collection.features || []),
  };
}

function hideLoading() {
  if (loadingTimeoutId !== null) {
    window.clearTimeout(loadingTimeoutId);
    loadingTimeoutId = null;
  }
  const el = document.getElementById('loading');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 500);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.style.display = 'block';
}

function setupPhotoOverlay() {
  const overlay = document.getElementById('photo-overlay');
  const closeBtn = document.getElementById('photo-overlay-close');

  if (!overlay || !closeBtn) return;

  closeBtn.addEventListener('click', closePhotoOverlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePhotoOverlay();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) closePhotoOverlay();
  });
}

function openPhotoOverlay(url, caption, mediaKind, note) {
  if (!url) return;

  const overlay = document.getElementById('photo-overlay');
  const image = document.getElementById('photo-overlay-image');
  const video = document.getElementById('photo-overlay-video');
  const captionEl = document.getElementById('photo-overlay-caption');
  const noteEl = document.getElementById('photo-overlay-note');

  if (!overlay || !image || !video || !captionEl) return;

  captionEl.textContent = caption || '';

  if (noteEl) {
    if (note) {
      noteEl.textContent = note;
      noteEl.hidden = false;
    } else {
      noteEl.textContent = '';
      noteEl.hidden = true;
    }
  }

  if (mediaKind === 'video') {
    image.src = '';
    image.onerror = null;

    video.style.display = 'block';
    video.onerror = () => {
      showError('Video could not be loaded.');
      closePhotoOverlay();
    };
    video.src = url;
    video.load();
  } else {
    video.pause();
    video.currentTime = 0;
    video.src = '';
    video.onerror = null;
    video.style.display = 'none';

    image.onerror = () => {
      showError('Photo could not be loaded.');
      closePhotoOverlay();
    };
    image.src = url;
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closePhotoOverlay() {
  const overlay = document.getElementById('photo-overlay');
  const image = document.getElementById('photo-overlay-image');
  const video = document.getElementById('photo-overlay-video');
  const noteEl = document.getElementById('photo-overlay-note');

  if (!overlay || !image || !video) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');

  image.src = '';
  image.onerror = null;

  video.pause();
  video.currentTime = 0;
  video.src = '';
  video.onerror = null;
  video.style.display = 'none';

  if (noteEl) {
    noteEl.textContent = '';
    noteEl.hidden = true;
  }
}

function normalizePhotoFilename(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/^.*[\\/]/, '');
}

function buildEventMedia(filename) {
  if (!filename) return { url: '', kind: 'image' };

  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const isVideo = ext === 'mov' || ext === 'mp4' || ext === 'm4v' || ext === 'webm' || ext === 'ogg';
  const basePath = isVideo ? VIDEO_BASE_PATH : PHOTO_BASE_PATH;

  return {
    url: `${basePath}${encodeURIComponent(filename)}`,
    kind: isVideo ? 'video' : 'image',
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function haversineDistanceKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const R = 6371;
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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
setupPhotoOverlay();
initMap();
