# Keyboard shortcuts

## Everywhere

| Key                                     | Action                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| <kbd>Tab</kbd> from the top of the page | Skip to main content                                                 |
| <kbd>Esc</kbd>                          | Close a menu, dialog, or picker, and return focus where it came from |

## Console

| Key                               | Action                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| <kbd>Enter</kbd>                  | Send the command                                            |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Add a line, to send a short script in one go                |
| <kbd>↑</kbd> / <kbd>↓</kbd>       | Walk back and forward through commands you have sent        |
| <kbd>Tab</kbd>                    | Complete against the commands your machine actually reports |

Tab completion fills in as far as the candidates agree, then offers the rest
to pick from. If there is nothing to complete, <kbd>Tab</kbd> keeps its usual
job of leaving the field.

Command history is kept in your browser and survives a reload.

## G-code viewer

| Key                                                 | Action                          |
| --------------------------------------------------- | ------------------------------- |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Pan                             |
| <kbd>Shift</kbd> + arrows                           | Rotate                          |
| <kbd>+</kbd> / <kbd>−</kbd>                         | Zoom in and out                 |
| <kbd>0</kbd>                                        | Frame the whole model again     |
| <kbd>Space</kbd>                                    | Play or pause, while simulating |

With the pointer:

| Gesture              | Action                                      |
| -------------------- | ------------------------------------------- |
| Left drag            | Rotate                                      |
| Right or middle drag | Pan                                         |
| Wheel                | Zoom, towards whatever is under the pointer |
| Double-click         | Reset the framing                           |

## Configuration

| Key                                                         | Action                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| <kbd>Ctrl</kbd>+click an `[include]` path                   | Open that file                                       |
| <kbd>Ctrl</kbd>+click a missing `[include]` path            | Offer to create it, and its folder                   |
| <kbd>Alt</kbd>+<kbd>←</kbd>                                 | Return to the file you came from                     |
| <kbd>Alt</kbd>+<kbd>→</kbd>                                 | Go forward again through the files you opened        |
| <kbd>Tab</kbd> in the editor                                | Indent the selected lines                            |
| <kbd>Shift</kbd>+<kbd>Tab</kbd>                             | Outdent the selected lines                           |
| <kbd>Ctrl</kbd>+<kbd>/</kbd>                                | Comment or uncomment the selected lines              |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd>                  | Move the selected lines up or down                   |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> | Duplicate the selected lines                         |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>                | Fix the indentation throughout the file              |
| <kbd>Enter</kbd>                                            | Start the next line at the indentation this one uses |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                                | Save this file                                       |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>                 | Save this file and restart the firmware              |

The mouse's back and forward buttons do the same as the arrow shortcuts
above. To see this same list without leaving the page, open the shortcuts
icon in the editor toolbar, or press <kbd>Ctrl</kbd>+<kbd>?</kbd>.

## Dashboard

| Gesture                        | Action                                                 |
| ------------------------------ | ------------------------------------------------------ |
| Click the gear on a card       | Quick settings, in place                               |
| <kbd>Ctrl</kbd>+click the gear | The full settings pane, with the card docked beside it |

Everything that can be done by dragging a card can also be done with
buttons: move it earlier or later, change its column, hide it, or collapse
it. Dragging is a faster path, not the only one.

## Temperature chart

Focus the chart on the Temperatures card and:

| Key                         | Action                                    |
| --------------------------- | ----------------------------------------- |
| <kbd>←</kbd> / <kbd>→</kbd> | Step back and forward one recorded sample |
| <kbd>Esc</kbd>              | Stop reading the past and return to now   |

The readings in the list above the chart follow the point in time you are
pointing at. Target boxes do not follow it — they always show the setpoint
the printer is on right now.

## Bed plan

| Key                                                 | Action                                     |
| --------------------------------------------------- | ------------------------------------------ |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Move the target by one jog step            |
| <kbd>Enter</kbd>                                    | Send the nozzle there — the same as **Go** |
| <kbd>Esc</kbd>                                      | Clear the target without moving anything   |

A double-click on the plan does the same as <kbd>Enter</kbd>. A single click
only aims and does not move anything. This is the one control that can send
the nozzle all the way across the bed in one move, and doing that over a
printed part causes a crash.
