# History

What this printer has actually done — totals for its lifetime, statistics over a
period you choose, and every job it recorded.

Requires Moonraker's `history` component. Without it the page is not shown.

## Lifetime totals

Five numbers, for the whole life of the printer:

| Total         |                                                             |
| ------------- | ----------------------------------------------------------- |
| Jobs recorded | Every job Moonraker logged.                                 |
| Time printing | Time actually spent printing.                               |
| Time occupied | Including heating, homing, and everything around the print. |
| Filament used | In metres.                                                  |
| Longest print | The single longest job.                                     |

The gap between **time printing** and **time occupied** is the one worth looking
at. It is what the machine costs you beyond the print itself.

## Statistics

A window over a period you pick — **30 days, 90 days, 12 months, or all time** —
measured in **jobs, filament, or time**.

The header says how many jobs are in the window, and whether that window is
complete for the period.

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

Shown as jobs, filament, and time — because ten failed one-hour prints and one
failed twenty-hour print are not the same problem, and a count alone cannot tell
you which you have.

### Trend

Completed against everything else, period by period, in your chosen measure.

This is what shows a printer getting worse. A success rate that has fallen from
95% to 70% over three months is a maintenance interval you have not set yet.

### Print length

The distribution of how long your prints run. Useful for a straightforward
reason: it tells you what your printer is actually for, which is often not what
you thought when you bought it.

## Completed jobs

The full list, newest first, with **Load older jobs** at the end. It pages on what
was actually returned rather than a count, so nothing is skipped at a boundary.

Each row shows its file, outcome, and when it ran. Click a job to see its
duration and filament — and the spool it came off, for jobs that used a
Spoolman spool.

Three actions per job:

- **Print again** — starts the same file now, and asks first. If the file is no
  longer on the printer, the action says so rather than failing when you press
  it.
- **Add to queue** — adds the job's file to the print queue instead of starting
  it right away.
- **Remove** — deletes the record. The lifetime totals keep it, and the
  confirmation says that.

## When Moonraker cannot be read

The page keeps the last successful read on screen and tells you it is not
current. It does not blank out and it does not show zeros — a statistics page
that reports zero jobs because a request failed is worse than one that says the
request failed.
