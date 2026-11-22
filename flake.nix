{
  description = "WordPress Cloudflare Email plugin — dev environment & reproducible build";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    composition-c4.url = "github:fossar/composition-c4";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      composition-c4,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ composition-c4.overlays.default ];
        };
        inherit (pkgs) lib stdenvNoCC;

        php = pkgs.php84.buildEnv {
          extensions =
            { enabled, all }:
            enabled
            ++ (with all; [
              curl
              mbstring
              openssl
              tokenizer
              fileinfo
            ]);
          # PHPStan parses the full WordPress stubs; the 128M default is not enough.
          extraConfig = ''
            memory_limit = 2G
          '';
        };

        nodejs = pkgs.nodejs_22;

        composerData = builtins.fromJSON (builtins.readFile ./composer.json);

        pname = "cloudflare-email";
        # The Release Please manifest owns the version; composer.json has none,
        # because Packagist takes versions from the git tags.
        version = (builtins.fromJSON (builtins.readFile ./.release-please-manifest.json)).".";
        src = self;

        # -------------------------------------------------------------- #
        # JS assets: compile the DataViews app with @wordpress/scripts.   #
        # importNpmLock fetches npm deps reproducibly from                #
        # package-lock.json (no hash to maintain). We only want the       #
        # emitted build/ directory, so npm's own install/pack is skipped. #
        # -------------------------------------------------------------- #
        jsAssets = pkgs.buildNpmPackage {
          pname = "${pname}-assets";
          inherit version src nodejs;

          npmDeps = pkgs.importNpmLock { npmRoot = src; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          dontNpmInstall = true;

          # rolldown ships a prebuilt native (.node) binding whose ELF
          # dependencies (libstdc++/libgcc_s) must be patched onto the Nix store
          # before it can be dlopened during the build.
          nativeBuildInputs = [ pkgs.autoPatchelfHook ];
          buildInputs = [ pkgs.stdenv.cc.cc.lib ];
          preBuild = ''
            autoPatchelf node_modules/@rolldown
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r build/. "$out/"
            runHook postInstall
          '';
        };

        # -------------------------------------------------------------- #
        # PHP / Composer vendor dependencies.                             #
        # c4.fetchComposerDeps reads composer.lock per-package — no hash. #
        # -------------------------------------------------------------- #
        composerDeps = pkgs.c4.fetchComposerDeps {
          inherit src;
        };

        # The PHPStan inputs (WordPress/WP-CLI stubs, phpstan-wordpress) live
        # in their own Composer project: the root composer.json is published
        # to Packagist, and the `replace` of phpstan/phpstan they need would
        # leak into every site that installs the plugin.
        phpstanTools = stdenvNoCC.mkDerivation {
          pname = "${pname}-phpstan-tools";
          inherit version;
          src = ./tests/tools;

          composerDeps = pkgs.c4.fetchComposerDeps {
            lockFile = ./tests/tools/composer.lock;
          };

          nativeBuildInputs = [
            php
            php.packages.composer
            pkgs.c4.composerSetupHook
          ];

          buildPhase = ''
            runHook preBuild
            composer --no-ansi install --no-interaction
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            # -L: c4 installs vendor as symlinks into the store.
            cp -rL vendor "$out/"
            runHook postInstall
          '';
        };

        # ---------------------------------------------------------------- #
        # Final plugin assembly: composer runtime deps + compiled assets.   #
        # ---------------------------------------------------------------- #
        pluginPackage = stdenvNoCC.mkDerivation {
          inherit
            pname
            version
            src
            composerDeps
            ;

          nativeBuildInputs = [
            php
            php.packages.composer
            pkgs.c4.composerSetupHook
          ];

          # composer.json carries no version and the sandbox has no .git.
          COMPOSER_ROOT_VERSION = version;

          buildPhase = ''
            runHook preBuild
            # Install runtime PHP dependencies (plugin-update-checker)
            composer --no-ansi install --no-dev --no-interaction --optimize-autoloader
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            pluginDir="$out/share/wordpress/plugins/cloudflare-email"
            mkdir -p "$pluginDir/build"

            cp cloudflare-email.php README.md LICENSE "$pluginDir/"
            # -L dereferences: composition-c4 installs vendor/ as symlinks into the
            # Nix store; the distributable plugin must contain real, self-contained files.
            cp -rL src vendor "$pluginDir/"
            cp -r ${jsAssets}/. "$pluginDir/build/"

            # Stamp the WordPress plugin header version from the Release Please
            # manifest, the single source of truth. WordPress and the update
            # checker read this header to detect new versions.
            sed -i -E "s|^([[:space:]]*\* Version:[[:space:]]*).*|\1${version}|" "$pluginDir/cloudflare-email.php"

            runHook postInstall
          '';

          meta = {
            inherit (composerData) description;
            license = lib.licenses.mit;
            platforms = lib.platforms.all;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            php
            php.packages.composer
            nodejs
            # phpstan backs the composer `phpstan` script; statix is for manual lint runs.
            # The prek hooks use neither.
            pkgs.statix
            pkgs.phpstan
          ];

          shellHook = ''
            echo "PHP $(php --version | head -1)"
            echo "Composer $(composer --version)"
            echo "Node $(node --version)"
          '';
        };

        # ------------------------------------------------------------------ #
        # nix flake check — PHPStan type checking (level 8, WordPress-aware). #
        # Runs offline: phpstanTools holds the WordPress / WP-CLI stubs and   #
        # phpstan-wordpress from tests/tools/composer.lock. The PHPStan       #
        # binary itself comes from nixpkgs: Packagist ships phpstan/phpstan   #
        # dist-only (phar), which composition-c4 cannot fetch, so             #
        # tests/tools/composer.json `replace`s it and nix provides it.        #
        # ------------------------------------------------------------------ #
        checks.phpstan = stdenvNoCC.mkDerivation {
          name = "${pname}-phpstan-${version}";
          inherit src composerDeps;

          nativeBuildInputs = [
            php
            php.packages.composer
            pkgs.phpstan
            pkgs.c4.composerSetupHook
          ];

          buildPhase = ''
            runHook preBuild
            composer --no-ansi install --no-interaction
            cp -rL ${phpstanTools}/vendor tests/tools/vendor
            # --autoload-file loads the WordPress extension's rule classes
            # before PHPStan builds its container.
            phpstan analyse --no-progress --no-ansi --memory-limit=2G \
              --autoload-file=tests/tools/vendor/autoload.php
            runHook postBuild
          '';

          installPhase = "touch $out";
        };

        packages = {
          default = pluginPackage;

          # ---------------------------------------------------------------- #
          # Deterministic, ready-to-install zip (top-level cloudflare-email/).#
          # nix build .#zip -> result/cloudflare-email.zip                   #
          # ---------------------------------------------------------------- #
          zip = stdenvNoCC.mkDerivation {
            name = "cloudflare-email-zip-${version}";
            nativeBuildInputs = [ pkgs.zip ];
            buildCommand = ''
              mkdir -p tmp/cloudflare-email
              cp -r ${pluginPackage}/share/wordpress/plugins/cloudflare-email/. tmp/cloudflare-email/
              chmod -R u+w tmp
              mkdir -p "$out"
              (cd tmp && zip -r -X "$out/cloudflare-email.zip" cloudflare-email)
            '';
          };
        };
      }
    );
}
