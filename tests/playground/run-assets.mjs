// Test A — build-output assertions (fast, no browser). Guards the exact bug that blanked
// the log page: index.asset.php must declare the real WP script handles the app needs, must
// NOT declare handles WordPress doesn't register (e.g. wp-icons), and the bundle must not
// carry an un-shimmed CommonJS `require("react")`. Also checks that StyleX was extracted at
// build time rather than left to run in the browser. Requires `npm run build` to have run.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tally } from "./assert.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const assetPath = resolve(ROOT, "build/index.asset.php");
const jsPath = resolve(ROOT, "build/index.js");
const cssPath = resolve(ROOT, "build/index.css");

if (!existsSync(assetPath) || !existsSync(jsPath) || !existsSync(cssPath)) {
	console.error("build/ is missing — run `npm run build` in the repo root first.");
	process.exit(1);
}

const assetPhp = readFileSync(assetPath, "utf8");
const js = readFileSync(jsPath, "utf8");
const css = readFileSync(cssPath, "utf8");

const depsBlock = assetPhp.match(/'dependencies'\s*=>\s*array\(([^)]*)\)/);
const deps = depsBlock ? [...depsBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

// Handles the app / bundled DataViews genuinely need at runtime.
const REQUIRED = [
	"react",
	"react-dom",
	"react-jsx-runtime",
	"wp-element",
	"wp-components",
	"wp-api-fetch",
	"wp-dom-ready",
	"wp-i18n",
];
// Core does NOT register these as script handles — declaring one silently drops the script.
const FORBIDDEN = ["wp-icons"];

const t = tally();
console.log("Test A — build output\n");

t.check("index.asset.php has a non-empty dependencies array", deps.length > 0, `${deps.length} deps`);
for (const h of REQUIRED) t.check(`manifest declares "${h}"`, deps.includes(h));
for (const h of FORBIDDEN) {
	t.check(`manifest does NOT declare "${h}" (unregistered → blank page)`, !deps.includes(h));
}
t.check(
	'bundle contains no un-shimmed require("react")',
	!js.includes('require("react")') && !js.includes("require(`react`)"),
);
t.check("index.js is non-trivial (bundled app present)", js.length > 50_000, `${js.length} bytes`);

// index.css is the vendored DataViews stylesheet with the compiled StyleX rules appended.
// Both halves must be present: a missing StyleX block means the compiler silently produced
// nothing and every element would render unstyled.
t.check("index.css carries the DataViews stylesheet", css.includes(".dataviews-wrapper"));
t.check("index.css carries compiled StyleX rules", /^\.cfe[\da-z]+/m.test(css));
t.check("index.css defines the StyleX token variables", /:root[^{]*\{--cfe/.test(css));
// The tokens deliberately carry no fallback values, so the WPDS layer must be reachable.
t.check(
	"StyleX tokens resolve against the WordPress design system",
	css.includes("var(--wpds-color-background-surface-success)"),
);
// StyleX is a compiler: any create() call surviving into the bundle means extraction failed
// and styles would be missing from the stylesheet.
t.check("bundle contains no runtime stylex.create() call", !js.includes("stylex.create("));

console.log(t.failures ? `\nTest A FAILED (${t.failures})` : "\nTest A PASSED");
process.exit(t.failures ? 1 : 0);
