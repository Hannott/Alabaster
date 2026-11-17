# Installation

Alabaster is a folder of static files. Any web server can serve it, and nothing
runs on your printer.

## Install it

Run this on the machine running Klipper, as the user that owns it, not as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)"
```

The installer stays open until you quit it. It shows what is on the machine
and what you can do: install, update, move the nginx site to another port,
repair the macro pack's clone, restart Klipper or Moonraker, or uninstall.
After each one you are back where you started, with its result, so you can
do the next thing without running the command again. When you quit, it lists
everything the session changed.

Installing downloads the latest release and verifies its checksum. Before it
changes anything, it lays out every change it would make outside its own
directory, so you decide all of them at once. After you confirm, it runs to
the end without stopping to ask again. Each of these is optional:

1. **The macro pack.** Clones `alabaster.cfg` from this same repository,
   links it in, and pins the clone to the exact release you are installing.
   See [Macros](/guide/macros) for more information.
2. **The include in `printer.cfg`.** Only offered when nothing already
   defines the same macros. If something does, you see which macros and which
   file before anything is installed.
3. **An nginx site.** Serves Alabaster, Moonraker, and up to four crowsnest
   cameras on a port you choose. crowsnest uses ports `8080` to `8083` for
   its cameras, so pick a port outside that range.
4. **Updates through Moonraker.** Adds an entry for the app. If the macro
   pack was cloned, adds a second entry for it. Both then appear on the
   Machine page alongside Klipper's and Moonraker's own entries.

If the install changed Klipper's or Moonraker's configuration, the installer
can restart them for you. It refuses while a print is running or paused.

Then open `http://<your-printer>.local:8090`.

::: tip Safe to run again
Run the installer again to update. It never adds a duplicate include and
never overwrites an `alabaster.cfg` you have edited.
:::

With `--yes`, with `--plain`, or when its output goes to a file, the installer
runs once from start to finish instead, printing one line per step. That suits
scripts and logs.

### Options

| Flag                                                               |                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `--path DIR`                                                       | Where to install. Default `~/alabaster`.                                                    |
| `--config-repo-path DIR`                                           | Where to clone the macro pack. Default `~/alabaster-config`.                                |
| `--port PORT`                                                      | The port for the nginx site. Default `8090`.                                                |
| `--moonraker HOST:PORT`                                            | Moonraker's address for the proxy. Default `127.0.0.1:7125`.                                |
| `--version TAG`                                                    | Install a specific release, such as `v0.2.0`.                                               |
| `--from-zip FILE`                                                  | Install a local archive instead of downloading.                                             |
| `--yes`                                                            | Do not prompt; take each prompt's default. Defaults never overwrite a file you have edited. |
| `--dry-run`                                                        | Print what would happen and change nothing.                                                 |
| `--plain`                                                          | Print one line per step, without panels or colour. Suits logs and screen readers.           |
| `--uninstall`                                                      | Open straight on the uninstall plan.                                                        |
| `--no-config`, `--no-include`, `--no-nginx`, `--no-update-manager` | Skip that step entirely.                                                                    |

## Choose where it runs

The installer assumes the most common case: Alabaster running on the
printer's own Pi. A second arrangement is also supported.

### On a printer's Raspberry Pi

This is the right choice for a single printer. The Pi serves Alabaster and
proxies Moonraker. The browser sees one origin, so nothing needs configuring.

### On a separate host

For example a NAS, an always-on box, or a container. This is the right choice
for more than one printer, for two reasons:

- This treats every printer the same: none gains an advantage by also
  serving the page.
- The interface stays reachable when a printer is switched off. It does not
  depend on any one printer being on.

Every printer is then cross-origin, including the first. Each one needs
[a CORS entry](#allow-the-browser-to-reach-moonraker). Install with
`--no-nginx --no-config --no-update-manager` and point your own web server at
the installed folder. There is nothing to proxy: the browser reaches each
Moonraker directly.

## Allow the browser to reach Moonraker

Skip this section when the same origin serves Alabaster and Moonraker. The
installer's nginx site does that.

Otherwise, add the address you open Alabaster at to every printer's
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

::: tip Connection refused
If Alabaster reports that something answered but refused the connection,
Moonraker is running and the address is correct, but your browser's origin is
not in `cors_domains`. A switched-off printer produces a different message.
:::

## Updating

If you let the installer manage updates, the app and the macro pack (if
installed) each appear as their own row on the
[Machine](/interface/machine#software-updates) page. Install updates from
there. The app downloads its next release, and the macro pack runs `git pull`
on its own clone.

Otherwise, run the install command again to update the app. Update the macro
pack's clone the same way Moonraker would: run `git pull` inside
`~/alabaster-config`.

Your settings (connection, saved printers, dashboards, theme) live in your
browser, not in the installed folder. An update never touches them.
`alabaster.cfg` is also unaffected by an app update. It lives in its own
clone, symlinked into your configuration directory, separate from the
directory an app update replaces.

## Uninstalling

```bash
bash ~/alabaster/scripts/uninstall.sh
```

Or choose Uninstall in the installer, or fetch the uninstaller the same way as
the installer. Before anything is removed, you choose what goes: the include,
the symlink or file, your `alabaster-user.cfg`, the macro pack's clone, the
`moonraker.conf` blocks, and the nginx site. Your own settings file and the
clone are kept unless you choose otherwise. The include is removed before the
file it points at, and the file stays while the include does, so Klipper
never refers to a file that is gone.

Settings stay in the browser until you clear its site data.

## Installing by hand

Follow these steps if you prefer not to run a script.

**1. Get a release.** Download `alabaster.zip` and `alabaster.zip.sha256` from
[the releases page](https://github.com/Hannott/Alabaster/releases), then:

```bash
sha256sum -c alabaster.zip.sha256 && unzip alabaster.zip -d ~/alabaster
```

**2. Serve it.** Alabaster routes on the URL hash, so no rewrite rules are
needed. A copy of the nginx site is inside the archive at
`deploy/nginx/alabaster.conf`. Replace `__PORT__`, `__ROOT__`, and
`__MOONRAKER__`, then put the file in `/etc/nginx/sites-available/` and link
it into `sites-enabled/`.

::: warning Upload size limit
nginx caps request bodies at 1 MB by default. This rejects every G-code
upload with a bare 413 error. The shipped site sets `client_max_body_size 0`.
Set this yourself if you write your own site.
:::

**3. Optionally add the macros.** Recommended: clone this repository into
`~/alabaster-config` and symlink the file in. This tracks it the same way the
installer does:

```bash
git clone --filter=blob:none --sparse --branch <the version you installed> \
  https://github.com/Hannott/Alabaster.git ~/alabaster-config
git -C ~/alabaster-config sparse-checkout set klipper
ln -s ~/alabaster-config/klipper/alabaster.cfg ~/printer_data/config/alabaster.cfg
```

Or, without git tracking: copy `klipper/alabaster.cfg` from the archive next
to `printer.cfg` directly. Either way, add `[include alabaster.cfg]` near the
top of `printer.cfg` after checking nothing else already defines the same
macros. See [Macros](/guide/macros) for more information.

**4. Optionally add updates.** Append `deploy/moonraker/update_manager.conf`
to `moonraker.conf` and restart Moonraker. The file has both entries. Delete
the second entry if you copied the file instead of cloning it.

## Building it yourself

Only needed to run unreleased code. Build on a workstation and copy the
result to the printer. Building on the Pi itself is not supported. See
[Development setup](/guide/development) for more information.

## Remote access with OctoEverywhere

[OctoEverywhere](https://octoeverywhere.com/klipper) can relay Alabaster from
outside your network. Its setup only looks for a frontend on a fixed list of
ports and names. Alabaster's default port (`8090`) is not on that list, so
point it at Alabaster explicitly:

- During interactive setup, choose **m** for manual setup and enter your
  Alabaster port.
- Or edit `octoeverywhere.conf` directly. Set `frontend_port = 8090` (or
  whichever port you installed Alabaster on) and restart the OctoEverywhere
  service.
