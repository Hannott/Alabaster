# Installation

Alabaster is a folder of static files. Any web server can serve it, and nothing
runs on your printer.

## Install it

On the machine running Klipper, as the user that owns it — not as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)"
```

That downloads the latest release, verifies its checksum, and asks before each
change it makes outside its own directory:

1. **Install the macro pack?** Clones `alabaster.cfg` — pinned to the exact
   release you are installing — from this same repository, and links it in.
   Optional — see [Macros](/guide/macros).
2. **Add the include to `printer.cfg`?** Only offered when nothing already
   defines the same macros.
3. **Configure nginx?** Serves Alabaster and proxies Moonraker on a port you
   choose.
4. **Let Moonraker manage updates?** Adds an entry for the app and, if the
   macro pack was cloned, a second for it — so both appear on the Machine
   page like Klipper's and Moonraker's.

Then open `http://<your-printer>.local:8081`.

::: tip Re-running is safe
Run it again to update. It installs over the existing copy, never adds a
duplicate include, and never overwrites an `alabaster.cfg` you have edited.
:::

### Options

| Flag                                                               |                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `--path DIR`                                                       | Where to install. Default `~/alabaster`.                                                    |
| `--config-repo-path DIR`                                           | Where to clone the macro pack. Default `~/alabaster-config`.                                |
| `--port PORT`                                                      | The port for the nginx site. Default `8081`.                                                |
| `--moonraker HOST:PORT`                                            | Moonraker's address for the proxy. Default `127.0.0.1:7125`.                                |
| `--version TAG`                                                    | Install a specific release, such as `v0.2.0`.                                               |
| `--from-zip FILE`                                                  | Install a local archive instead of downloading.                                             |
| `--yes`                                                            | Do not prompt; take each prompt's default. Defaults never overwrite a file you have edited. |
| `--dry-run`                                                        | Print what would happen and change nothing.                                                 |
| `--no-config`, `--no-include`, `--no-nginx`, `--no-update-manager` | Skip that step entirely.                                                                    |

## Choose where it runs

The installer assumes the common case: Alabaster on the printer's own Pi. There
is a second arrangement worth knowing about.

### On a printer's Raspberry Pi

The right choice for a single printer. The Pi serves Alabaster and proxies
Moonraker, so the browser sees one origin and nothing needs configuring.

### On a separate host

A NAS, an always-on box, a container. The right choice for more than one
printer, for two reasons:

- Every printer is treated the same, instead of one being privileged because it
  happens to serve the page.
- The interface stays reachable when a printer is switched off. An interface
  that dies with one of your printers is not much use for the others.

Every printer is then cross-origin, including the first, so each needs
[a CORS entry](#allow-the-browser-to-reach-moonraker). Install with
`--no-nginx --no-config --no-update-manager` and point your own web server at
the installed folder; there is nothing to proxy, because the browser reaches
each Moonraker directly.

## Allow the browser to reach Moonraker

Skip this if Alabaster is served from the same origin as Moonraker — the
installer's nginx site does exactly that.

Otherwise add the address you open Alabaster at to every printer's
`moonraker.conf`:

```ini
[authorization]
cors_domains:
    http://alabaster.local
    http://192.168.1.50
trusted_clients:
    192.168.1.0/24
```

Restart Moonraker afterwards.

::: tip "Reachable, but refused"
If Alabaster says something answered but refused the connection, this is what it
is telling you: Moonraker is running and the address is right, but your
browser's origin is not in `cors_domains`. A printer that is simply switched off
produces a different message.
:::

## Updating

If you let the installer manage updates, the app and the macro pack (if you
installed it) each appear as their own row on the
[Machine](/interface/machine#software-updates) page. Install from there — the
app downloads its next release, and the macro pack `git pull`s its own clone.

Otherwise, run the install command again for the app. The macro pack's clone
updates the same way Moonraker would have: `git pull` inside
`~/alabaster-config`.

Your settings — connection, saved printers, dashboards, theme — live in your
browser, not in the installed folder, so an update never touches them.
`alabaster.cfg` is unaffected by an app update either way: it lives in its own
clone, symlinked into your configuration directory, entirely separate from the
directory an app update replaces.

## Uninstalling

```bash
bash ~/alabaster/scripts/uninstall.sh
```

Or fetch it the same way as the installer. It lists everything it will touch
before it starts, and asks separately about the include, the symlink or file,
the macro pack's clone, the nginx site, and each `moonraker.conf` block. The
include comes out before the file it points at, so your configuration is
never left referring to something that has been deleted.

Settings stay in the browser until you clear its site data.

## Installing by hand

If you would rather not run a script.

**1. Get a release.** Download `alabaster.zip` and `alabaster.zip.sha256` from
[the releases page](https://github.com/Hannott/Alabaster/releases), then:

```bash
sha256sum -c alabaster.zip.sha256 && unzip alabaster.zip -d ~/alabaster
```

**2. Serve it.** Alabaster routes on the URL hash, so no rewrite rules are
needed. A copy of the nginx site is inside the archive at
`deploy/nginx/alabaster.conf` — replace `__PORT__`, `__ROOT__`, and
`__MOONRAKER__`, then put it in `/etc/nginx/sites-available/` and link it into
`sites-enabled/`.

::: warning Uploads need the size limit lifted
nginx caps request bodies at 1 MB by default, which rejects every G-code upload
with a bare 413. The shipped site sets `client_max_body_size 0`. If you write
your own, set it.
:::

**3. Optionally add the macros.** Recommended: clone this repository into
`~/alabaster-config` and symlink the file in, so it is tracked the same way
the installer sets it up:

```bash
git clone --filter=blob:none --sparse --branch <the version you installed> \
  https://github.com/Hannott/Alabaster.git ~/alabaster-config
git -C ~/alabaster-config sparse-checkout set klipper
ln -s ~/alabaster-config/klipper/alabaster.cfg ~/printer_data/config/alabaster.cfg
```

Or simpler, without git tracking: copy `klipper/alabaster.cfg` from the archive
next to `printer.cfg` directly. Either way, add `[include alabaster.cfg]` near
the top of `printer.cfg` — after checking nothing else already defines the same
macros. See [Macros](/guide/macros).

**4. Optionally add updates.** Append `deploy/moonraker/update_manager.conf`
to `moonraker.conf` and restart Moonraker. It has both entries; delete the
second if you copied the file instead of cloning it.

## Building it yourself

Only needed to run unreleased code. Building on the Pi is deliberately
unsupported — build on a workstation and copy the result. See
[Development setup](/guide/development).

## Remote access with OctoEverywhere

[OctoEverywhere](https://octoeverywhere.com/klipper) can relay Alabaster from
outside your network. Its own setup only looks for a frontend on a fixed list
of ports and by name, and Alabaster's default port (`8081`) is neither, so
point it at Alabaster explicitly:

- During interactive setup, choose **m** for manual setup and enter your
  Alabaster port.
- Or edit `octoeverywhere.conf` directly: set `frontend_port = 8081` (or
  whichever port you installed Alabaster on) and restart the OctoEverywhere
  service.
