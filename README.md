# Tallinn Old Town in 3D

A stylized, interactive 3D map of Tallinn's Old Town (Vanalinn), built from open data.

- **Buildings:** Estonian Land Board LOD2 models (49,816 for Tallinn), clipped to the Old Town area
- **Terrain:** Land Board 1 m DTM (map sheet 63843), so Toompea sits on its real hill
- **Streets, parks, water, city walls, trees, names:** OpenStreetMap
- **Hand-built models** where the automatic LOD2 data fails (`tools/landmark_models.py`; so far the Town Hall)

Features: 23 curated landmarks with stories in English, Estonian and Russian, a guided tour, a time-of-day slider with night lighting, building hover info (address and height), shareable links (`/#oleviste`), and a mobile layout.

## Run

```sh
npm install
npm run dev          # http://localhost:5173
```

## Rebuild the data

Raw downloads go in `data/raw/` (not committed):

| File | Source |
|---|---|
| `gdb/hooned_lod2-Tallinn.gdb` | Land Board 3D data, "Buildings LOD2, Tallinn, gdb" |
| `dem/63843_dtm_1m.tif` | Land Board elevation data, DTM 1 m, map sheet 63843 |
| `osm/oldtown.json`, `osm/vanalinn.json` | Overpass API exports (see `tools/build_scene.py`) |

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install pyogrio shapely numpy pyproj rasterio pillow mapbox_earcut
npm run data         # writes public/data/*
```

## Attribution

Buildings and terrain: Estonian Land and Spatial Development Board 2026. Map data © OpenStreetMap contributors (ODbL).
