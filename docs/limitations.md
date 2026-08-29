---
title: Limitations
description: What View Filter does not do.
order: 7
---

# Limitations

- **It searches text columns only.** A `Like` condition against a whole number,
  a currency or a lookup is a query the server rejects, so those columns are
  never included. A view of nothing but numbers and lookups has nothing to
  search: the box is disabled and says so, rather than accepting keystrokes that
  could not do anything.

- **One term, matched the same way in every column.** There is no field-by-field
  search, no ranges and no operators in the box — a term is a term, and it goes
  to every searched column as an `Or`. If you need "amount greater than", this is
  not the control.

- **`Contains` cannot use an index.** `%term%` makes the server read every row.
  On a large table that is the difference between a search and a timeout, which
  is why `Starts with` is the default.

- **The condition operators differ between hosts, and not symmetrically.** From
  the platform's own table: `NotLike` and `NotNull` are canvas-only;
  `Yesterday`, `Today` and `Tomorrow` are model-driven-only. This control uses
  only `Like`, which is supported on both — so it behaves identically, at the
  cost of not offering anything cleverer.

- **The list is deliberately plain.** No sortable headers, no selection, no
  column widths. That is not an omission to be fixed here: use `pcf-data-table`
  for a table or `pcf-compact-list` for a denser list.

- **A subgrid's own quick-find is not reconciled with this.** The manifest leaves
  `cds-data-set-options` off so neither box is shown; turning quick-find on gives
  you two search boxes over one view, filtering by different means. There is no
  setting here that makes them agree.

- **A wrong column name reaches the server, on purpose.** Entries in **Search
  columns** that cannot be a logical name are dropped, but one that could be a
  column and is not gets sent — because the server's rejection is the only thing
  that will ever name it. A silently dropped name leaves a search that quietly
  ignores a column nobody can find.

- **Case sensitivity follows the database.** Dataverse's default collation is
  case-insensitive and the control assumes nothing else; on a case-sensitive
  deployment `Starts with` would behave differently from what these pages
  promise.

- **The demo on the hub cannot filter.** Filtering is server-side and the demo
  harness has no server behind it, so typing narrows nothing there. What the
  demo does show — and it is the interesting half — is the call log: the
  debounce, the expression, the paging reset, the refresh.
