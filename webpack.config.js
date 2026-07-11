/**
 * Extends the default @wordpress/scripts webpack config.
 *
 * Two deviations from the default:
 *   1. Entry lives in assets/src/ (src/ is reserved for the PSR-4 PHP classes),
 *      output goes to build/.
 *   2. @wordpress/dataviews is *bundled* rather than externalized. Core does not
 *      reliably register a `wp-dataviews` script handle across the WordPress
 *      versions we support (6.5+), so we ship it ourselves. Every other
 *      @wordpress/* package is still externalized to its core `wp-*` handle.
 */
const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );

const plugins = defaultConfig.plugins.map( ( plugin ) => {
	if ( plugin.constructor.name !== 'DependencyExtractionWebpackPlugin' ) {
		return plugin;
	}
	// Replace the default extraction plugin with one that bundles dataviews.
	return new DependencyExtractionWebpackPlugin( {
		requestToExternal( request ) {
			if ( request === '@wordpress/dataviews' ) {
				// Falsey (not undefined) => do not externalize; bundle it.
				return false;
			}
			// undefined => fall back to the default externalization behavior.
			return undefined;
		},
	} );
} );

module.exports = {
	...defaultConfig,
	entry: {
		index: path.resolve( __dirname, 'assets/src/index.js' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve( __dirname, 'build' ),
	},
	plugins,
};
