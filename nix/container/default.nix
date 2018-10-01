# armokweb: Copyright (C) 2018+ Morgan Jones
#
# armokweb is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# armokweb is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with armokweb.  If not, see <https://www.gnu.org/licenses/>.

let
  pkgs = import <nixpkgs> {};
  unstable = import (fetchTarball https://github.com/NixOS/nixpkgs-channels/archive/nixos-unstable.tar.gz) {};
  xpra = import (fetchGit { url = https://github.com/numinit/nixpkgs.git; ref = "xf86videodummy"; }) {};

  armokweb = import ../armokweb;
in
{
  config = {
    environment.systemPackages = with pkgs; [
      coreutils vim htop bash tmux psmisc

      ruby
      python27

      armokweb

      xorg.xorgserver
      xorg.xinit
      xorg.xf86videodummy
      xorg.xf86inputevdev
      xorg.xkbcomp
      xorg.xrandr

      libGL
      glxinfo
      virtualgl

      xlibs.xmodmap
      xterm

      xpra.xpra
      xpra.xpra.xf86videodummy

      (unstable.dwarf-fortress-packages.dwarf-fortress-full.override {
        dfVersion = "0.44.12";
        theme = "phoebus";
        enableDFHack = true;
        enableTWBT = true;
        enableSoundSense = true;
        enableStoneSense = true;
        enableDwarfTherapist = true;
        enableLegendsBrowser = true;
        enableFPS = true;
        enableIntro = false;
      })
    ];

    environment.etc = {
      "armokweb/start.sh" = {
        source = ../../src/script/start.sh;
        mode = "0755";
      };

      "armokweb/runner.sh" = {
        source = ../../src/script/runner.sh;
        mode = "0755";
      };

      "armokweb/wrap.sh" = {
        source = ../../src/script/wrap.sh;
        mode = "0755";
      };

      "armokweb/spawn.sh" = {
        source = ../../src/script/spawn.sh;
        mode = "0755";
      };
    };

    hardware.pulseaudio = {
      enable = true;
      package = pkgs.pulseaudioFull;
    };

    hardware.opengl = {
      enable = true;
    };

    networking.firewall.allowedTCPPorts = [ 10000 ];
    networking.firewall.enable = true;

    nixpkgs.config = {
      allowUnfree = true;
    };

    systemd.services.armokweb = {
      description = "Armok Web Services";
      serviceConfig = {
        User = "df";
        Type = "forking";
        WorkingDirectory = "/home/df";
        ExecStart = "${pkgs.tmux}/bin/tmux new-session -s armokweb -d '${armokweb}/bin/armokweb --spawn /etc/armokweb/start.sh --listen 0.0.0.0:10000'";
        ExecStop = "${pkgs.tmux}/bin/tmux kill-session -t armokweb";
      };
      wantedBy = ["multi-user.target"];
      after = ["network.target"];
      enable = true;
    };

    users = {
      mutableUsers = true;
      extraUsers.df = {
        isNormalUser = true;
        uid = 1001;
        extraGroups = ["audio" "video" "tty"];
      };
    };
  };

  autoStart = true;
  privateNetwork = true;
  hostAddress = "192.168.100.1";
  localAddress = "192.168.100.10";
}
