{
  description = "WordPress Cloudflare Email plugin — dev environment & reproducible build";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    composition-c4.url = "github:fossar/composition-c4";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      composition-c4,
      git-hooks,
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

        # -------------------------------------------------------------- #
        # git-hooks.nix: installs a pre-commit hook (via the direnv/     #
        # devShell) that runs the same formatting/lint/typecheck as      #
        # `npm run check`, plus PHPStan, before every commit.             #
        #                                                                 #
        # Not wired into `checks` (nix flake check): the JS hooks shell   #
        # out to ./node_modules/.bin/* for exact toolchain parity with    #
        # npm, but node_modules is gitignored and so absent from the      #
        # hermetic source `git-hooks.nix` would use to build a check.     #
        # `checks.phpstan` below already covers PHPStan hermetically.     #
        # -------------------------------------------------------------- #
        pre-commit-check = git-hooks.lib.${system}.run {
          src = self;
          hooks = {
            # `excludes` mirrors the "tests" ignorePatterns entry in .oxfmtrc.json /
            # .oxlintrc.json: tests/playground is a separate npm package (own lint/format
            # setup, not part of this tsconfig). Without this, git-hooks.nix's built-in
            # oxfmt/oxlint hooks (matched via `types_or`, no files filter) still hand a
            # staged tests/*.mjs file to the tool; the tool's own ignorePatterns then
            # filters it back out, leaving zero targets — which both tools treat as a hard
            # failure ("Expected at least one target file") rather than a no-op.
            oxfmt = {
              enable = true;
              package = null;
              settings.binPath = "./node_modules/.bin/oxfmt";
              excludes = [ "^tests/" ];
            };

            oxlint = {
              enable = true;
              package = null;
              settings.binPath = "./node_modules/.bin/oxlint";
              excludes = [ "^tests/" ];
            };

            # `oxlint --type-aware` needs its own config/rule set (see
            # .oxlintrc.typecheck.json) and can't share the `oxlint` hook.
            oxlint-typecheck = {
              enable = true;
              name = "oxlint (type-aware)";
              description = "Type-aware oxlint pass against .oxlintrc.typecheck.json.";
              entry = "./node_modules/.bin/oxlint --type-aware -c .oxlintrc.typecheck.json .";
              files = "\\.tsx?$";
              pass_filenames = false;
            };

            tsc = {
              enable = true;
              name = "tsc";
              description = "TypeScript type-check (tsc --noEmit).";
              entry = "./node_modules/.bin/tsc --noEmit";
              files = "\\.tsx?$|tsconfig\\.json$";
              pass_filenames = false;
            };

            # Mirrors `checks.phpstan` and composer.json's `phpstan` script,
            # but runs against the working tree instead of a hermetic
            # composerDeps rebuild, so it stays fast enough for a hook.
            phpstan = {
              enable = true;
              package = pkgs.phpstan;
              entry = "${pkgs.phpstan}/bin/phpstan analyse --memory-limit=2G";
              pass_filenames = false;
            };

            nixfmt.enable = true;
            statix.enable = true;
            deadnix.enable = true;
          };
        };

        composerData = builtins.fromJSON (builtins.readFile ./composer.json);

        pname = "cloudflare-email";
        inherit (composerData) version;
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
            inherit (composerData) description;
            license = lib.licenses.mit;
            platforms = lib.platforms.all;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = pre-commit-check.enabledPackages ++ [
            php
            php.packages.composer
            nodejs
          ];

          shellHook = ''
            ${pre-commit-check.shellHook}
            echo "PHP $(php --version | head -1)"
            echo "Composer $(composer --version)"
            echo "Node $(node --version)"
          '';
        };

        # ------------------------------------------------------------------ #
        # nix flake check — PHPStan type checking (level 8, WordPress-aware). #
        # Runs offline: composerDeps contains the dev packages (WordPress /   #
        # WP-CLI stubs + phpstan-wordpress) from composer.lock. The PHPStan   #
        # binary itself comes from nixpkgs: Packagist ships phpstan/phpstan   #
        # dist-only (phar), which composition-c4 cannot fetch, so composer.json#
        # `replace`s it and nix provides the executable.                      #
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
            phpstan analyse --no-progress --no-ansi --memory-limit=2G
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
