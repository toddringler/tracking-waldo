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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let map;
let routeVisible = true;
let eventsVisible = true;
let routeData = null;
let eventsData = null;
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

  addRouteLayer(routeData);
  addEventsLayer(eventsData);
  addCurrentPositionLayer(routeData);

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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 12, 14],
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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 12, 10],
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
  const photoUrl = photoFilename ? `${PHOTO_BASE_PATH}${encodeURIComponent(photoFilename)}` : '';
  const photoCaption = props.photoCaption || props.title || 'Event photo';

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
      ${photoUrl ? `<button class="btn popup-photo-btn" data-photo-url="${escapeHtml(photoUrl)}" data-photo-caption="${escapeHtml(photoCaption)}">📷 View Photo</button>` : ''}
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
      openPhotoOverlay(photoBtn.dataset.photoUrl || '', photoBtn.dataset.photoCaption || 'Event photo');
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
      ? `${distanceKm.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  return resp.json();
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

function openPhotoOverlay(url, caption) {
  if (!url) return;

  const overlay = document.getElementById('photo-overlay');
  const image = document.getElementById('photo-overlay-image');
  const captionEl = document.getElementById('photo-overlay-caption');

  if (!overlay || !image || !captionEl) return;

  captionEl.textContent = caption || '';
  image.onerror = () => {
    showError('Photo could not be loaded.');
    closePhotoOverlay();
  };
  image.src = url;

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closePhotoOverlay() {
  const overlay = document.getElementById('photo-overlay');
  const image = document.getElementById('photo-overlay-image');

  if (!overlay || !image) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  image.src = '';
  image.onerror = null;
}

function normalizePhotoFilename(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/^.*[\\/]/, '');
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
