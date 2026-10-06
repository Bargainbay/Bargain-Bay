// lib/marketing-assets: the posters listed on /admin/operations must exist.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, equal } from './_harness.mjs';
import { CAMPAIGNS, assetPaths, posterCount } from '../lib/marketing-assets.js';

suite('marketing posters');

const pub = (p) => join(process.cwd(), 'public', p);

test('every file the page refers to is actually there', () => {
  for (const c of CAMPAIGNS) {
    for (const p of assetPaths(c)) assert(existsSync(pub(p)), `missing ${p}`);
  }
});

test('every poster has BOTH a still and an animated version, and ids are unique', () => {
  const ids = new Set();
  for (const c of CAMPAIGNS) for (const f of c.formats) for (const p of f.posters) {
    assert(p.still && p.video, `${p.id} needs a still and a video`);
    assert(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
  }
  equal(ids.size, posterCount());
});
