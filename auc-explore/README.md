# AUC Explorer

Two web apps about the **AUC** as a measure of binary-classifier performance, plus a
tutorial guide. The pages are peers (the guide is listed first in the navigation),
link to each other, and share one stylesheet and one statistics library.

| Page | Question it answers |
|---|---|
| **`auc-guide.html`** | *How do I use the tools, and what do the plots tell me?* A tutorial for students: a primer on ROC curves and the AUC, annotated screenshots of every panel, guided scenarios, exercises with answers, formulas, a glossary and references. |
| **`auc-simulator.html`** | *What does the AUC capture, and what does it leave out?* Choose P(score \| Y) and P(score \| N), simulate studies, and see the ROC curve, the CIs, their coverage, and scenarios such as "same AUC, different classifier". |
| **`auc-robustness.html`** | *How much does my AUC depend on particular observations?* Load your own scores and labels (or an example), see each case's exact effect on the AUC and its CI, and move, remove or relabel cases as a logged sensitivity analysis. |

Both run fully in the browser: no build step, no dependencies, and nothing is
sent anywhere. They use plain `<script src>` tags (not ES modules), so they work
when opened directly from disk as well as from a web server or portal.

## Quick start

```sh
cd auc-exploration-tool
python3 -m http.server 8000    # then visit http://localhost:8000/auc-guide.html
# or just double-click any of the HTML files inside auc-exploration-tool/
```

Deploy: copy the `auc-exploration-tool/` folder as-is to the HTML server.
It is self-contained (HTML + `css/` + `js/` + `docs/img/*.webp`) with no build step.

**Deep links** (used by the guide's "open ↗" buttons):
`auc-simulator.html#scenario=<key>` opens a scenario (`textbook`, `unequal`, `subgroup`, `rare`,
`small`, `chance`, `ranks`), and `auc-robustness.html#example=<key>` opens an example
(`lowY`, `mislabel`, `fragile`, `rare`, `hanley`).

---

# Guide (`auc-guide.html`)

The guide contains 31 screenshots of the real apps (`auc-exploration-tool/docs/img/*.webp`, 3.2 MB in total), most of them
with numbered callouts that are explained in the text. The screenshots are **generated**, not hand-made:

```sh
pip install playwright pillow && playwright install chromium   # once, developer machine only
python3 tools/make-guide-screenshots.py
```

The script drives both apps through fixed scenarios with fixed seeds (and a seeded `Math.random`), so
the images are reproducible and match the numbers quoted in the text. It draws the callouts, writes
`tools/manifest.json`, and updates the `width`/`height` of the guide's `<img>` tags. Re-run it after
any UI change. The test suite then checks that each figure's callout list in the text has as many items as
the image has numbers.

---

# Simulator (`auc-simulator.html`)

## What you can do

| Panel | What it shows |
|---|---|
| **Class settings** (sidebar) | For each class: Normal, Beta, Uniform, Gamma or a two-normal mixture, plus the sample size. The **true AUC** of the chosen distributions updates live. |
| **Score distributions** | Overlapping histograms of the Y / N sample with the true densities on top. Switch between *density* (compare shapes) and *counts* (see class imbalance). **Drag** to move the threshold. |
| **ROC curve** | Sample ROC (shaded area = AUC), true ROC (dashed), and the operating point. **Click** the curve to pick a threshold. **📌 Pin** curves to compare ROC shapes. |
| **KPIs** | True AUC, sample AUC (and its error), DeLong and bootstrap CIs, each marked ✓/✗ for whether it contains the true AUC, plus Sens/Spec/PPV at the threshold. |
| **Bootstrap distribution** | The B bootstrap AUCs, the bootstrap percentile CI, and the DeLong CI. |
| **Repeat the experiment** | Reruns the same study R times: the sampling distribution of the AUC, the first 100 CIs (misses in red), **coverage** of DeLong and bootstrap CIs, **power** vs chance, and the empirical vs estimated SE. The replicate ROCs appear faintly on the ROC plot. |
| **Confusion matrix** | TP/FP/TN/FN, Sens, Spec, PPV, NPV, F1, Youden J, prevalence. |
| **Pair game** | Draw random (Y, N) pairs. The share of pairs where the Y case scores higher converges to the AUC. |
| **Score transform** | Apply s³, exp, logistic or −s to both classes: the AUC is unchanged by increasing transforms and flips to 1 − AUC under −s. |

### Guided scenarios

Each scenario loads settings plus a short "what to notice / try" note.

| Scenario | Lesson |
|---|---|
| Textbook binormal | AUC = P(S_Y > S_N) = Φ(Δμ/√2) ≈ 0.760; a sample AUC wobbles around it. |
| Same AUC, different classifier | Unequal variances give the same AUC (0.760) but a very different ROC: much better at low FPR, and below chance in the top-right corner. |
| Hidden subgroup | 46% of positives are indistinguishable from negatives, yet the AUC is still 0.76. |
| Rare positives (1%) | The AUC ignores prevalence; PPV doesn't. The CI width is driven by the minority class. |
| Small study (15/class) | A single study can report anything from about 0.6 to 0.9; check whether the CIs keep their promised coverage. |
| Barely better than chance | Power to exclude 0.5, and how a large n makes a nearly useless model "significant". |
| Only the ranking matters | The AUC is invariant to monotone transforms, so it can't see calibration. |

The quantitative claims in these texts (e.g. "same AUC", "TPR 43% vs 9% at
FPR 1%") are checked by the test suite.

## Methods (short version — full details in the page's *Methods & formulas*)

- **True ROC / AUC**: ROC(t) = (1 − F_N(t), 1 − F_Y(t)) from exact CDFs (erfc,
  regularised incomplete gamma/beta). Thresholds are refined adaptively so that no
  interval carries more than 0.05% of either class's mass. The trapezoidal area
  matches closed forms to about 1e-6.
- **Sample AUC**: Mann–Whitney; tied scores get ½ credit, and ties form diagonal
  ROC segments.
- **DeLong CI**: structural components from one sort per class (O(N log N),
  equivalent to Sun & Xu 2014). Logit-scale interval; a sample AUC of exactly
  0 or 1 gives a degenerate, zero-width CI.
- **Bootstrap CI**: stratified (each class resampled separately), percentile.
  Each replicate costs O(N) because it only redraws multiplicity weights over
  pre-sorted scores.
- **Repeated experiments**: coverage reported with its Monte-Carlo SE; power =
  the share of CIs with lower limit > 0.5.
- **Reproducibility**: seeded mulberry32 generator. The seed stays fixed while you
  move parameters, so differences come from the parameters, not from noise.

## Performance (simulator)

All heavy work (bootstrap, repeated experiments) runs in small time slices, so
the page stays responsive, shows progress, and can be cancelled. At the maximum
size (20,000 per class), one sample with B = 1000 bootstrap replicates finishes in
about 3–5 s in Chrome; at the default 500 per class everything is effectively
instant.

---

# Robustness lab (`auc-robustness.html`)

### Data

- **Examples:**
  - *One surprising patient*: 20 Y vs 60 N, with one Y case scored very low.
  - *Suspected mislabelled control*: a visual outlier that turns out to have little influence.
  - *Fragile conclusion*: 12 Y vs 30 N, where 2 removals overturn the result.
  - *Rare positives*: 15 Y vs 400 N.
  - The real **Hanley & McNeil (1982)** CT rating data: 51 Y vs 58 N, 5-point scale, AUC 0.893.
- **Your data:** upload a CSV/TSV or paste it.
  - The delimiter (`,` `;` tab `|` or spaces), the header row, decimal commas and quoted fields are detected automatically.
  - You pick the score, label and id columns and which label value means Y; the page makes a first guess.
  - Rows with a missing label or score are dropped and reported.
  - A toggle handles scores where *lower* means Y.

### From the simulator to the robustness lab

In the simulator, **Inspect this sample in the Robustness lab ↗** opens the current
sample in the lab, in a new tab. The link carries the *recipe* (distributions, sample sizes,
seed, transform), not the data, e.g. `auc-robustness.html#sim=…`, about 500 characters even
for 40,000 cases.

The lab regenerates exactly the same sample with the same seeded generator, so the AUC and CI match
the simulator's to the last digit. Because the data are simulated, the lab also shows the
**true AUC** (in the KPIs and on the sensitivity curve) and the **true ROC**. This lets you see
that removing "influential" cases from a sample where nothing is wrong pushes the estimate
wherever you choose, not towards the truth.

The link can be bookmarked or shared. It is validated on arrival: unknown families or
transforms fall back to defaults, and sizes are clamped.

### Views

| View | What it shows |
|---|---|
| **KPIs** | Original vs current AUC and CI; whether the **conclusion** (lower CI limit > c₀, default 0.5 = better than chance) holds; **fragility** (how many greedy removals or flips change it); your edits. |
| **Observations** (strip plot) | One row per class; dot size = how much removing the case moves the AUC. Dark outline = at least ½ SE, or the removal changes the conclusion. A class with more than 300 cases is drawn as a density band plus its 40 most influential cases. |
| **ROC staircase** | Each Y case is a vertical step of 1/n_Y and each N case a horizontal step of 1/n_N (tied cases form diagonal segments). The original ROC is drawn in grey. Click a step to select its case. |
| **Sensitivity curve** | Starting from the original data: the AUC (solid) and lower CI limit (dashed) after the k most damaging (red) or most flattering (green) removals, optionally including label flips. Your own edits are drawn on top. If they are as favourable as the best possible choice, the page says so. |
| **Table** | Per case: placement, ΔAUC if removed (raw and in SE units), whether removal changes the conclusion, ΔAUC if flipped, and the AUC range if its score could be anywhere. Sortable and filterable, with per-row actions. |
| **Inspector** | All of the above for the selected case, in words, plus the edit buttons. |
| **Edit log** | Every edit with AUC and lower limit before → after. Undo, reset, export the log, and download the edited data with per-case effects. |

### Interaction

- Click a dot, a ROC step or a table row to select a case.
- **Drag** a dot sideways to change its score.
- Keys: <kbd>Del</kbd> exclude/include · <kbd>F</kbd> flip label · <kbd>R</kbd> restore · <kbd>←</kbd>/<kbd>→</kbd> previous/next case · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo.

### Methods

All single-case "what ifs" are **exact** and cheap:

- **Removal:** removing a Y case changes the AUC by `(AUC − V)/(n_Y − 1)`, where V is its
  placement value (share of N cases below it, ties ½); likewise for N cases.
  The new DeLong SE is exact too, computed in O(log N) per case from prefix sums of
  placement values over the sorted scores.
- **Label flip:** closed form.
- **Moving a score:** the AUC range is `[AUC − V/n, AUC + (1 − V)/n]`, where n is the
  case's class size. So a case's leverage is **1/(size of its class)**, which is why,
  with a small Y class, Y cases dominate.
- **Fragility:** a greedy search. It finds an achievable set of edits, so
  "k edits suffice" is an upper bound on the true minimum.

The page reports a **sensitivity analysis**. Removing cases because they lower the AUC
biases it upward, so the original result is always shown alongside the edited one.

---

## Files

```text
auc-exploration-tool/    # deploy this folder as-is to the HTML server (self-contained)
  auc-guide.html         # tutorial
  auc-simulator.html     # app 1
  auc-robustness.html    # app 2
  css/common.css         # shared styles (layout, cards, KPIs, controls, navigation)
  css/robustness.css     # robustness-lab specific styles
  css/guide.css          # guide styles (article, figures, callouts, exercises)
  js/stats.js            # shared pure statistics: RNG, distributions, ROC/AUC, DeLong, bootstrap, simulation
  js/ui-common.js        # shared SVG plotting + small DOM/format helpers
  js/scenarios.js        # simulator lessons (pure data)
  js/simulator.js        # simulator UI
  js/robustness-core.js  # pure robustness maths, CSV parsing, example datasets
  js/handoff.js          # pure: encode/decode the simulator → robustness link, regenerate the sample
  js/robustness.js       # robustness-lab UI
  js/guide.js            # guide: highlights the current section in the table of contents
  docs/img/*.webp        # guide screenshots (generated, no build step at runtime)
tools/make-guide-screenshots.py  # regenerates auc-exploration-tool/docs/img (Python + Playwright + Pillow)
tools/manifest.json      # screenshot callout data used by the test suite (not deployed)
tests/load.js          # loads the browser scripts into Node (same code, no duplication)
tests/simulator.test.js
tests/robustness.test.js
tests/handoff.test.js
tests/guide.test.js
package.json           # `npm test` (no dependencies)
```

Pure files (`stats.js`, `scenarios.js`, `robustness-core.js`, `handoff.js`) never touch the DOM,
so the tests load them directly. To embed the apps in a portal, copy the
`auc-exploration-tool/` folder and include the same `<link>`/`<script>` tags. Each page's
markup lives in its HTML file.

## Testing

Uses Node's built-in runner (Node ≥ 18), no install needed:

```sh
npm test        # or: node --test
```

There are 61 tests:

- **Simulator (32):** special functions vs closed forms; sampler moments; true
  AUC vs closed forms; fast DeLong vs a naive O(m·n) reference with heavy ties;
  bootstrap properties; transform invariance; CI coverage; and the scenario claims.
- **Robustness lab (20):**
  - Leave-one-out AUC/SE/CI, flip and move effects vs brute-force recomputation, on continuous and heavily tied data.
  - Greedy paths are monotone, and the reported removal set really overturns the conclusion.
  - CSV parsing: delimiters, decimal commas, quotes, missing values, duplicate ids.
  - Hanley & McNeil reproduces AUC 0.893.
  - Each example's story holds.
- **Hand-off (4):** the link round-trips, the lab regenerates exactly the simulator's sample,
  the true AUC accounts for a flipping transform, and malformed or hostile links are rejected or sanitised.
- **Guide (5):**
  - every screenshot exists, with matching size and an alt text
  - callout counts match the images
  - internal anchors, page links and deep links resolve
  - figures are numbered in order
  - the navigation order is the same on all pages

## Possible next steps

- Robustness lab: pairs of cases (joint influence), bootstrap-based influence,
  and a per-case "how far must its score move before the AUC changes" view.

- Partial AUC / a highlighted FPR range of interest.
- Precision–recall curve next to the ROC, to show prevalence effects.
- Calibration: treat scores as probabilities and show calibration plots, Brier
  score and log-loss next to the AUC.
- Comparing two classifiers on the same cases (correlated scores, paired DeLong
  test).
- Discretised scores (rating scales) and their effect on ties and the AUC.
- Shareable URLs that encode the current settings.

## License

MIT — do anything, no warranty.
