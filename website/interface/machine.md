# Machine

The computer running Klipper, the boards it talks to, and the software on both.

## Host load and resources

Live figures as Moonraker publishes them, not a snapshot from when the page
opened:

- **CPU load**, per core.
- **Memory**, used and free.
- **Host temperature.**
- **Network bandwidth.**
- **Uptime.**

If host status cannot be read, the previously loaded figures stay visible and the
page says so. It does not blank out or show zeros.

## Controller modules

Every MCU Klipper is talking to, with its chip, firmware version, load, and
frequency.

A board that has dropped off is marked **Disconnected** rather than showing its
last-known numbers as though they were current.

## Peripherals

The serial and USB devices actually attached to the host.

This exists for one specific job: finding the `/dev/serial/by-id/...` path for an
`[mcu]` or `[probe]` section without an SSH session. The USB list also confirms
that a board is enumerating at all, which is the answer when it has not been
given a tty node yet.

There is no notification for a device being plugged in or unplugged, so this is
read when the page loads and again when you choose **Refresh**.

## Services

The services Moonraker manages, each with its state — **Running**, **Stopped**, or
**Failed** — and a link to open it where it has a web interface of its own.

Restarting Klipper, restarting Moonraker, and rebooting or shutting down the host
are in the header's power menu, on every page. See
[Restarting things on purpose](/guide/connecting#restarting-things-on-purpose).

## Software updates

Every update source Moonraker reports, each with its own status:

| Status           | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Up to date       | Nothing to do.                                                                                 |
| Update available | A newer version is waiting.                                                                    |
| Needs attention  | The repository's local state blocks updating. See [recovery](#recovering-a-broken-repository). |

**Each source acts from its own row.** A repository that needs attention is never
swept into an update-everything run, because the recovery it needs is not the same
as an install.

**Update all** names every source it will touch before it starts, and warns that
Klipper and Moonraker restart as part of their own updates — so the printer must
not be printing.

The output appears as it runs, in a console panel on the page.

::: info Moonraker restarts mid-update
Moonraker disconnects while updating itself, which looks like a failure and is
not. Alabaster says so: the work may have finished on the host, and checking for
updates again is how you find out.
:::

::: tip Alabaster's own macro pack is one of these rows
If you installed [the macro pack](/guide/macros), it appears here separately
from Alabaster itself — a git clone updates differently from a downloaded
release. Editing `alabaster.cfg` directly is fine, but it is exactly what turns
this row into **Needs attention**: the clone now has local changes, and the
recovery below is how you either keep them or discard them before the next
update.
:::

## Recovering a broken repository

A repository Moonraker will not update tells you why, and offers what that
particular problem needs:

| Reported      | What it means                                            |
| ------------- | -------------------------------------------------------- |
| Local changes | The working tree is dirty.                               |
| Invalid       | Moonraker marked it invalid, which disables its updates. |
| Detached HEAD | It is on a commit rather than a branch.                  |
| Corrupt       | The repository itself is damaged.                        |

**View differences** shows how far behind the branch is and the upstream commits
Moonraker reported, alongside its raw git output. Moonraker does not expose a
file-level diff, and the page says that rather than leaving you looking for one.

Two recoveries, both destructive and both spelled out before they run:

- **Force reset the branch** — discards local changes and matches the remote.
- **Re-clone the repository** — replaces it entirely.
