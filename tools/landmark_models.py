"""Hand-built procedural models for landmarks that the automatic LOD2 data gets wrong.

Each builder receives the landmark's OSM footprint (EPSG:3301), the terrain sampler and an
`emit(points_xyz_3301, rgb)` callback taking planar polygons as (k,3) arrays of
(easting, northing, height).
"""

import math

import numpy as np
from shapely import Polygon


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


STONE = hex_rgb("#d3ccbb")
STONE_DARK = hex_rgb("#bdb4a1")
OPENING = hex_rgb("#4a3f37")
ROOF_DARK = hex_rgb("#55504b")
COPPER = hex_rgb("#3e6457")
GOLD = hex_rgb("#c9a240")


# ---------------------------------------------------------------- primitives
def quad(emit, a, b, y0a, y0b, y1a, y1b, rgb):
    emit(np.array([[*a, y0a], [*b, y0b], [*b, y1b], [*a, y1a]]), rgb)


def prism(emit, ring, y0, y1, rgb, cap=True, cap_rgb=None):
    ring = np.asarray(ring)
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        quad(emit, a, b, y0, y0, y1, y1, rgb)
    if cap:
        emit(np.column_stack([ring, np.full(len(ring), y1)]), cap_rgb if cap_rgb is not None else rgb)


def ngon(c, r, n, rot=0.0):
    return np.array([[c[0] + r * math.cos(rot + 2 * math.pi * k / n), c[1] + r * math.sin(rot + 2 * math.pi * k / n)] for k in range(n)])


def lathe(emit, c, profile, rgb, n=8, rot=0.0):
    """profile: list of (y, r) from bottom to top; r=0 closes to a point."""
    for (y0, r0), (y1, r1) in zip(profile[:-1], profile[1:]):
        a, b = ngon(c, max(r0, 1e-3), n, rot), ngon(c, max(r1, 1e-3), n, rot)
        for k in range(n):
            k1 = (k + 1) % n
            if r1 < 1e-3:
                emit(np.array([[*a[k], y0], [*a[k1], y0], [c[0], c[1], y1]]), rgb)
            elif r0 < 1e-3:
                emit(np.array([[c[0], c[1], y0], [*b[k1], y1], [*b[k], y1]]), rgb)
            else:
                emit(np.array([[*a[k], y0], [*a[k1], y0], [*b[k1], y1], [*b[k], y1]]), rgb)


def battlements(emit, a, b, y, rgb, h=1.5, w=1.1, gap=1.1, depth=0.6, inward=None):
    """Merlons along segment a->b sitting at height y; `inward` is the unit normal into the roof."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    L = np.linalg.norm(d)
    u = d / L
    n_in = np.asarray(inward) * depth
    s = 0.3
    while s + w <= L - 0.2:
        p0, p1 = a + u * s, a + u * (s + w)
        box = [p0, p1, p1 + n_in, p0 + n_in]
        prism(emit, box, y, y + h, rgb)
        s += w + gap


# ---------------------------------------------------------------- Tallinn Town Hall
# Tower position from OSM building:part way 304670224 (onion-roofed tower top), EPSG:3301.
RAEKODA_TOWER = (542200.0 + 109.1, 6589140.0 - 113.9)


def oriented_rect(poly):
    r = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e0, e1 = r[1] - r[0], r[2] - r[1]
    if np.linalg.norm(e0) < np.linalg.norm(e1):
        r = np.roll(r, -1, axis=0)
    return r  # r[0]->r[1] is a long side


def build_raekoda(poly, terrain, emit):
    c = poly.centroid
    g = float(terrain(c.x, c.y)) - 0.5
    rect = oriented_rect(poly)
    long_u = (rect[1] - rect[0]) / np.linalg.norm(rect[1] - rect[0])
    short_v = (rect[3] - rect[0]) / np.linalg.norm(rect[3] - rect[0])
    L = np.linalg.norm(rect[1] - rect[0])
    W = np.linalg.norm(rect[3] - rect[0])
    eave = g + 15.5

    # main hall
    prism(emit, rect, g - 1.0, eave, STONE, cap=True, cap_rgb=STONE_DARK)

    # long sides: which one faces the square (north = larger northing)
    sides = [(rect[0], rect[1], short_v), (rect[3], rect[2], -short_v)]
    for a, b, inward in sides:
        out = -inward * 0.06
        facing_square = (a[1] + b[1]) / 2 > c.y
        # Gothic windows on the upper floor
        for k in range(1, int(L // 3.4)):
            p = a + long_u * (k * 3.4)
            quad(emit, p - long_u * 0.55 + out, p + long_u * 0.55 + out, g + 8.3, g + 8.3, g + 12.6, g + 12.6, OPENING)
        # open arcade on the ground floor of the square side
        if facing_square:
            n_arch = int(L // 4.2)
            for k in range(n_arch):
                p = a + long_u * ((k + 0.5) * L / n_arch)
                quad(emit, p - long_u * 1.35 + out, p + long_u * 1.35 + out, g + 0.6, g + 0.6, g + 4.4, g + 4.4, OPENING)
        battlements(emit, a, b, eave, STONE, inward=inward)
    for a, b, inward in [(rect[1], rect[2], -long_u), (rect[3], rect[0], long_u)]:
        battlements(emit, a, b, eave, STONE, inward=inward)

    # steep gabled roof behind the parapet, ridge along the long axis
    inset = 0.9
    r0 = rect[0] + long_u * inset + short_v * inset
    r1 = rect[1] - long_u * inset + short_v * inset
    r2 = rect[2] - long_u * inset - short_v * inset
    r3 = rect[3] + long_u * inset - short_v * inset
    m0, m1 = (r0 + r3) / 2, (r1 + r2) / 2
    ridge = eave + 0.4 + (W / 2 - inset) * 1.35
    y = eave + 0.4
    emit(np.array([[*r0, y], [*r1, y], [*m1, ridge], [*m0, ridge]]), ROOF_DARK)
    emit(np.array([[*r3, y], [*m0, ridge], [*m1, ridge], [*r2, y]]), ROOF_DARK)
    emit(np.array([[*r0, y], [*m0, ridge], [*r3, y]]), STONE)
    emit(np.array([[*r1, y], [*r2, y], [*m1, ridge]]), STONE)

    # tower: square shaft, octagonal upper storey, Baroque spire with onion bulbs
    t = np.array(RAEKODA_TOWER)
    sq = np.array([t + (-long_u - short_v) * 3.0, t + (long_u - short_v) * 3.0,
                   t + (long_u + short_v) * 3.0, t + (-long_u + short_v) * 3.0])
    prism(emit, sq, g, ridge + 1.0, STONE)
    rot = math.atan2(long_u[1], long_u[0]) + math.pi / 8
    oct_r = 2.85
    top = g + 33.0
    lathe(emit, t, [(ridge + 1.0, oct_r), (top, oct_r)], STONE, rot=rot)
    # belfry openings
    for k in range(8):
        ang = rot + 2 * math.pi * (k + 0.5) / 8
        p = t + np.array([math.cos(ang), math.sin(ang)]) * (oct_r * 0.93 + 0.05)
        tang = np.array([-math.sin(ang), math.cos(ang)]) * 0.55
        quad(emit, p - tang, p + tang, top - 5.5, top - 5.5, top - 2.2, top - 2.2, OPENING)
    lathe(emit, t, [(top, oct_r + 0.35), (top + 0.6, oct_r + 0.35), (top + 0.6, oct_r)], STONE_DARK, rot=rot)
    lathe(emit, t, [(top + 0.6, oct_r), (top + 2.0, 2.9), (top + 4.0, 2.5), (top + 6.0, 1.3), (top + 7.0, 0.9)], COPPER, rot=rot)
    lathe(emit, t, [(top + 7.0, 1.0), (top + 9.6, 1.0)], COPPER, rot=rot)
    lathe(emit, t, [(top + 9.6, 1.1), (top + 10.6, 1.45), (top + 12.0, 1.0), (top + 13.0, 0.4)], COPPER, rot=rot)
    lathe(emit, t, [(top + 13.0, 0.45), (top + 28.0, 0.0)], COPPER, rot=rot)
    # Old Thomas weathervane
    lathe(emit, t, [(top + 27.0, 0.12), (top + 31.0, 0.12)], GOLD, n=4)
    vane = t + long_u * 0.05
    quad(emit, vane - long_u * 0.4, vane + long_u * 0.4, top + 29.0, top + 29.0, top + 30.8, top + 30.8, GOLD)
    return top + 31.0


CUSTOM = {"raekoda": build_raekoda}
