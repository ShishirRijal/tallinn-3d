# Tallinn Old Town in 3D

**[▶ Open the live map](https://shishirrijal.github.io/tallinn-3d/)**

An interactive, storybook-style 3D map of Tallinn's medieval Old Town (Vanalinn), a UNESCO World Heritage site. It runs in the browser with nothing to install, works on phones, and is built entirely from open government and community data.

![Tallinn Old Town overview](docs/screenshots/hero.jpg)

## Why this exists

Tallinn already has a few 3D experiences, but each serves a different audience:

| Existing | What it is | Gap |
|---|---|---|
| [3d.tallinn.ee](https://3d.tallinn.ee) | The city's digital twin | A realistic planning tool, not made for exploring or stories |
| VR Tallinn 1939/44 | A paid, in-person VR headset experience | Not on the web |
| VisitTallinn VR app | 360° videos of 8 spots | Video, not an explorable model |

This project fills the gap between them: **a free, readable, story-driven 3D map that anyone can open from a link.**

## Features

- **The real city, stylized.** About 1,800 buildings with their true roof shapes, standing on a 1 m terrain model. Toompea really is 20–30 m above the Lower Town.
- **23 landmarks with stories** in English, Estonian and Russian. Click a pin or a building to fly there.
- **Guided tour.** One button plays the landmarks in sequence, slowly circling each one while you read.
- **Time travel.** Jump between **1899, 1929, 1946, 2000 and today**. Each era drapes a real, georeferenced historical map over the 3D terrain and removes the buildings that didn't exist yet (see [Time travel](#time-travel)).
- **Time of day.** Drag the sun from dawn through golden hour to night, when windows across the town light up.
- **Building info on hover.** Address and height for every building, from the Land Board register.
- **Hand-built landmarks** where the automatic data fails. The Land Board's Town Hall is a flat box, so it is replaced with a procedural model: crenellated parapet, the arcade facing the square, the octagonal tower and Old Thomas on the spire.
- **City walls with battlements**, generated from OpenStreetMap because the Land Board data covers only the towers.
- **Shareable links** to any landmark, e.g. [`#oleviste`](https://shishirrijal.github.io/tallinn-3d/#oleviste).
- **Mobile-first controls.** One finger pans; two fingers zoom and rotate. On phones the list becomes a bottom sheet.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/townhall.jpg" alt="Town Hall close-up"><br><sub>The hand-built Town Hall on Town Hall Square</sub></td>
    <td width="50%"><img src="docs/screenshots/night.jpg" alt="Old Town at night"><br><sub>Night mode: lit windows around Town Hall Square</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/golden.jpg" alt="Golden hour overview"><br><sub>Golden hour over Toompea and the Lower Town</sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/mobile.jpg" alt="Mobile view" width="45%"><br><sub>Phone layout: Kiek in de Kök</sub></td>
  </tr>
</table>

## Time travel

![Tallinn in 1946 on the Soviet topographic map](docs/screenshots/history-1946.jpg)

| Era | Map draped on the terrain | Story |
|---|---|---|
| 1899 | One-verst map of the Russian Empire | Reval, a provincial capital; Nevsky Cathedral still under construction |
| 1929 | Estonian topographic map 1:25 000 | Capital of the independent Republic of Estonia |
| 1946 | Soviet topographic map 1:10 000 | After the March 1944 air raid; Russian labels, start of the Soviet occupation |
| 2000 | Tallinn aerial orthophoto 1:2000 | Independence restored (1991); UNESCO World Heritage listing (1997) |

All maps come from the Land Board's [historical maps WMS](https://geoportaal.maaruum.ee/eng/services/public-wms-wfs-p346.html). Sheet years come from each layer's metadata.

**Which buildings disappear.** Construction years come from the Estonian Building Register (`esmaneKasutus`, "first use"). The register has known quirks, so the rules are deliberately conservative:
- 1940, 1946 and 1994 are data-entry defaults (113 Old Town buildings, many of them medieval, are recorded as "first used in 1940"), so they count as unknown.
- Inside the Old Town, register years are ignored, because restoration dates are often recorded as first use.
- Buildings with an unknown year are shown in every era.

The old map underneath always shows what really stood there.

## How it is made

```
Land Board LOD2 buildings (.gdb) ─┐
Land Board 1 m terrain (.tif) ────┼──▶ tools/build_scene.py ──▶ public/data/* ──▶ Three.js app (src/)
OpenStreetMap (Overpass JSON) ────┘          │
                                             └─ tools/landmark_models.py (hand-built landmarks)
```

**Data pipeline (Python).** `tools/build_scene.py` does the following:
- Clips the Land Board's 49,816 Tallinn buildings to a 1.8 × 1.7 km area.
- Triangulates every roof and wall face and colors it by type. Old Town façades get a pastel palette; roofs are mostly clay tile, with some slate and metal; tall spires get copper.
- Turns the terrain model into a heightmap.
- Paints the ground texture (streets, squares, parks, Snelli pond) from OSM, with soft contact shadows around buildings.
- Extrudes the city walls and places the trees.
- Resolves each landmark's 3D anchor point.

The output is about 4.5 MB in total. Binary files ship gzip-compressed and are decompressed in the browser.

**App (JavaScript).** Vite and Three.js:
- One draw call for all buildings, with fast picking through [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh).
- A custom shader adds windows, hover and selection highlights, and night lighting without any extra geometry.
- The sun's shadow map follows the camera, so shadows stay crisp at every zoom level.

## Run locally

```sh
npm install
npm run dev          # http://localhost:5173
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## Rebuild the data

The processed data is committed, so this step is only needed to change the scene. Put the raw downloads in `data/raw/`, which is not committed:

| File | Where to get it |
|---|---|
| `gdb/hooned_lod2-Tallinn.gdb` | [Land Board 3D data](https://geoportaal.maaruum.ee/eng/spatial-data/3d-data/download-3d-data-p837.html): Buildings LOD2, Tallinn, gdb |
| `dem/63843_dtm_1m.tif` | [Land Board elevation data](https://geoportaal.maaruum.ee/eng/spatial-data/elevation-data/download-elevation-data-p664.html): DTM 1 m, map sheet 63843 |
| `osm/oldtown.json`, `osm/vanalinn.json` | Overpass API exports (queries described in `tools/build_scene.py`) |
| `hist/ehr_years.json` | `tools/fetch_ehr_years.py` (Building Register API) |

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install pyogrio shapely numpy pyproj rasterio pillow mapbox_earcut
tools/.venv/bin/python tools/fetch_ehr_years.py      # construction years (~1,500 requests, cached)
tools/.venv/bin/python tools/fetch_history_maps.py   # historical map drapes -> public/data/history/
npm run data                                          # regenerates public/data/*
```

Era texts live in `src/eras.js`.

Landmark texts live in `tools/landmarks_src.json`. Hand-built models live in `tools/landmark_models.py`.

## Roadmap

- [ ] Hand-model more landmarks: Alexander Nevsky's onion domes, Fat Margaret, Viru Gate
- [x] Time travel with real historical maps (1899, 1929, 1946, 2000)
- [ ] Earlier eras: the Swedish-era town plans and the 1825 model in the Tallinn City Museum
- [ ] Rebuild lost buildings (e.g. the Harju Street block destroyed in 1944) from historical footprints
- [ ] Audio narration for the tour
- [ ] A treasure hunt mode

## Credits

- Buildings, terrain and historical maps: © Estonian Land and Spatial Development Board (Maa- ja Ruumiamet) 2026, open data
- Construction years: Estonian Building Register (Ehitisregister)
- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL
- Built with [Three.js](https://threejs.org) and [Vite](https://vitejs.dev)
