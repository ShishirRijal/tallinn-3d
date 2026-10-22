import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// relative to the page so the app works from a subpath such as GitHub Pages
const DATA = import.meta.env.BASE_URL + 'data/';
const FLAG_W = 1024;

// Per-building flags read in the shader.
// R: interaction state (0 none, 1 hover, 2 selected landmark); G: 1 = no procedural windows
export class BuildingFlags {
  constructor(count) {
    this.h = Math.ceil(Math.max(count, 1) / FLAG_W);
    this.data = new Uint8Array(FLAG_W * this.h * 2);
    this.tex = new THREE.DataTexture(this.data, FLAG_W, this.h, THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.needsUpdate = true;
  }
  get(i) {
    return this.data[i * 2];
  }
  set(ids, v) {
    for (const i of ids) this.data[i * 2] = v;
    this.tex.needsUpdate = true;
  }
  setStatic(ids, v) {
    for (const i of ids) this.data[i * 2 + 1] = v;
    this.tex.needsUpdate = true;
  }
  clear(v) {
    for (let i = 0; i < this.data.length; i += 2) if (this.data[i] === v) this.data[i] = 0;
    this.tex.needsUpdate = true;
  }
}

async function fetchProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) {
    const b = await res.arrayBuffer();
    onBytes(b.byteLength, b.byteLength);
    return b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

const align4 = (o) => (o + 3) & ~3;

function parseMesh(buf) {
  const [nv, ni, scale] = new Uint32Array(buf, 0, 3);
  let o = 12;
  const pos = new Int16Array(buf, o, nv * 3); o = align4(o + nv * 6);
  const col = new Uint8Array(buf, o, nv * 3); o = align4(o + nv * 3);
  const bid = new Uint16Array(buf, o, nv); o = align4(o + nv * 2);
  const idx = new Uint32Array(buf, o, ni);

  // vertex colours are authored in sRGB; three.js expects linear
  const lut = new Uint8Array(256);
  const c = new THREE.Color();
  for (let i = 0; i < 256; i++) {
    c.setRGB(i / 255, i / 255, i / 255, THREE.SRGBColorSpace);
    lut[i] = Math.round(c.r * 255);
  }
  const lin = new Uint8Array(col.length);
  for (let i = 0; i < col.length; i++) lin[i] = lut[col[i]];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(lin, 3, true));
  g.setAttribute('bid', new THREE.BufferAttribute(bid, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return { geometry: g, scale };
}

function patchFlags(material, flags, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlags = { value: flags.tex };
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uSepia = uniforms.uSepia;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float bid;
        uniform sampler2D uFlags;
        varying vec2 vFlag;
        varying vec3 vWorld;
        varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlag = texelFetch(uFlags, ivec2(int(mod(bid, ${FLAG_W}.0)), int(bid / ${FLAG_W}.0)), 0).rg * 255.0;
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vObjN = objectNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFlag;
        varying vec3 vWorld;
        varying vec3 vObjN;
        uniform float uTime;
        uniform float uNight;
        uniform float uSepia;
        float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // procedural windows on vertical faces: a grid along the wall, some cells blank
        float win = 0.0, lit = 0.0;
        vec3 nrm = normalize(vObjN);
        if (vFlag.y < 0.5 && abs(nrm.y) < 0.2) {
          vec2 n2 = normalize(nrm.xz);
          float u = dot(vWorld.xz, vec2(-n2.y, n2.x));
          vec2 cell = vec2(u / 3.1, (vWorld.y + 0.8) / 3.3);
          vec2 f = fract(cell), id = floor(cell);
          float h = hash12(id + floor(vWorld.xz / 40.0));
          float aa = clamp(1.6 - max(fwidth(cell.x), fwidth(cell.y)) * 5.0, 0.0, 1.0);
          win = step(0.33, f.x) * step(f.x, 0.67) * step(0.28, f.y) * step(f.y, 0.78) * step(0.14, h) * aa;
          lit = win * step(0.48, fract(h * 7.31));
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.46, 0.48, 0.55), win * 0.8);
        // historical eras: buildings turn into a paper-model tone that sits on the old maps
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.52, 0.40) * (0.55 + lum * 0.9), uSepia * 0.85);
        if (vFlag.x > 1.5) {
          diffuseColor.rgb *= 1.08;
        } else if (vFlag.x > 0.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), 0.3);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.68, 0.32) * lit * uNight * 1.6;
        if (vFlag.x > 1.5) totalEmissiveRadiance += diffuseColor.rgb * (0.10 + 0.08 * sin(uTime * 2.6)) + vec3(0.05, 0.03, 0.0);`);
  };
}

function limestoneTexture() {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const ctx = cv.getContext('2d');
  const bands = ['#7a6a52', '#a99877', '#c8b997', '#b7a682', '#d5c8a8', '#a6916d', '#c3b28d', '#94815f', '#bba985', '#857254'];
  let y = 0, k = 0;
  // topsoil
  ctx.fillStyle = '#6d5a43'; ctx.fillRect(0, 0, 4, 14); y = 14;
  while (y < 256) {
    const h = 10 + ((k * 37) % 23);
    ctx.fillStyle = bands[k % bands.length];
    ctx.fillRect(0, y, 4, h);
    y += h; k++;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildTerrain(meta, heights, groundTex) {
  const { nx, nz, width, depth, baseY } = meta;
  const g = new THREE.PlaneGeometry(width, depth, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heights[i]);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 });
  const terrain = new THREE.Mesh(g, mat);
  terrain.receiveShadow = true;
  terrain.name = 'terrain';

  // limestone skirt around the diorama block
  const hx = width / 2, hz = depth / 2;
  const edge = [];
  for (let i = 0; i < nx; i++) edge.push([i, 0]);
  for (let j = 1; j < nz; j++) edge.push([nx - 1, j]);
  for (let i = nx - 2; i >= 0; i--) edge.push([i, nz - 1]);
  for (let j = nz - 2; j >= 1; j--) edge.push([0, j]);
  edge.push(edge[0]);
  const pos = [], uv = [];
  const vmax = meta.maxH - baseY;
  for (let k = 0; k < edge.length - 1; k++) {
    const [i0, j0] = edge[k], [i1, j1] = edge[k + 1];
    const x0 = -hx + (i0 / (nx - 1)) * width, z0 = -hz + (j0 / (nz - 1)) * depth;
    const x1 = -hx + (i1 / (nx - 1)) * width, z1 = -hz + (j1 / (nz - 1)) * depth;
    const y0 = heights[j0 * nx + i0], y1 = heights[j1 * nx + i1];
    // top edge follows terrain; v measured downward from the ground surface
    pos.push(x0, y0, z0, x0, baseY, z0, x1, y1, z1, x1, y1, z1, x0, baseY, z0, x1, baseY, z1);
    const d0 = (y0 - baseY) / vmax, d1 = (y1 - baseY) / vmax;
    uv.push(0.5, 1, 0.5, 1 - d0, 0.5, 1, 0.5, 1, 0.5, 1 - d0, 0.5, 1 - d1);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.computeVertexNormals();
  const skirt = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: limestoneTexture(), roughness: 1, side: THREE.DoubleSide }));
  skirt.receiveShadow = true;

  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ color: 0x6b5a45 }));
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = baseY;

  // soft contact shadow under the block
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(70,50,30,0.35)');
  grd.addColorStop(1, 'rgba(70,50,30,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, depth * 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = baseY - 30;

  const group = new THREE.Group();
  group.add(terrain, skirt, bottom, shadow);
  return { group, terrain };
}

function buildTrees(buf) {
  const a = new Float32Array(buf);
  const n = a.length / 5;
  const round = new THREE.IcosahedronGeometry(1, 0);
  const cone = new THREE.ConeGeometry(1, 1, 7);
  cone.translate(0, 0.5, 0);
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 1, 5);
  trunk.translate(0, 0.5, 0);
  const counts = [0, 0];
  for (let i = 0; i < n; i++) counts[a[i * 5 + 4] === 2 ? 1 : 0]++;
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const roundMesh = new THREE.InstancedMesh(round, leafMat, counts[0]);
  const coneMesh = new THREE.InstancedMesh(cone, leafMat, counts[1]);
  const trunkMesh = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x7a5a3f, roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const greens = ['#6f9a4c', '#7aa556', '#5f8c45', '#86ad5c', '#668f49'];
  const firs = ['#4a7a4b', '#3f6d47', '#527f50'];
  let ri = 0, ci = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i * 5], y = a[i * 5 + 1], z = a[i * 5 + 2], sc = a[i * 5 + 3], kind = a[i * 5 + 4];
    const rot = (i * 2.399) % (Math.PI * 2);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    if (kind === 2) {
      p.set(x, y + 1.6 * sc, z); s.set(2.6 * sc, 9 * sc, 2.6 * sc);
      coneMesh.setMatrixAt(ci, m.compose(p, q, s));
      coneMesh.setColorAt(ci++, col.set(firs[i % firs.length]));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, 2 * sc, sc));
    } else {
      const tall = kind === 1 ? 1.25 : 1;
      p.set(x, y + 5.2 * sc * tall, z); s.set(3.4 * sc, 3.6 * sc * tall, 3.4 * sc);
      roundMesh.setMatrixAt(ri, m.compose(p, q, s));
      roundMesh.setColorAt(ri++, col.set(greens[i % greens.length]));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, 3.4 * sc * tall, sc));
    }
    trunkMesh.setMatrixAt(i, m);
  }
  const g = new THREE.Group();
  for (const im of [roundMesh, coneMesh, trunkMesh]) {
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

export async function loadWorld(onProgress) {
  const files = ['buildings.bin', 'walls.bin', 'terrain.bin', 'trees.bin'];
  const progress = Object.fromEntries(files.map((f) => [f, [0, 1]]));
  const report = () => {
    let a = 0, b = 0;
    for (const [g, t] of Object.values(progress)) { a += g; b += t; }
    onProgress(a / b);
  };
  // binaries ship gzip-compressed as .binz so any static host serves them small
  const bin = (f) => fetchProgress(DATA + f + 'z', (g, t) => { progress[f] = [g, t]; report(); })
    .then((buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const json = (f) => fetch(DATA + f).then((r) => r.json());
  const tex = new Promise((res, rej) => new THREE.TextureLoader().load(DATA + 'ground.jpg', res, undefined, rej));

  const [bBuf, wBuf, tBuf, trBuf, bMeta, tMeta, landmarks, oldtown, groundTex] = await Promise.all([
    bin('buildings.bin'), bin('walls.bin'), bin('terrain.bin'), bin('trees.bin'),
    json('buildings.json'), json('terrain.json'), json('landmarks.json'), json('oldtown.json'), tex,
  ]);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 8;

  const uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uSepia: { value: 0 } };
  const flags = new BuildingFlags(bMeta.buildings.length);
  // landmarks keep their own facades (big church windows, hand-built models)
  flags.setStatic(bMeta.buildings.flatMap((b, i) => (b.lm ? [i] : [])), 1);

  const b = parseMesh(bBuf);
  const bMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  patchFlags(bMat, flags, uniforms);
  const buildings = new THREE.Mesh(b.geometry, bMat);
  buildings.scale.setScalar(1 / b.scale);
  buildings.castShadow = buildings.receiveShadow = true;
  b.geometry.computeBoundsTree();

  // Per-era index buffers: drop triangles of buildings first used after the era's year.
  // Buildings with no recorded year are treated as old and always shown.
  const fullIndex = b.geometry.index;
  const bidAttr = b.geometry.attributes.bid.array;
  const years = bMeta.buildings.map((bb) => bb.y || 0);
  const eraCache = new Map();
  const setEraYear = (year) => {
    if (!eraCache.has(year)) {
      if (year >= 9999) eraCache.set(year, { index: fullIndex, bvh: b.geometry.boundsTree });
      else {
        const src = fullIndex.array;
        const out = new Uint32Array(src.length);
        let n = 0;
        for (let i = 0; i < src.length; i += 3) {
          const y = years[bidAttr[src[i]]];
          if (y && y > year) continue;
          out[n++] = src[i]; out[n++] = src[i + 1]; out[n++] = src[i + 2];
        }
        b.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
        b.geometry.computeBoundsTree();
        eraCache.set(year, { index: b.geometry.index, bvh: b.geometry.boundsTree });
      }
    }
    const e = eraCache.get(year);
    b.geometry.setIndex(e.index);
    b.geometry.boundsTree = e.bvh;
  };
  const isVisibleIn = (bid, year) => !(years[bid] && years[bid] > year);

  const w = parseMesh(wBuf);
  const walls = new THREE.Mesh(w.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  walls.scale.setScalar(1 / w.scale);
  walls.castShadow = walls.receiveShadow = true;

  const heights = new Float32Array(tBuf);
  const { group: terrainGroup, terrain } = buildTerrain(tMeta, heights, groundTex);
  const trees = buildTrees(trBuf);

  const root = new THREE.Group();
  root.add(terrainGroup, buildings, walls, trees);

  const heightAt = (x, z) => {
    const { nx, nz, width, depth } = tMeta;
    const fx = THREE.MathUtils.clamp((x + width / 2) / width * (nx - 1), 0, nx - 1.001);
    const fz = THREE.MathUtils.clamp((z + depth / 2) / depth * (nz - 1), 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = (ii, jj) => heights[jj * nx + ii];
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };

  // historical map drapes, loaded on first use
  const texLoader = new THREE.TextureLoader();
  const mapCache = new Map();
  const loadMap = (path) => {
    if (!mapCache.has(path)) {
      mapCache.set(path, new Promise((res, rej) => texLoader.load(DATA + path, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        res(t);
      }, undefined, rej)));
    }
    return mapCache.get(path);
  };
  const setGround = (tex) => {
    terrain.material.map = tex || groundTex;
    terrain.material.needsUpdate = true;
  };

  return {
    root, buildings, terrain, trees, flags, uniforms, meta: bMeta, terrainMeta: tMeta, landmarks, oldtown, heightAt,
    setEraYear, isVisibleIn, loadMap, setGround,
  };
}
