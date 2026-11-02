// The village: a castle in the middle (the tracker and the database), one building per
// sector, and a minion for every scheduled job and assistant.
//
// The scene only DRAWS what lib/agent-floor.js decided. A minion's pose follows its
// state: working = carrying a crate to the castle, asleep = resting at its camp,
// warning/late/failing = alarm and smoke over its building, unknown = grey question
// mark, paused = switched off on purpose. Nothing here invents activity.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ZONE_COLOR = { voice: 0xff6b8a, fleet: 0x3aa8e0, store: 0x7ac943, back: 0xa879f0 };
const ZONE_POS = { voice: [-11, -11], fleet: [11, -11], store: [-11, 11], back: [11, 11] };
const ATTENTION = new Set(['warning', 'late', 'failing']);

const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
function mesh(geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, lam(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
const box = (w, h, d, c, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z);
const cyl = (rt, rb, h, c, x, y, z, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z);
const cone = (r, h, c, x, y, z, seg = 16) => mesh(new THREE.ConeGeometry(r, h, seg), c, x, y, z);

function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function tex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function sprite(t, sx, sy, order = 5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(sx, sy, 1); s.renderOrder = order; return s;
}
function label(text, size = 30, bg = 'rgba(20,30,42,.8)', fg = '#fff') {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `600 ${size}px system-ui, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + 28, h = size + 16;
  const t = tex(w, h, (x) => {
    x.font = `600 ${size}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, w, h, h / 2); x.fill();
    x.fillStyle = fg; x.fillText(text, w / 2, h / 2 + 1);
  });
  return { t, ratio: w / h };
}
const nameSprite = (text, height = 0.55, order = 6) => { const l = label(text); const s = sprite(l.t, height * l.ratio, height, order); return s; };
const badge = (text, bg, fg = '#fff', font = 54) => tex(96, 96, (x) => {
  x.fillStyle = bg; x.beginPath(); x.arc(48, 48, 44, 0, Math.PI * 2); x.fill();
  x.fillStyle = fg; x.font = `700 ${font}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 48, 52);
});
const zzz = () => tex(128, 96, (x) => {
  x.fillStyle = '#26466d'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 30px system-ui, sans-serif'; x.fillText('z', 36, 70);
  x.font = '700 42px system-ui, sans-serif'; x.fillText('z', 66, 46);
  x.font = '700 56px system-ui, sans-serif'; x.fillText('Z', 98, 24);
});
const smokeTex = () => tex(64, 64, (x) => {
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(70,70,76,.85)'); g.addColorStop(1, 'rgba(70,70,76,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
});

// ---------- buildings ----------
function castle() {
  const g = new THREE.Group();
  g.add(box(5, 6, 5, 0xbdb7aa, 0, 3, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(0.95, 1.05, 8, 0x9d978b, sx * 2.9, 4, sz * 2.9));
    g.add(cone(1.25, 2.3, 0x3d6fc4, sx * 2.9, 9.15, sz * 2.9));
  }
  const roof = cone(4.1, 2.6, 0xc0392b, 0, 7.3, 0, 4); roof.rotation.y = Math.PI / 4; g.add(roof);
  for (const [x, z, ry] of [[0, 2.55, 0], [0, -2.55, 0], [2.55, 0, Math.PI / 2], [-2.55, 0, Math.PI / 2]]) {
    const d = box(1.7, 2.6, 0.3, 0x4a3420, 0, 1.3, 0); const w = new THREE.Group(); w.add(d); w.position.set(x, 0, z); w.rotation.y = ry; g.add(w);
  }
  const gem = mesh(new THREE.OctahedronGeometry(0.8), 0x3ddc97, 0, 10.6, 0);
  gem.material = new THREE.MeshLambertMaterial({ color: 0x3ddc97, emissive: 0x1aa56b, emissiveIntensity: 0.6 }); g.add(gem);
  const flags = [];
  for (const [x, z] of [[-2.9, -2.9], [2.9, 2.9]]) {
    g.add(cyl(0.05, 0.05, 1.8, 0x333333, x, 11.2, z, 6));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), new THREE.MeshLambertMaterial({ color: 0xf2c230, side: THREE.DoubleSide }));
    f.position.set(x + 0.65, 11.7, z); g.add(f); flags.push(f);
  }
  const name = nameSprite('Tracker + database', 0.95); name.position.set(0, 13.2, 0); g.add(name);
  g.userData = { gem, flags, name };
  return g;
}
function callTower() {
  const g = new THREE.Group();
  g.add(box(3.2, 5.5, 3.2, 0xefe3d0, 0, 2.75, 0));
  g.add(box(3.8, 0.6, 3.8, 0xcfc4b0, 0, 5.8, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.7, 0.6, 0.7, 0xcfc4b0, sx * 1.55, 6.4, sz * 1.55));
  const roof = cone(2.6, 2.6, 0xe0546f, 0, 7.6, 0, 4); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(cyl(0.06, 0.06, 2.2, 0x555555, 0, 9.9, 0, 6)); g.add(mesh(new THREE.SphereGeometry(0.2, 10, 10), 0xff6b8a, 0, 11.1, 0));
  g.add(box(1.1, 1.9, 0.25, 0x4a3420, 0, 0.95, 1.65));
  for (const y of [3.2, 4.6]) g.add(box(0.7, 0.9, 0.2, 0x2b3a4a, 0, y, 1.65));
  return g;
}
function garage() {
  const g = new THREE.Group();
  g.add(box(7, 3.6, 5, 0xdcd4c6, 0, 1.8, 0));
  const geo = new THREE.CylinderGeometry(3, 3, 7.4, 3); geo.rotateZ(Math.PI / 2); geo.rotateX(-Math.PI / 2);
  const roof = mesh(geo, 0x2e6fa7, 0, 5.1, 0); g.add(roof);
  g.add(box(3.2, 2.7, 0.25, 0x3a3f46, 0, 1.35, 2.55));
  const truck = new THREE.Group();
  truck.add(box(2.6, 1.2, 1.3, 0xf4f4f4, 0, 0.95, 0)); truck.add(box(0.9, 0.95, 1.25, 0x3aa8e0, 1.7, 0.8, 0));
  for (const x of [-0.8, 0.8, 1.7]) for (const z of [-0.65, 0.65]) { const w = cyl(0.3, 0.3, 0.22, 0x222222, x, 0.3, z, 12); w.rotation.x = Math.PI / 2; truck.add(w); }
  truck.position.set(-2.4, 0, 4.4); g.add(truck);
  return g;
}
function market() {
  const g = new THREE.Group();
  g.add(box(7.4, 0.2, 5, 0xc9a66b, 0, 0.1, 0));
  [-2.4, 0, 2.4].forEach((x, i) => {
    g.add(box(1.9, 1, 1.4, 0x8b5a2b, x, 0.7, 0));
    for (const px of [-0.95, 0.95]) g.add(cyl(0.06, 0.06, 2.6, 0x6b4423, x + px, 1.5, 0.6, 6));
    for (let s = 0; s < 6; s++) {
      const slat = box(0.38, 0.1, 1.9, s % 2 ? 0xffffff : [0xe0546f, 0x3aa8e0, 0xf2c230][i], x - 0.95 + 0.19 + s * 0.35, 2.6, 0.2); slat.rotation.x = 0.2; g.add(slat);
    }
    g.add(box(0.6, 0.6, 0.6, 0xb98d55, x - 0.5, 1.5, 0)); g.add(box(0.5, 0.5, 0.5, 0xc79a60, x + 0.5, 1.45, 0.1));
  });
  g.add(cyl(0.45, 0.45, 0.9, 0x7a4a24, -3, 0.6, 2, 12)); g.add(cyl(0.45, 0.45, 0.9, 0x7a4a24, 3, 0.6, 2, 12));
  g.add(box(0.9, 0.9, 0.9, 0xb98d55, -2.2, 0.55, 2.2));
  return g;
}
function treasury() {
  const g = new THREE.Group();
  g.add(box(5, 3.2, 5, 0xd3ccbc, 0, 1.6, 0));
  const dome = mesh(new THREE.SphereGeometry(2.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xf2c230, 0, 3.2, 0); g.add(dome);
  g.add(cone(0.3, 1.2, 0xf2c230, 0, 6.5, 0, 10));
  for (const x of [-1.8, -0.6, 0.6, 1.8]) g.add(cyl(0.22, 0.22, 3.2, 0xf2c230, x, 1.6, 2.7, 10));
  g.add(box(1.2, 2.2, 0.2, 0x4a3420, 0, 1.1, 2.55));
  for (let i = 0; i < 6; i++) g.add(cyl(0.45, 0.45, 0.1, 0xf6d048, 3.4, 0.1 + i * 0.1, 1.5, 14));
  return g;
}
const BUILDERS = { voice: callTower, fleet: garage, store: market, back: treasury };
const ZONE_TITLE = { voice: 'Call tower', fleet: 'Garage', store: 'Market', back: 'Treasury' };
const ROOF_Y = { voice: 11, fleet: 8, store: 4.5, back: 7.5 };

// ---------- minion ----------
function makeMinion(zoneColor) {
  const g = new THREE.Group();
  const rig = new THREE.Group(); g.add(rig);
  const yellow = lam(0xffd83a), blue = lam(0x2f5fa8), hat = lam(zoneColor), dark = lam(0x3a3f46);
  const add = (geo, mat, x, y, z, parent = rig) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  add(new THREE.CapsuleGeometry(0.34, 0.55, 4, 12), yellow, 0, 0.9, 0);
  add(new THREE.CylinderGeometry(0.355, 0.35, 0.34, 14), blue, 0, 0.62, 0);
  add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 1.36, 0);
  const band = add(new THREE.TorusGeometry(0.35, 0.05, 6, 20), dark, 0, 1.2, 0); band.rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.15, 12, 10), lam(0xffffff), 0, 1.2, 0.3);
  const pupil = add(new THREE.SphereGeometry(0.07, 8, 8), lam(0x222222), 0, 1.2, 0.43);
  const limb = (x, y, geo, mat) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(geo, mat); m.position.y = -0.16; m.castShadow = true; p.add(m); rig.add(p); return p; };
  const armL = limb(-0.4, 1.05, new THREE.CapsuleGeometry(0.08, 0.28, 3, 6), yellow);
  const armR = limb(0.4, 1.05, new THREE.CapsuleGeometry(0.08, 0.28, 3, 6), yellow);
  const legL = limb(-0.15, 0.4, new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8), blue);
  const legR = limb(0.15, 0.4, new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8), blue);
  const crate = box(0.38, 0.32, 0.38, 0xb98d55, 0, 0.88, 0.5); crate.visible = false; rig.add(crate);
  g.scale.setScalar(1.25);
  g.userData = { rig, pupil, armL, armR, legL, legR, crate, hat: hat };
  return g;
}

export function createVillage({ mount, data, onPick, reduceMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f5);
  scene.fog = new THREE.Fog(0xbfe3f5, 60, 120);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  camera.position.set(0, 34, 48);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.enablePan = false; orbit.minDistance = 16; orbit.maxDistance = 80;
  orbit.minPolarAngle = 0.55; orbit.maxPolarAngle = 1.2; orbit.target.set(0, 1.5, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7aa660, 1.05));
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.5); sun.position.set(16, 28, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 80 }); scene.add(sun);

  // island
  const dirt = box(41.5, 2.2, 41.5, 0x8a6a45, 0, -1.2, 0); scene.add(dirt);
  const grass = box(40, 0.4, 40, 0x7ec850, 0, -0.2, 0); grass.castShadow = false; scene.add(grass);
  const plaza = cyl(5.6, 5.6, 0.06, 0xd9b779, 0, 0.03, 0, 40); plaza.castShadow = false; scene.add(plaza);

  const castleG = castle(); scene.add(castleG);
  const zones = {};
  const spare = rng(7);
  for (const [k, [bx, bz]] of Object.entries(ZONE_POS)) {
    const len = Math.hypot(bx, bz), dx = -bx / len, dz = -bz / len;     // unit vector toward the castle
    const b = BUILDERS[k](); b.position.set(bx, 0, bz); b.rotation.y = Math.atan2(dx, dz); scene.add(b);
    const sign = nameSprite(ZONE_TITLE[k], 0.9); sign.position.set(bx, ROOF_Y[k] + 1.6, bz); scene.add(sign);
    const signRef = sign;
    // dirt road to the castle
    const roadLen = len - 5.6 - 3;
    const road = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.4, roadLen).rotateX(-Math.PI / 2), lam(0xd9b779)); strip.receiveShadow = true;
    road.add(strip); road.position.set(bx + dx * (3 + roadLen / 2), 0.035, bz + dz * (3 + roadLen / 2)); road.rotation.y = Math.atan2(dx, dz); scene.add(road);
    // smoke over a building that needs attention
    const smoke = []; const st = smokeTex();
    for (let i = 0; i < 4; i++) { const s = sprite(st, 2.6, 2.6, 3); s.visible = false; s.position.set(bx, ROOF_Y[k], bz); scene.add(s); smoke.push({ s, off: i / 4 }); }
    // where a minion hands the crate over: on the plaza, 4.6 out from the middle toward this building
    zones[k] = { key: k, sign: signRef, signText: '', bx, bz, dx, dz, smoke, alarm: false, door: new THREE.Vector3((bx / len) * 4.6, 0, (bz / len) * 4.6) };
  }

  // trees and rocks
  const rand = rng(11);
  for (let i = 0, placed = 0; i < 400 && placed < 30; i++) {
    const x = (rand() - 0.5) * 37, z = (rand() - 0.5) * 37;
    if (Math.hypot(x, z) < 8) continue;
    if (Object.values(ZONE_POS).some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 11)) continue;
    const t = new THREE.Group(); const s = 0.8 + rand() * 0.7;
    t.add(cyl(0.18, 0.25, 1.1, 0x7a5230, 0, 0.55, 0, 6)); t.add(cone(1.1, 2.2, 0x2f8f46, 0, 2.0, 0, 7)); t.add(cone(0.8, 1.6, 0x3aa457, 0, 3.0, 0, 7));
    t.scale.setScalar(s); t.position.set(x, 0, z); scene.add(t); placed++;
  }
  for (let i = 0; i < 10; i++) {
    const x = (spare() - 0.5) * 36, z = (spare() - 0.5) * 36;
    if (Math.hypot(x, z) < 9 || Object.values(ZONE_POS).some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 9)) continue;
    const r = mesh(new THREE.DodecahedronGeometry(0.5 + spare() * 0.4), 0x9a9a98, x, 0.3, z); scene.add(r);
  }

  // minions
  const T = { zzz: zzz(), alarm: badge('!', '#e03131'), warn: badge('!', '#f08c00'), unknown: badge('?', '#7b8794'), off: badge('off', '#7b8794', '#fff', 34), busy: badge('…', '#2f9e44', '#fff', 52) };
  const agents = new Map();
  const perZone = {};
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff })); ring.visible = false; scene.add(ring);

  function addAgent(d) {
    const z = zones[d.zone]; const k = (perZone[d.zone] = (perZone[d.zone] || 0) + 1) - 1;
    const row = Math.floor(k / 3), col = (k % 3) - 1;
    const px = -z.dz, pz = z.dx;                                         // sideways, across the road
    const camp = new THREE.Vector3(z.bx + z.dx * (4.9 + row * 2.3) + px * col * 3.0, 0, z.bz + z.dz * (4.9 + row * 2.3) + pz * col * 3.0);
    const m = makeMinion(ZONE_COLOR[d.zone]); m.position.copy(camp); scene.add(m);
    m.traverse((o) => { o.userData.agentId = d.id; });
    const name = nameSprite(d.name, 0.5); name.position.set(0, 2.55, 0); m.add(name);
    const bubble = sprite(T.alarm, 0.9, 0.9, 7); bubble.position.set(0, 3.25, 0); bubble.visible = false; m.add(bubble);
    const sleepZ = sprite(T.zzz, 1.3, 0.97, 7); sleepZ.position.set(0.3, 1.5, 0); sleepZ.visible = false; m.add(sleepZ);
    const a = { d, m, camp, zone: z, name, bubble, sleepZ, lie: 0, leg: 'camp', u: 0, wait: 0, phase: Math.random() * 6, bubbleKey: '' };
    agents.set(d.id, a); return a;
  }
  data.agents.forEach(addAgent);

  let selected = null;
  function setBubble(a, key) {
    if (a.bubbleKey === key) return; a.bubbleKey = key;
    if (!key) { a.bubble.visible = false; return; }
    a.bubble.material.map = T[key]; a.bubble.material.needsUpdate = true; a.bubble.visible = true;
  }
  // A sign's text is redrawn only when its level changes.
  function setSign(sprite, text, height) {
    const l = label(text); if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.map = l.t; sprite.material.needsUpdate = true; sprite.scale.set(height * l.ratio, height, 1);
  }
  const castleSign = { text: '' };
  function update(next) {
    next.agents.forEach((d) => { const a = agents.get(d.id); if (a) a.d = d; });
    (next.zones || []).forEach((zd) => {
      const z = zones[zd.key]; if (!z || !zd.level) return;
      const text = `${ZONE_TITLE[zd.key]} \u00b7 Lv ${zd.level}`;
      if (z.signText !== text) { z.signText = text; setSign(z.sign, text, 0.9); }
    });
    if (next.castle && castleSign.text !== `Lv ${next.castle.level}`) { castleSign.text = `Lv ${next.castle.level}`; setSign(castleG.userData.name, `Tracker + database \u00b7 Lv ${next.castle.level}`, 0.95); }
    Object.values(zones).forEach((z) => { z.alarm = false; });
    next.agents.forEach((d) => { if (ATTENTION.has(d.state)) zones[d.zone].alarm = true; });
  }
  update(data);

  // picking
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null;
  const ndc = (e) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); };
  const roots = () => [...agents.values()].map((a) => a.m);
  const idAt = (e) => { ndc(e); const hit = ray.intersectObjects(roots(), true).find((h) => h.object.userData.agentId); return hit ? hit.object.userData.agentId : null; };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) onPick(idAt(e)); down = null; };
  let hovered = null;
  const onMove = (e) => { hovered = idAt(e); renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab'; };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);

  const resize = () => { const w = mount.clientWidth || 800, h = mount.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(mount); resize();

  let last = performance.now(), elapsed = 0, raf = 0, glow = 0;
  const goal = new THREE.Vector3(0, 1.5, 0);
  const SPEED = 3.2;

  function frame() {
    raf = requestAnimationFrame(frame);
    const nowMs = performance.now();
    const dt = Math.min((nowMs - last) / 1000, 0.05); last = nowMs; elapsed += dt;
    const t = elapsed;
    goal.set(0, 1.5, 0);
    if (selected && agents.get(selected)) goal.copy(agents.get(selected).m.position).setY(1.2);
    orbit.target.lerp(goal, 0.06);
    orbit.update();

    glow = Math.max(0, glow - dt * 1.2);
    castleG.userData.gem.rotation.y += dt * 0.8;
    castleG.userData.gem.position.y = 10.6 + (reduceMotion ? 0 : Math.sin(t * 1.6) * 0.15);
    castleG.userData.gem.material.emissiveIntensity = 0.5 + glow * 1.6;
    castleG.userData.gem.scale.setScalar(1 + glow * 0.35);
    castleG.userData.flags.forEach((f, i) => { f.rotation.y = reduceMotion ? 0 : Math.sin(t * 3 + i) * 0.35; });

    for (const a of agents.values()) {
      const { rig, armL, armR, legL, legR, crate, pupil } = a.m.userData;
      const st = a.d.state;
      const sleepy = st === 'asleep' || st === 'paused';
      const walkMode = st === 'working' && !reduceMotion;
      a.lie += ((sleepy ? 1 : 0) - a.lie) * Math.min(1, dt * 4);
      rig.rotation.z = a.lie * Math.PI / 2; rig.position.y = a.lie * 0.34; rig.position.x = 0;
      pupil.scale.y = 1 - a.lie * 0.9;
      a.m.userData.hat.color.setHex(st === 'paused' ? 0x7b8794 : ZONE_COLOR[a.d.zone]);

      // trips to the castle
      const dist = a.camp.distanceTo(a.zone.door);
      let moving = false;
      if (walkMode && a.leg === 'camp' && a.lie < 0.08) { a.wait -= dt; if (a.wait <= 0) { a.leg = 'out'; crate.visible = true; } }
      if (a.leg === 'out') { a.u = Math.min(1, a.u + dt * SPEED / dist); moving = true; if (a.u >= 1) { a.leg = 'drop'; a.wait = 0.8; crate.visible = false; glow = 1; } }
      else if (a.leg === 'drop') { a.wait -= dt; if (a.wait <= 0) a.leg = 'back'; }
      else if (a.leg === 'back') { a.u = Math.max(0, a.u - dt * SPEED / dist); moving = true; if (a.u <= 0) { a.leg = 'camp'; a.wait = 0.5; } }
      if (a.leg === 'camp' && !walkMode) a.u = 0;
      a.m.position.lerpVectors(a.camp, a.zone.door, a.u);
      if (moving) {
        const dir = a.leg === 'out' ? 1 : -1;
        a.m.rotation.y = Math.atan2((a.zone.door.x - a.camp.x) * dir, (a.zone.door.z - a.camp.z) * dir);
      } else if (a.lie < 0.5) {
        a.m.rotation.y += (Math.atan2(-a.camp.x, -a.camp.z) - a.m.rotation.y) * Math.min(1, dt * 3);
      }

      // limbs
      a.phase += dt * (moving ? 9 : 2);
      const sw = moving ? Math.sin(a.phase) * 0.8 : 0;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = moving ? (crate.visible ? -1.3 : -sw) : 0; armR.rotation.x = moving ? (crate.visible ? -1.3 : sw) : 0;
      armL.rotation.z = 0.15; armR.rotation.z = -0.15;
      if (moving) rig.position.y += Math.abs(Math.sin(a.phase)) * 0.08;
      if (ATTENTION.has(st) && !reduceMotion) {
        rig.position.x = Math.sin(t * 28 + a.phase) * 0.04;
        armL.rotation.x = Math.PI + Math.sin(t * 9 + a.phase) * 0.4; armR.rotation.x = Math.PI - Math.sin(t * 9 + a.phase) * 0.4;
      }
      if (st === 'unknown') { armL.rotation.z = 0.9; armR.rotation.z = -0.9; rig.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.8 + a.phase) * 0.25; } else rig.rotation.y = 0;

      // bubbles
      setBubble(a, st === 'late' || st === 'failing' ? 'alarm' : st === 'warning' ? 'warn' : st === 'unknown' ? 'unknown' : st === 'paused' ? 'off' : (st === 'working' && reduceMotion ? 'busy' : ''));
      if (a.bubble.visible) a.bubble.position.y = 3.25 + (reduceMotion ? 0 : Math.sin(t * 4 + a.phase) * 0.12);
      a.sleepZ.visible = st === 'asleep' && a.lie > 0.6;
      if (a.sleepZ.visible) { a.sleepZ.position.y = 1.7 + (reduceMotion ? 0 : (Math.sin(t * 1.5 + a.phase) * 0.18)); a.sleepZ.material.opacity = 0.65 + 0.35 * Math.sin(t * 1.5 + a.phase); }
      a.m.scale.setScalar(selected === a.d.id ? 1.5 : 1.25);
      // names only where they help: the one picked, the one under the pointer, and anything in trouble
      a.name.visible = selected === a.d.id || hovered === a.d.id || ATTENTION.has(st);
    }

    for (const z of Object.values(zones)) {
      z.smoke.forEach(({ s, off }) => {
        s.visible = z.alarm;
        if (!z.alarm) return;
        const p = reduceMotion ? 0.5 : (t * 0.22 + off) % 1;
        s.position.y = ROOF_Y[z.key] + p * 4;
        s.material.opacity = 1 - p; s.scale.setScalar(2 + p * 2);
      });
    }

    if (selected && agents.get(selected)) { const p = agents.get(selected).m.position; ring.position.set(p.x, 0.08, p.z); ring.visible = true; } else ring.visible = false;
    renderer.render(scene, camera);
  }
  frame();

  return {
    update,
    select(id) { selected = id; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); orbit.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
      renderer.dispose(); renderer.domElement.remove();
    }
  };
}
