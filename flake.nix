{
  description = "nhost-retro";

  inputs = {
    nixops.url = "github:nhost/nhost";
    nixpkgs.follows = "nixops/nixpkgs";
    flake-utils.follows = "nixops/flake-utils";
  };

  outputs =
    { self
    , nixops
    , nixpkgs
    , flake-utils
    ,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [
            nixops.overlays.default
          ];
        };

        fs = pkgs.lib.fileset;

        src = fs.toSource {
          root = ../..;
          fileset = fs.unions [
          ];
        };

        nix-src = fs.toSource {
          root = ./.;
          fileset = fs.unions [
            (fs.fileFilter (file: file.hasExt "nix") ./.)
          ];
        };

        playwrightBrowsers = pkgs.playwright-driver.selectBrowsers {
          withFirefox = false;
          withWebkit = false;
        };

        checkDeps = with pkgs; [
          nhost.biome
        ];

        nativeBuildInputs = with pkgs; [
          nhost.pnpm
          nhost.nodejs
        ];

        buildInputs = [
        ];

      in
      {
        checks = {
          playwright-version = pkgs.runCommand "check-playwright-version"
            {
              npmVersion = (builtins.fromJSON (builtins.readFile ./frontend/package.json)).devDependencies."@playwright/test";
              nixVersion = pkgs.playwright-driver.version;
            }
            ''
              test "$npmVersion" = "$nixVersion"
              mkdir "$out"
            '';

          biome-version = pkgs.runCommand "check-biome-version"
            {
              npmVersion = (builtins.fromJSON (builtins.readFile ./package.json)).devDependencies."@biomejs/biome";
              nixVersion = pkgs.nhost.biome.version;
              schema = (builtins.fromJSON (builtins.readFile ./biome.json))."$schema";
            }
            ''
              test "$npmVersion" = "$nixVersion"
              test "$schema" = "https://biomejs.dev/schemas/$nixVersion/schema.json"
              mkdir "$out"
            '';

          nixpkgs-fmt =
            pkgs.runCommand "check-nixpkgs-fmt"
              {
                nativeBuildInputs = with pkgs; [
                  nixpkgs-fmt
                ];
              }
              ''
                nixpkgs-fmt --check ${nix-src}/*

                mkdir $out
              '';

        };

        devShells = flake-utils.lib.flattenTree {
          default = pkgs.mkShell {
            # The npm wrapper honors this; generic Linux ELF binaries cannot run on NixOS.
            BIOME_BINARY = "${pkgs.nhost.biome}/bin/biome";
            PLAYWRIGHT_BROWSERS_PATH = "${playwrightBrowsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            # Nix browser wrappers carry their runtime libraries via rpath.
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

            buildInputs =
              with pkgs;
              [
                gnumake
                nixpkgs-fmt
                nhost.nhost-cli
                wrangler
                hasura-cli
                skopeo

              ]
              ++ checkDeps
              ++ buildInputs
              ++ nativeBuildInputs;
          };

          skopeo = pkgs.mkShell {
            buildInputs = with pkgs; [
              skopeo
            ];
          };
        };

        packages = flake-utils.lib.flattenTree { };
      }
    );
}
