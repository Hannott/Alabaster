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

Tab completion fills in as far as the candidates agree and offers the rest to
pick from. With nothing to complete, <kbd>Tab</kbd> keeps its usual job of
leaving the field.

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

| Key                                              | Action                             |
| ------------------------------------------------ | ---------------------------------- |
| <kbd>Ctrl</kbd>+click an `[include]` path        | Open that file                     |
| <kbd>Ctrl</kbd>+click a missing `[include]` path | Offer to create it, and its folder |
| <kbd>Tab</kbd> in the editor                     | Indent                             |

## Dashboard

| Gesture                        | Action                                                 |
| ------------------------------ | ------------------------------------------------------ |
| Click the gear on a card       | Quick settings, in place                               |
| <kbd>Ctrl</kbd>+click the gear | The full settings pane, with the card docked beside it |

Everything that can be done by dragging a card can also be done with buttons —
move earlier or later, change column, hide, collapse. Dragging is the fast path,
not the only one.

## Bed plan

Arrow keys move the target on the bed plan. **Go** sends the nozzle there.
