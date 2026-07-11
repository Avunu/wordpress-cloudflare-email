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

        php = pkgs.php84.withExtensions (
          { enabled, all }:
          enabled
          ++ (with all; [
            curl
            mbstring
            openssl
            tokenizer
            fileinfo
          ])
        );

        nodejs = pkgs.nodejs_22;

        composerData = builtins.fromJSON (builtins.readFile ./composer.json);

        pname = "cloudflare-email";
        version = composerData.version;
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

            # Stamp the WordPress plugin header version from composer.json, the single
            # source of truth (Release Please bumps it). WordPress and the update
            # checker read this header to detect new versions.
            sed -i -E "s|^([[:space:]]*\* Version:[[:space:]]*).*|\1${version}|" "$pluginDir/cloudflare-email.php"

            runHook postInstall
          '';

          meta = {
            description = composerData.description;
            license = lib.licenses.mit;
            platforms = lib.platforms.all;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            php
            pkgs.php84Packages.composer
            nodejs
          ];

          shellHook = ''
            echo "PHP $(php --version | head -1)"
            echo "Composer $(composer --version)"
            echo "Node $(node --version)"
          '';
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
