const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./load.js');

const R = loadScripts(['stats.js', 'robustness-core.js'], ['makeRNG', 'distSample', 'delongFromSamples', 'aucRank',
  'analyzeCases', 'greedyPath', 'fragilityFromPath', 'parseDelimited', 'parseNumber', 'guessColumns', 'buildCases',
  'EXAMPLES', 'exampleToCSV', 'aucCI']);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);

function sampleData(seed, m, n, roundTo) {
  const rng = R.makeRNG(seed);
  const r = (v) => (roundTo ? Math.round(v / roundTo) * roundTo : v);
  const y = [], s = [];
  for (const v of R.distSample({ family: 'normal', p: { mu: 1, sd: 1 } }, rng, m)) { y.push(1); s.push(r(v)); }
  for (const v of R.distSample({ family: 'normal', p: { mu: 0, sd: 1 } }, rng, n)) { y.push(0); s.push(r(v)); }
  return { y, s };
}
const without = (arr, k) => arr.filter((_, i) => i !== k);

describe('analyzeCases: exact single-case what-ifs', () => {
  for (const [name, data] of [['continuous', sampleData(1, 14, 37)], ['heavily tied', sampleData(2, 20, 25, 0.5)]]) {
    it(`leave-one-out AUC, SE and CI match brute-force DeLong (${name})`, () => {
      const A = R.analyzeCases(data.y, data.s, 0.95, 0.5);
      const full = R.aucCI(data.y, data.s, 0.95);
      close(A.auc, full.auc, 1e-12, 'AUC'); close(A.se, full.se, 1e-12, 'SE'); close(A.lo, full.lo, 1e-12, 'lower');
      for (let k = 0; k < data.y.length; k++) {
        const b = R.aucCI(without(data.y, k), without(data.s, k), 0.95);
        close(A.looAuc[k], b.auc, 1e-12, `LOO AUC case ${k}`);
        close(A.looSe[k], b.se, 1e-10, `LOO SE case ${k}`);
        close(A.looLo[k], b.lo, 1e-10, `LOO lower case ${k}`);
      }
    });

    it(`flip AUC matches brute force (${name})`, () => {
      const A = R.analyzeCases(data.y, data.s, 0.95, 0.5);
      for (let k = 0; k < data.y.length; k++) {
        const y2 = data.y.slice(); y2[k] = 1 - y2[k];
        close(A.flipAuc[k], R.aucRank(y2, data.s), 1e-12, `flip case ${k}`);
      }
    });

    it(`move range = AUC with the score moved to ±∞ (${name})`, () => {
      const A = R.analyzeCases(data.y, data.s, 0.95, 0.5);
      for (let k = 0; k < data.y.length; k += 3) {
        const lo = data.s.slice(), hi = data.s.slice();
        lo[k] = -1e9; hi[k] = 1e9;
        const a = R.aucRank(data.y, lo), b = R.aucRank(data.y, hi);
        close(A.moveMin[k], Math.min(a, b), 1e-12, `min case ${k}`);
        close(A.moveMax[k], Math.max(a, b), 1e-12, `max case ${k}`);
      }
    });
  }

  it('a Y case in a small class moves the AUC far more than an N case in a big class', () => {
    const d = sampleData(3, 10, 300);
    const A = R.analyzeCases(d.y, d.s, 0.95, 0.5);
    const maxAbs = (cls) => Math.max(...d.y.map((v, k) => (v === cls ? Math.abs(A.looAuc[k] - A.auc) : 0)));
    assert.ok(maxAbs(1) > 5 * maxAbs(0), `${maxAbs(1)} vs ${maxAbs(0)}`);
    // leverage: moving a Y case from bottom to top spans exactly 1/m
    for (let k = 0; k < 10; k++) close(A.moveMax[k] - A.moveMin[k], 1 / 10, 1e-12);
  });
});

describe('greedyPath / fragility', () => {
  it('damaging path lowers the lower CI limit, flattering path raises it', () => {
    const d = sampleData(4, 15, 40);
    const ids = d.y.map((_, k) => `c${k}`);
    const down = R.greedyPath(d.y, d.s, ids, { level: 0.95, c0: 0.5, dir: -1, maxSteps: 6 });
    const up = R.greedyPath(d.y, d.s, ids, { level: 0.95, c0: 0.5, dir: 1, maxSteps: 6 });
    assert.equal(down.length, 7);
    for (let k = 1; k < down.length; k++) {
      assert.ok(down[k].lo <= down[k - 1].lo + 1e-12, 'down is monotone');
      assert.ok(up[k].lo >= up[k - 1].lo - 1e-12, 'up is monotone');
    }
  });

  it('the reported removal set really does overturn the conclusion', () => {
    const ex = R.EXAMPLES.fragile.make();
    const y = ex.map((c) => c.y), s = ex.map((c) => c.s), ids = ex.map((c) => c.id);
    const path = R.greedyPath(y, s, ids, { level: 0.95, c0: 0.5, dir: -1, maxSteps: 10 });
    const k = R.fragilityFromPath(path, 0.5);
    assert.ok(k !== null && k >= 1, `fragility ${k}`);
    const removed = new Set(path.slice(1, k + 1).map((p) => p.edit.id));
    const keep = ex.filter((c) => !removed.has(c.id));
    const d = R.aucCI(keep.map((c) => c.y), keep.map((c) => c.s), 0.95);
    assert.ok(d.lo <= 0.5, `after removing ${[...removed]} lower limit is ${d.lo}`);
  });

  it('single-class removals: greedy matches the exhaustive optimum for the AUC', () => {
    // removing Y cases only, the AUC after removing a set = mean placement of the rest, so the best
    // k removals are the k highest placements. Check the analysis ranks them that way.
    const d = sampleData(5, 8, 30);
    const A = R.analyzeCases(d.y, d.s, 0.95, 0.5);
    const yIdx = d.y.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    const byLoo = yIdx.slice().sort((a, b) => A.looAuc[a] - A.looAuc[b]);
    const byV = yIdx.slice().sort((a, b) => A.V[b] - A.V[a]);
    assert.deepEqual(byLoo, byV);
  });

  it('label flips can be included', () => {
    const ex = R.EXAMPLES.mislabel.make();
    const path = R.greedyPath(ex.map((c) => c.y), ex.map((c) => c.s), ex.map((c) => c.id),
      { level: 0.95, c0: 0.5, dir: 1, maxSteps: 3, flips: true });
    assert.equal(path.length, 4);
    assert.ok(path.some((p) => p.edit && p.edit.type === 'flip'), 'flipping N33 should be among the most flattering edits');
  });
});

describe('parsing uploaded data', () => {
  it('comma CSV with header, quotes and id column', () => {
    const p = R.parseDelimited('id,label,score\n"a, 1",Y,0.9\nb,N,0.2\nc,Y,"0.7"\n');
    assert.equal(p.hasHeader, true);
    assert.deepEqual(p.header, ['id', 'label', 'score']);
    assert.equal(p.rows[0][0], 'a, 1');
    const g = R.guessColumns(p);
    assert.deepEqual([g.idCol, g.labelCol, g.scoreCol, g.yValue], [0, 1, 2, 'Y']);
  });

  it('semicolon + decimal comma, no header, numeric labels', () => {
    const p = R.parseDelimited('1;0,83\n0;0,12\n1;0,55\n0;0,40\n');
    assert.equal(p.delim, ';');
    assert.equal(p.hasHeader, false);
    const g = R.guessColumns(p);
    assert.equal(g.labelCol, 0); assert.equal(g.scoreCol, 1); assert.equal(g.yValue, '1');
    const { cases } = R.buildCases(p, g);
    assert.deepEqual(cases.map((c) => c.s), [0.83, 0.12, 0.55, 0.4]);
  });

  it('tab-separated and whitespace-separated input', () => {
    assert.equal(R.parseDelimited('y\tscore\n1\t3\n0\t1\n').delim, '\t');
    const w = R.parseDelimited('disease 0.9\nhealthy 0.1\ndisease 0.4\n');
    assert.equal(w.rows.length, 3);
    assert.equal(R.guessColumns(w).yValue, 'disease');
  });

  it('rows with missing values are dropped and reported; duplicate ids made unique', () => {
    const p = R.parseDelimited('id,y,s\nx,1,0.5\nx,0,NA\nz,,0.3\nx,0,0.1\n');
    const { cases, dropped } = R.buildCases(p, { idCol: 0, labelCol: 1, scoreCol: 2, yValue: '1' });
    assert.deepEqual(dropped, [2, 3]);
    assert.deepEqual(cases.map((c) => c.id), ['x', 'x·2']);
    assert.equal(R.parseNumber('1e-3'), 0.001);
    assert.equal(R.parseNumber(''), null);
  });
});

describe('examples', () => {
  it('Hanley & McNeil data reproduce the published AUC 0.893', () => {
    const c = R.EXAMPLES.hanley.make();
    assert.equal(c.filter((v) => v.y).length, 51);
    assert.equal(c.filter((v) => !v.y).length, 58);
    close(R.aucRank(c.map((v) => v.y), c.map((v) => v.s)), 0.893, 5e-4);
  });

  it('example story holds: Y07 is the most influential case', () => {
    const c = R.EXAMPLES.lowY.make();
    const A = R.analyzeCases(c.map((v) => v.y), c.map((v) => v.s), 0.95, 0.5);
    let best = 0;
    for (let k = 1; k < c.length; k++) if (Math.abs(A.looAuc[k] - A.auc) > Math.abs(A.looAuc[best] - A.auc)) best = k;
    assert.equal(c[best].id, 'Y07');
  });

  it('example story holds: N33 is the visual outlier, yet removing or flipping it moves the AUC < 0.5 SE', () => {
    const c = R.EXAMPLES.mislabel.make();
    const A = R.analyzeCases(c.map((v) => v.y), c.map((v) => v.s), 0.95, 0.5);
    const k = c.findIndex((v) => v.id === 'N33');
    assert.equal(Math.max(...c.map((v) => v.s)), c[k].s, 'N33 has the highest score');
    assert.ok(Math.abs(A.looAuc[k] - A.auc) < 0.5 * A.se, 'removal < 0.5 SE');
    assert.ok(Math.abs(A.flipAuc[k] - A.auc) < 0.5 * A.se, 'flip < 0.5 SE');
    const maxY = Math.max(...c.map((v, i) => (v.y ? Math.abs(A.looAuc[i] - A.auc) : 0)));
    assert.ok(maxY > Math.abs(A.looAuc[k] - A.auc), 'some Y case matters more');
  });

  it('fragile example: conclusion holds but breaks within a few removals', () => {
    const c = R.EXAMPLES.fragile.make();
    const y = c.map((v) => v.y), s = c.map((v) => v.s);
    const A = R.analyzeCases(y, s, 0.95, 0.5);
    assert.ok(A.holds, `lower limit ${A.lo}`);
    const k = R.fragilityFromPath(R.greedyPath(y, s, c.map((v) => v.id), { level: 0.95, c0: 0.5, dir: -1, maxSteps: 10 }), 0.5);
    assert.ok(k !== null && k <= 3, `fragility ${k}`);
    close(A.auc, 0.76, 0.01, 'quoted AUC');
  });

  it('examples round-trip through CSV export and parsing', () => {
    const c = R.EXAMPLES.rare.make();
    const p = R.parseDelimited(R.exampleToCSV(c));
    const { cases } = R.buildCases(p, R.guessColumns(p));
    assert.deepEqual(cases, c);
  });
});
