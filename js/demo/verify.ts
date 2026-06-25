/**
 * Dumb runner for the demo's page-owned `?scenario=verify` report (see automating-browsers.md). It serves the
 * built demo, drives ONE headless-Chrome page over CDP, waits for the matching requestId to reach
 * phase:"ready", asserts the fragile interactions, and writes the report as a checked-in snapshot. The page
 * owns the scenario; this runner only does transport.
 *
 * Run with: bun run verify:demo  (builds demo/dist first). Needs Google Chrome installed; local check only —
 * the GitHub Pages workflow just builds.
 */
import { spawn } from "bun";
import { writeFileSync } from "node:fs";

// Mirror of the report the page publishes (main.ts). The runner owns its own view of the transport contract.
type VerifyReport = {
  phase: "loading" | "ready" | "error";
  requestId: string;
  numPages?: number;
  page1Overlay?: number;
  page1Data?: number;
  clearedOnNav?: boolean;
  page2Overlay?: number;
  hoverTip?: string;
  message?: string;
};

const PORT = 8124;
const CDP_PORT = 9223;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const requestId = `${Date.now().toString(36)}-verify`;
const scenarioUrl = `http://127.0.0.1:${PORT}/?scenario=verify&requestId=${encodeURIComponent(requestId)}`;

async function poll<T>(label: string, ms: number, fn: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + ms;
  let lastErr = "";
  while (Date.now() < deadline) {
    try { const r = await fn(); if (r != null) return r; } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    await Bun.sleep(150);
  }
  throw new Error(`timeout waiting for ${label}${lastErr !== "" ? ` (${lastErr})` : ""}`);
}

/** Minimal CDP client over the browser websocket: send(method) -> resolves with the matching response. */
function makeClient(ws: WebSocket): (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<Record<string, unknown>> {
  let nextId = 0;
  const pending = new Map<number, (m: Record<string, unknown>) => void>();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as Record<string, unknown>;
    const id = msg["id"];
    if (typeof id === "number") { pending.get(id)?.(msg); pending.delete(id); }
  });
  return (method, params = {}, sessionId) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify(sessionId != null ? { id, method, params, sessionId } : { id, method, params }));
    });
}

// serve the built demo, no-store so a rerun never sees a stale bundle
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(`demo/dist${path === "/" ? "/index.html" : path}`);
    return (await file.exists())
      ? new Response(file, { headers: { "cache-control": "no-store" } })
      : new Response("not found", { status: 404 });
  },
});

const chrome = spawn([
  CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", `--user-data-dir=/tmp/unplot-verify-${requestId}`,
  "about:blank",
], { stdout: "ignore", stderr: "ignore" });

let ws: WebSocket | null = null;
try {
  const version = await poll("chrome cdp", 15000, async () => {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return r.ok ? (await r.json() as { webSocketDebuggerUrl: string }) : null;
  });
  ws = new WebSocket(version.webSocketDebuggerUrl);
  const socket = ws;
  await new Promise<void>((res, rej) => {
    socket.addEventListener("open", () => res(), { once: true });
    socket.addEventListener("error", () => rej(new Error("websocket error")), { once: true });
  });
  const send = makeClient(socket);

  const created = await send("Target.createTarget", { url: scenarioUrl });
  const targetId = (created["result"] as { targetId: string }).targetId;
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = (attached["result"] as { sessionId: string }).sessionId;

  const report = await poll<VerifyReport>("page report", 25000, async () => {
    const r = await send("Runtime.evaluate", { expression: "location.hash", returnByValue: true }, sessionId);
    const value = (r["result"] as { result?: { value?: unknown } } | undefined)?.result?.value;
    const hash = typeof value === "string" ? value : "";
    const m = /report=(.+)$/.exec(hash);
    if (!m) return null;
    const rep = JSON.parse(decodeURIComponent(m[1]!)) as VerifyReport;
    return rep.requestId === requestId && (rep.phase === "ready" || rep.phase === "error") ? rep : null;
  });

  const checks: [string, boolean][] = [
    ["page reached phase:ready", report.phase === "ready"],
    ["sample produced curves on the source overlay", (report.page1Overlay ?? 0) > 0],
    ["sample produced curves in the data panel", (report.page1Data ?? 0) > 0],
    ["overlay cleared synchronously on page change", report.clearedOnNav === true],
    ["overlay repopulated for the new page", (report.page2Overlay ?? 0) > 0],
    ["hover resolved a point value from state", /x\s+\S+\s+y\s+\S+/i.test(report.hoverTip ?? "")],
  ];

  let failed = report.phase !== "ready";
  for (const [name, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed = true; }

  // drop requestId before checking the snapshot in — it's a per-run nonce (transport), not product behaviour
  const { requestId: _nonce, ...stable } = report;
  writeFileSync("demo/verify.report.json", JSON.stringify({ ...stable, checks: Object.fromEntries(checks) }, null, 2) + "\n");
  console.log("\nreport -> demo/verify.report.json");
  if (failed) { console.error("\nVERIFY FAILED"); process.exitCode = 1; } else console.log("\nVERIFY OK");
} catch (e) {
  console.error(`\nVERIFY ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
  void server.stop(true);
}
