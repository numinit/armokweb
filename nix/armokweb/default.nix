# armokweb: Copyright (C) 2018+ Morgan Jones
#
# armokweb is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# armokweb is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with armokweb.  If not, see <https://www.gnu.org/licenses/>.

let
  pkgs = import <nixpkgs> {};
  unstable = import (fetchTarball https://github.com/NixOS/nixpkgs-channels/archive/nixos-unstable.tar.gz) {};
in
pkgs.stdenv.mkDerivation rec {
  name = "armokweb";
  version = "0.1";

  src = ../../src;

  buildInputs = [ pkgs.makeWrapper ];
  buildDepends = [ pkgs.stdenv ];
  buildPhase = ":";

  installPhase = ''
    mkdir -p $out/bin $out/share/armokweb
    cp bin/armokweb $out/bin/.armokweb-original
    cp -R public $out/share/armokweb
    makeWrapper $out/bin/.armokweb-original $out/bin/armokweb \
      --add-flags "--xpra ${unstable.xpra}/bin/xpra" \
      --add-flags "--xpra-root ${unstable.xpra}" \
      --add-flags "--module-root ${pkgs.xorg.xf86videodummy}" \
      --add-flags "--module-root ${pkgs.xorg.xf86inputevdev}" \
      --add-flags "--module-root ${pkgs.xorg.xorgserver}" \
      --add-flags "--font-root ${pkgs.xorg.fontmiscmisc}" \
      --add-flags "--font-root ${pkgs.ucsFonts}" \
      --add-flags "--web-root $out/share/armokweb/public"
  '';

  meta = with pkgs.stdenv.lib; {
    description = "Play Dwarf Fortress in a browser session";
    license = licenses.agpl3;
    platforms = platforms.linux;
    maintainers = with maintainers; [ numinit ];
  };
}
