import { defineConfig } from "rolldown";
import type { Plugin } from "rolldown";
import { transformAsync } from "@babel/core";
import styleX from "@stylexjs/babel-plugin";
import type { Rule } from "@stylexjs/babel-plugin";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/**
 * Build config for the DataViews admin app.
 *
 * Output is a single IIFE (`build/index.js`) plus a WordPress dependency manifest
 * (`build/index.asset.php`) and one stylesheet (`build/index.css`) — matching what Admin::enqueue()
 * expects.
 *
 * Styling is StyleX, extracted at build time: stylexPlugin() runs the StyleX babel plugin over
 * `assets/src` and collects the CSS rules it generates, and wpAssets() concatenates them onto the
 * DataViews stylesheet. Nothing is injected at runtime.
 *
 * Externalization strategy: every WordPress package that WordPress core registers as a script
 * handle is externalized to its `wp.*` / React global; `@wordpress/dataviews` and its non-core
 * dependencies (`@wordpress/ui`, `@ariakit/react`, clsx, …) are bundled, because core does not
 * register them.
 *
 * JSX uses oxc's default automatic runtime (imports from `react/jsx-runtime`, which is
 * externalized), so no explicit jsx option is needed.
 */

const require = createRequire(import.meta.url);

// WordPress packages that core registers as script handles (window.wp.*).
const CORE_WP_HANDLES = new Set([
	"a11y",
	"annotations",
	"api-fetch",
	"autop",
	"blob",
	"block-editor",
	"block-serialization-default-parser",
	"blocks",
	"commands",
	"components",
	"compose",
	"core-data",
	"data",
	"data-controls",
	"date",
	"deprecated",
	"dom",
	"dom-ready",
	"element",
	"escape-html",
	"hooks",
	"html-entities",
	"i18n",
	// NOTE: `@wordpress/icons` is intentionally absent. Unlike the handles here, core
	// does NOT register a `wp-icons` script — it is a bundled-only library. Listing it
	// would emit `wp-icons` into index.asset.php as a dependency; WordPress then finds
	// that handle unregistered and *silently drops the whole enqueued script*
	// (WP_Dependencies::all_deps fails) — the log page renders completely blank with no
	// console error. So `@wordpress/icons` must be bundled, not externalized.
	"is-shallow-equal",
	"keyboard-shortcuts",
	"keycodes",
	"notices",
	"plugins",
	"preferences",
	"primitives",
	"priority-queue",
	"private-apis",
	"redux-routine",
	"rich-text",
	"shortcode",
	"style-engine",
	"token-list",
	"url",
	"viewport",
	"warning",
	"wordcount",
]);

/** A module that is not bundled: WordPress loads it as a script, the IIFE reads it off a global. */
interface ExternalInfo {
	/** Script handle emitted into `index.asset.php`'s dependency array. */
	handle: string;
	/** Browser global the module resolves to at runtime. */
	global: string;
}

// `c` needs the annotation: replaceAll types the replacer's capture args as `...args: any[]`.
const camelCase = (name: string): string =>
	name.replaceAll(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** Map a module id to its WordPress script handle + browser global, or null to bundle it. */
function externalInfo(id: string): ExternalInfo | null {
	switch (id) {
		case "react": {
			return { handle: "react", global: "React" };
		}
		case "react-dom":
		case "react-dom/client": {
			return { handle: "react-dom", global: "ReactDOM" };
		}
		case "react/jsx-runtime":
		case "react/jsx-dev-runtime": {
			return { handle: "react-jsx-runtime", global: "ReactJSXRuntime" };
		}
		// no default
	}
	const match = /^@wordpress\/([a-z0-9-]+)$/.exec(id);
	if (match && CORE_WP_HANDLES.has(match[1])) {
		return { handle: `wp-${match[1]}`, global: `wp.${camelCase(match[1])}` };
	}
	return null;
}

// DataViews ships its compiled stylesheet separately; copy it into the bundle
// (rolldown no longer bundles CSS imports).
const dataviewsDir = dirname(require.resolve("@wordpress/dataviews/package.json"));
const dataviewsCss = readFileSync(join(dataviewsDir, "build-style", "style.css"), "utf8");

/**
 * CSS rules the StyleX compiler produced, keyed by module id so a `--watch` rebuild replaces a
 * module's rules instead of appending a second copy.
 */
const stylexRules = new Map<string, Rule[]>();

/**
 * Compile StyleX at build time.
 *
 * Rolldown applies its own oxc transform _after_ the `transform` hook, so babel sees the original
 * TSX and only needs the two syntax parsers — no TypeScript or JSX codegen happens here. Those
 * plugins are referenced by name rather than imported because they ship no type declarations.
 */
function stylexPlugin(): Plugin {
	return {
		name: "stylex",
		transform: {
			filter: { id: /\/assets\/src\/.*\.tsx?$/ },
			async handler(code, id) {
				const result = await transformAsync(code, {
					filename: id,
					babelrc: false,
					configFile: false,
					sourceMaps: false,
					plugins: [
						"@babel/plugin-syntax-jsx",
						["@babel/plugin-syntax-typescript", { isTSX: true }],
						styleX.withOptions({
							dev: false,
							// Extraction only: no style tags are injected at runtime.
							runtimeInjection: false,
							// Keeps the `tokens.stylex` import alive once its uses compile to literals.
							treeshakeCompensation: true,
							// Namespaced so atomic classes cannot collide with another plugin's StyleX
							// output on the same admin screen.
							classNamePrefix: "cfe",
							importSources: ["@stylexjs/stylex"],
							// Required by defineVars: resolves `*.stylex.ts` to stable variable names.
							unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname },
						}),
					],
				});
				if (!result?.code) {
					return null;
				}
				const metadata = result.metadata as { stylex?: Rule[] } | undefined;
				stylexRules.set(id, metadata?.stylex ?? []);
				return result.code;
			},
		},
	};
}

/**
 * Emit `index.asset.php` (the dependency handles the bundle imports + a content hash) and
 * `index.css` (the DataViews stylesheet followed by the extracted StyleX rules). Mirrors
 *
 * @wordpress/scripts' output so the PHP side (Admin::enqueue) stays a single style handle.
 */
function wpAssets(): Plugin {
	return {
		name: "wp-assets",
		generateBundle(_options, bundle) {
			const handles = new Set<string>();
			let entryCode = "";
			for (const file of Object.values(bundle)) {
				if (file.type !== "chunk") {
					continue;
				}
				if (file.isEntry) {
					entryCode = file.code;
				}
				for (const imported of file.imports) {
					const info = externalInfo(imported);
					if (info) {
						handles.add(info.handle);
					}
				}
			}
			const deps = [...handles].toSorted();

			// `false` disables @layer. A named layer ranks below *all* unlayered CSS, so layered
			// StyleX output would lose to wp-admin.css, wp-components and the DataViews rules.
			// Unlayered, it also outranks @wordpress/ui, which injects itself into `@layer wp-ui`.
			const stylexCss = styleX.processStylexRules([...stylexRules.values()].flat(), false);
			// StyleX last, so it wins equal-specificity ties against the DataViews rules above it.
			const css = `${dataviewsCss}\n${stylexCss}`;

			// Both halves feed the hash: a style-only change must still bust the asset version.
			const version = createHash("sha256").update(entryCode).update(css).digest("hex").slice(0, 20);
			const php = `<?php return array('dependencies' => array(${deps
				.map((d) => `'${d}'`)
				.join(", ")}), 'version' => '${version}');\n`;

			this.emitFile({ type: "asset", fileName: "index.asset.php", source: php });
			this.emitFile({ type: "asset", fileName: "index.css", source: css });
		},
	};
}

/**
 * Some bundled transitive dependencies (notably `use-sync-external-store`, pulled in via
 * `@wordpress/dataviews`) ship only CommonJS and call `require("react")`. rolldown leaves those
 * `require()` calls untouched in the IIFE output, where `require` is undefined — so the bundle
 * throws `ReferenceError: require is not defined` on load and the page renders blank. Define a tiny
 * IIFE-scoped `require` that resolves the externalized React modules to the globals WordPress
 * already provides. Unknown ids throw a descriptive error rather than the opaque built-in one, so
 * the e2e/browser test surfaces any new CJS require.
 */
const REQUIRE_SHIM =
	`var require=function(id){switch(id){` +
	`case"react":return globalThis.React;` +
	`case"react-dom":case"react-dom/client":return globalThis.ReactDOM;` +
	`case"react/jsx-runtime":case"react/jsx-dev-runtime":return globalThis.ReactJSXRuntime;` +
	`default:throw new Error("cloudflare-email: unshimmed require("+JSON.stringify(id)+")")}};`;

export default defineConfig({
	input: "assets/src/index.tsx",
	platform: "browser",
	transform: {
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
		},
	},
	external: (id) => externalInfo(id) !== null,
	plugins: [stylexPlugin(), wpAssets()],
	output: {
		dir: "build",
		format: "iife",
		entryFileNames: "index.js",
		minify: true,
		// Placed inside the IIFE wrapper (not the global scope), so `require` stays local.
		intro: REQUIRE_SHIM,
		globals: (id) => externalInfo(id)?.global ?? id,
	},
});
