// Builds public/giveaway/freezer.glb: a clean 3D model of the prize freezer.
//
//   node scripts/make-freezer-glb.mjs
//
// Why this exists instead of an AI image-to-3D model: we tried one (Tripo, from
// the product photo) and it came back lumpy, because a single front photo says
// nothing about the sides and the model had to guess. A freezer is a box with a
// front. So this is a rounded box, the REAL product photo as its front, and plain
// white paint everywhere else. What is shown on the front is exactly the product.
//
// Output is a hand-assembled binary glTF (no dependencies beyond `sharp`, which
// Next already ships).
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'public/giveaway/freezer.png';
const OUT = 'public/giveaway/freezer.glb';

// Front texture: the cutout trimmed to the appliance and flattened onto white.
const png = await sharp(SRC).trim({ threshold: 5 }).flatten({ background: '#f6f6f6' }).resize({ height: 1024 }).png().toBuffer();
const meta = await sharp(png).metadata();

const H = 1.0;
const W = H * meta.width / meta.height;
const D = W * 1.08;   // a typical upright is about as deep as it is wide
const R = 0.02;       // edge radius
const N = 14;         // grid segments per face edge (smooth rounded corners)
const half = [W / 2, H / 2, D / 2];

// One face of the box as a grid of points, rounded the standard way: pull each
// point toward the inner (shrunk) box and push it out by R along the offset.
function face(axis, sign) {
  const pos = [], nor = [], uv = [], idx = [];
  const [a, b] = [0, 1, 2].filter((i) => i !== axis);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const p = [0, 0, 0];
      p[axis] = sign * half[axis];
      p[a] = (i / N * 2 - 1) * half[a];
      p[b] = (j / N * 2 - 1) * half[b];
      const inner = p.map((v, k) => Math.max(-half[k] + R, Math.min(half[k] - R, v)));
      const d = p.map((v, k) => v - inner[k]);
      const len = Math.hypot(...d) || 1;
      const n = d.map((v) => v / len);
      const q = inner.map((v, k) => v + n[k] * R);
      pos.push(q[0], q[1] + H / 2, q[2]);   // stand it on y = 0
      nor.push(...n);
      uv.push((p[0] + W / 2) / W, 0.5 - p[1] / H);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i;
      for (const t of [[k, k + 1, k + N + 1], [k + 1, k + N + 2, k + N + 1]]) idx.push(...t);
    }
  }
  // Wind every triangle so it faces the way its normals do.
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
    const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const A = v(i0), B = v(i1), C = v(i2);
    const e1 = B.map((x, k) => x - A[k]), e2 = C.map((x, k) => x - A[k]);
    const cx = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nn = [0, 1, 2].map((k) => nor[i0 * 3 + k] + nor[i1 * 3 + k] + nor[i2 * 3 + k]);
    if (cx[0] * nn[0] + cx[1] * nn[1] + cx[2] * nn[2] < 0) { idx[t + 1] = i2; idx[t + 2] = i1; }
  }
  return { pos, nor, uv, idx };
}

function merge(parts) {
  const out = { pos: [], nor: [], uv: [], idx: [] };
  for (const p of parts) {
    const base = out.pos.length / 3;
    out.pos.push(...p.pos); out.nor.push(...p.nor); out.uv.push(...p.uv);
    out.idx.push(...p.idx.map((i) => i + base));
  }
  return out;
}

const front = face(2, +1);
const body = merge([face(2, -1), face(0, +1), face(0, -1), face(1, +1), face(1, -1)]);

// ---- binary glTF -----------------------------------------------------------
const chunks = []; const views = []; const accessors = [];
let offset = 0;
function add(buf, target) {
  const pad = (4 - (buf.length % 4)) % 4;
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf, Buffer.alloc(pad));
  offset += buf.length + pad;
  return views.length - 1;
}
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const u32 = (a) => Buffer.from(new Uint32Array(a).buffer);
function accessor(view, componentType, count, type, extra = {}) {
  accessors.push({ bufferView: view, componentType, count, type, ...extra });
  return accessors.length - 1;
}
function minmax(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  return { min: mn, max: mx };
}
function primitive(g, material, withUv) {
  const attrs = {
    POSITION: accessor(add(f32(g.pos), 34962), 5126, g.pos.length / 3, 'VEC3', minmax(g.pos)),
    NORMAL: accessor(add(f32(g.nor), 34962), 5126, g.nor.length / 3, 'VEC3')
  };
  if (withUv) attrs.TEXCOORD_0 = accessor(add(f32(g.uv), 34962), 5126, g.uv.length / 2, 'VEC2');
  return { attributes: attrs, indices: accessor(add(u32(g.idx), 34963), 5125, g.idx.length, 'SCALAR'), material };
}

const prims = [primitive(front, 0, true), primitive(body, 1, false)];
const imageView = add(png);

const json = {
  asset: { version: '2.0', generator: 'scripts/make-freezer-glb.mjs' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: prims }],
  materials: [
    { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.55 } },
    { pbrMetallicRoughness: { baseColorFactor: [0.965, 0.965, 0.965, 1], metallicFactor: 0, roughnessFactor: 0.5 } }
  ],
  textures: [{ sampler: 0, source: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: imageView, mimeType: 'image/png' }],
  bufferViews: views, accessors,
  buffers: [{ byteLength: offset }]
};

let j = Buffer.from(JSON.stringify(json));
j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(OUT, Buffer.concat([head, jh, j, bh, bin]));
console.log(`wrote ${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${W.toFixed(3)} x ${H} x ${D.toFixed(3)}`);
