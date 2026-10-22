"""Build the web scene for Tallinn Old Town from Land Board + OSM data.

Inputs (data/raw):
  gdb/hooned_lod2-Tallinn.gdb   Land Board LOD2 buildings (EPSG:3301 + EVRF2007 heights)
  dem/63843_dtm_1m.tif          Land Board 1 m terrain model, map sheet 63843
  osm/oldtown.json              Overpass dump: streets, landuse, walls, named places
  osm/vanalinn.json             Overpass dump: Vanalinn district boundary

Outputs (public/data):
  buildings.bin / buildings.json   indexed triangle mesh + per-building metadata
  walls.bin                        city walls extruded from OSM
  terrain.bin / terrain.json       heightmap grid
  ground.jpg                       painted ground texture (streets, parks, water)
  trees.bin                        tree positions
  landmarks.json                   curated landmarks with 3D anchors

Coordinates: x = easting - CX, z = -(northing - CY), y = height above sea level (m).
"""

import gzip
import json
import math
import sys
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import pyogrio
import rasterio
from PIL import Image, ImageDraw, ImageFilter
from pyproj import Transformer
from shapely import Point, Polygon, MultiPolygon, LineString, STRtree, force_2d, from_wkb
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from landmark_models import CUSTOM  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

# Scene extent in EPSG:3301 (easting, northing)
E0, E1 = 541300.0, 543100.0
N0, N1 = 6588300.0, 6589980.0
CX, CY = (E0 + E1) / 2, (N0 + N1) / 2
TERRAIN_STEP = 4.0
TEX_SIZE = 4096
BASE_Y = -12.0  # bottom of the diorama block
POS_SCALE = 32
# Building Register years that are data-entry defaults rather than real dates
# (e.g. 113 Old Town buildings, many medieval, are recorded as first used in 1940)
PLACEHOLDER_YEARS = {1940, 1946, 1994}

to3301 = Transformer.from_crs(4326, 3301, always_xy=True)


def write_gz(path, data):
    """Binary payloads ship gzip-compressed (.binz) and are inflated in the browser."""
    path = path.with_suffix(".binz")
    path.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    return path


def local(e, n):
    return e - CX, -(n - CY)


def rng_for(seed):
    return np.random.default_rng(seed & 0xFFFFFFFF)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


# ---------------------------------------------------------------- palettes
WALL_OLD = [hex_rgb(c) for c in [
    "#f3e6c9", "#f2d38c", "#ebb9a3", "#dcc4a6", "#cdd8bb", "#f4f1ea",
    "#e8c896", "#bdd2da", "#eeaa98", "#f0dcb4", "#d9b98f", "#e6d3c3",
]]
# weighted roughly like Tallinn's roofscape: mostly clay tiles, some slate/metal and brown tiles
ROOF_OLD = [hex_rgb(c) for c in [
    "#b5523a", "#c0633f", "#a8472f", "#b85a3c", "#c27a5a", "#a5402f", "#b4573d", "#c86f48",
    "#9c4f3b", "#7f4a3a", "#56595e", "#61656a", "#4b4f55", "#6b4a3c",
]]
ROOF_FLAT = hex_rgb("#8e8a86")
SPIRE = [hex_rgb("#3f6a5c"), hex_rgb("#35574d"), hex_rgb("#3b3d42")]
WALL_CTX = [hex_rgb(c) for c in ["#e9e4dc", "#e2ddd5", "#eeeae3", "#dcd7cf"]]
ROOF_CTX = [hex_rgb(c) for c in ["#b8b3ad", "#aaa59f", "#c3beb7"]]
WALL_STONE = hex_rgb("#d8cdb8")
WALL_STONE_TOP = hex_rgb("#c9bca4")

# Per-landmark colour overrides (by landmark id) applied to the matched buildings
LANDMARK_STYLE = {
    "toompealoss": {"wall": "#eaa6a0"},
    "nevski": {"wall": "#efe3d6", "spire": "#2f3034"},
    "oleviste": {"wall": "#cfc3ae", "spire": "#3d5f55"},
    "raekoda": {"wall": "#d6cbb5", "spire": "#3d5f55"},
    "niguliste": {"wall": "#dcd2c0", "spire": "#3d6b5e"},
    "toomkirik": {"wall": "#f1ece2", "spire": "#2f3337"},
    "puhavaimu": {"wall": "#f4f0e8", "spire": "#3d5f55"},
    "margareeta": {"wall": "#d8cdb8"},
    "kiek": {"wall": "#d8cdb8"},
    "pikkhermann": {"wall": "#d8cdb8"},
}


# ---------------------------------------------------------------- OSM
def load_osm():
    d = json.load(open(RAW / "osm" / "oldtown.json"))
    return d["elements"]


def osm_lines(el):
    """Return list of coordinate arrays (EPSG:3301) for a way/relation."""
    out = []
    if el["type"] == "way" and "geometry" in el:
        out.append([(p["lon"], p["lat"]) for p in el["geometry"]])
    elif el["type"] == "relation":
        for m in el.get("members", []):
            if m.get("geometry") and m.get("role", "outer") in ("outer", "", "inner"):
                out.append(([(p["lon"], p["lat"]) for p in m["geometry"] if p], m.get("role")))
        return [(np.array(to3301.transform(*zip(*c))).T, r) for c, r in out if len(c) > 1]
    return [(np.array(to3301.transform(*zip(*c))).T, "outer") for c in out if len(c) > 1]


def osm_polygon(el):
    rings = osm_lines(el)
    if el["type"] == "relation":
        # member ways are fragments; stitch them into rings
        from shapely.ops import polygonize, linemerge

        def stitch(parts):
            if not parts:
                return []
            m = linemerge([LineString(r) for r in parts])
            return list(polygonize(list(getattr(m, "geoms", [m]))))
        polys = stitch([r for r, role in rings if role != "inner"])
        holes = stitch([r for r, role in rings if role == "inner"])
        if not polys:
            return None
        g = unary_union(polys)
        if holes:
            g = g.difference(unary_union(holes))
        return g
    outers = [r for r, role in rings if len(r) >= 4]
    if outers and np.allclose(outers[0][0], outers[0][-1]):
        p = Polygon(outers[0])
        return p if p.is_valid else p.buffer(0)
    return None


def osm_point(el):
    if el["type"] == "node":
        return np.array(to3301.transform(el["lon"], el["lat"]))
    g = osm_polygon(el)
    if g is not None and not g.is_empty:
        c = g.representative_point() if not g.centroid.within(g) else g.centroid
        return np.array([c.x, c.y])
    b = el["bounds"]
    return np.array(to3301.transform((b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2))


def oldtown_polygon():
    d = json.load(open(RAW / "osm" / "vanalinn.json"))
    return osm_polygon(d["elements"][0])


# ---------------------------------------------------------------- terrain
class Terrain:
    def __init__(self):
        with rasterio.open(RAW / "dem" / "63843_dtm_1m.tif") as r:
            self.a = r.read(1).astype(np.float64)
            self.t = r.transform
            nod = r.nodata
        self.a[self.a == nod] = np.nan
        if np.isnan(self.a).any():
            self.a = np.where(np.isnan(self.a), np.nanmedian(self.a), self.a)
        # light smoothing for a stylised, soft relief
        from numpy.lib.stride_tricks import sliding_window_view
        k = 3
        p = np.pad(self.a, k // 2, mode="edge")
        self.s = sliding_window_view(p, (k, k)).mean(axis=(2, 3))

    def h(self, e, n, smooth=True):
        a = self.s if smooth else self.a
        col = (np.asarray(e) - self.t.c) / self.t.a - 0.5
        row = (np.asarray(n) - self.t.f) / self.t.e - 0.5
        c0 = np.clip(np.floor(col).astype(int), 0, a.shape[1] - 2)
        r0 = np.clip(np.floor(row).astype(int), 0, a.shape[0] - 2)
        fc = np.clip(col - c0, 0, 1)
        fr = np.clip(row - r0, 0, 1)
        v = (a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr)
             + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr)
        return v


def build_terrain(T):
    nx = int(round((E1 - E0) / TERRAIN_STEP)) + 1
    nz = int(round((N1 - N0) / TERRAIN_STEP)) + 1
    es = np.linspace(E0, E1, nx)
    ns = np.linspace(N1, N0, nz)  # row 0 = north (z negative)
    EE, NN = np.meshgrid(es, ns)
    H = T.h(EE, NN).astype(np.float32)
    write_gz(OUT / "terrain.bin", H.tobytes())
    meta = {"nx": nx, "nz": nz, "width": E1 - E0, "depth": N1 - N0,
            "minH": float(H.min()), "maxH": float(H.max()), "baseY": BASE_Y}
    json.dump(meta, open(OUT / "terrain.json", "w"))
    print(f"terrain {nx}x{nz}, h {H.min():.1f}..{H.max():.1f}")


# ---------------------------------------------------------------- mesh writer
class Mesh:
    def __init__(self):
        self.pos, self.col, self.bid, self.idx = [], [], [], []
        self.n = 0

    def add_poly(self, pts3, rgb, bid, holes=()):
        """pts3: (k,3) local coords (x,y,z) planar polygon; holes: list of (m,3)."""
        rings = [pts3] + list(holes)
        allp = np.vstack(rings)
        # Newell normal
        nrm = np.zeros(3)
        for i in range(len(pts3)):
            a, b = pts3[i], pts3[(i + 1) % len(pts3)]
            nrm += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
        ax = int(np.argmax(np.abs(nrm)))
        keep = [i for i in range(3) if i != ax]
        p2 = allp[:, keep]
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        tri = earcut.triangulate_float64(p2, ends)
        if len(tri) == 0:
            return 0
        self.pos.append(allp)
        self.col.append(np.tile(np.clip(rgb, 0, 255), (len(allp), 1)))
        self.bid.append(np.full(len(allp), bid))
        self.idx.append(tri.astype(np.uint32) + self.n)
        self.n += len(allp)
        return len(tri) // 3

    def write(self, path):
        # positions quantised to int16 at POS_SCALE steps per metre (~3 cm), enough for +-1 km
        pos = np.vstack(self.pos)
        assert np.abs(pos).max() * POS_SCALE < 32767
        pos = np.round(pos * POS_SCALE).astype(np.int16)
        col = np.vstack(self.col).astype(np.uint8)
        bid = np.concatenate(self.bid).astype(np.uint16)
        idx = np.concatenate(self.idx).astype(np.uint32)
        header = np.array([len(pos), len(idx), POS_SCALE], dtype=np.uint32)
        parts = [header.tobytes(), pos.tobytes(), b"\0" * (pos.nbytes % 4),
                 col.tobytes(), b"\0" * (-col.nbytes % 4),
                 bid.tobytes(), b"\0" * (-bid.nbytes % 4), idx.tobytes()]
        path = write_gz(path, b"".join(parts))
        print(f"{path.name}: {len(pos)} verts, {len(idx)//3} tris, {path.stat().st_size/1e6:.1f} MB")


def jitter(rgb, r, amt=0.05):
    return rgb * (1 + r.uniform(-amt, amt))


# ---------------------------------------------------------------- buildings
def build_buildings(T, oldtown, landmarks):
    meta, fids, geom, fields = pyogrio.raw.read(
        RAW / "gdb" / "hooned_lod2-Tallinn.gdb", bbox=(E0, N0, E1, N1), return_fids=True)
    f = dict(zip(meta["fields"], fields))
    gs = from_wkb(geom)
    # landmark lookup: which building does each landmark sit in / nearest
    fps = [force_2d(g).buffer(0.05).buffer(0) for g in gs]
    tree = STRtree(fps)
    lm_by_bid = {}
    for lm in landmarks:
        p = Point(lm["_e"], lm["_n"])
        poly = lm.get("_poly")
        hits = []
        if poly is not None and poly.geom_type in ("Polygon", "MultiPolygon"):
            for i in tree.query(poly, predicate="intersects"):
                inter = fps[i].intersection(poly).area
                if inter > 0.5 * fps[i].area:
                    hits.append(int(i))
        if not hits:
            hits = [int(i) for i in tree.query(p, predicate="intersects")]
        if not hits:
            j = tree.nearest(p)
            if fps[j].distance(p) < 15:
                hits = [int(j)]
        lm["_bids"] = hits
        for i in hits:
            lm_by_bid.setdefault(i, lm["id"])

    # landmarks with hand-built models replace their LOD2 buildings
    custom = {}
    for lm in landmarks:
        if lm["id"] in CUSTOM and lm.get("_poly") is not None:
            for k, i in enumerate(lm["_bids"]):
                custom[i] = lm if k == 0 else None

    mesh = Mesh()
    blds = []
    kept = 0
    for i, g in enumerate(gs):
        fp = fps[i]
        c = fp.centroid
        if not (E0 + 5 < c.x < E1 - 5 and N0 + 5 < c.y < N1 - 5):
            continue
        if i in custom:
            lm = custom[i]
            if lm is None:
                continue
            bid = len(blds)

            def emit(pts, rgb, bid=bid):
                x, z = local(pts[:, 0], pts[:, 1])
                mesh.add_poly(np.column_stack([x, pts[:, 2], z]), rgb, bid)
            ground = float(T.h(c.x, c.y, smooth=False))
            top = CUSTOM[lm["id"]](lm["_poly"], lambda e, n: T.h(e, n, smooth=False), emit)
            lm["_top"] = (lm["_e"], lm["_n"], top)
            tx, tz = local(c.x, c.y)
            blds.append({"addr": f["ads_lahiaadress"][i] or None, "h": round(top - ground, 1),
                         "top": [round(tx, 1), round(top, 1), round(tz, 1)], "old": True, "lm": lm["id"], "_src": i})
            continue
        r = rng_for(int(f["etak_id"][i]) * 2654435761 if f["etak_id"][i] else i * 7919)
        zmin, zmax = float(f["z_min"][i]), float(f["z_max"][i])
        ground = float(T.h(c.x, c.y, smooth=False))
        old = oldtown.contains(c)
        lm_id = lm_by_bid.get(i)
        style = LANDMARK_STYLE.get(lm_id, {})
        if old:
            wall = hex_rgb(style["wall"]) if "wall" in style else jitter(WALL_OLD[r.integers(len(WALL_OLD))], r, 0.03)
            roof = ROOF_OLD[r.integers(len(ROOF_OLD))]
        else:
            wall = jitter(WALL_CTX[r.integers(len(WALL_CTX))], r, 0.02)
            roof = ROOF_CTX[r.integers(len(ROOF_CTX))]
        spire = hex_rgb(style["spire"]) if "spire" in style else SPIRE[r.integers(len(SPIRE))]
        bid = len(blds)
        ntri = 0
        for face in g.geoms:
            ext = np.asarray(face.exterior.coords)[:-1]
            if len(ext) < 3:
                continue
            holes = [np.asarray(h.coords)[:-1] for h in face.interiors]
            # Newell normal; classification ignores orientation since LOD2 winding is not guaranteed
            nw = np.zeros(3)
            for k in range(len(ext)):
                a, b = ext[k], ext[(k + 1) % len(ext)]
                nw += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
            ln = np.linalg.norm(nw)
            if ln < 1e-9:
                continue
            nz = abs(nw[2]) / ln
            fz = ext[:, 2]
            if nz > 0.3 and fz.max() < zmin + 0.4:
                continue  # floor
            if nz < 0.3:
                rgb = wall
                # slight darkening of lower storeys reads like a plinth
            else:
                slope = math.degrees(math.acos(min(1, nz)))
                if old and fz.mean() - ground > 32 and slope > 50:
                    rgb = spire
                elif slope < 8:
                    rgb = ROOF_FLAT if not old else roof * 0.85 + ROOF_FLAT * 0.15
                else:
                    rgb = roof
            if old and nz >= 0.3 and lm_id and "spire" in style and fz.mean() - ground > 20 and nz < 0.75:
                rgb = spire

            def tl(a):
                x, z = local(a[:, 0], a[:, 1])
                return np.column_stack([x, a[:, 2], z])
            ntri += mesh.add_poly(tl(ext), rgb, bid, [tl(h) for h in holes if len(h) >= 3])
        if ntri == 0:
            continue
        kept += 1
        topx, topz = local(c.x, c.y)
        blds.append({
            "addr": f["ads_lahiaadress"][i] or None,
            "h": round(zmax - ground, 1),
            "top": [round(topx, 1), round(zmax, 1), round(topz, 1)],
            "old": bool(old),
            "lm": lm_id,
            "_src": i,
        })
    mesh.write(OUT / "buildings.bin")
    return blds, gs, fps


def attach_osm_names(blds, fps, elements):
    named = []
    for el in elements:
        t = el.get("tags", {})
        if "building" in t and "name" in t and el["type"] in ("way", "relation"):
            g = osm_polygon(el)
            if g is not None and not g.is_empty:
                named.append((g, t))
    for b in blds:
        fp = fps[b["_src"]]
        c = fp.representative_point()
        for g, t in named:
            if g.contains(c):
                b["name"] = {"et": t.get("name"), "en": t.get("name:en"), "ru": t.get("name:ru")}
                break


# ---------------------------------------------------------------- city walls
def build_walls(T, elements, fps):
    mesh = Mesh()
    tree = STRtree(fps)
    total = 0
    for el in elements:
        t = el.get("tags", {})
        if t.get("barrier") != "city_wall" or el["type"] != "way":
            continue
        pts = np.array(to3301.transform(*zip(*[(p["lon"], p["lat"]) for p in el["geometry"]]))).T
        h = float(t.get("height", "11").split()[0]) if t.get("height", "").replace(".", "").isdigit() else 11.0
        line = LineString(pts)
        L = line.length
        if L < 2:
            continue
        # resample so wall follows terrain
        n = max(2, int(L / 4) + 1)
        ds = np.linspace(0, L, n)
        P = np.array([line.interpolate(d).coords[0] for d in ds])
        base = T.h(P[:, 0], P[:, 1])
        # skip segments buried inside buildings (towers are modelled already)
        inside = np.array([len(tree.query(Point(p), predicate="intersects")) > 0 for p in P])
        w = 1.25
        for k in range(len(P) - 1):
            if inside[k] and inside[k + 1]:
                continue
            a, b = P[k], P[k + 1]
            d = b - a
            ln = np.linalg.norm(d)
            if ln < 1e-6:
                continue
            nrm = np.array([-d[1], d[0]]) / ln * w
            ya0, yb0 = base[k] - 2, base[k + 1] - 2
            ya1, yb1 = base[k] + h, base[k + 1] + h

            def L3(e, n_, y):
                x, z = local(e, n_)
                return [x, y, z]
            for s in (1, -1):
                q = [L3(*(a + s * nrm), ya0), L3(*(b + s * nrm), yb0), L3(*(b + s * nrm), yb1), L3(*(a + s * nrm), ya1)]
                total += mesh.add_poly(np.array(q), WALL_STONE, 0)
            top = [L3(*(a + nrm), ya1), L3(*(b + nrm), yb1), L3(*(b - nrm), yb1), L3(*(a - nrm), ya1)]
            total += mesh.add_poly(np.array(top), WALL_STONE_TOP, 0)
            # crenellations along the outer edge
            for s0 in np.arange(0.6, ln - 0.6, 2.6):
                fr0, fr1 = s0 / ln, min(1, (s0 + 1.3) / ln)
                m0, m1 = a + d * fr0, a + d * fr1
                y0 = ya1 + (yb1 - ya1) * fr0
                y1 = ya1 + (yb1 - ya1) * fr1
                o, i_ = nrm, nrm * 0.45
                box = [m0 + o, m1 + o, m1 + i_, m0 + i_]
                yb = [y0, y1, y1, y0]
                topq = np.array([L3(*box[j], yb[j] + 1.3) for j in range(4)])
                total += mesh.add_poly(topq, WALL_STONE_TOP, 0)
                for j in range(4):
                    p0, p1 = box[j], box[(j + 1) % 4]
                    q = np.array([L3(*p0, yb[j]), L3(*p1, yb[(j + 1) % 4]), L3(*p1, yb[(j + 1) % 4] + 1.3), L3(*p0, yb[j] + 1.3)])
                    total += mesh.add_poly(q, WALL_STONE, 0)
    mesh.write(OUT / "walls.bin")


# ---------------------------------------------------------------- ground texture
def build_ground(elements, fps, oldtown):
    S = TEX_SIZE
    sx, sy = S / (E1 - E0), S / (N1 - N0)

    def px(arr):
        return [((e - E0) * sx, (N1 - n) * sy) for e, n in arr]

    img = Image.new("RGB", (S, S), "#e4dccd")
    dr = ImageDraw.Draw(img)

    def fill(el, color):
        g = osm_polygon(el)
        if g is None or g.is_empty:
            return
        for p in getattr(g, "geoms", [g]):
            if p.geom_type != "Polygon":
                continue
            dr.polygon(px(np.asarray(p.exterior.coords)), fill=color)
            for h in p.interiors:
                dr.polygon(px(np.asarray(h.coords)), fill="#e4dccd")

    def tagged(pred):
        return [el for el in elements if el["type"] in ("way", "relation") and pred(el.get("tags", {}))]

    GREEN = {"grass": "#a9c77c", "park": "#a3c476", "garden": "#a0c274", "grassland": "#a9c77c",
             "wood": "#86ad62", "scrub": "#93b46a", "flowerbed": "#b9c97f", "village_green": "#a9c77c",
             "pitch": "#b2cd86", "playground": "#c9d39c", "meadow": "#b0cb80", "cemetery": "#a5bf7d"}
    # parking / paved landuse first
    for el in tagged(lambda t: t.get("amenity") == "parking" or t.get("landuse") in ("construction",)):
        fill(el, "#d2cdc4")
    for el in tagged(lambda t: t.get("leisure") in ("park", "garden")):
        fill(el, GREEN[t] if (t := el["tags"].get("leisure")) in GREEN else "#a3c476")
    for el in tagged(lambda t: t.get("landuse") in GREEN or t.get("natural") in GREEN or t.get("leisure") in ("pitch", "playground")):
        tg = el["tags"]
        k = tg.get("landuse") or tg.get("natural") or tg.get("leisure")
        fill(el, GREEN.get(k, "#a9c77c"))
    for el in tagged(lambda t: t.get("natural") == "water" or "water" in t or t.get("waterway") == "riverbank"):
        fill(el, "#86bcd6")
    for el in tagged(lambda t: t.get("area") == "yes" and t.get("highway") in ("pedestrian", "footway", "service")
                     or "area:highway" in t or t.get("place") == "square" or t.get("tourism") == "square"):
        fill(el, "#ddd2bf")

    widths = {"primary": 15, "primary_link": 9, "secondary": 13, "secondary_link": 8, "tertiary": 10,
              "tertiary_link": 7, "unclassified": 7, "residential": 7, "living_street": 6, "pedestrian": 6,
              "service": 4.5, "footway": 2.6, "path": 2.0, "cycleway": 2.6, "steps": 2.6, "track": 3}
    order = ["path", "footway", "cycleway", "steps", "track", "service", "living_street", "pedestrian",
             "residential", "unclassified", "tertiary_link", "tertiary", "secondary_link", "secondary",
             "primary_link", "primary"]
    ways = [el for el in elements if el["type"] == "way" and el.get("tags", {}).get("highway") in widths
            and el["tags"].get("area") != "yes"]
    ways.sort(key=lambda el: order.index(el["tags"]["highway"]))
    for el in ways:
        hw = el["tags"]["highway"]
        if el["tags"].get("tunnel") in ("yes", "building_passage") or el["tags"].get("layer", "0").startswith("-"):
            continue
        pts = np.array(to3301.transform(*zip(*[(p["lon"], p["lat"]) for p in el["geometry"]]))).T
        P = px(pts)
        mid = Point(pts[len(pts) // 2])
        major = hw in ("primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link")
        if hw in ("footway", "path", "cycleway", "steps", "track"):
            col = "#e7dbc0" if not oldtown.contains(mid) else "#d8ccb6"
        elif major and not oldtown.contains(mid):
            col = "#b4b2b0"
        else:
            col = "#cfc4b2"
        w = max(1, widths[hw] * sx)
        dr.line(P, fill=col, width=int(round(w)), joint="curve")
        r = w / 2
        for x, y in (P[0], P[-1]):
            dr.ellipse([x - r, y - r, x + r, y + r], fill=col)

    # soft contact shadow around building footprints
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    for fp in fps:
        for p in getattr(fp, "geoms", [fp]):
            if p.geom_type == "Polygon":
                md.polygon(px(np.asarray(p.exterior.coords)), fill=255)
    ao = mask.filter(ImageFilter.GaussianBlur(radius=3.5))
    dark = Image.new("RGB", (S, S), "#6f6556")
    img = Image.composite(dark, img, ao.point(lambda v: int(v * 0.45)))
    img.save(OUT / "ground.jpg", quality=86, optimize=True, progressive=True)
    print(f"ground.jpg {(OUT / 'ground.jpg').stat().st_size/1e6:.1f} MB")


# ---------------------------------------------------------------- trees
def build_trees(T, elements, fps):
    tree = STRtree(fps)
    pts = []
    for el in elements:
        t = el.get("tags", {})
        if el["type"] == "node" and t.get("natural") == "tree":
            pts.append(to3301.transform(el["lon"], el["lat"]))
        elif el["type"] == "way" and t.get("natural") == "tree_row":
            line = LineString(np.array(to3301.transform(*zip(*[(p["lon"], p["lat"]) for p in el["geometry"]]))).T)
            for d in np.arange(0, line.length, 7):
                pts.append(line.interpolate(d).coords[0])
    pts = np.array(pts)
    m = (pts[:, 0] > E0 + 3) & (pts[:, 0] < E1 - 3) & (pts[:, 1] > N0 + 3) & (pts[:, 1] < N1 - 3)
    pts = pts[m]
    pts = np.array([p for p in pts if not len(tree.query(Point(p), predicate="intersects"))])
    y = T.h(pts[:, 0], pts[:, 1])
    x, z = local(pts[:, 0], pts[:, 1])
    r = rng_for(42)
    scale = r.uniform(0.75, 1.3, len(x))
    kind = r.integers(0, 3, len(x)).astype(np.float32)
    arr = np.column_stack([x, y, z, scale, kind]).astype(np.float32)
    write_gz(OUT / "trees.bin", arr.tobytes())
    print(f"trees: {len(arr)}")


# ---------------------------------------------------------------- landmarks
def resolve_landmarks(elements):
    src = json.load(open(ROOT / "tools" / "landmarks_src.json"))
    by_ref = {f"{el['type']}/{el['id']}": el for el in elements}
    extra = json.load(open(RAW / "osm" / "vanalinn.json"))["elements"]
    for lm in src:
        el = by_ref.get(lm["osm"])
        if el is None:
            print("MISSING landmark", lm["id"], lm["osm"], file=sys.stderr)
            continue
        e, n = osm_point(el)
        lm["_e"], lm["_n"] = float(e), float(n)
        lm["_poly"] = osm_polygon(el) if el["type"] != "node" else None
    return [lm for lm in src if "_e" in lm]


def finish_landmarks(landmarks, blds, T, gs, fps):
    out = []
    by_src = {b["_src"]: k for k, b in enumerate(blds)}
    for lm in landmarks:
        ground = float(T.h(lm["_e"], lm["_n"], smooth=False))
        x, z = local(lm["_e"], lm["_n"])
        top = ground + 2
        bids = [by_src[i] for i in lm.get("_bids", []) if i in by_src]
        if "_top" in lm:
            x, z = local(lm["_top"][0], lm["_top"][1])
            top = lm["_top"][2]
        elif lm["cat"] not in ("square", "view") and bids:
            # anchor on highest vertex of the matched buildings
            best = None
            for i in lm["_bids"]:
                g = gs[i]
                for face in g.geoms:
                    a = np.asarray(face.exterior.coords)
                    k = int(np.argmax(a[:, 2]))
                    if best is None or a[k, 2] > best[2]:
                        best = a[k]
            if best is not None:
                x, z = local(best[0], best[1])
                top = float(best[2])
        out.append({
            "id": lm["id"], "cat": lm["cat"], "year": lm["year"], "name": lm["name"], "text": lm["text"],
            "anchor": [round(float(x), 1), round(top + 3, 1), round(float(z), 1)],
            "ground": round(ground, 1), "buildings": bids,
        })
    json.dump(out, open(OUT / "landmarks.json", "w"), ensure_ascii=False, indent=1)
    print(f"landmarks: {len(out)}")


def attach_years(blds, fields_ehr, landmarks):
    """First-use year per building from the Building Register (tools/fetch_ehr_years.py).

    Landmarks use their curated date instead: a plain year (e.g. 1900 for Nevsky) is used as-is,
    anything older or vaguer ("13th c.") means the building predates every historical map.
    """
    f = RAW / "hist" / "ehr_years.json"
    years = json.load(open(f)) if f.exists() else {}
    lm_year = {lm["id"]: lm["year"] for lm in landmarks}
    for b in blds:
        if b.get("lm"):
            y = lm_year.get(b["lm"], "")
            b["y"] = int(y) if y.isdigit() and int(y) > 1800 else None
        elif b["old"]:
            # inside the Old Town the register often records restoration dates as "first use";
            # never risk erasing a medieval house, so these are always shown
            b["y"] = None
        else:
            y = years.get(fields_ehr[b["_src"]] or "")
            b["y"] = None if y in PLACEHOLDER_YEARS else y
        if b["y"] is None:
            b.pop("y")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    T = Terrain()
    elements = load_osm()
    oldtown = oldtown_polygon()
    build_terrain(T)
    landmarks = resolve_landmarks(elements)
    blds, gs, fps = build_buildings(T, oldtown, landmarks)
    attach_osm_names(blds, fps, elements)
    _, _, _, ehr = pyogrio.raw.read(RAW / "gdb" / "hooned_lod2-Tallinn.gdb", bbox=(E0, N0, E1, N1), columns=["ehr_gid"])
    attach_years(blds, ehr[0], landmarks)
    finish_landmarks(landmarks, blds, T, gs, fps)
    for b in blds:
        b.pop("_src", None)
    json.dump({"bounds": [E0, N0, E1, N1], "center": [CX, CY], "buildings": blds},
              open(OUT / "buildings.json", "w"), ensure_ascii=False, separators=(",", ":"))
    build_walls(T, elements, fps)
    build_trees(T, elements, fps)
    build_ground(elements, fps, oldtown)
    # Old Town outline (local coords) for the minimap / UI
    ring = oldtown.exterior if oldtown.geom_type == "Polygon" else max(oldtown.geoms, key=lambda p: p.area).exterior
    xs, zs = local(*np.asarray(ring.coords).T)
    json.dump([[round(a, 1), round(b, 1)] for a, b in zip(xs, zs)], open(OUT / "oldtown.json", "w"))


if __name__ == "__main__":
    main()
