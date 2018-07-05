# armokweb

Demo: https://armokweb.numin.it/ - check the lobste.rs thread for credentials

Armok Web Services: play collaborative (or chaotic) Dwarf Fortress sessions
in your browser by streaming through [xpra](https://xpra.org/). Manage your
fort's labors while a friend manages your military. It's like having multiple
people at multiple keyboards!

![Screenshot](https://i.imgur.com/BcK8u1k.png)

[Demo video](https://streamable.com/uax2f)

## Dependencies

xpra, xorg, xf86videodummy, xf86inputevdev, xkbcomp, xmodmap, xvfb_run, and
others. Pull requests are welcome to get it working on your distribution.

## Deployment

We currently support deploying on NixOS in containers.

The deployment is currently not perfect, copy the `script` folder under `src`
to the home folder of the `df` user in the container and restart the container.

Dwarf Therapist also complains about memory maps missing; you might have to
drop a symlink to `memory_layouts` into ~/.local/share/dwarftherapist.
This should be fixable in nixpkgs at some point.

To create a Nix container for Armok Web Services, add the following to your
`configuration.nix` after cloning this repository:

    containers.df = import /path/to/armokweb-repo/nix/container;

### nginx `proxy_pass` config

If you want to use nginx as a proxy server, a config like this will work.
It's *highly* recommended to use TLS if you're hosting this on the internet.

```nix
services.nginx = {
  enable = true;

  virtualHosts."armokweb.example.com" = {
    http2 = true;
    forceSSL = true;
    enableACME = true;
    basicAuth = {
      "username" = "password";
    };

    locations."/" = {
      extraConfig = ''
        proxy_pass http://192.168.100.10:10000;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
      '';
    };
  };
};
```

## Security

Containers aren't perfect. Only give access to people you trust!

## Related projects

* [dfremote](https://github.com/mifki/dfremote)

## License notice

See [NOTICE.md](NOTICE.md)
