# History

History shows what this printer has done: lifetime totals, statistics over a
period you choose, and every job it recorded.

Requires Moonraker's `history` component. Without it the page is not shown.

## Lifetime totals

Every job Moonraker logged, and five numbers for the whole life of the
printer:

| Total              |                                                             |
| ------------------ | ----------------------------------------------------------- |
| Printing           | Time spent printing.                                        |
| Occupied           | Including heating, homing, and everything around the print. |
| Heat-up and pauses | The difference between the two, and its share of the time.  |
| Filament           | In metres.                                                  |
| Longest print      | The single longest job.                                     |

**See how much of the printer's time goes to waiting.** Heat-up and pauses is
the overhead around every print, worked out for you rather than left as a
subtraction.

## Statistics

Statistics cover a period you choose (**30 days, 90 days, 12 months, or all
time**), measured in **jobs, filament, or time**.

The header shows how many jobs are in the window, and whether that window is
complete for the period.

**Know what a typical print costs you, and how far to trust the slicer.**
Beside the success rate, the statistics show your typical print time and how
much longer prints run than the slicer estimated. Both are medians over the
completed jobs in the period, so one very long print does not skew them, and
each says how many jobs it was measured on.

![Statistics for a 30-day window: outcome table, trend chart, and print length distribution](/images/history/statistics-trend.png)

### Outcomes

Every outcome in the period, with its share:

| Outcome     |                                           |
| ----------- | ----------------------------------------- |
| Completed   |                                           |
| Cancelled   | You stopped it.                           |
| Failed      | Klipper reported an error.                |
| Interrupted | Something ended the job without a result. |
| Unknown     | Moonraker recorded no outcome.            |

Each outcome is shown in jobs, filament, and time, since a count alone does not
distinguish ten failed one-hour prints from one failed twenty-hour print.

### Trend

Completed jobs against everything else, period by period, in your chosen
measure.

A falling trend line shows a printer getting worse. A success rate that drops
from 95% to 70% over three months points to a maintenance interval you have
not set.

### Print length

The distribution of how long your prints run: what the printer is used for.

## Jobs

The full list, newest first and grouped by day. Older jobs load as you scroll
toward the end, so the whole history reads as one list. It pages on what was
returned rather than a count, so nothing is skipped at a boundary.

Jobs you have loaded stay loaded. A print starting or finishing adds it to the
top of the list you already have, so scrolling back through a long history is
not undone by the printer finishing a job while you read.

**Recognise a job at a glance.** Each row shows the slicer's thumbnail, the
time it finished, how long it printed, and how much filament it used. Open a
job to see the rest without leaving the list: when it started and ended, how
its print time compared with the slicer's estimate, how long it spent heating,
the material and layer height, and the spool it came from, for jobs that used
a Spoolman spool.

Three actions per job, from the opened job or from the row's menu:

- **Print again**: Starts the same file now. Asks for confirmation first. If
  the file is no longer on the printer, it says so instead of failing when
  pressed.
- **Add to queue**: Adds the job's file to the print queue instead of starting
  it right away.
- **Remove**: Deletes the record. Lifetime totals keep the entry, and the
  confirmation states this.

## When Moonraker cannot be read

The page keeps the last successful read on screen and marks it as not
current. It does not clear the display and does not show zero values.
