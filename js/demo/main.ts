/**
 * GetMapped browser demo — wires the TypeScript port into a static page. pdf.js renders the PDF page to a
 * canvas; extract() runs the same bytes through the port; recovered curves are drawn over the render in an
 * SVG overlay, with per-curve QA in a table and a CSV export. No server, no upload.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extract, free, lobe, monotone, type OrderBy, type ShapePrior, smooth } from "../src/index.ts";
import type { CurveSet } from "../src/index.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.js", import.meta.url).toString();

const $ = <T extends Element = HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;
const drop = $("drop"), stage = $("stage"), fileInput = $<HTMLInputElement>("file");
const pdfCanvas = $<HTMLCanvasElement>("pdf"), overlay = $<SVGSVGElement>("overlay");
const setqaEl = $("setqa"), tableWrap = $("tableWrap"), tbody = $<HTMLElement>("qa").querySelector("tbody")!;
const priorSel = $<HTMLSelectElement>("prior"), tolInput = $<HTMLInputElement>("tol"), tolWrap = $("tolWrap");
const expectedInput = $<HTMLInputElement>("expected"), orderSel = $<HTMLSelectElement>("orderby");
const splitCb = $<HTMLInputElement>("split");
const rerunBtn = $<HTMLButtonElement>("rerun"), csvBtn = $<HTMLButtonElement>("csv"), sampleBtn = $<HTMLButtonElement>("sample");
const busy = $("busy");
const pagebar = $("pagebar"), pageLabel = $("pagelabel");
const prevBtn = $<HTMLButtonElement>("prev"), nextBtn = $<HTMLButtonElement>("next"), extractAllBtn = $<HTMLButtonElement>("extractall");
const pagesWrap = $("pagesWrap"), pagesBody = $<HTMLElement>("pages").querySelector("tbody")!;
const selbox = $("selbox"), regionbar = $("regionbar"), regionmsg = $("regionmsg"), wholepageBtn = $<HTMLButtonElement>("wholepage");

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
const PALETTE = ["#6ea8fe", "#57c98a", "#e0b341", "#e06c6c", "#b78bf0", "#4ec9d6"];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pdfData: Uint8Array | null = null;
let pdfDoc: PdfDoc | null = null;        // kept so flipping pages doesn't re-parse the file
let numPages = 1;
let pageIndex = 0;                        // 0-based, matches extract()'s `page` option
let renderScale = 1;
let lastSet: CurveSet | null = null;
let allSets: (CurveSet | null)[] | null = null;   // populated by "Extract all pages"; null = single-page mode
let frameSel: [number, number, number, number] | null = null;   // selected ROI in source pt; null = auto-frame
let selecting = false, dragged = false, selStart: [number, number] | null = null;

/** Re-trigger a CSS keyframe animation by removing the class, forcing reflow, and re-adding it. */
function replayAnim(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function buildPrior(): ShapePrior {
  const tol = parseFloat(tolInput.value);
  switch (priorSel.value) {
    case "lobe": return lobe(tol);
    case "monotone": return monotone("auto", tol);
    case "smooth": return smooth(tol);
    default: return free();
  }
}

async function renderPage(i: number): Promise<void> {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(i + 1);   // pdf.js pages are 1-based
  const unscaled = page.getViewport({ scale: 1 });
  renderScale = Math.min(2, Math.max(0.6, 900 / unscaled.width)); // fit ~900px wide, clamp
  const viewport = page.getViewport({ scale: renderScale });
  pdfCanvas.width = Math.ceil(viewport.width);
  pdfCanvas.height = Math.ceil(viewport.height);
  overlay.setAttribute("viewBox", `0 0 ${pdfCanvas.width} ${pdfCanvas.height}`);
  overlay.setAttribute("width", String(pdfCanvas.width));
  overlay.setAttribute("height", String(pdfCanvas.height));
  stage.classList.remove("has-result");   // new page renders at full brightness; re-dims when curves come in
  const ctx = pdfCanvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  stage.hidden = false;
  replayAnim(stage, "enter");   // loading a new PDF is occasional — a gentle entrance fits
}

function curveColor(c: CurveSet["curves"][number], i: number): string {
  if (c.style.color) {
    const [r, g, b] = c.style.color;
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
  return PALETTE[i % PALETTE.length];
}

// `animate` draws the curves in (stroke reveal, staggered) — the demo's payoff. Only on a fresh load: on
// re-extract (a control tweak, repeated often) the overlay updates instantly so it feels responsive.
function drawOverlay(cs: CurveSet, animate: boolean): void {
  // source coords are y-down, top-left, in PDF pt at scale 1 — so canvas px = source * renderScale.
  const NS = "http://www.w3.org/2000/svg";
  overlay.replaceChildren();
  const [fx0, fy0, fx1, fy1] = cs.source.frameSrc;
  const frame = document.createElementNS(NS, "rect");
  frame.setAttribute("x", String(fx0 * renderScale)); frame.setAttribute("y", String(fy0 * renderScale));
  frame.setAttribute("width", String((fx1 - fx0) * renderScale)); frame.setAttribute("height", String((fy1 - fy0) * renderScale));
  frame.setAttribute("fill", "none"); frame.setAttribute("stroke", "#ffffff22"); frame.setAttribute("stroke-dasharray", "4 4");
  overlay.appendChild(frame);
  cs.curves.forEach((c, i) => {
    const pl = document.createElementNS(NS, "polyline");
    pl.setAttribute("points", c.pointsSrc.map((p) => `${p[0] * renderScale},${p[1] * renderScale}`).join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", curveColor(c, i));
    pl.setAttribute("stroke-width", "2.5");
    pl.setAttribute("stroke-linecap", "round");
    pl.setAttribute("stroke-linejoin", "round");
    overlay.appendChild(pl);
  });
  stage.classList.add("has-result");   // dim the source render so the bright overlay reads as the result

  // Reveal: wipe the bright overlay in left-to-right over the dimmed plot — a "scan" reading the curves off
  // it. A per-curve stroke draw is invisible here: the overlay lands exactly on the identical source line
  // underneath, so it only ever brightens. A clip sweep against the dimmed render is clearly visible. First
  // load only; re-extract (a repeated control tweak) updates instantly.
  if (!animate || reduceMotion) { overlay.style.clipPath = ""; return; }
  overlay.style.transition = "none";
  overlay.style.clipPath = "inset(0 100% 0 0)";   // hidden, then revealed from the left
  void overlay.getBoundingClientRect();           // commit the hidden start state before transitioning
  overlay.style.transition = "clip-path 760ms cubic-bezier(0.5, 0, 0.2, 1)";
  overlay.style.clipPath = "inset(0 0 0 0)";
}

function peakX(c: CurveSet["curves"][number]): number {
  let k = 0;
  for (let j = 1; j < c.points.length; j++) if (c.points[j][1] > c.points[k][1]) k = j;
  return c.points[k]?.[0] ?? NaN;
}

function fillTable(cs: CurveSet, animate: boolean): void {
  setqaEl.hidden = false;
  const w = cs.qa.warnings.length ? `<span class="warn">⚠ ${cs.qa.warnings.join("; ")}</span>` : "clean";
  setqaEl.innerHTML =
    `<span>set confidence <b>${cs.qa.confidence}</b></span>` +
    `<span>curves <b>${cs.qa.nCurves}</b></span>` +
    `<span>crossings <b>${cs.qa.crossings}</b></span>` +
    `<span>x-axis r <b>${cs.xAxis.r.toFixed(4)}</b> · y-axis r <b>${cs.yAxis.r.toFixed(4)}</b></span>` +
    `<span>${w}</span>`;
  if (animate && !reduceMotion) replayAnim(setqaEl, "enter");
  tableWrap.hidden = false;
  tbody.replaceChildren();
  cs.curves.forEach((c, i) => {
    const tr = document.createElement("tr");
    const conf = c.qa.confidence;
    const confColor = conf > 0.9 ? "var(--good)" : conf > 0.6 ? "var(--warn)" : "var(--bad)";
    tr.innerHTML =
      `<td><span class="swatch" style="background:${curveColor(c, i)}"></span>${c.id}</td>` +
      `<td class="num">${c.qa.nPoints}</td>` +
      `<td class="num">${Number.isFinite(peakX(c)) ? peakX(c).toFixed(1) : "—"}</td>` +
      `<td class="num" style="color:${confColor}">${conf}</td>` +
      `<td class="num">${c.qa.violation} <span class="hint">${c.qa.violationKind}</span></td>` +
      `<td>${c.qa.xMonotonic ? "yes" : "no"}</td>` +
      `<td><span class="pill ${c.qa.passed ? "ok" : "no"}">${c.qa.passed ? "pass" : "fail"}</span></td>`;
    if (animate) { tr.classList.add("row-in"); tr.style.animationDelay = `${i * 45}ms`; }
    tbody.appendChild(tr);
  });
}

function toCsv(cs: CurveSet): string {
  const lines = ["curve_id,order_index,x,y"];
  for (const c of cs.curves) for (const [x, y] of c.points) lines.push(`${c.id},${c.orderIndex},${x},${y}`);
  return lines.join("\n");
}

function currentOpts() {
  const expected = Math.round(parseFloat(expectedInput.value) || 0);
  return {
    prior: buildPrior(),
    orderBy: orderSel.value as OrderBy,
    expectedCurves: expected > 0 ? expected : null,
    split: splitCb.checked,
  };
}

async function run(animate = false): Promise<void> {
  if (!pdfData) return;
  try {
    const cs = await extract(pdfData, { page: pageIndex, frame: frameSel ?? undefined, ...currentOpts() });
    lastSet = cs;
    drawOverlay(cs, animate);
    fillTable(cs, animate);
    csvBtn.disabled = false;
  } catch (e) {
    setqaEl.hidden = false;
    setqaEl.innerHTML = `<span class="warn">extract failed: ${e instanceof Error ? e.message : String(e)}</span>`;
    tableWrap.hidden = true;
    overlay.replaceChildren();
    stage.classList.remove("has-result");   // un-dim: nothing to highlight
    csvBtn.disabled = true;
  }
}

async function load(data: Uint8Array): Promise<void> {
  pdfData = data;
  rerunBtn.disabled = false;
  drop.hidden = true;
  clearAllPages();
  busy.classList.add("on");
  try {
    pdfDoc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, isEvalSupported: false }).promise; // copy: pdf.js detaches the buffer
    numPages = pdfDoc.numPages;
    pageIndex = 0;
    frameSel = null; selbox.hidden = true;
    updatePageUi();
    await renderPage(0);
    await run(true);        // first draw of a new PDF: animate the curves in
    updateRegionBar();
  } finally {
    busy.classList.remove("on");
  }
}

function updatePageUi(): void {
  const multi = numPages > 1;
  pagebar.hidden = !multi;
  extractAllBtn.hidden = !multi;
  extractAllBtn.textContent = `Extract all ${numPages} pages`;
  pageLabel.textContent = `Page ${pageIndex + 1} / ${numPages}`;
  prevBtn.disabled = pageIndex <= 0;
  nextBtn.disabled = pageIndex >= numPages - 1;
}

async function goToPage(i: number): Promise<void> {
  const t = Math.max(0, Math.min(numPages - 1, i));
  if (t === pageIndex || !pdfDoc) return;
  pageIndex = t;
  frameSel = null; selbox.hidden = true;   // a region is page-specific; reset on page change
  updatePageUi();
  highlightPageRow();
  await renderPage(pageIndex);
  await run(true);          // a new page is a new result — animate it in
  updateRegionBar();
}

/** Reset multi-page state (called on a new file, and when options change so the summary isn't stale). */
function clearAllPages(): void {
  allSets = null;
  pagesWrap.hidden = true;
  pagesBody.replaceChildren();
}

/** Extract every page in one go: a per-page summary table + a combined all-pages CSV. */
async function extractAll(): Promise<void> {
  if (!pdfData) return;
  busy.classList.add("on");
  try {
    const opts = currentOpts();
    const sets: (CurveSet | null)[] = [];
    for (let i = 0; i < numPages; i++) {
      try { sets.push(await extract(pdfData, { page: i, frame: frameSel ?? undefined, ...opts })); }
      catch { sets.push(null); }   // a page with no curve paths -> no result for that page
    }
    allSets = sets;
    renderPagesSummary(sets);
    csvBtn.disabled = false;
  } finally {
    busy.classList.remove("on");
  }
}

function renderPagesSummary(sets: (CurveSet | null)[]): void {
  pagesWrap.hidden = false;
  pagesBody.replaceChildren();
  sets.forEach((cs, i) => {
    const tr = document.createElement("tr");
    if (i === pageIndex) tr.classList.add("active");
    if (!cs) {
      tr.innerHTML = `<td class="num">${i + 1}</td><td class="num">0</td><td>—</td><td>—</td><td class="hint">no curves found</td>`;
    } else {
      const conf = cs.qa.confidence;
      const confColor = conf > 0.9 ? "var(--good)" : conf > 0.6 ? "var(--warn)" : "var(--bad)";
      const notes = cs.qa.warnings.length ? `<span class="warn">⚠ ${cs.qa.warnings.length}</span>` : "clean";
      tr.innerHTML =
        `<td class="num">${i + 1}</td><td class="num">${cs.qa.nCurves}</td>` +
        `<td class="num" style="color:${confColor}">${conf}</td><td class="num">${cs.qa.crossings}</td><td>${notes}</td>`;
    }
    tr.addEventListener("click", () => void goToPage(i));
    pagesBody.appendChild(tr);
  });
}

function highlightPageRow(): void {
  [...pagesBody.children].forEach((tr, i) => tr.classList.toggle("active", i === pageIndex));
}

function toCsvAll(sets: (CurveSet | null)[]): string {
  const lines = ["page,curve_id,order_index,x,y"];
  sets.forEach((cs, i) => {
    if (cs) for (const c of cs.curves) for (const [x, y] of c.points) lines.push(`${i + 1},${c.id},${c.orderIndex},${x},${y}`);
  });
  return lines.join("\n");
}

// --- region select: drag a box on the plot to constrain extraction to one plot (multi-plot datasheet pages,
// where the auto-frame would otherwise span every plot on the page and tangle them together).
function localXY(e: PointerEvent): [number, number] {
  const r = stage.getBoundingClientRect();
  return [
    Math.max(0, Math.min(pdfCanvas.width, e.clientX - r.left)),
    Math.max(0, Math.min(pdfCanvas.height, e.clientY - r.top)),
  ];
}

function updateRegionBar(): void {
  regionbar.hidden = stage.hidden;
  if (frameSel) {
    regionmsg.innerHTML = `Extracting a <b style="color:var(--fg)">selected region</b> — drag again to reselect.`;
    wholepageBtn.hidden = false;
  } else {
    regionmsg.innerHTML = `<span class="hint">Multi-plot page? Drag a box around one plot's axes (tick labels just outside) to extract only that plot.</span>`;
    wholepageBtn.hidden = true;
  }
}

stage.addEventListener("pointerdown", (e) => {
  if (!pdfDoc || stage.hidden) return;
  selecting = true; dragged = false; selStart = localXY(e);
  try { stage.setPointerCapture(e.pointerId); } catch { /* pointer may not be capturable */ }
});
stage.addEventListener("pointermove", (e) => {
  if (!selecting || !selStart) return;
  const [x, y] = localXY(e);
  if (!dragged && Math.abs(x - selStart[0]) < 3 && Math.abs(y - selStart[1]) < 3) return;
  dragged = true;
  selbox.hidden = false;
  selbox.style.left = `${Math.min(selStart[0], x)}px`;
  selbox.style.top = `${Math.min(selStart[1], y)}px`;
  selbox.style.width = `${Math.abs(x - selStart[0])}px`;
  selbox.style.height = `${Math.abs(y - selStart[1])}px`;
});
stage.addEventListener("pointerup", (e) => {
  if (!selecting) return;
  selecting = false;
  if (!dragged || !selStart) { selStart = null; return; }   // a click, not a drag — leave the current region as-is
  const [x, y] = localXY(e);
  const x0 = Math.min(selStart[0], x), y0 = Math.min(selStart[1], y);
  const x1 = Math.max(selStart[0], x), y1 = Math.max(selStart[1], y);
  selStart = null;
  if (x1 - x0 < 8 || y1 - y0 < 8) { selbox.hidden = true; return; }   // too small to be a real region
  frameSel = [x0 / renderScale, y0 / renderScale, x1 / renderScale, y1 / renderScale];   // canvas px -> source pt
  clearAllPages();        // a region changes results; any all-pages summary is stale
  updateRegionBar();
  void run(true);
});
wholepageBtn.addEventListener("click", () => {
  frameSel = null; selbox.hidden = true;
  updateRegionBar();
  void run(true);
});

// --- wiring ---
// changing options re-extracts the current page; any all-pages summary is now stale, so drop it.
priorSel.addEventListener("change", () => { tolWrap.hidden = priorSel.value === "free"; clearAllPages(); void run(); });
[tolInput, expectedInput, orderSel, splitCb].forEach((el) => el.addEventListener("change", () => { clearAllPages(); void run(); }));
rerunBtn.addEventListener("click", () => void run());
prevBtn.addEventListener("click", () => void goToPage(pageIndex - 1));
nextBtn.addEventListener("click", () => void goToPage(pageIndex + 1));
extractAllBtn.addEventListener("click", () => void extractAll());

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (f) await load(new Uint8Array(await f.arrayBuffer()));
});
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("hot"); });
drop.addEventListener("dragleave", () => drop.classList.remove("hot"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault(); drop.classList.remove("hot");
  const f = e.dataTransfer?.files?.[0];
  if (f) await load(new Uint8Array(await f.arrayBuffer()));
});
sampleBtn.addEventListener("click", async () => {
  const buf = await (await fetch("./sample.pdf")).arrayBuffer();
  await load(new Uint8Array(buf));   // auto curve count: the sample is colour-keyed, separated by style
});
csvBtn.addEventListener("click", () => {
  const csv = allSets ? toCsvAll(allSets) : lastSet ? toCsv(lastSet) : null;
  if (!csv) return;
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = allSets ? "getmapped-all-pages.csv" : "getmapped-curves.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});
