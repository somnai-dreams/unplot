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

const PALETTE = ["#6ea8fe", "#57c98a", "#e0b341", "#e06c6c", "#b78bf0", "#4ec9d6"];
let pdfData: Uint8Array | null = null;
let renderScale = 1;
let lastSet: CurveSet | null = null;

function buildPrior(): ShapePrior {
  const tol = parseFloat(tolInput.value);
  switch (priorSel.value) {
    case "lobe": return lobe(tol);
    case "monotone": return monotone("auto", tol);
    case "smooth": return smooth(tol);
    default: return free();
  }
}

async function renderPdf(data: Uint8Array): Promise<void> {
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, isEvalSupported: false }).promise; // copy: pdf.js detaches the buffer
  const page = await doc.getPage(1);
  const unscaled = page.getViewport({ scale: 1 });
  renderScale = Math.min(2, Math.max(0.6, 900 / unscaled.width)); // fit ~900px wide, clamp
  const viewport = page.getViewport({ scale: renderScale });
  pdfCanvas.width = Math.ceil(viewport.width);
  pdfCanvas.height = Math.ceil(viewport.height);
  overlay.setAttribute("viewBox", `0 0 ${pdfCanvas.width} ${pdfCanvas.height}`);
  overlay.setAttribute("width", String(pdfCanvas.width));
  overlay.setAttribute("height", String(pdfCanvas.height));
  const ctx = pdfCanvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  stage.hidden = false;
}

function curveColor(c: CurveSet["curves"][number], i: number): string {
  if (c.style.color) {
    const [r, g, b] = c.style.color;
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
  return PALETTE[i % PALETTE.length];
}

function drawOverlay(cs: CurveSet): void {
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
    pl.setAttribute("stroke-width", "2");
    pl.setAttribute("opacity", "0.9");
    overlay.appendChild(pl);
  });
}

function peakX(c: CurveSet["curves"][number]): number {
  let k = 0;
  for (let j = 1; j < c.points.length; j++) if (c.points[j][1] > c.points[k][1]) k = j;
  return c.points[k]?.[0] ?? NaN;
}

function fillTable(cs: CurveSet): void {
  setqaEl.hidden = false;
  const w = cs.qa.warnings.length ? `<span class="warn">⚠ ${cs.qa.warnings.join("; ")}</span>` : "clean";
  setqaEl.innerHTML =
    `<span>set confidence <b>${cs.qa.confidence}</b></span>` +
    `<span>curves <b>${cs.qa.nCurves}</b></span>` +
    `<span>crossings <b>${cs.qa.crossings}</b></span>` +
    `<span>x-axis r <b>${cs.xAxis.r.toFixed(4)}</b> · y-axis r <b>${cs.yAxis.r.toFixed(4)}</b></span>` +
    `<span>${w}</span>`;
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
    tbody.appendChild(tr);
  });
}

function toCsv(cs: CurveSet): string {
  const lines = ["curve_id,order_index,x,y"];
  for (const c of cs.curves) for (const [x, y] of c.points) lines.push(`${c.id},${c.orderIndex},${x},${y}`);
  return lines.join("\n");
}

async function run(): Promise<void> {
  if (!pdfData) return;
  const expected = Math.round(parseFloat(expectedInput.value) || 0);
  try {
    const cs = await extract(pdfData, {
      prior: buildPrior(),
      orderBy: orderSel.value as OrderBy,
      expectedCurves: expected > 0 ? expected : null,
      split: splitCb.checked,
    });
    lastSet = cs;
    drawOverlay(cs);
    fillTable(cs);
    csvBtn.disabled = false;
  } catch (e) {
    setqaEl.hidden = false;
    setqaEl.innerHTML = `<span class="warn">extract failed: ${e instanceof Error ? e.message : String(e)}</span>`;
    tableWrap.hidden = true;
    overlay.replaceChildren();
    csvBtn.disabled = true;
  }
}

async function load(data: Uint8Array): Promise<void> {
  pdfData = data;
  rerunBtn.disabled = false;
  drop.hidden = true;
  await renderPdf(data);
  await run();
}

// --- wiring ---
priorSel.addEventListener("change", () => { tolWrap.hidden = priorSel.value === "free"; void run(); });
[tolInput, expectedInput, orderSel, splitCb].forEach((el) => el.addEventListener("change", () => void run()));
rerunBtn.addEventListener("click", () => void run());

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
  expectedInput.value = "3";
  await load(new Uint8Array(buf));
});
csvBtn.addEventListener("click", () => {
  if (!lastSet) return;
  const blob = new Blob([toCsv(lastSet)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "getmapped-curves.csv"; a.click();
  URL.revokeObjectURL(a.href);
});
