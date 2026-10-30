{
  description = "nhost-retro";

  inputs = {
    nixops.url = "github:nhost/nhost";
    nixpkgs.follows = "nixops/nixpkgs";
    flake-utils.follows = "nixops/flake-utils";
  };

  outputs =
    {
      self,
      nixops,
      nixpkgs,
      flake-utils,
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

        checkDeps = [
        ];

        nativeBuildInputs =
          with pkgs;
          [
            nhost.biome
            hasura-cli
            bun
          ]
          ++ lib.optionals (stdenv.isDarwin && pkgs ? xcodegen) [
            xcodegen
          ];

        buildInputs = [
        ];

      in
      {
        checks = {
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
            buildInputs =
              with pkgs;
              [
                gnumake
                nixpkgs-fmt
                nhost.nhost-cli
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
