# Machine

The computer running Klipper, the boards it talks to, and the software on both.

## Host

The top of the page reads the computer running Klipper live, not as a snapshot
from when the page opened: CPU load averaged across all cores, memory in use,
host temperature, uptime and when it booted, and network bandwidth on the
interface that carries the printer's address.

**On a Raspberry Pi, the page also watches the power supply.** It reports an
under-voltage while it is happening, and one that happened earlier since boot,
which is the usual hidden cause of random disconnects and SD card corruption.

If host status cannot be read, the page keeps showing the previously loaded
figures and says so, instead of blanking out or showing zeros.

## Services

This section lists the services Moonraker manages. Klipper's row also says
what Klippy itself is doing, which can differ from its service being up, and
Moonraker's row says how many clients are connected to it.

**A service that needs you shows the action it needs.** A failed service
offers Restart and a stopped one offers Start, right on its row. A running
service keeps Restart and Stop in its menu. Stopping a service always asks for
confirmation. Restarting asks for lighter confirmation, since the service
comes back on its own.

Moonraker is the one exception: while it is running, only Restart is offered,
since stopping the service that serves this page would leave nothing able to
start it again. Spoolman runs outside systemd. Its row shows only its status
and a link to its web interface, with no Start, Stop, or Restart control.

Restarting Klipper, restarting Moonraker, and rebooting or shutting down the
host are also available from the header's power menu, on every page. See
[Restarting things on purpose](/guide/connecting#restarting-things-on-purpose).

## Hardware

This section lists every MCU Klipper is talking to, with its chip, firmware
version, and load, then the serial, USB, and CAN devices attached to the host.
A board that has dropped off is marked **Disconnected**, rather than showing
its last-known numbers as current.

**Find the path for an `[mcu]` section without an SSH session.** Each serial
device is named after the board it belongs to, says which `[mcu]` section
already uses it, and copies its `/dev/serial/by-id/...` path in one click. The
USB list confirms that a board is enumerating, even before it has been given a
tty node; USB hubs are folded away, since the board you are looking for is
never one. A CAN interface is listed even with nothing unclaimed on it,
confirming the adapter is working, along with the UUID a CAN toolhead's
`canbus_uuid:` line wants.

There is no notification for a device being plugged in or unplugged. This
list is read when the page loads, and again when you refresh it.

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

**You see where an update goes before you open it.** An available source
shows the version it moves to and how many commits that is, and a downloaded
release links straight to its release notes. The panel also says when the
sources were last checked, whether that check came from this browser, another
one, or Moonraker's own schedule.

Updating every source at once names every source it will touch before it starts. It also
warns that Klipper and Moonraker restart as part of their own updates, so the
printer must not be printing.

**What you are about to install is shown before you install it.** A git
source lists the commits you are behind by. A system-package source lists the
packages that will change. A downloaded release, such as Alabaster itself,
shows the release notes of every version between the one installed and the
one on offer, read from GitHub, with a link to the release page. Without
internet access from the browser, only the link is shown.

### Watching an update run

The transcript opens in a window of its own the moment a run starts, with
room to read the output as it arrives. This is the same `git` or `apt` output
you would get over SSH.

The window also opens in every other browser connected to the printer, on
whatever page it is showing, so an update started from a phone is visible on
the desktop too, and nobody starts a second one mid-run.

While a run is in progress, the window stays open regardless of `Escape`, a
click outside it, or the close control, so a stalled or failed update can't
be dismissed and forgotten. Once the run ends, the window closes normally by
any of those methods. **The Updates panel reopens it** for as long as there
is a transcript worth reading.

If the run updated Alabaster itself, closing the transcript reloads the page
once, to load the new version.

::: info Moonraker restarts mid-update
Moonraker disconnects while it updates itself. Alabaster reports this state
rather than flagging it as a failure. The work may have finished on the
host; check for updates again to confirm.
:::

::: tip Alabaster's own macro pack is one of these rows
If you installed [the macro pack](/guide/macros), it appears here as its own
row, separate from Alabaster itself, because a git clone updates differently
from a downloaded release. Editing `alabaster.cfg` directly turns this row
into **Needs attention**, because the clone now has local changes. Use the
recovery below to keep or discard those changes before the next update.
:::

### Rolling back an update

Moonraker tracks Klipper, Moonraker, and a git-based client by their own git
history, and can revert any of them to the version before its most recent
update. Use this if a new version turns out to be the problem. The rollback
names the version it returns to, and Alabaster confirms it the same way it
confirms an install, requiring the printer not be printing. A source updated from
packages has no previous version for Moonraker to hold onto, so it does not
offer this control. Use the recovery flow below instead for a row that
already needs attention; it does not offer this control either.

## Recovering a broken repository

Moonraker reports why it will not update a repository, and the page offers
what that problem needs:

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
