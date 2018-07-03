let
  pkgs = import <nixpkgs> {};
in
pkgs.stdenv.mkDerivation rec {
  name = "armokweb";
  version = "0.1";

  src = ".";

  buildInputs = [ pkgs.makeWrapper ];
  buildDepends = [ pkgs.stdenv ];
  buildPhase = ":";

  installPhase = ''
    mkdir -p $out/bin $out/share/armokweb
    cp bin/armokweb $out/bin/.armokweb-original
    cp -R public $out/share/armokweb
    makeWrapper $out/bin/.armokweb-original $out/bin/armokweb \
      --add-flags "--xpra-root ${pkgs.xpra}" \
      --add-flags "--module-root ${pkgs.xorg.xf86videodummy}" \
      --add-flags "--module-root ${pkgs.xorg.xf86inputevdev}" \
      --add-flags "--module-root ${pkgs.xorg.xorgserver}" \
      --add-flags "--font-root ${pkgs.xorg.fontmiscmisc}" \
      --add-flags "--font-root ${pkgs.ucsFonts}" \
      --add-flags "--web-root $out/share/armokweb/public"
  '';

  meta = with pkgs.stdenv.lib; {
    description = "Play Dwarf Fortress in a browser session";
    license = licenses.free;
    platforms = platforms.linux;
    maintainers = with maintainers; [ numinit ];
  };
}
