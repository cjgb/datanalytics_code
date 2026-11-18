const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./load.js');

const H = loadScripts(['stats.js', 'scenarios.js', 'handoff.js'], ['encodeSimConfig', 'decodeSimConfig', 'casesFromSim',
  'drawSample', 'makeRNG', 'delongFromSamples', 'SCENARIOS', 'cleanDist', 'TRANSFORMS']);

const cfg = { Y: { family: 'mixture', p: { w: 0.46, mu1: 0, sd1: 1, mu2: 3, sd2: 1 } }, N: { family: 'normal', p: { mu: 0, sd: 1 } },
  nY: 37, nN: 120, seed: 987654, transform: 'cube', level: 0.9, B: 500 };

describe('simulator → robustness hand-off', () => {
  it('round-trips the recipe through the URL hash', () => {
    const d = H.decodeSimConfig('#' + H.encodeSimConfig(cfg, 'Hidden subgroup & co'));
    assert.deepEqual(d.Y, cfg.Y); assert.deepEqual(d.N, cfg.N);
    assert.deepEqual([d.nY, d.nN, d.seed, d.transform, d.label], [37, 120, 987654, 'cube', 'Hidden subgroup & co']);
  });

  it('regenerates exactly the sample the simulator shows', () => {
    const sim = H.drawSample(cfg, H.makeRNG(cfg.seed));
    const { cases, trueAuc } = H.casesFromSim(H.decodeSimConfig(H.encodeSimConfig(cfg)));
    assert.deepEqual(cases.filter((c) => c.y).map((c) => c.s), Array.from(sim.pos));
    assert.deepEqual(cases.filter((c) => !c.y).map((c) => c.s), Array.from(sim.neg));
    assert.equal(cases[0].id, 'Y01'); assert.equal(cases.at(-1).id, 'N120');
    assert.ok(Math.abs(trueAuc - 0.7608) < 1e-3, `true AUC ${trueAuc}`);
  });

  it('true AUC accounts for a flipping transform', () => {
    const t = H.SCENARIOS.textbook;
    const c = { Y: t.Y, N: t.N, nY: 10, nN: 10, seed: 1, transform: 'neg' };
    assert.ok(Math.abs(H.casesFromSim(c).trueAuc - (1 - 0.76025)) < 1e-4);
  });

  it('rejects or sanitises malformed and hostile links', () => {
    assert.equal(H.decodeSimConfig(''), null);
    assert.equal(H.decodeSimConfig('#other=1'), null);
    assert.equal(H.decodeSimConfig('#sim=%7Bnot-json'), null);
    assert.equal(H.decodeSimConfig('#sim=' + encodeURIComponent('[1,2]')), null);
    const bad = { Y: { family: '__proto__', p: { mu: 'x' } }, N: { family: 'constructor' }, nY: 1e9, nN: -5, seed: 'abc', transform: 'constructor', label: 'x'.repeat(500) };
    const d = H.decodeSimConfig('#sim=' + encodeURIComponent(JSON.stringify(bad)));
    assert.equal(d.Y.family, 'normal'); assert.equal(d.N.family, 'normal');
    assert.deepEqual([d.nY, d.nN, d.seed, d.transform, d.label.length], [20000, 3, 0, 'none', 160]);
    assert.equal(H.cleanDist({ family: 'toString' }).family, 'normal');
  });
});
