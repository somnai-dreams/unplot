/**
 * unplot browser demo — wires the TypeScript port into a static page. pdf.js renders the PDF page to a
 * canvas; extract() runs the same bytes through the port; recovered curves are drawn over the render in an
 * SVG overlay, with per-curve QA in a table and a CSV export. No server, no upload.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extract, free, lobe, monotone, type OrderBy, type ShapePrior, smooth } from "../src/index.ts";
import type { CurveSet } from "../src/index.ts";
import { loadVectorPage, pathBbox, type VectorPage } from "../src/io/vector.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.js", import.meta.url).toString();

const $ = <T extends Element = HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;
const drop = $("drop"), stage = $("stage"), fileInput = $<HTMLInputElement>("file");
const pdfCanvas = $<HTMLCanvasElement>("pdf"), overlay = $<SVGSVGElement>("overlay");
const setqaEl = $("setqa"), tableWrap = $("tableWrap"), tbody = $<HTMLElement>("qa").querySelector("tbody")!;
const priorSel = $<HTMLSelectElement>("prior"), tolInput = $<HTMLInputElement>("tol"), tolWrap = $("tolWrap");
const expectedInput = $<HTMLInputElement>("expected"), orderSel = $<HTMLSelectElement>("orderby");
const splitCb = $<HTMLInputElement>("split");
const csvBtn = $<HTMLButtonElement>("csv"), sampleBtn = $<HTMLButtonElement>("sample"), results = $("results");
const busy = $("busy");
const pagebar = $("pagebar"), pageLabel = $("pagelabel");
const prevBtn = $<HTMLButtonElement>("prev"), nextBtn = $<HTMLButtonElement>("next"), extractAllBtn = $<HTMLButtonElement>("extractall");
const pagesWrap = $("pagesWrap"), pagesBody = $<HTMLElement>("pages").querySelector("tbody")!;
const selbox = $("selbox"), regionbar = $("regionbar"), regionmsg = $("regionmsg"), wholepageBtn = $<HTMLButtonElement>("wholepage");
const dataplot = $<SVGSVGElement>("dataplot"), dataEmpty = $("dataEmpty"), tip = $("tip");

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
const NS = "http://www.w3.org/2000/svg";
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
let multiPlot = false;                                           // current page holds several plots (auto-picked one)
let selecting = false, dragged = false, selStart: [number, number] | null = null;
let lastHi = "";                                                 // currently highlighted curve (data-c), "" = none

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
  overlay.replaceChildren();   // clear the previous page's points immediately, before the async render/extract
  selbox.hidden = true;
  const page = await pdfDoc.getPage(i + 1);   // pdf.js pages are 1-based
  const unscaled = page.getViewport({ scale: 1 });
  const avail = Math.max(240, stage.parentElement?.clientWidth ?? 760); // fit the stage container
  renderScale = Math.min(2, avail / unscaled.width);   // never exceed avail, so the canvas isn't CSS-scaled
  const viewport = page.getViewport({ scale: renderScale });
  pdfCanvas.width = Math.ceil(viewport.width);
  pdfCanvas.height = Math.ceil(viewport.height);
  overlay.setAttribute("viewBox", `0 0 ${pdfCanvas.width} ${pdfCanvas.height}`);
  stage.classList.remove("desat");   // new page renders in full colour, then greys when results come in
  const ctx = pdfCanvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  stage.hidden = false;
  stage.classList.add("ready");   // enable the drag-to-select cursor
  replayAnim(stage, "enter");     // loading a new PDF is occasional — a gentle entrance fits
}

function curveColor(c: CurveSet["curves"][number], i: number): string {
  if (c.style.color) {
    const [r, g, b] = c.style.color;
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
  return PALETTE[i % PALETTE.length];
}

const fmtVal = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1));
const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 1 : 0));

/** Mark a SAMPLE of the recovered points on the source PDF — no overlay line, since it would just trace the
 *  source and look like nothing happened. The dots show it read points OFF the curve; hover one for its value.
 *  (source coords are y-down pt; canvas px = source * renderScale.) */
function drawOverlay(cs: CurveSet, animate: boolean): void {
  overlay.replaceChildren();
  lastHi = "";
  cs.curves.forEach((c, i) => {
    const col = curveColor(c, i);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "curve"); g.setAttribute("data-c", String(i));
    const step = Math.max(1, Math.floor(c.pointsSrc.length / 11));
    for (let k = 0; k < c.pointsSrc.length; k += step) {
      const cx = String(c.pointsSrc[k][0] * renderScale), cy = String(c.pointsSrc[k][1] * renderScale);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("r", "3");
      dot.setAttribute("fill", col); dot.setAttribute("stroke", "#fff"); dot.setAttribute("stroke-width", "1.2");
      g.appendChild(dot);
      const hit = document.createElementNS(NS, "circle");   // generous, invisible hit area for hover
      hit.setAttribute("cx", cx); hit.setAttribute("cy", cy); hit.setAttribute("r", "9");
      hit.setAttribute("fill", "transparent"); hit.setAttribute("class", "hit");
      hit.setAttribute("data-c", String(i));
      hit.setAttribute("data-x", fmtVal(c.points[k][0])); hit.setAttribute("data-y", fmtVal(c.points[k][1]));
      g.appendChild(hit);
    }
    overlay.appendChild(g);
  });
  stage.classList.toggle("desat", cs.curves.length > 0);   // grey the source so the colour dots are the output
  if (animate && !reduceMotion) replayAnim(overlay as unknown as HTMLElement, "fade-in");
}

/** Re-draw the extracted curves as a clean chart purely from the recovered (x,y) numbers — so it's obvious
 *  the tool produced DATA, not a copy of the PDF image. Matches the source plot's axis range (the calibration
 *  anchors, extended to the data) AND its aspect ratio, so it reads as the SAME curves. Points are hoverable. */
function renderDataPlot(cs: CurveSet, animate: boolean): void {
  const pts = cs.curves.flatMap((c) => c.points);
  if (!pts.length) { dataplot.replaceChildren(); dataplot.removeAttribute("viewBox"); dataEmpty.hidden = false; return; }
  dataEmpty.hidden = true;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of pts) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  for (const a of cs.xAxis.anchors) { xmin = Math.min(xmin, a[1]); xmax = Math.max(xmax, a[1]); }
  for (const a of cs.yAxis.anchors) { ymin = Math.min(ymin, a[1]); ymax = Math.max(ymax, a[1]); }
  const xSpan = xmax - xmin || 1, ySpan = ymax - ymin || 1;
  const [sx0, sy0, sx1, sy1] = cs.source.frameSrc;
  const aspect = Math.min(3, Math.max(0.7, (sx1 - sx0) / (sy1 - sy0 || 1)));   // mirror the source proportions
  const mL = 46, mR = 14, mT = 12, mB = 28, plotW = 480, plotH = Math.round(plotW / aspect);
  const W = plotW + mL + mR, H = plotH + mT + mB;
  const mapX = (x: number) => mL + (x - xmin) / xSpan * plotW;
  const mapY = (y: number) => mT + (ymax - y) / ySpan * plotH;
  const inR = (v: number, lo: number, hi: number) => v >= lo - 1e-9 && v <= hi + 1e-9;
  const p: string[] = [];
  p.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#dcdde2"/>`);
  p.push(`<line x1="${mL}" y1="${mT + plotH}" x2="${mL + plotW}" y2="${mT + plotH}" stroke="#dcdde2"/>`);
  for (const a of cs.xAxis.anchors) if (inR(a[1], xmin, xmax)) { const x = mapX(a[1]); p.push(`<line x1="${x}" y1="${mT + plotH}" x2="${x}" y2="${mT + plotH + 4}" stroke="#c8cad1"/><text x="${x}" y="${mT + plotH + 16}" text-anchor="middle" font-size="10" fill="#9ca3af">${fmtTick(a[1])}</text>`); }
  for (const a of cs.yAxis.anchors) if (inR(a[1], ymin, ymax)) { const y = mapY(a[1]); p.push(`<line x1="${mL - 4}" y1="${y}" x2="${mL}" y2="${y}" stroke="#c8cad1"/><text x="${mL - 7}" y="${y + 3}" text-anchor="end" font-size="10" fill="#9ca3af">${fmtTick(a[1])}</text>`); }
  cs.curves.forEach((c, i) => {
    const col = curveColor(c, i);
    const line = c.points.map((q) => `${mapX(q[0]).toFixed(1)},${mapY(q[1]).toFixed(1)}`).join(" ");
    p.push(`<g class="curve" data-c="${i}">`);
    p.push(`<polyline points="${line}" fill="none" stroke="transparent" stroke-width="12" data-c="${i}"/>`);   // wide hover target
    p.push(`<polyline class="line" points="${line}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" data-c="${i}"/>`);
    const step = Math.max(1, Math.floor(c.points.length / 11));
    for (let k = 0; k < c.points.length; k += step) {
      const cx = mapX(c.points[k][0]).toFixed(1), cy = mapY(c.points[k][1]).toFixed(1);
      p.push(`<circle cx="${cx}" cy="${cy}" r="2.6" fill="${col}" stroke="#fff" stroke-width="1"/>`);
      p.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="transparent" class="hit" data-c="${i}" data-x="${fmtVal(c.points[k][0])}" data-y="${fmtVal(c.points[k][1])}"/>`);
    }
    p.push(`</g>`);
  });
  dataplot.setAttribute("viewBox", `0 0 ${W} ${H}`);
  dataplot.innerHTML = p.join("");
  lastHi = "";
  if (animate && !reduceMotion) {   // the re-plot is on white, so a left-to-right reveal actually shows
    dataplot.style.transition = "none"; dataplot.style.clipPath = "inset(0 100% 0 0)";
    void dataplot.getBoundingClientRect();
    dataplot.style.transition = "clip-path 700ms cubic-bezier(0.5,0,0.2,1)"; dataplot.style.clipPath = "inset(0 0 0 0)";
  } else dataplot.style.clipPath = "";
}

/** Raise one curve above the others in BOTH panels and fade the rest — so distinct traces are visible even
 *  where the curves merge into one line. */
function setHighlight(c: string | null): void {
  const key = c ?? "";
  if (key === lastHi) return;
  lastHi = key;
  for (const svg of [overlay, dataplot]) {
    for (const g of svg.querySelectorAll<SVGGElement>(".curve")) {
      const isit = c != null && g.getAttribute("data-c") === c;
      g.classList.toggle("dim", c != null && !isit);
      g.classList.toggle("active", isit);
      if (isit) svg.appendChild(g);   // move to end -> drawn on top
    }
  }
}

/** Hover: a point shows its value (`.hit` circles carry data-x/data-y); any element with data-c raises its
 *  curve in both panels. */
function wireHover(svg: SVGElement): void {
  svg.addEventListener("mousemove", (e) => {
    const el = e.target as Element;
    const x = el.getAttribute?.("data-x");
    if (x != null) {
      tip.innerHTML = `<span class="k">x</span> ${x}&nbsp;&nbsp;<span class="k">y</span> ${el.getAttribute("data-y")}`;
      tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 14}px`;
      tip.hidden = false;
    } else tip.hidden = true;
    setHighlight(el.getAttribute?.("data-c") ?? null);
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; setHighlight(null); });
}

function peakX(c: CurveSet["curves"][number]): number {
  let k = 0;
  for (let j = 1; j < c.points.length; j++) if (c.points[j][1] > c.points[k][1]) k = j;
  return c.points[k]?.[0] ?? NaN;
}

function fillTable(cs: CurveSet, animate: boolean): void {
  results.classList.remove("empty");
  setqaEl.hidden = false;
  const w = cs.qa.warnings.length ? `<span class="warn">⚠ ${cs.qa.warnings.join("; ")}</span>` : "clean";
  setqaEl.innerHTML =
    `<span>set confidence <b>${cs.qa.confidence}</b></span>` +
    `<span>curves <b>${cs.qa.nCurves}</b></span>` +
    `<span>crossings <b>${cs.qa.crossings}</b></span>` +
    `<span>x-axis r <b>${cs.xAxis.r.toFixed(4)}</b> · y-axis r <b>${cs.yAxis.r.toFixed(4)}</b></span>` +
    `<span>${w}</span>`;
  if (animate && !reduceMotion) replayAnim(setqaEl, "fade-in");
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
    renderDataPlot(cs, animate);
    fillTable(cs, animate);
    csvBtn.disabled = false;
  } catch (e) {
    results.classList.remove("empty");
    setqaEl.hidden = false;
    setqaEl.innerHTML = `<span class="warn">extract failed: ${e instanceof Error ? e.message : String(e)}</span>`;
    tableWrap.hidden = true;
    overlay.replaceChildren();
    stage.classList.remove("desat");
    dataplot.replaceChildren(); dataplot.removeAttribute("viewBox"); dataEmpty.hidden = false;
    csvBtn.disabled = true;
  }
}

async function load(data: Uint8Array): Promise<void> {
  pdfData = data;
  clearAllPages();
  busy.classList.add("on");
  try {
    pdfDoc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, isEvalSupported: false }).promise; // copy: pdf.js detaches the buffer
    numPages = pdfDoc.numPages;
    pageIndex = 0;
    updatePageUi();
    await renderPage(0);
    await autoFrame();      // a multi-plot page -> show one plot, not the tangled whole page
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
  updatePageUi();
  highlightPageRow();
  await renderPage(pageIndex);
  await autoFrame();        // region is page-specific; re-pick (first plot on a multi-plot page)
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
      const frame = await autoBoxFrame(i);   // each page frames itself (first plot if multi-plot)
      try { sets.push(await extract(pdfData, { page: i, frame, ...opts })); }
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

/** Position the selection box from a frame in source pt. */
function placeSelbox(frameSrc: [number, number, number, number]): void {
  const [fx0, fy0, fx1, fy1] = frameSrc;
  selbox.hidden = false;
  selbox.style.left = `${fx0 * renderScale}px`;
  selbox.style.top = `${fy0 * renderScale}px`;
  selbox.style.width = `${(fx1 - fx0) * renderScale}px`;
  selbox.style.height = `${(fy1 - fy0) * renderScale}px`;
}

/** If the loose selection contains a drawn axis box (a ruled rectangle — frame or grid), snap the frame to it
 *  so the numeric tick labels land just OUTSIDE the frame, where calibration looks for them. A user can't be
 *  expected to trace the axes by hand; this makes a rough drag work. Falls back to the raw selection. */
async function snapToAxisBox(sel: [number, number, number, number]): Promise<[number, number, number, number]> {
  if (!pdfData) return sel;
  let page;
  try { page = await loadVectorPage(pdfData, pageIndex); } catch { return sel; }
  const [sx0, sy0, sx1, sy1] = sel;
  let best: [number, number, number, number] | null = null, bestArea = 0;
  for (const p of page.paths) {
    if (!p.ruled || p.pts.length < 4) continue;                                   // only ruled rectangles/axes
    const [bx0, by0, bx1, by1] = pathBbox(p.pts);
    const w = bx1 - bx0, h = by1 - by0;
    if (w < 30 || h < 30) continue;                                               // a thin line, not a box
    if (bx0 < sx0 - 3 || by0 < sy0 - 3 || bx1 > sx1 + 3 || by1 > sy1 + 3) continue; // must sit inside the drag
    if (w * h > bestArea) { bestArea = w * h; best = [bx0, by0, bx1, by1]; }
  }
  return best ?? sel;
}

/** Distinct plot axis-boxes on a page (ruled rectangles, deduped vs the grid, left-to-right). */
function detectPlotBoxes(page: VectorPage): [number, number, number, number][] {
  const boxes: [number, number, number, number][] = [];
  for (const p of page.paths) {
    if (!p.ruled || p.pts.length < 4) continue;
    const bb = pathBbox(p.pts);
    if (bb[2] - bb[0] < 40 || bb[3] - bb[1] < 40) continue;   // a real plot box, not a tick / short rule
    if (boxes.some((b) => Math.abs(b[0] - bb[0]) < 14 && Math.abs(b[1] - bb[1]) < 14 && Math.abs(b[2] - bb[2]) < 14)) continue; // frame + grid share a bbox
    boxes.push(bb);
  }
  return boxes.sort((a, b) => a[0] - b[0]);
}

/** The default frame for a page: the first plot box if the page holds several plots, else undefined (whole
 *  page). Used so a multi-plot page shows ONE clean plot instead of the tangled whole-page extract. */
async function autoBoxFrame(idx: number): Promise<[number, number, number, number] | undefined> {
  if (!pdfData) return undefined;
  try {
    const boxes = detectPlotBoxes(await loadVectorPage(pdfData, idx));
    return boxes.length >= 2 ? boxes[0] : undefined;
  } catch { return undefined; }
}

/** On entering a page, auto-pick the first plot when it's a multi-plot page. */
async function autoFrame(): Promise<void> {
  selbox.hidden = true;
  frameSel = (await autoBoxFrame(pageIndex)) ?? null;
  multiPlot = frameSel !== null;
  if (frameSel) placeSelbox(frameSel);
}

function updateRegionBar(): void {
  regionbar.hidden = stage.hidden;
  if (frameSel) {
    regionmsg.innerHTML = multiPlot
      ? `Several plots on this page — showing one. <b style="color:var(--fg)">Drag a box</b> around another to switch.`
      : `Extracting a <b style="color:var(--fg)">selected region</b> — drag again to reselect.`;
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
stage.addEventListener("pointerup", async (e) => {
  if (!selecting) return;
  selecting = false;
  if (!dragged || !selStart) { selStart = null; return; }   // a click, not a drag — leave the current region as-is
  const [x, y] = localXY(e);
  const x0 = Math.min(selStart[0], x), y0 = Math.min(selStart[1], y);
  const x1 = Math.max(selStart[0], x), y1 = Math.max(selStart[1], y);
  selStart = null;
  if (x1 - x0 < 8 || y1 - y0 < 8) { selbox.hidden = true; return; }   // too small to be a real region
  const sel: [number, number, number, number] = [x0 / renderScale, y0 / renderScale, x1 / renderScale, y1 / renderScale];
  frameSel = await snapToAxisBox(sel);   // snap to the plot's axis box so tick labels stay just outside the frame
  placeSelbox(frameSel);                 // show the box where it actually snapped
  clearAllPages();        // a region changes results; any all-pages summary is stale
  updateRegionBar();
  void run(true);
});
wholepageBtn.addEventListener("click", () => {
  frameSel = null; multiPlot = false; selbox.hidden = true;   // explicit override: show the whole page
  updateRegionBar();
  void run(true);
});

// --- wiring ---
// changing options re-extracts the current page; any all-pages summary is now stale, so drop it.
priorSel.addEventListener("change", () => { tolWrap.hidden = priorSel.value === "free"; clearAllPages(); void run(); });
[tolInput, expectedInput, orderSel, splitCb].forEach((el) => el.addEventListener("change", () => { clearAllPages(); void run(); }));
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
async function loadSample(): Promise<void> {
  const buf = await (await fetch("./sample.pdf")).arrayBuffer();
  await load(new Uint8Array(buf));   // auto curve count: the sample is colour-keyed, separated by style
}
sampleBtn.addEventListener("click", () => void loadSample());
csvBtn.addEventListener("click", () => {
  const csv = allSets ? toCsvAll(allSets) : lastSet ? toCsv(lastSet) : null;
  if (!csv) return;
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = allSets ? "unplot-all-pages.csv" : "unplot-curves.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

wireHover(overlay); wireHover(dataplot);

// open with a result already on screen so the demo reads as a working app, not an empty shell
void loadSample().catch(() => { /* offline / no sample: the drop zone is still there */ });
