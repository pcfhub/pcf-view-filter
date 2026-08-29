---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

<!--
  Do not write the property tables by hand.

  `props-table` renders from what the hub parsed out of
  ControlManifest.Input.xml at the release being viewed, so it cannot drift from
  the control. A hand-written table is wrong the first time somebody adds a
  property and forgets this file, and a reader has no way to tell.

  kind: input | bound | output | dataset | dataset_column
  Omit `kind` to render every property in one table.

  There is no `kind=bound` section here because a dataset control binds a
  collection, not a column.

  There is no `kind=dataset_column` section either, because the manifest this
  ships with declares no `property-set` roles — the directive would render an
  empty table, which reads as "this control has no dataset columns" rather than
  as a section nobody wrote. **If you add roles to the manifest, add the section
  back**, or the roles you declared are documented nowhere.
-->

## Input properties

::props-table{kind=input}

## Dataset

::props-table{kind=dataset}

## Outputs

::props-table{kind=output}

## Columns

<!--
  Delete this section if you declare property-set roles — the generated
  dataset_column table replaces it. Keep it if the control renders the view's
  own columns, because then there is nothing for a table to list and a reader
  needs telling why.
-->

The columns are the view's.

This control declares no `property-set` roles, so it renders whatever
`dataset.columns` reports — the columns the maker put in the view, in the view's
own `order`, at the view's own widths — and skips the ones marked hidden. There
is nothing to configure per column.

| Metadata | Effect |
| --- | --- |
| `isPrimary` | Becomes the record's own line, and the button that opens it. Falls back to the first visible column. |
| `isHidden` | Left out of the list, and left out of the search. A match on a column the user cannot see is a result they cannot account for. |
| `order` | The order the detail lines appear in, after the primary one. |
| `dataType` | Decides whether a column can be searched at all. A `Like` condition against a number or a lookup is a query the server rejects, so only text types are included. |

## Notes

**Search columns** takes logical names, comma-separated, and is not limited to
the columns the view displays — a column the maker did not add is still one the
server can filter on. Entries that cannot be a logical name
(`/^[a-z][a-z0-9_]*$/`) are dropped; one that could be a column and is not is
sent anyway, so the server's rejection names it.

Terms are escaped for SQL `LIKE` before they are sent: `%`, `_` and `[` become
`[%]`, `[_]` and `[[]`. A backslash is not an escape character there. Without
this, typing `%` matches every record in the table.

**Match** decides only where the wildcard goes — `term%` or `%term%` — and the
server does the work either way. `Contains` cannot use an index.

**Minimum characters** is a floor on asking at all, not on matching: below it the
control clears the filter rather than sending a broader one.

**Clicking a record** is an `Enum` rather than a yes/no, and the reason is the
default. A `TwoOptions` input property generates as `raw: boolean`, so "set to
false" and "never touched" are the same value — and opening the record is what
nearly every view wants.

**Filtered record count** is `-1` on a view the platform did not count, which is
common on large tables. It travels as `-1` rather than as `0` so a formula can
tell "none" from "unknown".
