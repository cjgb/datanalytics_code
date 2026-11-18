const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./load.js');

// Load the shared maths exactly as the pages do (js/stats.js, js/scenarios.js).
function loadStats() {
  return loadScripts(['stats.js', 'scenarios.js'], ['mulberry32', 'makeRandn', 'makeRNG', 'normCdf', 'normInv', 'lnGamma',
    'gammaP', 'betaI', 'FAMILIES', 'TRANSFORMS', 'cleanDist', 'distSample', 'distCdf', 'applyTransform', 'trueROC',
    'transformROC', 'aucRank', 'computeROC', 'rocFromSamples', 'delongCI', 'delongFromSamples', 'logitCI', 'quantile',
    'makeAUCResampler', 'bootstrapAUC', 'metricsAt', 'metricsSorted', 'youdenThreshold', 'drawSample',
    'simulateReplicate', 'summarizeReplicates', 'SCENARIOS']);
}

const S = loadStats();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);
const normal = (mu, sd) => ({ family: 'normal', p: { mu, sd } });
const binormalAUC = (mY, sY, mN, sN) => S.normCdf((mY - mN) / Math.hypot(sY, sN));
function labelled(pos, neg) {
  return { y: [...pos].map(() => 1).concat([...neg].map(() => 0)), s: [...pos, ...neg] };
}
// Reference O(m·n) DeLong SE, written independently of the app's implementation.
function naiveDelongSE(pos, neg) {
  const m = pos.length, n = neg.length, psi = (a, b) => (a > b ? 1 : a === b ? 0.5 : 0);
  const v10 = pos.map((p) => neg.reduce((s, q) => s + psi(p, q), 0) / n);
  const v01 = neg.map((q) => pos.reduce((s, p) => s + psi(p, q), 0) / m);
  const va = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length - 1); };
  return Math.sqrt(va(v10) / m + va(v01) / n);
}

/* ------------------------------------------------------------------ */
/* Original mock-data tests (kept)                                      */
/* ------------------------------------------------------------------ */
describe('aucRank (mock data)', () => {
  it('perfect separation = 1.0', () => {
    assert.equal(S.aucRank([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1]), 1);
  });

  it('all tied scores = 0.5', () => {
    assert.equal(S.aucRank([1, 0, 1, 0], [0.5, 0.5, 0.5, 0.5]), 0.5);
  });

  it('label flip maps AUC -> 1 - AUC', () => {
    const y = [1, 1, 0, 0];
    const s = [0.9, 0.4, 0.7, 0.1];
    const a = S.aucRank(y, s);
    const flipped = S.aucRank(y.map((v) => 1 - v), s);
    assert.ok(Math.abs(flipped - (1 - a)) < 1e-12);
  });
});

describe('computeROC (mock data)', () => {
  it('starts at (0,0), ends at (1,1), AUC matches aucRank', () => {
    const y = [1, 0, 1, 0];
    const s = [0.9, 0.8, 0.3, 0.1];
    const roc = S.computeROC(y, s);
    assert.equal(roc.fpr[0], 0);
    assert.equal(roc.tpr[0], 0);
    assert.equal(roc.fpr[roc.fpr.length - 1], 1);
    assert.equal(roc.tpr[roc.tpr.length - 1], 1);
    assert.ok(Math.abs(roc.auc - S.aucRank(y, s)) < 1e-12);
  });

  it('every vertex matches the confusion counts at its threshold (with ties)', () => {
    const y = [1, 1, 0, 1, 0, 0, 1, 0];
    const s = [0.9, 0.5, 0.5, 0.5, 0.2, 0.9, 0.1, 0.3];
    const roc = S.computeROC(y, s);
    close(roc.auc, S.aucRank(y, s), 1e-12, 'tied AUC');
    for (let k = 1; k < roc.thr.length; k++) {
      const m = S.metricsAt(y, s, roc.thr[k]);
      close(roc.tpr[k], m.sens, 1e-12, `TPR at vertex ${k}`);
      close(roc.fpr[k], 1 - m.spec, 1e-12, `FPR at vertex ${k}`);
    }
  });
});

describe('delongCI (mock data)', () => {
  it('CI brackets AUC with non-negative SE', () => {
    const y = [1, 1, 1, 0, 0, 0];
    const s = [0.9, 0.7, 0.6, 0.65, 0.3, 0.1];
    const auc = S.aucRank(y, s);
    const { se, lo, hi } = S.delongCI(y, s, auc);
    assert.ok(se >= 0);
    assert.ok(lo <= auc && auc <= hi);
    assert.ok(lo >= 0 && hi <= 1);
  });

  it('fast DeLong equals the naive O(m·n) definition, including heavy ties', () => {
    const rng = S.makeRNG(3);
    const round = (a) => Array.from(a, (v) => Math.round(v * 4) / 4);
    const pos = round(S.distSample(normal(1, 1), rng, 120));
    const neg = round(S.distSample(normal(0, 1), rng, 90));
    const d = S.delongFromSamples(Float64Array.from(pos), Float64Array.from(neg), 0.95);
    const { y, s } = labelled(pos, neg);
    close(d.auc, S.aucRank(y, s), 1e-12, 'AUC');
    close(d.se, naiveDelongSE(pos, neg), 1e-12, 'SE');
  });

  it('perfect separation gives a degenerate (zero-width) interval', () => {
    const d = S.delongFromSamples(Float64Array.of(3, 4, 5), Float64Array.of(0, 1, 2), 0.95);
    assert.equal(d.auc, 1);
    assert.equal(d.degenerate, true);
    assert.equal(d.lo, 1);
  });

  it('higher CI level gives a wider interval', () => {
    const rng = S.makeRNG(9);
    const pos = S.distSample(normal(1, 1), rng, 60), neg = S.distSample(normal(0, 1), rng, 60);
    const w = (lvl) => { const d = S.delongFromSamples(pos, neg, lvl); return d.hi - d.lo; };
    assert.ok(w(0.9) < w(0.95) && w(0.95) < w(0.99));
  });
});

describe('bootstrapAUC + quantile (mock data)', () => {
  it('is stratified, sized B, and deterministic for a fixed seed', () => {
    const y = [1, 1, 0, 0];
    const s = [0.9, 0.6, 0.7, 0.2];
    const a = S.bootstrapAUC(y, s, 50, 123);
    const b = S.bootstrapAUC(y, s, 50, 123);
    assert.equal(a.length, 50);
    assert.deepEqual(a, b);
    assert.ok(a.every((v) => v >= 0 && v <= 1));
  });

  it('quantile median of sorted bootstrap sample', () => {
    assert.equal(S.quantile([0.1, 0.2, 0.3, 0.4, 0.5], 0.5), 0.3);
  });

  it('separated classes always give 1; fully tied classes always give 0.5', () => {
    assert.ok(S.bootstrapAUC([1, 1, 0, 0], [5, 6, 1, 2], 40, 1).every((v) => v === 1));
    assert.ok(S.bootstrapAUC([1, 1, 0, 0], [3, 3, 3, 3], 40, 1).every((v) => v === 0.5));
  });

  it('bootstrap mean ≈ sample AUC and bootstrap SD ≈ DeLong SE', () => {
    const rng = S.makeRNG(11);
    const pos = S.distSample(normal(1, 1), rng, 200), neg = S.distSample(normal(0, 1), rng, 200);
    const { y, s } = labelled(pos, neg);
    const b = S.bootstrapAUC(y, s, 2000, 5);
    const mu = b.reduce((x, v) => x + v, 0) / b.length;
    const sd = Math.sqrt(b.reduce((x, v) => x + (v - mu) ** 2, 0) / (b.length - 1));
    const d = S.delongFromSamples(pos, neg, 0.95);
    close(mu, d.auc, 0.003, 'bootstrap mean');
    close(sd / d.se, 1, 0.1, 'bootstrap SD / DeLong SE');
  });
});

describe('metricsAt (mock data)', () => {
  it('confusion counts and Sens/Spec at t=0.5', () => {
    // scores: + + - - with threshold 0.5 -> TP=1 FN=1 TN=2 FP=0
    const m = S.metricsAt([1, 1, 0, 0], [0.9, 0.4, 0.3, 0.1], 0.5);
    assert.deepEqual([m.tp, m.fn, m.tn, m.fp], [1, 1, 2, 0]);
    assert.equal(m.sens, 0.5);
    assert.equal(m.spec, 1);
  });

  it('metricsSorted (binary search) agrees with metricsAt', () => {
    const rng = S.makeRNG(4);
    const pos = Array.from(S.distSample(normal(1, 1), rng, 80), (v) => Math.round(v * 10) / 10);
    const neg = Array.from(S.distSample(normal(0, 1), rng, 70), (v) => Math.round(v * 10) / 10);
    const { y, s } = labelled(pos, neg);
    const P = Float64Array.from(pos).sort(), Q = Float64Array.from(neg).sort();
    for (const t of [-3, -0.5, 0, 0.3, 0.5, 1, 1.7, 5]) {
      const a = S.metricsAt(y, s, t), b = S.metricsSorted(P, Q, t);
      assert.deepEqual([b.tp, b.fp, b.tn, b.fn], [a.tp, a.fp, a.tn, a.fn], `t=${t}`);
      close(b.prec, a.prec, 1e-12);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Special functions and distributions                                 */
/* ------------------------------------------------------------------ */
describe('special functions', () => {
  it('normCdf / normInv are accurate and mutually inverse', () => {
    close(S.normCdf(1.959963984540054), 0.975, 2e-7);
    close(S.normInv(0.975), 1.959963984540054, 1e-8);
    for (const p of [1e-6, 0.01, 0.3, 0.5, 0.8, 0.999]) close(S.normCdf(S.normInv(p)), p, 2e-7 * Math.max(1, p * 10));
  });

  it('gammaP and betaI match closed forms', () => {
    close(S.gammaP(1, 2), 1 - Math.exp(-2), 1e-12);
    close(S.gammaP(3, 10), 1 - Math.exp(-10) * (1 + 10 + 50), 1e-12);
    close(S.gammaP(3, 0.5), 1 - Math.exp(-0.5) * (1 + 0.5 + 0.125), 1e-12);
    const x = 0.4; // I_x(2,3) = 6x² − 8x³ + 3x⁴
    close(S.betaI(2, 3, x), 6 * x * x - 8 * x ** 3 + 3 * x ** 4, 1e-12);
    close(S.betaI(0.5, 0.5, 0.25), (2 / Math.PI) * Math.asin(Math.sqrt(0.25)), 1e-10);
  });
});

describe('distributions', () => {
  it('samplers reproduce theoretical means / variances', () => {
    const rng = S.makeRNG(1), n = 100000;
    const moments = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let v2 = 0; for (const v of a) v2 += (v - m) ** 2; return [m, v2 / a.length]; };
    let [m, v] = moments(S.distSample({ family: 'gamma', p: { k: 0.5, theta: 2 } }, rng, n));
    close(m, 1, 0.02, 'gamma mean'); close(v, 2, 0.08, 'gamma var');
    [m, v] = moments(S.distSample({ family: 'beta', p: { a: 5, b: 2 } }, rng, n));
    close(m, 5 / 7, 0.003, 'beta mean'); close(v, 10 / (49 * 8), 0.001, 'beta var');
    [m] = moments(S.distSample({ family: 'mixture', p: { w: 0.3, mu1: -2, sd1: 1, mu2: 2, sd2: 0.5 } }, rng, n));
    close(m, 0.3 * -2 + 0.7 * 2, 0.02, 'mixture mean');
    [m, v] = moments(S.distSample({ family: 'uniform', p: { lo: -1, hi: 3 } }, rng, n));
    close(m, 1, 0.02, 'uniform mean'); close(v, 16 / 12, 0.03, 'uniform var');
  });

  it('sampling is reproducible from the seed', () => {
    const cfg = { Y: normal(1, 1), N: normal(0, 1), nY: 30, nN: 20, transform: 'none', level: 0.95 };
    const a = S.drawSample(cfg, S.makeRNG(7)), b = S.drawSample(cfg, S.makeRNG(7));
    assert.deepEqual(Array.from(a.pos), Array.from(b.pos));
    assert.deepEqual(Array.from(a.neg), Array.from(b.neg));
  });

  it('cleanDist clamps invalid parameters', () => {
    const d = S.cleanDist({ family: 'normal', p: { mu: 'abc', sd: -1 } });
    assert.equal(d.p.mu, 0);
    assert.ok(d.p.sd > 0);
    const u = S.cleanDist({ family: 'uniform', p: { lo: 2, hi: 1 } });
    assert.ok(u.p.hi > u.p.lo);
    assert.equal(S.cleanDist({ family: 'nope', p: {} }).family, 'normal');
  });
});

/* ------------------------------------------------------------------ */
/* True (population) ROC / AUC                                          */
/* ------------------------------------------------------------------ */
describe('trueROC', () => {
  it('matches the binormal closed form Φ(Δμ/√(σ²+σ²))', () => {
    for (const [mY, sY, mN, sN] of [[1, 1, 0, 1], [1.904, 2.5, 0, 1], [2, 1, 0, 1], [0.1, 1, 0, 1], [0, 0.01, 0, 100], [-1, 0.5, 0, 2]]) {
      close(S.trueROC(normal(mY, sY), normal(mN, sN)).auc, binormalAUC(mY, sY, mN, sN), 1e-6, `${mY},${sY} vs ${mN},${sN}`);
    }
  });

  it('handles uniform, mixture, and spiky beta distributions', () => {
    const U = (lo, hi) => ({ family: 'uniform', p: { lo, hi } });
    close(S.trueROC(U(0.5, 1.5), U(0, 1)).auc, 0.875, 1e-6, 'uniform shift');
    close(S.trueROC(U(0, 1), U(0, 1)).auc, 0.5, 1e-9, 'identical');
    const mix = { family: 'mixture', p: { w: 0.46, mu1: 0, sd1: 1, mu2: 3, sd2: 1 } };
    close(S.trueROC(mix, normal(0, 1)).auc, 0.46 * 0.5 + 0.54 * S.normCdf(3 / Math.SQRT2), 1e-6, 'mixture');
    // Beta(a,1) vs Beta(1,1): P(X > U) = E[X] = a/(a+1)
    close(S.trueROC({ family: 'beta', p: { a: 0.2, b: 1 } }, { family: 'beta', p: { a: 1, b: 1 } }).auc, 0.2 / 1.2, 2e-4, 'spiky beta');
    // Gamma(k,θ) vs Exp: P(G > E) with E~Exp(1), G~Gamma(2,1) → 1 − E[e^{−G}] = 1 − (1/2)^2 = 0.75
    close(S.trueROC({ family: 'gamma', p: { k: 2, theta: 1 } }, { family: 'gamma', p: { k: 1, theta: 1 } }).auc, 0.75, 1e-5, 'gamma');
  });

  it('curve is monotone from (0,0) to (1,1)', () => {
    const r = S.trueROC(normal(1, 2), normal(0, 1));
    assert.equal(r.fpr[0], 0); assert.equal(r.tpr[0], 0);
    assert.equal(r.fpr.at(-1), 1); assert.equal(r.tpr.at(-1), 1);
    for (let k = 1; k < r.fpr.length; k++) assert.ok(r.fpr[k] >= r.fpr[k - 1] - 1e-15 && r.tpr[k] >= r.tpr[k - 1] - 1e-15);
  });

  it('sample AUC converges to the true AUC', () => {
    const Y = { family: 'gamma', p: { k: 3, theta: 1 } }, N = { family: 'beta', p: { a: 2, b: 2 } };
    const rng = S.makeRNG(2);
    const d = S.delongFromSamples(S.distSample(Y, rng, 20000), S.distSample(N, rng, 20000), 0.95);
    close(d.auc, S.trueROC(Y, N).auc, 4 * d.se, 'large-sample AUC');
  });
});

describe('score transforms', () => {
  const cfgFor = (transform) => ({ Y: { family: 'beta', p: { a: 4, b: 2 } }, N: { family: 'beta', p: { a: 2, b: 4 } }, nY: 200, nN: 150, transform, level: 0.95 });
  it('increasing transforms leave the sample AUC exactly unchanged', () => {
    const base = S.simulateReplicate(cfgFor('none'), S.makeRNG(5)).auc;
    for (const t of ['cube', 'exp', 'logistic']) assert.equal(S.simulateReplicate(cfgFor(t), S.makeRNG(5)).auc, base, t);
  });
  it('flipping the score gives 1 − AUC, for the sample and the true ROC', () => {
    const base = S.simulateReplicate(cfgFor('none'), S.makeRNG(5)).auc;
    close(S.simulateReplicate(cfgFor('neg'), S.makeRNG(5)).auc, 1 - base, 1e-12);
    const r = S.trueROC(normal(1, 1), normal(0, 1));
    close(S.transformROC(r, 'neg').auc, 1 - r.auc, 1e-12);
    assert.equal(S.transformROC(r, 'cube'), r);
  });
});

/* ------------------------------------------------------------------ */
/* Repeated experiments                                                  */
/* ------------------------------------------------------------------ */
describe('simulateReplicate / summarizeReplicates', () => {
  it('DeLong coverage is close to nominal for a moderate textbook study', () => {
    const cfg = { Y: normal(1, 1), N: normal(0, 1), nY: 100, nN: 100, transform: 'none', level: 0.95 };
    const rng = S.makeRNG(123), reps = [];
    for (let r = 0; r < 400; r++) reps.push(S.simulateReplicate(cfg, rng));
    const sum = S.summarizeReplicates(reps, binormalAUC(1, 1, 0, 1));
    assert.equal(sum.R, 400);
    assert.ok(sum.coverage > 0.91 && sum.coverage < 0.99, `coverage ${sum.coverage}`);
    close(sum.bias, 0, 0.01, 'bias');
    close(sum.seMean / sum.sd, 1, 0.15, 'mean DeLong SE / empirical SE');
    assert.ok(sum.power > 0.99, 'AUC 0.76 with 100/class is always detectably > 0.5');
  });

  it('optional bootstrap CIs are produced and summarised', () => {
    const cfg = { Y: normal(1, 1), N: normal(0, 1), nY: 30, nN: 30, transform: 'none', level: 0.9 };
    const rng = S.makeRNG(8), reps = [];
    for (let r = 0; r < 60; r++) reps.push(S.simulateReplicate(cfg, rng, { bootB: 100 }));
    assert.ok(reps.every((r) => r.bLo <= r.auc + 1e-9 && r.auc - 1e-9 <= r.bHi));
    const sum = S.summarizeReplicates(reps, 0.76);
    assert.ok(sum.bootCoverage >= 0 && sum.bootCoverage <= 1);
  });
});

/* ------------------------------------------------------------------ */
/* Scenario texts make quantitative claims; keep them honest           */
/* ------------------------------------------------------------------ */
describe('scenario claims', () => {
  const auc = (k) => S.trueROC(S.SCENARIOS[k].Y, S.SCENARIOS[k].N).auc;
  it('"same AUC" scenarios really match the textbook AUC (0.760)', () => {
    close(auc('textbook'), 0.7602, 1e-4);
    close(auc('unequal'), auc('textbook'), 1e-3, 'unequal variances');
    close(auc('subgroup'), auc('textbook'), 1e-3, 'hidden subgroup');
  });
  it('quoted AUCs for the other scenarios are correct', () => {
    close(auc('rare'), 0.921, 5e-4);
    close(auc('chance'), 0.528, 5e-4);
    close(auc('small'), 0.760, 5e-4);
    assert.equal(S.SCENARIOS.rare.nY / (S.SCENARIOS.rare.nY + S.SCENARIOS.rare.nN) < 0.011, true);
  });
  it('unequal-variance ROC: TPR at FPR 1% ≈ 43% vs ≈ 9% for textbook, and it dips below chance', () => {
    const z = S.normInv(0.99), u = S.SCENARIOS.unequal.Y.p;
    close(S.normCdf((u.mu - z) / u.sd), 0.43, 0.01);
    close(S.normCdf(1 - z), 0.09, 0.01);
    const r = S.trueROC(S.SCENARIOS.unequal.Y, S.SCENARIOS.unequal.N);
    assert.ok(r.fpr.some((f, i) => f > 0.5 && r.tpr[i] < f - 0.01), 'some part of the curve lies below the diagonal');
  });
  it('hidden subgroup caps sensitivity near 54% at low FPR', () => {
    const r = S.trueROC(S.SCENARIOS.subgroup.Y, S.SCENARIOS.subgroup.N);
    const i = r.fpr.findIndex((f) => f >= 0.02);
    assert.ok(r.tpr[i] > 0.45 && r.tpr[i] < 0.56, `TPR ${r.tpr[i]} at FPR ${r.fpr[i]}`);
  });
});
