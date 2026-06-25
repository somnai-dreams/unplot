/** Build the static demo into demo/dist/ — bundles the app + pdf.js worker with Bun, copies the page + a
 *  sample PDF, and cache-busts the app bundle per build. Run with: bun run build:demo */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const out = "demo/dist";
mkdirSync(out, { recursive: true });

const worker = Bun.resolveSync("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.dir);
for (const [entry, name] of [["demo/main.ts", "app"], [worker, "pdf.worker"]] as const) {
  const r = await Bun.build({ entrypoints: [entry], outdir: out, target: "browser", naming: `${name}.[ext]` });
  if (!r.success) { console.error(r.logs); process.exit(1); }
}

// cache-bust the app bundle so a reload never serves a stale app.js
const version = Date.now().toString(36);
writeFileSync(`${out}/index.html`, readFileSync("demo/index.html", "utf8").replace('src="./app.js"', `src="./app.js?v=${version}"`));
copyFileSync("demo/sample.pdf", `${out}/sample.pdf`);   // multi-page synthetic sample (demo/make_sample.py)
console.log(`built -> ${out}/  (serve: bun run serve:demo)`);
