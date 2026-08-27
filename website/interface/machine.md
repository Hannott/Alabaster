# Machine

The computer running Klipper, the boards it talks to, and the software on both.

## Host load and resources

These figures come from Moonraker in real time, not as a snapshot from when the
page opened:

- **CPU load**, averaged across all cores.
- **Memory**, used and free.
- **Host temperature.**
- **Network bandwidth.**
- **Uptime.**

If host status cannot be read, the page keeps showing the previously loaded
figures and says so. It does not blank out or show zeros.

## Controller modules

This section lists every MCU Klipper is talking to, with its chip, firmware
version, load, and frequency.

A board that has dropped off is marked **Disconnected**. It does not keep
showing its last-known numbers as current.

## Peripherals

This section lists the serial, USB, and CAN devices actually attached to the
host.

Use it to find the `/dev/serial/by-id/...` path for an `[mcu]` or `[probe]`
section, or the UUID a CAN-connected toolhead's `canbus_uuid:` line wants,
without an SSH session. The USB list also confirms that a board is
enumerating, even before it has been given a tty node. A CAN interface is
listed even with nothing unclaimed on it, which confirms the adapter itself
is working, not just quiet.

There is no notification for a device being plugged in or unplugged. This
list is read when the page loads, and again when you choose **Refresh**.

## Services

This section lists the services Moonraker manages. Each row shows its state —
**Running**, **Stopped**, or **Failed** — and a link to its web interface,
where it has one.

**Most services can be started, stopped, or restarted from their own row.** A
stopped service offers only Start. A failed service offers Start and Restart.
A running service offers Stop and Restart. Stopping a service always asks for
confirmation. Restarting asks for lighter confirmation, since the service
comes back on its own.

Moonraker is the one exception: while it is running, only Restart is offered,
since stopping the service that serves this page would leave nothing able to
start it again. Spoolman runs outside systemd. Its row shows only its status
and a link to its web interface, with no Start, Stop, or Restart control.

Restarting Klipper, restarting Moonraker, and rebooting or shutting down the
host are also available from the header's power menu, on every page. See
[Restarting things on purpose](/guide/connecting#restarting-things-on-purpose)
for more information.

## Software updates

Every update source Moonraker reports has its own status:

| Status           | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Up to date       | Nothing to do.                                                                                 |
| Update available | A newer version is waiting.                                                                    |
| Needs attention  | The repository's local state blocks updating. See [recovery](#recovering-a-broken-repository). |

**Each source acts from its own row.** A repository that needs attention is
never swept into an update-everything run, because the recovery it needs is
not the same as an install.

**Update all** names every source it will touch before it starts. It also
warns that Klipper and Moonraker restart as part of their own updates, so the
printer must not be printing.

**What you are about to install is shown before you install it.** A git
source lists the commits you are behind by. A system-package source lists the
packages that will change.

### Watching an update run

The transcript opens in a window of its own the moment a run starts, with
room to read the output as it arrives. This is the same `git` or `apt` output
you would get over SSH.

While a run is in progress, the window **will not close**: not on `Escape`,
not on a click outside it, not on the close control. This prevents a
half-finished update from being dismissed and forgotten, which is how a
stalled or failed update goes unnoticed. Once the run ends, the window closes
normally by any of those methods. **The Updates panel reopens it** for as
long as there is a transcript worth reading.

If the run updated Alabaster itself, closing the transcript reloads the page
once, to load the new version.

::: info Moonraker restarts mid-update
Moonraker disconnects while it updates itself. This looks like a failure, but
it is not. Alabaster says so. The work may have finished on the host. Check
for updates again to find out.
:::

::: tip Alabaster's own macro pack is one of these rows
If you installed [the macro pack](/guide/macros), it appears here as its own
row, separate from Alabaster itself, because a git clone updates differently
from a downloaded release. Editing `alabaster.cfg` directly is fine, but it
turns this row into **Needs attention**, because the clone now has local
changes. Use the recovery below to keep or discard those changes before the
next update.
:::

### Rolling back an update

A source Moonraker tracks by its own git history — Klipper, Moonraker, and a
git-based client — can be reverted to the version it had before its most
recent update. Use this if a new version turns out to be the problem. The
rollback control sits beside the row and is confirmed the same way an install
is: the printer must not be printing. A source updated from packages has no
previous version for Moonraker to hold onto, so it does not offer this
control. A row that already needs attention is resolved through the recovery
below instead, so it does not offer this control either.

## Recovering a broken repository

When Moonraker will not update a repository, it reports why, and the page
offers what that problem needs:

| Reported      | What it means                                            |
| ------------- | -------------------------------------------------------- |
| Local changes | The working tree is dirty.                               |
| Invalid       | Moonraker marked it invalid, which disables its updates. |
| Detached HEAD | It is on a commit rather than a branch.                  |
| Corrupt       | The repository itself is damaged.                        |

**View differences** shows how far behind the branch is, the upstream commits
Moonraker reported, and its raw git output. Moonraker does not expose a
file-level diff. The page states this instead of leaving you looking for one.

Both recovery options are destructive, and each is spelled out before it
runs:

- **Force reset the branch**: discards local changes and matches the remote.
- **Re-clone the repository**: replaces it entirely.
