/**
 * PMTiles Viewer — app.js
 * Loads local or remote .pmtiles files via MapLibre GL + the pmtiles JS library.
 * Introspects vector tile layers and renders a filterable legend panel.
 */

'use strict';

/* ── PMTiles protocol registration ─────────────────────────────────────── */
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

/* ── Color palette for auto-assigning layer colours ────────────────────── */
const PALETTE = [
  '#f6ad3c', '#60a5fa', '#4ade80', '#f472b6',
  '#a78bfa', '#34d399', '#fb923c', '#fbbf24',
  '#f87171', '#38bdf8', '#c084fc', '#86efac',
];

/* ── Map initialisation ─────────────────────────────────────────────────── */
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'osm-base',
        type: 'raster',
        source: 'osm-tiles',
        paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.5 },
      },
    ],
  },
  center: [0, 20],
  zoom: 2,
  attributionControl: false,
});

map.addControl(new maplibregl.NavigationControl(), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

/* ── State ──────────────────────────────────────────────────────────────── */
let currentSourceId  = null;
let addedLayerIds    = [];      // MapLibre layer ids added from PMTiles
let layerVisibility  = {};      // { layerId: bool }
let layerColors      = {};      // { vectorLayerName: hex }
let tilesUrl         = null;    // active pmtiles:// URL

/* ── UI elements ────────────────────────────────────────────────────────── */
const legendPanel   = document.getElementById('legend-panel');
const legendCollapse= document.getElementById('legend-collapse');
const legendExpand  = document.getElementById('legend-expand');
const layerListEl   = document.getElementById('layer-list');
const layerControls = document.getElementById('layer-controls');
const sourceInfoEl  = document.getElementById('source-info');
const toastEl       = document.getElementById('toast');

/* ── Toast ──────────────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type = 'info', duration = 3500) {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, duration);
}

/* ── Legend collapse / expand ───────────────────────────────────────────── */
legendCollapse.addEventListener('click', () => {
  legendPanel.style.display = 'none';
  legendExpand.style.display = 'flex';
});
legendExpand.addEventListener('click', () => {
  legendPanel.style.display = 'flex';
  legendExpand.style.display = 'none';
});

/* ── Load File button ───────────────────────────────────────────────────── */
document.getElementById('btn-load-file').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  // PMTiles JS can open File objects directly
  const p = new pmtiles.PMTiles(file);
  protocol.add(p);
  const url = `pmtiles://${file.name}`;

  await loadPMTiles(url, file.name, p);
});

/* ── Load URL button ─────────────────────────────────────────────────────── */
document.getElementById('btn-load-url').addEventListener('click', () => {
  document.getElementById('modal-url').style.display = 'flex';
  setTimeout(() => document.getElementById('url-input').focus(), 50);
});

document.getElementById('btn-url-confirm').addEventListener('click', async () => {
  const raw = document.getElementById('url-input').value.trim();
  if (!raw) { showToast('Please enter a URL', 'error'); return; }

  let url = raw;
  if (!url.startsWith('pmtiles://')) url = `pmtiles://${raw}`;
  const label = raw.split('/').pop();

  closeModal('modal-url');

  const p = new pmtiles.PMTiles(raw);
  protocol.add(p);

  await loadPMTiles(url, label, p);
});

/* ── Modal helpers ───────────────────────────────────────────────────────── */
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}
document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});
document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-url-confirm').click();
});

/* ── Core: load PMTiles ───────────────────────────────────────────────────
   Reads metadata, adds MapLibre source + layers, builds legend.
   ────────────────────────────────────────────────────────────────────────── */
async function loadPMTiles(pmtilesUrl, label, pmtilesObj) {
  showToast('Reading PMTiles metadata…', 'info', 8000);

  try {
    const header   = await pmtilesObj.getHeader();
    const metadata = await pmtilesObj.getMetadata();

    // Determine tile type
    if (header.tileType !== 1) {   // 1 = MVT / vector
      showToast('Only vector PMTiles (MVT) are supported for layer filtering.', 'error', 6000);
      // Still add as raster if tileType === 2 (png)
      if (header.tileType === 2 || header.tileType === 3) {
        await addRasterSource(pmtilesUrl, header, label);
      }
      return;
    }

    await addVectorSource(pmtilesUrl, header, metadata, label);
    showToast(`Loaded: ${label}`, 'success');

  } catch (err) {
    console.error(err);
    showToast(`Failed to load: ${err.message}`, 'error', 6000);
  }
}

/* ── Add vector PMTiles source ──────────────────────────────────────────── */
async function addVectorSource(url, header, metadata, label) {
  // Remove previous PMTiles source & layers
  clearPreviousLayers();

  tilesUrl = url;
  currentSourceId = 'pmtiles-source';

  // Extract vector layer names from metadata
  const vectorLayers = extractVectorLayers(metadata);

  map.addSource(currentSourceId, {
    type: 'vector',
    url: url,
    attribution: metadata?.attribution || '',
  });

  // Assign colours and add MapLibre layers
  addedLayerIds = [];
  layerVisibility = {};
  layerColors = {};

  vectorLayers.forEach((vl, i) => {
    const color = PALETTE[i % PALETTE.length];
    layerColors[vl.id] = color;

    // Fill / polygon layer
    const fillId = `pmt-fill-${vl.id}`;
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: currentSourceId,
      'source-layer': vl.id,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': color,
        'fill-opacity': 0.35,
        'fill-outline-color': color,
      },
    });
    addedLayerIds.push(fillId);
    layerVisibility[fillId] = true;

    // Line layer (also catches polygon outlines when filter is off)
    const lineId = `pmt-line-${vl.id}`;
    map.addLayer({
      id: lineId,
      type: 'line',
      source: currentSourceId,
      'source-layer': vl.id,
      filter: ['any',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
      ],
      paint: {
        'line-color': color,
        'line-width': 1.5,
        'line-opacity': 0.85,
      },
    });
    addedLayerIds.push(lineId);
    layerVisibility[lineId] = true;

    // Point / circle layer
    const circleId = `pmt-circle-${vl.id}`;
    map.addLayer({
      id: circleId,
      type: 'circle',
      source: currentSourceId,
      'source-layer': vl.id,
      filter: ['any',
        ['==', ['geometry-type'], 'Point'],
        ['==', ['geometry-type'], 'MultiPoint'],
      ],
      paint: {
        'circle-color': color,
        'circle-radius': 4,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 1,
        'circle-opacity': 0.9,
      },
    });
    addedLayerIds.push(circleId);
    layerVisibility[circleId] = true;
  });

  // Fit map to data bounds
  fitToBounds(header);

  // Popup on click
  setupPopup();

  // Build legend
  buildLegend(vectorLayers, header, metadata, label);
}

/* ── Raster fallback ─────────────────────────────────────────────────────── */
async function addRasterSource(url, header, label) {
  clearPreviousLayers();
  currentSourceId = 'pmtiles-source';

  map.addSource(currentSourceId, {
    type: 'raster',
    url: url,
    tileSize: 256,
  });

  const layerId = 'pmt-raster';
  map.addLayer({ id: layerId, type: 'raster', source: currentSourceId });
  addedLayerIds.push(layerId);

  fitToBounds(header);
  showToast(`Loaded raster: ${label}`, 'success');

  buildLegend([], header, {}, label, true);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function clearPreviousLayers() {
  addedLayerIds.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  addedLayerIds = [];
  if (currentSourceId && map.getSource(currentSourceId)) {
    map.removeSource(currentSourceId);
  }
  currentSourceId = null;
  tilesUrl = null;
}

function fitToBounds(header) {
  if (
    header.minLon != null && header.minLat != null &&
    header.maxLon != null && header.maxLat != null &&
    isFinite(header.minLon) && isFinite(header.minLat)
  ) {
    map.fitBounds(
      [[header.minLon, header.minLat], [header.maxLon, header.maxLat]],
      { padding: 40, maxZoom: 14, duration: 800 }
    );
  }
}

function extractVectorLayers(metadata) {
  // Standard TileJSON vector_layers array
  if (Array.isArray(metadata?.vector_layers)) {
    return metadata.vector_layers.map(vl => ({
      id:     vl.id,
      desc:   vl.description || '',
      fields: vl.fields || {},
      minzoom: vl.minzoom,
      maxzoom: vl.maxzoom,
    }));
  }
  // Tippecanoe embeds under tilestats
  if (Array.isArray(metadata?.tilestats?.layers)) {
    return metadata.tilestats.layers.map(l => ({
      id:     l.layer,
      desc:   '',
      fields: {},
    }));
  }
  return [];
}

/* ── Popup on feature click ──────────────────────────────────────────────── */
let popup = null;
function setupPopup() {
  if (popup) { popup.remove(); popup = null; }
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });

  map.on('click', (e) => {
    if (!addedLayerIds.length) return;

    const features = map.queryRenderedFeatures(e.point, { layers: addedLayerIds });
    if (!features.length) return;

    const f = features[0];
    const props = f.properties || {};
    const keys  = Object.keys(props).slice(0, 20);

    // Find source-layer name from the MapLibre layer id convention
    const sourceLayer = f.sourceLayer || (f.layer && f.layer['source-layer']) || '—';

    const propsHtml = keys.length
      ? keys.map(k => `
          <div class="popup-prop">
            <span class="popup-prop-key">${escHtml(k)}</span>
            <span class="popup-prop-val">${escHtml(String(props[k]))}</span>
          </div>`).join('')
      : '<div style="color:var(--text-dim)">No properties</div>';

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="popup-inner">
          <div class="popup-layer-name">${escHtml(sourceLayer)}</div>
          <div class="popup-props">${propsHtml}</div>
        </div>`)
      .addTo(map);
  });

  map.on('mouseenter', addedLayerIds, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', addedLayerIds, () => { map.getCanvas().style.cursor = ''; });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Legend builder ──────────────────────────────────────────────────────── */
function buildLegend(vectorLayers, header, metadata, label, isRaster = false) {
  // Source info block
  const minZ = header.minZoom ?? '—';
  const maxZ = header.maxZoom ?? '—';
  const name = metadata?.name || label;
  const desc = metadata?.description || '';

  let infoHtml = `
    <div class="source-meta">
      <div class="source-meta-row">
        <span class="source-meta-label">Name</span>
        <span class="source-meta-value">${escHtml(name)}</span>
      </div>
      <div class="source-meta-row">
        <span class="source-meta-label">Zoom</span>
        <span class="source-meta-value">${minZ} – ${maxZ}</span>
      </div>
      ${desc ? `<div class="source-meta-row">
        <span class="source-meta-label">Info</span>
        <span class="source-meta-value">${escHtml(desc)}</span>
      </div>` : ''}
      ${isRaster ? `<div class="source-meta-row">
        <span class="source-meta-label">Type</span>
        <span class="source-meta-value">Raster</span>
      </div>` : ''}
    </div>`;

  sourceInfoEl.innerHTML = infoHtml;

  // Layer list
  if (!vectorLayers.length) {
    layerListEl.style.display  = 'none';
    layerControls.style.display = 'none';
    return;
  }

  layerListEl.style.display  = 'block';
  layerControls.style.display = 'flex';

  layerListEl.innerHTML = '';

  const header2 = document.createElement('div');
  header2.className = 'layer-group-header';
  header2.textContent = `${vectorLayers.length} vector layer${vectorLayers.length !== 1 ? 's' : ''}`;
  layerListEl.appendChild(header2);

  vectorLayers.forEach((vl) => {
    const color = layerColors[vl.id] || '#888';

    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.layer = vl.id;
    item.innerHTML = `
      <div class="layer-swatch" style="background:${color};" title="${escHtml(vl.id)}"></div>
      <span class="layer-name" title="${escHtml(vl.id)}">${escHtml(vl.id)}</span>
      <span class="layer-type-badge">vt</span>
      <span class="layer-eye">◉</span>`;

    item.addEventListener('click', () => toggleLayerGroup(vl.id, item));
    layerListEl.appendChild(item);
  });

  /* Show/Hide All */
  document.getElementById('btn-show-all').onclick = () => {
    document.querySelectorAll('.layer-item').forEach(el => {
      el.classList.remove('hidden');
      el.querySelector('.layer-eye').textContent = '◉';
    });
    addedLayerIds.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      layerVisibility[id] = true;
    });
  };

  document.getElementById('btn-hide-all').onclick = () => {
    document.querySelectorAll('.layer-item').forEach(el => {
      el.classList.add('hidden');
      el.querySelector('.layer-eye').textContent = '○';
    });
    addedLayerIds.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      layerVisibility[id] = false;
    });
  };
}

/* Toggle a vector layer group (fill + line + circle) */
function toggleLayerGroup(vectorLayerId, itemEl) {
  // Derive the three MapLibre layer ids from the naming convention
  const relatedIds = [
    `pmt-fill-${vectorLayerId}`,
    `pmt-line-${vectorLayerId}`,
    `pmt-circle-${vectorLayerId}`,
  ];

  // Current state: visible if any related layer is visible
  const isVisible = relatedIds.some(id => layerVisibility[id]);

  const next = !isVisible;
  relatedIds.forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', next ? 'visible' : 'none');
    }
    layerVisibility[id] = next;
  });

  itemEl.classList.toggle('hidden', !next);
  itemEl.querySelector('.layer-eye').textContent = next ? '◉' : '○';
}
