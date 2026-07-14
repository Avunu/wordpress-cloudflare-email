// Test A — build-output assertions (fast, no browser). Guards the exact bug that blanked
// the log page: index.asset.php must declare the real WP script handles the app needs, must
// NOT declare handles WordPress doesn't register (e.g. wp-icons), and the bundle must not
// carry an un-shimmed CommonJS `require("react")`. Requires `npm run build` to have run.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tally } from "./assert.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const assetPath = resolve(ROOT, "build/index.asset.php");
const jsPath = resolve(ROOT, "build/index.js");

if (!existsSync(assetPath) || !existsSync(jsPath)) {
	console.error("build/ is missing — run `npm run build` in the repo root first.");
	process.exit(1);
}

const assetPhp = readFileSync(assetPath, "utf8");
const js = readFileSync(jsPath, "utf8");

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

console.log(t.failures ? `\nTest A FAILED (${t.failures})` : "\nTest A PASSED");
process.exit(t.failures ? 1 : 0);
