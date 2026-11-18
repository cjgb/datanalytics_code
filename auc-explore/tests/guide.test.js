const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScripts } = require('./load.js');

const ROOT = path.join(__dirname, '..', 'auc-exploration-tool');
const html = fs.readFileSync(path.join(ROOT, 'auc-guide.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'manifest.json'), 'utf8'));
const { SCENARIOS, EXAMPLES } = loadScripts(['stats.js', 'scenarios.js', 'robustness-core.js'], ['SCENARIOS', 'EXAMPLES']);

describe('guide (auc-guide.html)', () => {
  it('every screenshot exists, is in the manifest and has matching width/height', () => {
    const imgs = [...html.matchAll(/<img ([^>]*)>/g)].map((m) => m[1]);
    assert.ok(imgs.length >= 20, `only ${imgs.length} images`);
    for (const attrs of imgs) {
      const src = attrs.match(/src="([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(ROOT, src)), `missing ${src}`);
      const name = path.basename(src, '.webp');
      assert.ok(manifest[name], `${name} not in manifest (regenerate with tools/make-guide-screenshots.py)`);
      assert.equal(+attrs.match(/width="(\d+)"/)[1], manifest[name].w, `${name} width`);
      assert.equal(+attrs.match(/height="(\d+)"/)[1], manifest[name].h, `${name} height`);
      assert.match(attrs, /alt="[^"]{10,}"/, `${name} needs a descriptive alt text`);
    }
  });

  it('numbered callout lists match the numbers drawn on the screenshots', () => {
    const lists = new Map([...html.matchAll(/<ol class="callouts" data-for="([\w-]+)">([\s\S]*?)<\/ol>/g)]
      .map((m) => [m[1], (m[2].match(/<li>/g) || []).length]));
    for (const [name, info] of Object.entries(manifest)) {
      if (info.marks > 0) assert.equal(lists.get(name), info.marks, `${name}: ${info.marks} callouts on the image, ${lists.get(name)} in the text`);
    }
    for (const name of lists.keys()) assert.ok(manifest[name] && manifest[name].marks > 0, `callout list for ${name} but no callouts on the image`);
  });

  it('internal links and deep links resolve', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `broken anchor #${id}`);
    for (const [, key] of html.matchAll(/auc-simulator\.html#scenario=(\w+)/g)) assert.ok(key in SCENARIOS, `unknown scenario ${key}`);
    for (const [, key] of html.matchAll(/auc-robustness\.html#example=(\w+)/g)) assert.ok(key in EXAMPLES, `unknown example ${key}`);
    for (const [, file] of html.matchAll(/href="([\w-]+\.html)/g)) assert.ok(fs.existsSync(path.join(ROOT, file)), `missing page ${file}`);
  });

  it('figures are numbered in order and every "Figure N" reference exists', () => {
    const nums = [...html.matchAll(/<b>Figure (\d+)\.<\/b>/g)].map((m) => +m[1]);
    assert.deepEqual(nums, nums.map((_, i) => i + 1));
    for (const [, n] of html.matchAll(/Figure (\d+)/g)) assert.ok(+n >= 1 && +n <= nums.length, `reference to missing Figure ${n}`);
  });

  it('all three pages list the guide first in the navigation', () => {
    for (const page of ['auc-guide.html', 'auc-simulator.html', 'auc-robustness.html']) {
      const nav = fs.readFileSync(path.join(ROOT, page), 'utf8').match(/<nav class="apps"[\s\S]*?<\/nav>/)[0];
      const order = [...nav.matchAll(/href="([\w-]+)\.html"/g)].map((m) => m[1]);
      assert.deepEqual(order, ['auc-guide', 'auc-simulator', 'auc-robustness'], page);
    }
  });
});
