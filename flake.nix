{
  description = "Dagshund development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [ "x86_64-linux" ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      artifacts = {
        x86_64-linux = {
          bun = {
            archive = "bun-linux-x64.zip";
            hash = "sha256-LQP7X7g6yLVnrKCigbLOGhoZ1Ij1bClo2Iw/Jekv5FI=";
          };
          databricks = {
            archive = "databricks_cli_1.14.0_linux_amd64.tar.gz";
            hash = "sha256-biMitrRIzNomHBWwRFtUY5Gaym++kolz6O6+ur2UhOk=";
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
            version = "1.4.0";
            src = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/${artifact.bun.archive}";
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
            version = "1.14.0";
            src = pkgs.fetchurl {
              url = "https://github.com/databricks/cli/releases/download/v1.14.0/${artifact.databricks.archive}";
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
              pkgs.gh
              pkgs.git
              pkgs.glab
              pkgs.gnugrep
              pkgs.gnused
              pkgs.jq
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
            LD_LIBRARY_PATH = nixpkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
            UV_CACHE_DIR = ".cache/uv-cache";
            UV_NO_SYNC = "1";
            UV_PYTHON = "${python}/bin/python3.14";
            UV_PYTHON_DOWNLOADS = "never";
            UV_PYTHON_PREFERENCE = "only-system";
          };
        }
      );
    };
}
