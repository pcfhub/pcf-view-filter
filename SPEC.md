# View Filter

A search box that filters the view server-side.

## What the build disagreed with

**The scaffolded dataset skeleton cannot host a text input, and that is
structural rather than a detail.** `render()` in the `--type dataset` scaffold
clears its whole container and rebuilds — which is right for records, since they
change wholesale — but `refresh()` causes a render, so the box the user is
typing in would cease to exist on the first keystroke of every search. The
control is split into a bar built once in `init` and a body rebuilt per render.
Anything else with a persistent, stateful child needs the same split.

**`openOnItemClick` had to become an `Enum`.** `refreshTypes` generates
`TwoOptionsProperty` with `raw: boolean`, so there is no way to tell "the maker
set this to false" from "the maker never touched it" — and opening the record on
click is what nearly every view wants. An `Enum` with two values carries a real
`default-value`. Same finding as `pcf-file-drop`'s `hidePreview`, reached from
the other direction: there, the property was inverted; here, it changed type.
Promoted to the skill, `references/control-patterns.md`, under *Property types*.

## Platform behaviour worth knowing

**The filtering contract is three calls in one order**, and each is a shipped
bug on its own: `filtering.setFilter(expression)`, `paging.reset()`,
`dataset.refresh()`. Read from the DataSet reference, which states it as
"[o]nce filter is set, calling refresh() retrieves the filtered data" — the
paging reset it does not mention, and it is the one that produces an empty
result rather than a wrong one.

**`FilterExpression.filterOperator` defaults to And.** A search across four
columns that omits it asks for the term present in all four at once, matches
nothing, and reads as a broken query rather than as a missing field. Every
multi-column search is an `Or` (1).

**The condition operators are not symmetric across hosts.** From the DataSet
reference's own table: `NotLike` (7) and `NotNull` (13) are canvas-only, while
`Yesterday` (14), `Today` (15) and `Tomorrow` (16) are model-driven-only. `Like`
(6) is on both, which is why this control uses nothing else.

**SQL `LIKE` escapes with a character class, not a backslash.** `%`, `_` and `[`
become `[%]`, `[_]` and `[[]`. A backslash is not an escape character here and
would be searched for literally. Without this, a user typing `%` matches every
record in the table — a search box that appears to ignore what was typed.

## Demo

`limited`, and unusually the limitation is the control's whole purpose:
searching narrows nothing in the hub's harness, because filtering is
server-side and there is no server behind that origin.

What remains real is worth more than it sounds. The call log shows the debounce
collapsing keystrokes into one request, the expression the control built, the
paging reset and the refresh — in order. Everything that never leaves the
browser works fully: the box survives every render, Clear empties it, the
minimum-character threshold is observable, and a view with nothing to search
disables the box and says so.

## Not verified

- **Whether the hub's demo harness discards a filter, or applies it.** It is
  documented as discarding a *sort* request on each render, and `npm start`'s
  dataset mock logs every mutator and moves nothing — so the demo's first
  limitation is written from that analogy rather than from observation. Confirm
  against the first release and correct the wording either way; if it does apply
  filters, the fidelity claim is understated rather than wrong.
- **Whether `dataset.filtering` is present on every host.** It is typed as
  required, and this control checks it anyway — the same claim about the type
  definitions that `dataset.sorting` already broke on `npm start`. Nothing has
  yet been observed handing over a dataset without it.
- **Whether a maker-supplied column name that is wrong reaches the user as a
  readable error.** The control deliberately passes a syntactically valid but
  unknown logical name through to the server, on the reasoning that the
  rejection is the only thing that will ever name it. What a model-driven form
  actually does with that rejection — surface it, swallow it, blank the subgrid
  — has not been seen.
- **Whether `Like` is case-insensitive on every deployment.** Dataverse's
  default collation is, and the dev rig models it that way, but a
  case-sensitive collation would make `startsWith` behave differently from what
  `docs/` promises.
- **The interaction with a subgrid's own quick-find box.** The manifest leaves
  `cds-data-set-options` off, so neither is shown; a maker who turns quick-find
  on gets two search boxes over one view, filtering by different means. Whether
  the platform's own filter and this control's `setFilter` compose or replace
  each other is unknown.

## Promoting a finding

When something here turns out to be general — true of PCF rather than true of
this control — move it to the skill's `references/control-patterns.md` and
replace it here with a line naming where it went.

Repeating it in both places is how the two drift, and the copy nothing executes
always loses. The rule is: one home, and a pointer from anywhere else.
