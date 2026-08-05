# Timelapse

The videos your printer rendered, watchable here.

Requires the timelapse component installed on Moonraker. Without it the page is
not shown at all.

## Watching and keeping

The list holds every rendered video, with its date and size. Select one to play
it in place.

- **Download** saves it to the device you are using.
- **Delete** removes it from the printer. It asks first and names the file.
- **Refresh** re-reads the folder.

A print that has finished but not rendered yet is not here. The page says a
timelapse appears once rendering completes, rather than looking broken while it
works.

## While it is recording

Timelapse fires a macro on every layer, which fills the console with noise you
did not ask for.

The console's **Hide timelapse commands** filter takes them out, and it only
appears when you have timelapse installed. See
[Console filters](/interface/console#filtering-output).
