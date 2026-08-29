---
title: FAQ
description: Questions that come up more than once.
order: 8
---

# FAQ

## The search box is greyed out. Why?

There is nothing in the view for it to search. The query is built from `Like`
conditions, which the server rejects against numbers, dates and lookups — so a
view of only those columns has no searchable column. Add a text column to the
view, or name one in **Search columns**.

## Why does nothing happen until I have typed two characters?

**Minimum characters**, which defaults to 2. Below it the control asks the
platform for nothing at all — not a filter that matches everything. Searching on
the first keystroke sends `a%` across every text column of the table, which is
the most expensive query the control will ever send and the least useful.

## Searching for a name in the middle of a company finds nothing.

Set **Match** to `Contains`. The default is `Starts with`, which sends `term%`
and can use an index; `Contains` sends `%term%`, which cannot. On a small view
the difference is invisible — on a large one, see
[Limitations](limitations.md).

## I typed a `%` and got every record. Is that fixed?

Yes. `%`, `_` and `[` are SQL `LIKE` wildcards and the control escapes them
before sending — `[%]`, `[_]`, `[[]` — so a typed `%` looks for a `%`. If you
are seeing otherwise, you are on a version before this was handled.

## Can I search a column that is not in the view?

Name it in **Search columns**. The property takes logical names and is not
limited to what the view displays — a column the maker did not add is still a
column the server can filter on.

Be deliberate about it though: a match on a column nobody can see is a result
the user cannot account for.

## I named a column and nothing changed.

Two possibilities. If it cannot be a logical name — a space, a capital, a
comma-separated fragment that is really prose — the control drops it, because
that is where free text stops being data and starts being part of a query. If it
looks like a logical name but is not a column on this table, the control sends
it and the server rejects the query; check the browser console and the form's
own error for the column name.

## Why is there no sorting, and no columns?

Because that is `pcf-data-table`'s job. The list here exists so that the filter
has something to show; a dataset control replaces the grid entirely, so
something has to render the records.

## Does it work in a canvas app?

Yes, and the outputs are what make it useful there — `filteredRecordCount` and
`searchTerm` let the app write its own "no results" message, and
`openedRecordId` is how you navigate. See [Canvas apps](canvas.md).

## Why does searching do nothing in the demo on the hub?

Filtering is server-side and the demo harness has no server behind it. The call
log below the demo is the part worth watching: the debounce, the expression, the
paging reset and the refresh are all real.

## How do I report a bug?

Open an issue at <https://github.com/pcfhub/pcf-view-filter/issues>, with the
platform version and the control version from the solution.
