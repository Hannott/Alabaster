# Console

The console sends any G-code or macro command straight to Klipper, and shows
what the printer says back. The record survives a reload.

The console appears in two places. The dashboard card sends a command and
shows the response without leaving the Overview page. The Console page reads
back through a print's full history, sets up filters, looks up the commands
your machine supports, and searches what you have already sent it.

## Sending commands

Type a command and press <kbd>Enter</kbd>. The command you sent appears
immediately. Any response from Klipper appears underneath: an error, a
`RESPOND`, or ordinary output. Many commands complete silently; the echoed
command is the record that it ran.

- <kbd>↑</kbd> and <kbd>↓</kbd> step back through commands you have sent
  before. This history survives a reload. It is stored in your browser, not
  on the printer.
- <kbd>Tab</kbd> completes against the commands your machine reports. If
  several commands match, it fills in as far as they agree and lists the rest
  to choose from. Type `set` and press <kbd>Tab</kbd> to narrow the list
  without typing the full command name.
- Type a macro's name and a space, and Alabaster shows the next parameter it
  takes, dimmed, right after the cursor. Press <kbd>→</kbd> to fill it in and
  keep typing its value. If a macro takes more than one parameter,
  <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> step through the ones
  you haven't filled in, so you can set them in any order.
- <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line. Use it to send a short script
  in one go instead of one command at a time.
- Click any command in the transcript to put it back in the prompt. Adjust one
  parameter of a long macro call and resend it.

## Looking up what your printer can do

**Browse commands**, on the Console page, searches every command your machine
reports, along with the help text Klipper provides. This includes macros you
wrote yourself. The search matches descriptions as well as names: searching
"mesh" finds the bed mesh commands even if you don't remember whether the
command is `BED_MESH_CALIBRATE` or something else.

Selecting a command puts it in the prompt instead of running it, so you can
read it and add parameters before anything moves.

## Browsing what you have already sent

**Browse history**, on the Console page, lists every command you have sent to
this printer, newest first, and searches it the same way command browsing
does. Clicking one puts it back in the prompt rather than running it. Use it
instead of stepping through with <kbd>↑</kbd> when you want to see everything
you have typed at once, or find one command among many without walking past
the rest.

## Reading the response stream

The console follows the newest line while you are scrolled to the bottom. It
stops following as soon as you scroll up, so reading an error from ten
minutes ago is not interrupted by new print chatter. Scroll back to the
bottom to resume following.

Moonraker keeps its own record of recent output, and the console loads it on
connect, so a browser reload does not hide why a job failed.

The console marks commands you sent, errors, and ordinary printer output
distinctly, so a failure is easy to find when scrolling back through a long
print.

A command that takes minutes (heating the bed, calibrating a mesh, a probe
accuracy run) holds the prompt until the printer answers. The send button
pulses while it waits. Nothing queues behind it: your next line stays in the
prompt where you typed it, and <kbd>Enter</kbd> sends it as soon as the
printer is free.

## Clearing what you have read

**Clear** empties the transcript on this device. Alabaster remembers this, so
a reload does not bring back what you cleared. The printer's own record of
output from before that point stays hidden too, so Alabaster asks for
confirmation before clearing. Clearing does not undo anything sent to the
printer; it only clears your view of it. You can turn off this confirmation,
along with every other confirmation in Alabaster, under Settings →
Confirmations.

Your typed-command history is separate, and lives under **Browse history**
instead. It clears on its own, so emptying the transcript never removes what
you have sent before.

## Filtering output

Hiding temperature reports is on by default. Every heat-up, and every `M105`,
emits a temperature line each second, which buries everything else. The
printer still sends a filtered line; only the view leaves it out. The page
shows how many lines are hidden.

The other filters and display options are under **Console settings**:

| Option                      | What it is for                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Hide temperature reports    | Removes the per-second heater chatter. On by default.                                             |
| Hide timelapse commands     | Quiets the macros a timelapse fires on every layer. Appears only if you have timelapse installed. |
| Show timestamps             | When each line arrived, useful when correlating with a failure.                                   |
| Compact rows                | Tighter lines, so more history fits in the same space.                                            |
| Show Klipper's own prefixes | Leaves the raw `!!` and `//` markers in place, for copying a line verbatim into a bug report.     |
| Autoscroll                  | Turn off to keep your place while a print floods the console.                                     |
| Prompt                      | Put the input at the bottom, terminal-style, or at the top with the newest line beside it.        |

Moving the prompt to the top also flips the transcript, so the newest line
appears next to it instead of at the far end of the box.

The dashboard card starts with one filter, hiding temperature reports, plus
two display toggles: timestamps and compact rows. The rest of the options
above are on the page. You can add any of them to the card from the card's
own settings pane, which also sets the card's line count (how tall it is).
The card and the page keep separate settings, so you can run a quiet card
alongside a verbose page.
