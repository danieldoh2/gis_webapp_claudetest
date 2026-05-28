# PMTiles Viewer

A lightweight, self-contained web app for visualising **vector PMTiles** data directly in the browser — no build step, no server required (beyond a basic static file server).

---

## Project Structure

```
pmtiles-viewer/
├── index.html   ← entry point
├── style.css    ← all styles
├── app.js       ← MapLibre + PMTiles logic
├── README.md
└── *.pmtiles    ← drop your tiles here (same level)
```

---

## Quick Start

### 1. Serve the folder locally

You need a local HTTP server (browsers block local file:// access for tiles):

```bash
# Python 3
python -m http.server 8080

# Node (npx)
npx serve .

# VS Code: use the "Live Server" extension
```

Then open **http://localhost:8080** in your browser.

### 2. Load your PMTiles file

**Option A — Local file (drag-free picker)**
Click **Load File** in the header → select your `.pmtiles` file from disk.  
Because the PMTiles JS library reads the file directly as a `File` object, the file does **not** need to be in the project directory for this method.

**Option B — Remote URL**
Click **Load URL** → paste a full HTTPS URL to a `.pmtiles` file.  
The remote server must send CORS headers (`Access-Control-Allow-Origin: *`).

**Option C — Hardcode a local path**
If you have a `.pmtiles` file in the project folder (e.g. `my-data.pmtiles`), you can auto-load it at startup by adding this snippet to the bottom of `app.js`:

```js
// Auto-load on startup
map.on('load', async () => {
  const filename = 'my-data.pmtiles';
  const url = `pmtiles://${window.location.origin}/${filename}`;
  const p   = new pmtiles.PMTiles(`${window.location.origin}/${filename}`);
  protocol.add(p);
  await loadPMTiles(url, filename, p);
});
```

---

## Features

| Feature | Details |
|---|---|
| **Vector layer auto-detection** | Reads `vector_layers` / `tilestats` from PMTiles metadata |
| **Per-layer colour coding** | Each source layer gets a distinct colour; fill + line + point sub-layers share it |
| **Layer toggle** | Click any row in the legend to show/hide that layer group |
| **Show All / Hide All** | Batch visibility controls |
| **Feature popup** | Click any feature to inspect its properties |
| **Bounds auto-fit** | Map zooms to the data extent on load |
| **Remote URL support** | Any CORS-enabled remote PMTiles URL |
| **Raster fallback** | PNG/WebP PMTiles load as a raster layer (no layer filtering) |
| **OSM base map** | Muted OpenStreetMap tiles as context |

---

## Dependencies (CDN, no install needed)

- [MapLibre GL JS](https://maplibre.org/) `v4.7.1`
- [PMTiles JS](https://github.com/protomaps/PMTiles) `v3.2.1`
- Google Fonts: Space Mono + Syne

---

## Notes

- Only **vector** PMTiles (tile type `mvt`) support per-layer filtering. Raster tiles load but show as a single layer.
- The viewer auto-assigns fill, line, and circle sub-layers per vector source-layer, so mixed-geometry layers render correctly.
- For very large files, the initial metadata read may take a moment — a toast message will confirm when loading is complete.
