/** Build the static demo into demo/dist/ — bundles the app + pdf.js worker, copies the page + a sample PDF.
 *  Output is fully static (GitHub Pages-ready): open demo/dist/index.html over http. */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const out = "demo/dist";
mkdirSync(out, { recursive: true });

const common = { bundle: true, format: "esm", platform: "browser", logLevel: "info", target: "es2022" };

await build({ ...common, entryPoints: ["demo/main.ts"], outfile: `${out}/app.js` });
await build({ ...common, entryPoints: ["pdfjs-dist/legacy/build/pdf.worker.mjs"], outfile: `${out}/pdf.worker.js` });

// cache-bust the app bundle per build so a reload never serves a stale app.js
const version = Date.now().toString(36);
const html = readFileSync("demo/index.html", "utf8").replace('src="./app.js"', `src="./app.js?v=${version}"`);
writeFileSync(`${out}/index.html`, html);
copyFileSync("demo/sample.pdf", `${out}/sample.pdf`);   // multi-page synthetic sample (demo/make_sample.py)
console.log(`\nbuilt -> ${out}/  (serve it: npm run serve:demo)`);
