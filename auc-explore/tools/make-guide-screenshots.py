#!/usr/bin/env python3
"""
Regenerate the screenshots used by auc-guide.html  →  auc-exploration-tool/docs/img/*.webp (+ tools/manifest.json)

Requirements (developer machine only; the web pages themselves need nothing):
    pip install playwright pillow && playwright install chromium
Usage:
    python3 tools/make-guide-screenshots.py

Deterministic: Math.random is replaced by a seeded generator and every scene uses fixed seeds,
so re-running after a UI change gives comparable images. Numbered callouts are drawn on the images;
their order must match the <ol class="callouts" data-for="NAME"> lists in auc-guide.html (the test
suite checks that the counts agree, using manifest.json). Finally the width/height attributes of the
guide's <img> tags are updated to the new image sizes.
"""

import asyncio, io, json, pathlib, re, tempfile
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "auc-exploration-tool"
OUT = APP / "docs" / "img"
GUIDE = APP / "auc-guide.html"
MANIFEST = ROOT / "tools" / "manifest.json"
DSF = 2  # device scale factor (crisp on high-DPI screens)
ACCENT = (112, 72, 232)  # callout colour (matches the guide's callout badges)
try:
    FONT = ImageFont.truetype("DejaVuSans-Bold.ttf", 14 * DSF)
except OSError:
    try:
        FONT = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14 * DSF
        )
    except OSError:
        FONT = ImageFont.load_default()

# page helpers: points on SVG polylines in viewport coordinates (to anchor callouts on curves)
PAGE_HELPERS = """
window.__svgPt = (el, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM()); return { x: q.x, y: q.y }; };
window.__ptAt = (sel, idx, frac) => { const el = document.querySelectorAll(sel)[idx], n = el.points.length;
  return __svgPt(el, el.points[Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))))]); };
window.__ptTop = (sel, idx) => { const el = document.querySelectorAll(sel)[idx]; let b = null;
  for (const p of el.points) if (!b || p.y < b.y) b = p; return __svgPt(el, b); };
"""

SEEDED_RANDOM = """(() => { let a = 20240611;
  Math.random = function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"""

manifest = {}


def url(page_name, hash_=""):
    return (APP / page_name).as_uri() + hash_


async def box(page, target):
    loc = page.locator(target) if isinstance(target, str) else target
    b = await loc.first.bounding_box()
    if b is None:
        raise RuntimeError(f"element not visible: {target}")
    return b


async def capture(page, name, region, marks=(), pad=22, pad_top=None):
    """Screenshot the union of `region` element(s) and draw numbered callouts.
    marks: list of dicts {t: selector | js: expression returning {x, y}, at: tl|tr|bl|br|t|b|l|r|c, box: bool, dx, dy}.
    Default placement: just outside the left edge of the element (so the badge doesn't cover text)."""
    regs = region if isinstance(region, (list, tuple)) else [region]
    bs = [await box(page, r) for r in regs]
    x0 = max(0, min(b["x"] for b in bs) - pad)
    y0 = max(0, min(b["y"] for b in bs) - (pad if pad_top is None else pad_top))
    x1 = max(b["x"] + b["width"] for b in bs) + pad
    y1 = max(b["y"] + b["height"] for b in bs) + pad
    png = await page.screenshot(
        clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
    )
    img = Image.open(io.BytesIO(png)).convert("RGB")
    d = ImageDraw.Draw(img)
    r = 13 * DSF
    for i, m in enumerate(marks, 1):
        if "js" in m:
            pt = await page.evaluate(m["js"])
            b = {"x": pt["x"], "y": pt["y"], "width": 0, "height": 0}
            m = {"box": False, "at": "c", **m}
        else:
            b = await box(page, m["t"])
            if "at" not in m:
                m = {"at": "l", "dx": -15, **m}
        X, Y, W, H = (
            (b["x"] - x0) * DSF,
            (b["y"] - y0) * DSF,
            b["width"] * DSF,
            b["height"] * DSF,
        )
        if m.get("box", True):
            g = 3 * DSF
            d.rounded_rectangle(
                [X - g, Y - g, X + W + g, Y + H + g],
                radius=6 * DSF,
                outline=ACCENT,
                width=2 * DSF,
            )
        at = m.get("at", "tl")
        cx = {"l": X, "c": X + W / 2, "r": X + W}[
            "l" if "l" in at else "r" if "r" in at else "c"
        ]
        cy = {"t": Y, "c": Y + H / 2, "b": Y + H}[
            "t" if "t" in at else "b" if "b" in at else "c"
        ]
        cx += m.get("dx", 0) * DSF
        cy += m.get("dy", 0) * DSF
        cx = min(max(cx, r + 2), img.width - r - 2)
        cy = min(max(cy, r + 2), img.height - r - 2)
        d.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=ACCENT,
            outline="white",
            width=2 * DSF,
        )
        d.text((cx, cy + DSF), str(i), fill="white", font=FONT, anchor="mm")
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.webp", "WEBP", quality=86, method=6)
    manifest[name] = {
        "w": round(img.width / DSF),
        "h": round(img.height / DSF),
        "marks": len(marks),
    }
    print(
        f"  {name}.webp  {manifest[name]['w']}×{manifest[name]['h']}  callouts: {len(marks)}"
    )


async def new_page(browser):
    ctx = await browser.new_context(
        viewport={"width": 1400, "height": 2600}, device_scale_factor=DSF
    )
    await ctx.add_init_script(SEEDED_RANDOM)
    await ctx.add_init_script(PAGE_HELPERS)
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.errors = errors
    return page


async def load(page, page_name, hash_=""):
    """Full page load (going through about:blank: a hash-only change would not reload the app)."""
    await page.goto("about:blank")
    await page.goto(url(page_name, hash_))


async def wait_boot(page):
    await page.wait_for_function(
        "document.getElementById('kBoot').textContent.startsWith('[')", timeout=60000
    )


async def run_reps(page, boot=False):
    if boot:
        await page.check("#repBoot")
    await page.click("#btnRep")
    await page.wait_for_function(
        "!document.getElementById('btnRep').disabled", timeout=120000
    )
    await page.wait_for_timeout(200)


C = lambda i: (
    f".charts > .card >> nth={i}"
)  # main-area cards (simulator and lab share this structure)
SEC = lambda i: f"aside .sec >> nth={i}"  # sidebar sections


async def simulator_scenes(browser):
    p = await new_page(browser)
    await load(p, "auc-simulator.html")
    await wait_boot(p)
    # 1. overview
    await capture(
        p,
        "sim-overview",
        ["aside.controls", C(1)],
        [
            {"t": "#scenario"},
            {"t": ".sec.cls-y"},
            {"t": ".sec.cls-n"},
            {"t": SEC(3)},
            {"t": SEC(4)},
            {"t": "#lesson"},
            {"t": ".kpis"},
            {"t": C(0)},
            {"t": C(1)},
        ],
        pad_top=6,
    )
    # 2. histogram
    await capture(
        p,
        "sim-hist",
        C(0),
        [
            {"t": "#histMode", "at": "tl"},
            {
                "t": '#histPlot rect[fill="#c2255c"]',
                "at": "tl",
                "box": False,
                "dx": -14,
            },
            {"js": "__ptTop('#histPlot polyline', 1)", "dy": -16},
            {
                "t": "#histPlot path >> nth=1",
                "at": "br",
                "box": False,
                "dx": -40,
                "dy": -70,
            },
            {
                "t": '#histPlot rect[fill="rgba(194,37,92,.045)"]',
                "at": "tr",
                "box": False,
                "dx": -20,
                "dy": 40,
            },
        ],
    )
    # 3. ROC
    await capture(
        p,
        "sim-roc",
        C(1),
        [
            {"t": "#rocPlot circle", "at": "tl", "box": False, "dx": -10, "dy": -10},
            {
                "js": """__ptAt('#rocPlot polyline[stroke="#6741d9"]', 0, 0.12)""",
                "dx": 18,
                "dy": 10,
            },
            {
                "js": """__ptAt('#rocPlot polyline[stroke="#212529"]', 0, 0.8)""",
                "dx": -16,
                "dy": -16,
            },
            {
                "t": '#rocPlot line[stroke="#adb5bd"]',
                "at": "c",
                "box": False,
                "dx": 15,
                "dy": 15,
            },
            {"t": "#rocPlot text >> text=sample AUC"},
            {"t": C(1) + " >> .btnrow"},
        ],
    )
    # 4. KPIs
    await capture(
        p,
        "sim-kpis",
        ".kpis",
        [
            {"t": f".kpi >> nth={i}", "at": "tr", "box": False, "dx": -8, "dy": 8}
            for i in range(5)
        ],
    )
    # 5. bootstrap
    await capture(
        p,
        "sim-bootstrap",
        C(2),
        [
            {
                "t": '#bootPlot line[stroke="#0c8599"]',
                "at": "l",
                "box": False,
                "dx": -16,
            },
            {
                "t": '#bootPlot rect[fill="rgba(151,117,250,.13)"]',
                "at": "tl",
                "box": False,
                "dx": 14,
                "dy": 14,
            },
            {
                "t": '#bootPlot line[stroke="#6741d9"]',
                "at": "b",
                "box": False,
                "dx": 14,
                "dy": -14,
            },
            {
                "t": '#bootPlot line[stroke="#212529"]',
                "at": "b",
                "box": False,
                "dx": -14,
                "dy": -14,
            },
            {"t": "#bootNote"},
        ],
    )
    # 6. confusion matrix + pair game
    await p.click("#pair100")
    await p.click("#pair1")
    await p.wait_for_timeout(150)
    await capture(
        p,
        "sim-confusion-pair",
        [C(4), C(5)],
        [
            {"t": "#cmWrap"},
            {"t": "#cmMetrics"},
            {"t": "#cmNote"},
            {"t": C(5) + " >> .btnrow"},
            {"t": "#pairOut"},
        ],
    )
    await capture(
        p,
        "sim-pair-markers",
        C(0),
        [
            {"t": "#histPlot text >> text=Y", "at": "t", "box": False, "dy": -14},
            {"t": "#histPlot text >> text=N", "at": "t", "box": False, "dy": -14},
        ],
    )
    # 7. repeated experiments (small study, with bootstrap)
    await load(p, "auc-simulator.html", "#scenario=small")
    await wait_boot(p)
    await run_reps(p, boot=True)
    await capture(
        p,
        "sim-repeat",
        "#repCard",
        [
            {"t": ".rep-controls"},
            {"t": "#repHist"},
            {"t": "#repForest"},
            {"t": ".stat >> nth=1"},
            {"t": ".stat >> nth=2"},
            {"t": ".stat >> nth=4"},
            {"t": ".stat >> nth=5"},
            {"t": ".stat >> nth=6"},
        ],
    )
    await capture(p, "sim-replicate-rocs", C(1))
    # 8. scenarios
    for key in ["unequal", "subgroup"]:
        await load(p, "auc-simulator.html", f"#scenario={key}")
        await wait_boot(p)
        await capture(p, f"sim-{key}", [C(0), C(1)])
    await load(p, "auc-simulator.html", "#scenario=rare")
    await wait_boot(p)
    await capture(p, "sim-rare", [".kpis", C(1)])
    await capture(p, "sim-rare-cm", C(4))
    await load(p, "auc-simulator.html", "#scenario=ranks")
    await wait_boot(p)
    await p.select_option("#transform", "logistic")
    await wait_boot(p)
    await capture(p, "sim-transform", [".kpis", C(1)])
    await load(p, "auc-simulator.html", "#scenario=chance")
    await wait_boot(p)
    await run_reps(p)
    await capture(p, "sim-chance-reps", "#repCard")
    if p.errors:
        raise RuntimeError(f"simulator page errors: {p.errors}")


async def lab_scenes(browser):
    p = await new_page(browser)
    await load(p, "auc-robustness.html")
    await p.wait_for_timeout(800)
    # 1. overview
    await capture(
        p,
        "rob-overview",
        ["aside.controls", C(0)],
        [
            {"t": SEC(0)},
            {"t": SEC(1)},
            {"t": "#inspector"},
            {"t": "#about"},
            {"t": ".kpis"},
            {"t": C(0)},
            {"t": C(0) + " >> .btnrow", "at": "tl"},
        ],
        pad_top=6,
    )
    # 2. select Y07: strip, inspector, staircase
    await p.evaluate("select(R.idToKey.get('Y07'))")
    await p.wait_for_timeout(200)
    big_n = await p.evaluate("""R.cases.filter(c => c.y === 0).map(c => [c.key, Math.abs(effects(c).d)])
                                  .sort((a, b) => b[1] - a[1])[0][0]""")
    await capture(
        p,
        "rob-strip",
        C(0),
        [
            {
                "t": '#strip circle.dot[data-key="6"]',
                "at": "br",
                "box": False,
                "dx": 8,
                "dy": 8,
            },
            {
                "t": f'#strip circle.dot[data-key="{big_n}"]',
                "at": "tr",
                "box": False,
                "dx": 6,
                "dy": -6,
            },
            {"t": "#strip text >> text=n = 20", "at": "l", "box": False, "dx": -16},
            {"t": C(0) + " >> .legend"},
            {"t": C(0) + " >> p.note"},
        ],
    )
    await capture(
        p,
        "rob-inspector",
        "#inspector",
        [
            {"t": "#insScore"},
            {"t": "#inspector dd >> nth=0"},
            {"t": "#inspector dd >> nth=1"},
            {"t": "#inspector dd >> nth=2"},
            {"t": "#inspector dd >> nth=3"},
            {"t": "#inspector .acts"},
        ],
    )
    await capture(
        p,
        "rob-staircase",
        C(1),
        [
            {"t": "#roc text >> text=Y07", "at": "r", "box": False, "dx": 16},
            {"t": "#roc text >> text=AUC 0.808"},
        ],
    )
    # 3. exclude Y07
    await p.keyboard.press("Delete")
    await p.wait_for_timeout(300)
    await p.wait_for_function("document.getElementById('kFrag').textContent !== '…'")
    await capture(
        p,
        "rob-after-exclude",
        [".kpis", C(0)],
        [
            {"t": ".kpi >> nth=1"},
            {"t": ".kpi >> nth=2"},
            {"t": ".kpi >> nth=4"},
            {
                "t": '#strip circle.dot[stroke-dasharray="2 2"]',
                "at": "tr",
                "box": False,
                "dx": 8,
                "dy": -8,
            },
        ],
    )
    await capture(
        p,
        "rob-sensitivity",
        C(2),
        [
            {
                "t": '#sens polyline[stroke="#e03131"] >> nth=0',
                "at": "br",
                "box": False,
                "dx": -50,
                "dy": -40,
            },
            {
                "t": '#sens polyline[stroke="#2f9e44"] >> nth=0',
                "at": "tr",
                "box": False,
                "dx": -60,
                "dy": 16,
            },
            {"t": "#sens text >> text=you", "at": "r", "box": False, "dx": 16},
            {"t": "#sens text >> text=conclusion threshold"},
            {"t": "#sens text >> text=conclusion changes"},
            {"t": C(2) + " >> .chk"},
            {"t": "#sensNote"},
        ],
    )
    await capture(
        p,
        "rob-table",
        C(3),
        [
            {"t": "#tFilter"},
            {"t": C(3) + " >> .chk", "at": "b", "dy": 16},
            {"t": "#tableWrap thead"},
            {"t": "#tableWrap tbody tr >> nth=0 >> td >> nth=-1", "at": "r", "dx": 15},
        ],
    )
    # 4. more edits → log
    await p.evaluate("select(R.idToKey.get('N40'))")
    await p.keyboard.press("f")
    await p.wait_for_timeout(200)
    await p.evaluate("select(R.idToKey.get('Y14'))")
    await p.evaluate("moveTo(R.cases[R.idToKey.get('Y14')], 1.2)")
    await p.wait_for_timeout(200)
    await capture(p, "rob-log", C(4))
    await capture(p, "rob-edited-strip", C(0))
    # 5. upload with mapping
    tmp = pathlib.Path(tempfile.mkdtemp()) / "marker_study.csv"
    rows = (
        ["patient;diagnosis;marker"]
        + [
            f"P{i:03d};{'disease' if i % 4 == 0 else 'healthy'};{(i * 37 % 23) / 7 + (0.9 if i % 4 == 0 else 0):.2f}".replace(
                ".", ","
            )
            for i in range(1, 61)
        ]
        + ["P061;disease;NA"]
    )
    tmp.write_text("\n".join(rows) + "\n")
    await p.set_input_files("#file", str(tmp))
    await p.wait_for_timeout(600)
    await capture(
        p,
        "rob-upload",
        SEC(0),
        [
            {"t": SEC(0) + " >> .btnrow"},
            {"t": "#mapping"},
            {"t": "#dataInfo"},
            {"t": SEC(0) + " >> .chk"},
        ],
    )
    # 6. examples
    await load(p, "auc-robustness.html", "#example=mislabel")
    await p.wait_for_timeout(700)
    await p.evaluate("select(R.idToKey.get('N33'))")
    await p.wait_for_timeout(200)
    await capture(
        p,
        "rob-mislabel",
        ["#inspector", C(0)],
        [
            {"t": "#strip text >> text=N33", "at": "l", "box": False, "dx": -16},
            {"t": "#inspector dd >> nth=1"},
            {"t": "#inspector dd >> nth=2"},
            {"t": "#inspector dd >> nth=3"},
        ],
    )
    await load(p, "auc-robustness.html", "#example=fragile")
    await p.wait_for_timeout(700)
    await p.wait_for_function("document.getElementById('kFrag').textContent !== '…'")
    await capture(p, "rob-fragile", [".kpis", C(2)])
    await load(p, "auc-robustness.html", "#example=rare")
    await p.wait_for_timeout(900)
    await capture(p, "rob-rare", C(0))
    await load(p, "auc-robustness.html", "#example=hanley")
    await p.wait_for_timeout(900)
    await capture(p, "rob-hanley", [C(0), C(1)])
    if p.errors:
        raise RuntimeError(f"lab page errors: {p.errors}")


async def together_scenes(browser):
    p = await new_page(browser)
    await load(p, "auc-simulator.html", "#scenario=textbook")
    await wait_boot(p)
    await p.fill("#nY", "40")
    await p.fill("#nN", "40")
    await p.wait_for_timeout(300)
    await wait_boot(p)
    await capture(p, "both-button", SEC(3), [{"t": "#toRobust"}])
    href = await p.get_attribute("#toRobust", "href")
    q = await new_page(browser)
    await q.goto((APP / href.split("#")[0]).as_uri() + "#" + href.split("#", 1)[1])
    await q.wait_for_timeout(900)
    await q.wait_for_function("document.getElementById('kFrag').textContent !== '…'")
    await capture(
        q,
        "both-lab",
        ["#about", C(2)],
        [
            {"t": "#kOrigSub"},
            {"t": "#sens text >> text=true AUC", "at": "r", "box": False, "dx": 16},
        ],
    )
    if p.errors or q.errors:
        raise RuntimeError(f"page errors: {p.errors + q.errors}")


def patch_guide_sizes():
    if not GUIDE.exists():
        return
    html = GUIDE.read_text()

    def fix(m):
        tag, name = m.group(0), m.group(1)
        if name not in manifest:
            return tag
        tag = re.sub(r'\s(width|height)="\d+"', "", tag)
        return tag.replace(
            "<img ",
            f'<img width="{manifest[name]["w"]}" height="{manifest[name]["h"]}" ',
            1,
        )

    new = re.sub(r'<img [^>]*src="docs/img/([\w-]+)\.webp"[^>]*>', fix, html)
    if new != html:
        GUIDE.write_text(new)
        print("updated <img> sizes in auc-exploration-tool/auc-guide.html")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        print("simulator …")
        await simulator_scenes(browser)
        print("robustness lab …")
        await lab_scenes(browser)
        print("both …")
        await together_scenes(browser)
        await browser.close()
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    patch_guide_sizes()
    total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"{len(manifest)} images, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    asyncio.run(main())
