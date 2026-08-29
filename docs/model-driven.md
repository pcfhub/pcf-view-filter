---
title: Model-driven apps
description: Adding View Filter to a view or a subgrid.
order: 4
---

# Using it on a model-driven form

:::steps
1. Open the form in the modern form designer and select the **subgrid** whose
   view you want searchable — or, for a full-page view, open the table's view in
   the app designer.
2. Under **Components → Add component**, choose **View Filter**.
3. Set **Search columns** to two or three indexed columns, or leave it empty to
   search every text column the view carries.
4. Enable it for **Web**, **Phone** and **Tablet** as appropriate.
5. Save and publish.
:::

## Choosing the search columns

Leaving **Search columns** empty is the setting that needs no thought and the
one that is slowest: every text column in the view becomes an `Or` condition,
and on a large table that is a query the server has to work for.

Name the columns people actually search by — the primary name column, an account
number, a reference — and prefer ones with an index behind them. The property
takes logical names, comma-separated:

```text
name, accountnumber, cr123_reference
```

Entries that cannot be a logical name are dropped. An entry that *could* be one
but is not a column in this table is passed through, so the server's error names
it — that is the typo worth surfacing rather than swallowing.

## Starts with, or contains

**Starts with** sends `term%` and can use an index. **Contains** sends `%term%`
and cannot: the server has to read every row. On a small table the difference is
invisible; on a large one it is the difference between a search and a timeout.

Start with **Starts with** and change it only if people complain that searching
for a word in the middle of a name finds nothing.

## The subgrid's own search box

This control leaves `cds-data-set-options` off, so the subgrid shows no command
bar, view selector or quick-find. Turning quick-find on would put the platform's
own search box directly above this one — two boxes over the same view, filtering
by different means, and whichever a user types in the other looks broken.

:::callout{type=info}
If you want the command bar for other reasons, the two search boxes are the
trade you are making. There is no configuration here that reconciles them.
:::
