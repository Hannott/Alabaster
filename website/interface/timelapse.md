# Timelapse

Timelapse shows the videos your printer has rendered, and lets you play,
download, or delete them.

It requires the timelapse component installed on Moonraker. Without it, the
page is not shown.

## Watching and keeping

The newest video is ready to play as soon as the page opens, beside the list
of every video the printer has rendered, grouped by the day it was recorded.
Each video is named after the print it shows, with the time it was recorded
and its size. Select another to play it instead.

Under the player you see when the print was recorded, how long the video runs,
its frame size, and its file name.

- **Download** saves it to the device you are using, from above the player or
  from a video's **⋯** menu.
- **Delete** removes it from the printer, along with its preview image. It asks
  for confirmation first and names the file.
- **Refresh** re-reads the folder.

A print that has finished but not rendered yet does not appear in the list
until rendering completes; the list then updates by itself.

## While it is recording

Timelapse runs a macro on every layer. This adds messages to the console.

The console's **Hide timelapse commands** filter removes these messages. This
filter only appears when timelapse is installed. See
[Console filters](/interface/console#filtering-output) for more information.
