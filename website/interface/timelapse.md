# Timelapse

Timelapse shows the videos your printer has rendered, and lets you play,
download, or delete them.

It requires the timelapse component installed on Moonraker. Without it, the
page is not shown.

## Watching and keeping

The list shows every rendered video, with its date and size. Select a video to
play it in place.

- **Download** saves it to the device you are using.
- **Delete** removes it from the printer. It asks for confirmation first and
  names the file.
- **Refresh** re-reads the folder.

A print that has finished but not rendered yet does not appear in the list.
The page shows a message that the timelapse will appear once rendering
completes.

## While it is recording

Timelapse runs a macro on every layer. This adds messages to the console.

The console's **Hide timelapse commands** filter removes these messages. This
filter only appears when timelapse is installed. See
[Console filters](/interface/console#filtering-output) for more information.
