{
  description = "Dagshund development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.multiverse.url = "github:fzakaria/nixpkgs-multiverse";

  outputs =
    { nixpkgs, multiverse, ... }:
    let
      system = "x86_64-linux";
    in
    {
      devShells.${system}.default =
        let
          pkgs = nixpkgs.legacyPackages.${system};

          mv = multiverse.lib.mkMultiverse {
            inherit system;
            config.allowUnfree = true;
          };

          beadsRust = pkgs.stdenvNoCC.mkDerivation {
            pname = "beads-rust";
            version = "0.7.0";
            src = pkgs.fetchurl {
              url = "https://github.com/Dicklesworthstone/beads_rust/releases/download/v0.7.0/br-0.7.0-linux_musl_amd64.tar.gz";
              hash = "sha256-KD4vO06xtXM2JXjN+CKHko5sAktkZP54E3M1i3L/gl0=";
            };
            sourceRoot = ".";
            dontConfigure = true;
            dontBuild = true;
            installPhase = ''
              install -Dm755 br "$out/bin/br"
            '';
          };

        in
        pkgs.mkShell {
          packages = [
            beadsRust
            mv.versions.bun."1.4.2"
            pkgs.glab
            pkgs.just
            pkgs.process-compose
            mv.versions.databricks-cli."1.20.0"
            mv.versions.uv."0.12.5"
            pkgs.python314
          ];

          DAGSHUND_PYTHON312 = "${pkgs.python312}/bin/python3.12";
          DAGSHUND_PYTHON313 = "${pkgs.python313}/bin/python3.13";
          DAGSHUND_PYTHON314 = "${pkgs.python314}/bin/python3.14";
          UV_PYTHON = "${pkgs.python314}/bin/python3.14";
          UV_PYTHON_DOWNLOADS = "never";
          UV_PYTHON_PREFERENCE = "only-system";
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
               pkgs.stdenv.cc.cc.lib
          ];
        };
    };
}
