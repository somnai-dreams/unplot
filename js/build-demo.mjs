/** Build the static demo into demo/dist/ — bundles the app + pdf.js worker, copies the page + a sample PDF.
 *  Output is fully static (GitHub Pages-ready): open demo/dist/index.html over http. */
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const out = "demo/dist";
mkdirSync(out, { recursive: true });

const common = { bundle: true, format: "esm", platform: "browser", logLevel: "info", target: "es2022" };

await build({ ...common, entryPoints: ["demo/main.ts"], outfile: `${out}/app.js` });
await build({ ...common, entryPoints: ["pdfjs-dist/legacy/build/pdf.worker.mjs"], outfile: `${out}/pdf.worker.js` });

copyFileSync("demo/index.html", `${out}/index.html`);
copyFileSync("test/fixtures/three_curves.pdf", `${out}/sample.pdf`);
console.log(`\nbuilt -> ${out}/  (serve it: python3 -m http.server -d ${out})`);
