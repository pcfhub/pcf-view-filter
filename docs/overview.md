---
title: Overview
description: What View Filter does, and when to reach for it.
order: 1
---

# View Filter

A search box that filters the view server-side.

Type into the box and, after a short pause, the control asks the platform to
re-query: it builds a `FilterExpression` of `Like` conditions across the view's
text columns, resets the page, and calls `refresh()`. What comes back is a
different set of records, not a subset of the ones already on screen.

::image{src=media/screenshot.png alt="View Filter with contoso typed in, showing the one matching account" zoom}

## Why this one

- **Server-side is the whole point.** A control that filters the records it
  already has narrows 25 rows out of 240 — a wrong answer that looks completely
  right, and one nobody notices until a record that should have matched is
  missing. This one asks the server, so the result covers the view.
- **It searches columns, not a fixed one.** With `Search columns` empty it
  searches every text column the view carries; naming two or three indexed ones
  is the difference between a search that returns and one that times out on a
  large table.
- **What a user types is treated as text.** `%` and `_` are SQL wildcards, and
  they are escaped before the query is sent. Without that, typing `%` matches
  every record in the table.

## What it is not

**The list under the search box is deliberately plain** — a primary line and a
couple of detail lines. A dataset control replaces the grid entirely, so
something has to render the records, but that part is not the point of this
control.

If you want sortable columns, selection and a real table, use **pcf-data-table**.
If you want a denser list, **pcf-compact-list**. This one is for the case where
finding the record is the job.

## What it works with

:::callout{type=info}
Model-driven views and subgrids, and canvas apps. Filtering is supported on
both, with one asymmetry worth knowing: the condition operators available
differ between the hosts. This control uses only `Like`, which is on both — see
[Limitations](limitations.md).
:::
