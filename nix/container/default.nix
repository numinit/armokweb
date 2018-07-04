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
  master = import (fetchGit https://github.com/NixOS/nixpkgs) {};
  armokweb = import ../armokweb;
in
{
  config = {
    # TODO: clean up.
    environment.systemPackages = with pkgs; [
      coreutils wget vim curl git subversion htop bash zsh tmux psmisc

      ruby
      python27

      armokweb

      gnome2.gtkglext gnome2.libglade
      gtk3 gdk_pixbuf gobjectIntrospection

      xorg.xorgserver
      xorg.xinit
      xorg.xf86videodummy
      xorg.xf86inputevdev
      xorg.xkbcomp

      xterm
      xlibs.xmodmap

      xvfb_run xdummy

      unstable.xpra
      unstable.pythonPackages.rencode

      (master.dwarf-fortress.override {
        enableDFHack = true;
        enableStoneSense = false;
        enableSoundSense = false;
        theme = "cla";
      })
      master.dwarf-therapist
    ];

    hardware.pulseaudio = {
      enable = true;
      package = pkgs.pulseaudioFull;
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
        ExecStart = "${pkgs.tmux}/bin/tmux new-session -s armokweb -d '${armokweb}/bin/armokweb --spawn ~/script/wrapper.sh --listen 0.0.0.0:10000'";
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
        extraGroups = ["audio" "tty"];
      };
    };
  };

  autoStart = true;
  privateNetwork = true;
  hostAddress = "192.168.100.1";
  localAddress = "192.168.100.10";
}
