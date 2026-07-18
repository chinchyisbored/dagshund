{
  description = "Dagshund development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      artifacts = {
        aarch64-linux = {
          bun = {
            archive = "bun-linux-aarch64.zip";
            hash = "sha256-xAvA68oRvefXWvSXplSodNDH/Y1qjWAxwXPBDJBkKXs=";
          };
          databricks = {
            archive = "databricks_cli_1.8.0_linux_arm64.tar.gz";
            hash = "sha256-pfNXWgblaluS2vYqiLLVTE8HIxwHuiFgDJxyF2GBRQg=";
          };
          beadsRust = {
            archive = "br-0.2.16-linux_musl_arm64.tar.gz";
            hash = "sha256-OLISantckz6LpvcDCSmD+x+dJloe2Y/LLzwULnDFYq4=";
          };
        };
        x86_64-linux = {
          bun = {
            archive = "bun-linux-x64.zip";
            hash = "sha256-Edw+4RvBaV4UlzfGyj1WGTAs9DRua4pux5iJZ+8B3cU=";
          };
          databricks = {
            archive = "databricks_cli_1.8.0_linux_amd64.tar.gz";
            hash = "sha256-l/UHWBmrx09GS5KqxBIKZsiQyvUXwn5+ZUNNw7By8is=";
          };
          beadsRust = {
            archive = "br-0.2.16-linux_musl_amd64.tar.gz";
            hash = "sha256-7htuBq+zqUFoRr0dAdgBH6qjbDAaPX4wkWyzhaXHefU=";
          };
        };
      };
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          artifact = artifacts.${system};
          python = pkgs.python314;

          bun = pkgs.stdenvNoCC.mkDerivation {
            pname = "bun";
            version = "1.3.12";
            src = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.12/${artifact.bun.archive}";
              inherit (artifact.bun) hash;
            };
            nativeBuildInputs = [
              pkgs.autoPatchelfHook
              pkgs.unzip
            ];
            buildInputs = [ pkgs.openssl ];
            dontConfigure = true;
            dontBuild = true;
            installPhase = ''
              install -Dm755 bun "$out/bin/bun"
              ln -s "$out/bin/bun" "$out/bin/bunx"
            '';
          };

          databricksCli = pkgs.stdenvNoCC.mkDerivation {
            pname = "databricks-cli";
            version = "1.8.0";
            src = pkgs.fetchurl {
              url = "https://github.com/databricks/cli/releases/download/v1.8.0/${artifact.databricks.archive}";
              inherit (artifact.databricks) hash;
            };
            sourceRoot = ".";
            dontConfigure = true;
            dontBuild = true;
            installPhase = ''
              install -Dm755 databricks "$out/bin/databricks"
            '';
          };

          beadsRust = pkgs.stdenvNoCC.mkDerivation {
            pname = "beads-rust";
            version = "0.2.16";
            src = pkgs.fetchurl {
              url = "https://github.com/Dicklesworthstone/beads_rust/releases/download/v0.2.16/${artifact.beadsRust.archive}";
              inherit (artifact.beadsRust) hash;
            };
            sourceRoot = ".";
            dontConfigure = true;
            dontBuild = true;
            installPhase = ''
              install -Dm755 br "$out/bin/br"
            '';
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              beadsRust
              bun
              databricksCli
              pkgs.bashInteractive
              pkgs.biome
              pkgs.coreutils
              pkgs.diffutils
              pkgs.findutils
              pkgs.git
              pkgs.glab
              pkgs.gnugrep
              pkgs.gnused
              pkgs.just
              pkgs.prek
              pkgs.psmisc
              pkgs.ruff
              pkgs.ty
              pkgs.uv
              pkgs.xdg-utils
              python
            ];

            BIOME_BINARY = "${pkgs.biome}/bin/biome";
            BUN_INSTALL_CACHE_DIR = ".cache/bun/install";
            UV_CACHE_DIR = ".uv-cache";
            UV_NO_SYNC = "1";
            UV_PYTHON = "${python}/bin/python3.14";
            UV_PYTHON_DOWNLOADS = "never";
            UV_PYTHON_PREFERENCE = "only-system";
          };
        }
      );
    };
}
