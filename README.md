# armokweb

Armok Web Services: play collaborative (or chaotic) Dwarf Fortress sessions
in your browser by streaming through [xpra](https://xpra.org/). Manage your
fort's labors while a friend manages your military. It's like having multiple
people at the same keyboard!

![Screenshot](https://i.imgur.com/BcK8u1k.png)

[Demo video](https://streamable.com/uax2f)

## Deployment

We currently support deploying on NixOS in containers.

The deployment is currently not perfect, copy the `script` folder under `src`
to the home folder of the `df` user in the container.

Dwarf Therapist also complains about memory maps missing; you might have to
drop a symlink into ~/.local. This should be fixable in nixpkgs at some point.

To create a Nix container for Armok Web Services, add the following to your
`configuration.nix`:

    containers.df = import /path/to/armokweb/nix/container;

## Security

Containers aren't perfect. Only give access to people you trust!

## Related projects

* [dfremote](https://github.com/mifki/dfremote)

## License notice

See [NOTICE.md](NOTICE.md)
