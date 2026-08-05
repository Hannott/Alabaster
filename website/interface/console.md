# Console

Talk to Klipper directly: send any G-code or macro, read exactly what the printer
says back, and keep that record across reloads.

The console lives in two places. The dashboard card is for firing off a command
and watching the answer without leaving your overview. The Console page is where
you read back through a print, set up what gets filtered, and look up what your
machine can actually do.

## Sending commands

Type a command and press <kbd>Enter</kbd>. What you sent appears immediately,
with the printer's reply underneath it — including when Klipper rejects the
command, so you always have a record of what was tried.

- <kbd>↑</kbd> and <kbd>↓</kbd> walk back through commands you have sent before.
  That history survives a reload; it is kept in your browser, not on the printer.
- <kbd>Tab</kbd> completes against the commands your machine actually reports. If
  several match, it fills in as far as they agree and offers the rest to pick
  from — so `set` then <kbd>Tab</kbd> narrows without you typing the whole name.
- <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line, letting you send a short script
  in one go instead of one command at a time.
- Click any command in the transcript to put it back in the prompt. Handy for a
  long macro invocation you want to adjust a parameter on and re-send.

## Looking up what your printer can do

**Browse commands** on the Console page searches every command your machine
reports, with the help text Klipper provides — and that includes the macros you
wrote yourself, which no documentation covers. Searching matches descriptions as
well as names, so "mesh" finds the bed mesh commands without you remembering
whether it is `BED_MESH_CALIBRATE` or something else.

Picking one puts it in the prompt rather than running it, so you can read it and
add parameters before anything moves.

## Reading the response stream

The console follows the newest line while you are at the bottom, and stops
following the moment you scroll up — so reading an error from ten minutes ago is
never yanked away by the next line of print chatter. Scroll back to the bottom to
resume following.

Opening the console does not mean starting from nothing. Moonraker keeps its own
record of recent output, and the console loads it when it connects, so a browser
reload no longer hides why a job failed.

Commands you sent, errors, and the printer's ordinary chatter are each marked
distinctly, so a failure is findable when you scroll back through a long print.

A command that takes minutes — heating the bed, calibrating a mesh, a probe
accuracy run — holds the prompt until the printer answers, and the send button
pulses while it does. Nothing is queued behind it: your next line waits in the
prompt where you typed it, and one <kbd>Enter</kbd> sends it the moment the
printer is free.

## Clearing what you have read

**Clear** empties the transcript on this device and is remembered, so a reload
does not bring back what you just cleared. Worth knowing before you press it:
the printer's own record of the output from before that point stays hidden too,
which is why Alabaster asks first. Nothing already sent to the printer is undone
— only your view of it. (If you would rather it stopped asking, every
confirmation in Alabaster can be turned off under Settings → Confirmations.)

Your typed-command history is separate, and lives under **Console settings** on
the page: it says how many commands it is holding for this printer, and clears
on its own so emptying the transcript never costs you the arrow keys.

## Filtering output

Hiding temperature reports is on from the start. Every heat-up and every `M105`
emits a temperature line per second, and they bury everything worth reading.
Whatever you filter is still being sent by the printer — only the view leaves it
out — and the page tells you how many lines are hidden so a missing line is never
a mystery.

The other filters and display options are under **Console settings**:

| Option                      | What it is for                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Hide temperature reports    | Removes the per-second heater chatter. On by default.                                             |
| Hide timelapse commands     | Quiets the macros a timelapse fires on every layer. Appears only if you have timelapse installed. |
| Show timestamps             | When each line arrived — worth having when correlating with a failure.                            |
| Compact rows                | Tighter lines, so more history fits in the same space.                                            |
| Show Klipper's own prefixes | Leaves the raw `!!` and `//` markers in place, for copying a line verbatim into a bug report.     |
| Autoscroll                  | Turn off to keep your place while a print floods the console.                                     |
| Prompt                      | Put the input at the bottom, terminal-style, or at the top with the newest line beside it.        |

Moving the prompt to the top also flips the transcript so the newest line is
next to it — typing in one place and watching the answer appear at the far end of
the box is nobody's idea of an improvement.

The dashboard card carries the two filters you reach for mid-print plus a line
count for how tall it should be; the full set lives on the page. The two keep
their own settings, so a quiet card and a verbose page are a valid combination.
