import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { loadWorld } from './world.js';
import { I18N, CATS } from './i18n.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const isMobile = matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf4ecdd, 2600, 5200);

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 5, 9000);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 70;
controls.maxDistance = 3200;
controls.maxPolarAngle = 1.32;
controls.minPolarAngle = 0.15;
controls.zoomToCursor = true;
controls.rotateSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

const hemi = new THREE.HemisphereLight(0xdfeeff, 0xc9b28c, 1.25);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
sun.shadow.radius = 3;
scene.add(hemi, sun, sun.target);

// ------------------------------------------------------------ state
const state = {
  lang: localStorage.getItem('lang') || 'en',
  cat: 'all',
  selected: -1,
  tour: false,
  tourT: 0,
  hover: -1,
};
const TOUR_STEP = 11; // seconds per stop
let world;
let markers = [];
let selRing;
let fly = null;

function t(key) {
  return I18N[state.lang][key] ?? I18N.en[key] ?? key;
}

// ------------------------------------------------------------ camera helpers
const tmpV = new THREE.Vector3();
const sph = new THREE.Spherical();

function viewFrom(target, dist, polar, azimuth) {
  sph.set(dist, polar, azimuth);
  return new THREE.Vector3().setFromSpherical(sph).add(target);
}

function flyTo(target, dist, polar, azimuth, dur = 1.8) {
  const fromT = controls.target.clone();
  const offset = camera.position.clone().sub(controls.target);
  sph.setFromVector3(offset);
  const from = { r: sph.radius, p: sph.phi, a: sph.theta };
  let da = (azimuth ?? from.a) - from.a;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  fly = {
    t: 0, dur, fromT, toT: target.clone(),
    from, to: { r: dist ?? from.r, p: polar ?? from.p, a: from.a + da },
  };
}

function stepFly(dt) {
  if (!fly) return;
  fly.t = Math.min(1, fly.t + dt / fly.dur);
  const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
  // arc out a little on long hops so the city stays in view
  const hop = fly.fromT.distanceTo(fly.toT);
  const lift = Math.sin(Math.PI * k) * Math.min(hop * 0.6, 500);
  controls.target.lerpVectors(fly.fromT, fly.toT, k);
  const r = THREE.MathUtils.lerp(fly.from.r, fly.to.r, k) + lift;
  const p = THREE.MathUtils.lerp(fly.from.p, fly.to.p, k);
  const a = THREE.MathUtils.lerp(fly.from.a, fly.to.a, k);
  camera.position.copy(viewFrom(controls.target, r, p, a));
  if (fly.t >= 1) fly = null;
}

function homeView(dur = 2.2) {
  flyTo(new THREE.Vector3(-30, 25, 30), isMobile ? 1700 : 1250, 0.88, -0.42, dur);
}

// ------------------------------------------------------------ sun / time of day
const SKY = [
  // hour, sky top, sky bottom, sun colour, sun intensity, hemi intensity
  [5, '#9fb2c9', '#f2c9a4', '#ffb27a', 0.9, 0.75],
  [7.5, '#c6dbe6', '#f6e2c8', '#ffd9ae', 2.1, 1.05],
  [12, '#cfe2ea', '#f4ecdd', '#fff4e2', 2.7, 1.25],
  [17, '#cbdde6', '#f5e6cf', '#ffe4bd', 2.4, 1.15],
  [20, '#a9b9d0', '#f3c39b', '#ff9e66', 1.3, 0.85],
  [21.5, '#59688a', '#c9a3a0', '#ff8a5a', 0.5, 0.55],
  [23, '#16203a', '#33395a', '#9fb4e8', 0.32, 0.32],
];

function lerpColor(a, b, k) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k);
}

function setSun(hour) {
  let i = 0;
  while (i < SKY.length - 2 && hour > SKY[i + 1][0]) i++;
  const [h0, top0, bot0, sc0, si0, hi0] = SKY[i];
  const [h1, top1, bot1, sc1, si1, hi1] = SKY[i + 1];
  const k = THREE.MathUtils.clamp((hour - h0) / (h1 - h0), 0, 1);
  const top = lerpColor(top0, top1, k), bot = lerpColor(bot0, bot1, k);
  document.documentElement.style.setProperty('--sky-top', '#' + top.getHexString());
  document.documentElement.style.setProperty('--sky-bottom', '#' + bot.getHexString());
  scene.fog.color.copy(bot);
  sun.color.copy(lerpColor(sc0, sc1, k));
  sun.intensity = THREE.MathUtils.lerp(si0, si1, k);
  hemi.intensity = THREE.MathUtils.lerp(hi0, hi1, k);
  hemi.color.copy(lerpColor('#dfeeff', top.getStyle(), 0.3));
  world.uniforms.uNight.value = THREE.MathUtils.smoothstep(hour, 20.6, 22.4) + 1 - THREE.MathUtils.smoothstep(hour, 5, 6.2);
  // Tallinn, late summer: sun rises ~NE, sets ~NW, peaks ~45° in the south around 13:30 local time
  // after dusk the "sun" becomes a cool moon light from the south-east
  const dayFrac = THREE.MathUtils.clamp((hour - 5) / (22 - 5), 0, 1);
  const azimuth = THREE.MathUtils.degToRad(60 + dayFrac * 240); // compass bearing
  let elev = THREE.MathUtils.degToRad(Math.max(4, 46 * Math.sin(Math.PI * dayFrac)));
  if (hour > 22) elev = THREE.MathUtils.degToRad(4 + (hour - 22) * 30);
  sun.userData.dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elev), Math.sin(elev), -Math.cos(azimuth) * Math.cos(elev));
  const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60 / 5) * 5;
  $('#sun-time').textContent = `${String(hh + (mm === 60 ? 1 : 0)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

function updateShadowFrustum() {
  // keep the shadow map tight around what the camera is looking at
  const dist = camera.position.distanceTo(controls.target);
  const half = THREE.MathUtils.clamp(dist * 0.75, 180, 1300);
  const c = sun.shadow.camera;
  c.left = -half; c.right = half; c.top = half; c.bottom = -half;
  c.near = 10; c.far = 4000;
  c.updateProjectionMatrix();
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(sun.userData.dir, 1600);
  // snap to texel grid to avoid shimmering while panning
  const texel = (2 * half) / sun.shadow.mapSize.x;
  sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
  sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
  sun.position.x = Math.round(sun.position.x / texel) * texel;
  sun.position.z = Math.round(sun.position.z / texel) * texel;
}

// ------------------------------------------------------------ UI: i18n
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.lang));
  $('#tour-btn').querySelector('[data-i18n]').textContent = state.tour ? t('stopTour') : t('tour');
  renderChips();
  renderList();
  renderMarkers();
  renderDistricts();
  if (state.selected >= 0) renderCard();
}

function renderChips() {
  const chips = $('#chips');
  chips.innerHTML = '';
  for (const c of ['all', ...Object.keys(CATS)]) {
    const b = document.createElement('button');
    b.className = `chip cat-${c}` + (state.cat === c ? ' active' : '');
    b.innerHTML = (c === 'all' ? '' : '<i></i>') + t('cat_' + c);
    b.onclick = () => { state.cat = c; renderChips(); renderList(); applyFilter(); };
    chips.appendChild(b);
  }
}

function catOf(lm) { return lm.cat === 'view' ? 'square' : lm.cat; }
function visible(lm) { return state.cat === 'all' || catOf(lm) === state.cat; }

function renderList() {
  const ol = $('#places');
  ol.innerHTML = '';
  world.landmarks.forEach((lm, i) => {
    if (!visible(lm)) return;
    const li = document.createElement('li');
    li.className = `cat-${lm.cat}` + (i === state.selected ? ' active' : '');
    const alt = state.lang === 'et' ? lm.name.en : lm.name.et;
    li.innerHTML = `<span class="n">${i + 1}</span><span><div class="t">${lm.name[state.lang]}</div><div class="s">${alt}</div></span><span class="y">${lm.year}</span>`;
    li.onclick = () => select(i, { stopTour: true });
    ol.appendChild(li);
  });
}

function applyFilter() {
  markers.forEach((m, i) => m.el.classList.toggle('dim', !visible(world.landmarks[i])));
}

// ------------------------------------------------------------ markers
function renderMarkers() {
  const root = $('#markers');
  root.innerHTML = '';
  markers = world.landmarks.map((lm, i) => {
    const el = document.createElement('div');
    el.className = `marker cat-${lm.cat}` + (i === state.selected ? ' active' : '');
    el.innerHTML = `<div class="stem"></div><div class="pin">${i + 1}</div><div class="label">${lm.name[state.lang]}</div>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); select(i, { stopTour: true }); });
    root.appendChild(el);
    return { el, pos: new THREE.Vector3(...lm.anchor) };
  });
  applyFilter();
}

// district labels sit between the landmarks that define them
const DISTRICTS = [
  { key: 'd_toompea', near: ['toomkirik', 'toompealoss', 'nevski'] },
  { key: 'd_lower', near: ['raeplats', 'oleviste', 'puhavaimu'] },
];
let districtEls = [];
function renderDistricts() {
  const root = $('#districts');
  root.innerHTML = '';
  districtEls = DISTRICTS.map((d) => {
    const el = document.createElement('div');
    el.className = 'district';
    el.textContent = t(d.key);
    root.appendChild(el);
    const pts = world.landmarks.filter((l) => d.near.includes(l.id));
    const pos = new THREE.Vector3();
    for (const l of pts) pos.add(new THREE.Vector3(l.anchor[0], 0, l.anchor[2]));
    return { el, pos: pos.divideScalar(pts.length || 1) };
  });
}

function placeOverlays() {
  const w = innerWidth, h = innerHeight;
  const dist = camera.position.distanceTo(controls.target);
  const scale = THREE.MathUtils.clamp(900 / dist, 0.75, 1.15);
  for (const m of markers) {
    tmpV.copy(m.pos).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.2 || Math.abs(tmpV.y) > 1.2) { m.el.style.display = 'none'; continue; }
    m.el.style.display = '';
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
    m.el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    m.el.style.zIndex = String(1000 - Math.round(tmpV.z * 1000));
  }
  const showD = dist > 500 && dist < 2600;
  for (const d of districtEls) {
    tmpV.copy(d.pos);
    tmpV.y = world.heightAt(d.pos.x, d.pos.z) + 2;
    tmpV.project(camera);
    d.el.style.opacity = showD && tmpV.z < 1 ? '1' : '0';
    d.el.style.left = `${(tmpV.x * 0.5 + 0.5) * w}px`;
    d.el.style.top = `${(-tmpV.y * 0.5 + 0.5) * h}px`;
  }
}

// ------------------------------------------------------------ selection ring
function makeRing() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,214,140,0)');
  g.addColorStop(0.72, 'rgba(255,214,140,0.25)');
  g.addColorStop(0.86, 'rgba(255,196,110,0.95)');
  g.addColorStop(0.93, 'rgba(255,214,140,0.35)');
  g.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  m.visible = false;
  return m;
}
const RING_R = { square: 46, view: 16, church: 34, civic: 22, tower: 20 };

// ------------------------------------------------------------ selection & card
function select(i, { stopTour = false, fly: doFly = true } = {}) {
  if (stopTour) setTour(false);
  const prev = state.selected;
  state.selected = i;
  world.flags.clear(2);
  markers.forEach((m, k) => m.el.classList.toggle('active', k === i));
  document.querySelectorAll('#places li').forEach((li) => li.classList.toggle('active', li.querySelector('.n')?.textContent === String(i + 1)));
  selRing.visible = i >= 0;
  if (i < 0) {
    $('#card').classList.add('hidden');
    if (location.hash) history.replaceState(null, '', location.pathname);
    return;
  }
  const lm = world.landmarks[i];
  world.flags.set(lm.buildings, 2);
  selRing.position.set(lm.anchor[0], world.heightAt(lm.anchor[0], lm.anchor[2]) + 0.6, lm.anchor[2]);
  selRing.userData.r = RING_R[lm.cat] ?? 22;
  renderCard();
  $('#card').classList.remove('hidden');
  history.replaceState(null, '', '#' + lm.id);
  if (isMobile) $('#list-panel').classList.remove('open');
  if (doFly) {
    const tgt = new THREE.Vector3(lm.anchor[0], (lm.ground + lm.anchor[1]) / 2, lm.anchor[2]);
    const height = lm.anchor[1] - lm.ground;
    const dist = THREE.MathUtils.clamp(height * 4.2, 260, 520) * (isMobile ? 1.35 : 1);
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    // during the tour, drift the view around a little for each stop
    const az = state.tour ? sph.theta + 0.5 : (prev < 0 ? sph.theta : undefined);
    flyTo(tgt, dist, 1.0, az, state.tour ? 2.6 : 1.6);
  }
}

function renderCard() {
  const lm = world.landmarks[state.selected];
  const card = $('#card');
  card.className = `card cat-${lm.cat}`;
  $('#card-num').textContent = state.selected + 1;
  $('#card-cat').textContent = t('one_' + lm.cat);
  $('#card-title').textContent = lm.name[state.lang];
  $('#card-alt').textContent = state.lang === 'et' ? lm.name.en : lm.name.et;
  $('#card-text').textContent = lm.text[state.lang];
  const meta = [];
  if (lm.year) meta.push(`<span>${t('built')} <b>${lm.year}</b></span>`);
  meta.push(`<span>${t('elev')} <b>${Math.round(lm.ground)} m</b></span>`);
  $('#card-meta').innerHTML = meta.join('');
}

function step(d) {
  const n = world.landmarks.length;
  let i = state.selected;
  for (let k = 0; k < n; k++) {
    i = (i + d + n) % n;
    if (visible(world.landmarks[i])) break;
  }
  select(i);
}

function setTour(on) {
  state.tour = on;
  state.tourT = 0;
  $('#tour-btn').classList.toggle('on', on);
  $('#tour-btn .tour-icon').textContent = on ? '■' : '▶';
  $('#tour-btn [data-i18n]').textContent = on ? t('stopTour') : t('tour');
  $('#card-progress-bar').style.width = '0';
  if (on) select(state.selected < 0 ? 0 : state.selected);
}

// ------------------------------------------------------------ hover & picking
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const pointer = new THREE.Vector2();
let pointerDirty = false, lastPointer = { x: 0, y: 0 }, downAt = null;

canvas.addEventListener('pointermove', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerDirty = e.pointerType === 'mouse';
});
canvas.addEventListener('pointerleave', () => { setHover(-1); });
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  fly = null;
  if (state.tour) setTour(false);
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const bid = pick();
  const b = bid >= 0 ? world.meta.buildings[bid] : null;
  if (b?.lm) select(world.landmarks.findIndex((l) => l.id === b.lm), { stopTour: true });
  else if (e.pointerType !== 'mouse' && bid >= 0) { setHover(bid); showTooltip(bid, e.clientX, e.clientY); }
  else if (bid < 0) select(-1);
});
canvas.addEventListener('wheel', () => { fly = null; if (state.tour) setTour(false); }, { passive: true });

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(world.buildings, false)[0];
  if (!hit) return -1;
  return world.buildings.geometry.attributes.bid.getX(hit.face.a);
}

function setHover(bid) {
  if (bid === state.hover) return;
  if (state.hover >= 0 && world.flags.get(state.hover) === 1) world.flags.set([state.hover], 0);
  state.hover = bid;
  if (bid >= 0 && world.flags.get(bid) === 0) world.flags.set([bid], 1);
  canvas.style.cursor = bid >= 0 && world.meta.buildings[bid].lm ? 'pointer' : '';
  if (bid < 0) $('#tooltip').classList.add('hidden');
}

function showTooltip(bid, x, y) {
  const b = world.meta.buildings[bid];
  const tip = $('#tooltip');
  const name = b.name ? (b.name[state.lang] || b.name.et || b.name.en) : null;
  const lm = b.lm ? world.landmarks.find((l) => l.id === b.lm) : null;
  const title = lm ? lm.name[state.lang] : name || b.addr || t('building');
  const sub = [lm || name ? b.addr : null, `${t('height')} ≈ ${Math.round(b.h)} m`].filter(Boolean).join(' · ');
  tip.innerHTML = `<b>${title}</b><small>${sub}</small>`;
  tip.classList.remove('hidden');
  const tw = tip.offsetWidth;
  tip.style.transform = `translate(${Math.min(x + 14, innerWidth - tw - 8)}px, ${y + 16}px)`;
}

// ------------------------------------------------------------ tools
function wireUi() {
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    localStorage.setItem('lang', state.lang);
    applyI18n();
  }));
  $('#tour-btn').onclick = () => setTour(!state.tour);
  $('#card-close').onclick = () => select(-1, { stopTour: true });
  $('#card-next').onclick = () => { setTour(false); step(1); };
  $('#card-prev').onclick = () => { setTour(false); step(-1); };
  $('#compass').onclick = () => flyTo(controls.target.clone(), undefined, undefined, 0, 1);
  const zoom = (f) => {
    const off = camera.position.clone().sub(controls.target);
    const r = THREE.MathUtils.clamp(off.length() * f, controls.minDistance, controls.maxDistance);
    sph.setFromVector3(off);
    flyTo(controls.target.clone(), r, sph.phi, sph.theta, 0.5);
  };
  $('#zoom-in').onclick = () => zoom(0.65);
  $('#zoom-out').onclick = () => zoom(1.5);
  $('#home').onclick = () => { setTour(false); select(-1); homeView(1.6); };
  $('#sun-range').addEventListener('input', (e) => setSun(+e.target.value));
  $('#panel-toggle').onclick = () => $('#list-panel').classList.toggle('open');
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { setTour(false); step(1); }
    else if (e.key === 'ArrowLeft') { setTour(false); step(-1); }
    else if (e.key === 'Escape') select(-1, { stopTour: true });
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ------------------------------------------------------------ framing
// shift the projection centre so the focus sits in the space left free by the panels
let viewShift = 0, viewShiftY = 0;
function updateViewOffset(dt) {
  let target = 0, targetY = 0;
  const cardOpen = !$('#card').classList.contains('hidden');
  if (!isMobile) {
    const left = $('#list-panel').classList.contains('open') ? 356 : 0;
    target = (left - (cardOpen ? 376 : 0)) / 2;
  } else if (cardOpen) {
    targetY = $('#card').offsetHeight * 0.45;
  }
  const k = Math.min(1, dt * 4);
  viewShift += (target - viewShift) * k;
  viewShiftY += (targetY - viewShiftY) * k;
  camera.setViewOffset(innerWidth, innerHeight, -viewShift, viewShiftY, innerWidth, innerHeight);
}

// ------------------------------------------------------------ loop
const timer = new THREE.Timer();
const bounds = { x: 0, z: 0 };
function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  world.uniforms.uTime.value += dt;
  if (selRing.visible) selRing.scale.setScalar(selRing.userData.r * (1 + 0.06 * Math.sin(world.uniforms.uTime.value * 2.6)));
  stepFly(dt);
  updateViewOffset(dt);
  if (!fly) controls.update();
  else controls.update(0);
  // keep the focus point on the diorama
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -bounds.x, bounds.x);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -bounds.z, bounds.z);
  if (!fly) controls.target.y = THREE.MathUtils.lerp(controls.target.y, world.heightAt(controls.target.x, controls.target.z) + 8, 0.05);

  if (state.tour && !fly) {
    state.tourT += dt;
    $('#card-progress-bar').style.width = `${Math.min(100, (state.tourT / TOUR_STEP) * 100)}%`;
    // slow orbit while reading
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    sph.theta += dt * 0.04;
    camera.position.copy(viewFrom(controls.target, sph.radius, sph.phi, sph.theta));
    if (state.tourT > TOUR_STEP) { state.tourT = 0; step(1); }
  }

  if (pointerDirty && !fly) {
    pointerDirty = false;
    const bid = pick();
    setHover(bid);
    if (bid >= 0) showTooltip(bid, lastPointer.x, lastPointer.y);
  }

  updateShadowFrustum();
  $('#needle').setAttribute('transform', `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())} 24 24)`);
  renderer.render(scene, camera);
  placeOverlays();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ boot
async function boot() {
  applyStaticI18n();
  world = await loadWorld((p) => { $('#loader-bar').style.width = `${Math.round(p * 100)}%`; });
  scene.add(world.root);
  selRing = makeRing();
  scene.add(selRing);
  bounds.x = world.terrainMeta.width / 2 - 60;
  bounds.z = world.terrainMeta.depth / 2 - 60;

  setSun(+$('#sun-range').value);
  camera.position.copy(viewFrom(new THREE.Vector3(0, 20, 0), 3000, 0.55, -1.2));
  controls.target.set(0, 20, 0);
  wireUi();
  applyI18n();

  renderer.compile(scene, camera);
  $('#loader').classList.add('done');
  const fromHash = world.landmarks.findIndex((l) => '#' + l.id === location.hash);
  if (fromHash >= 0) {
    homeView(0.01);
    stepFly(1);
    select(fromHash);
  } else {
    homeView(3.2);
  }
  if (!isMobile) $('#list-panel').classList.add('open');
  frame();
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

boot().catch((e) => {
  console.error(e);
  $('.loader-title').textContent = 'Could not load the map: ' + e.message;
});
