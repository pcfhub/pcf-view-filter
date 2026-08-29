# View Filter

A search box that filters the view server-side.

[![Build](https://github.com/pcfhub/pcf-view-filter/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-view-filter/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-view-filter/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-view-filter/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-view-filter), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

Puts a search box above the bound view and filters it **server-side**. Type,
and after a short pause the control builds a `FilterExpression`, resets the
page and calls `refresh()` — the platform re-queries and hands back a different
set of records.

**Server-side is the point, and it is what a client-side filter cannot be.**
Filtering the records already on screen narrows 25 rows out of 240 and looks
completely correct while being a wrong answer. This asks the server, so the
result is the whole view.

**The list below the box is deliberately plain**, and it is not the
contribution. A dataset control replaces the grid entirely, so something has to
render the records — a primary line and a couple of details is enough to see
the filter working. If you want a real table, use `pcf-data-table`; a compact
list, `pcf-compact-list`.

Three things about the platform are worth knowing, because each is a bug
somebody ships:

- **`setFilter` is not a fetch.** It records an expression; nothing moves until
  `refresh()`. A control that omits the refresh looks exactly like one whose
  filter matched nothing.
- **Filtering does not reset the page.** Filter from page three and you have
  asked for page three of a result set that may have one page in it, and the
  platform returns nothing at all.
- **`refresh()` fires `updateView`.** So the filter is applied from the debounce
  handler and never from a render, and it is guarded on the expression it last
  applied. Without that guard this is an unbounded refresh loop, which a browser
  shows as a hang.

## Properties

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `records` | data-set | bound, **required** | — | The view to search. No `property-set` roles: it reads `dataset.columns` |
| `pageSize` | Whole.None | input | `25` | Rows requested per page. The platform may clamp large values |
| `searchColumns` | SingleLine.Text | input | *(empty)* | Logical names to search, comma-separated. Empty searches every text column in the view |
| `matchMode` | Enum | input | `startsWith` | `startsWith` sends `term%`; `contains` sends `%term%` and cannot use an index |
| `minimumCharacters` | Whole.None | input | `2` | Below this nothing is asked for at all — not a filter that matches everything |
| `debounceMs` | Whole.None | input | `300` | How long after the last keystroke before querying |
| `detailColumns` | Whole.None | input | `2` | Columns shown under each record, after the primary one |
| `itemClick` | Enum | input | `open` | `open` or `none` |
| `openedRecordId` | SingleLine.Text | output | — | The record most recently opened |
| `filteredRecordCount` | Whole.None | output | — | What the filter matched, from `totalResultCount`. `-1` on a view the platform did not count |
| `searchTerm` | SingleLine.Text | output | — | What is currently typed |

`itemClick` is an `Enum` with two values rather than a `TwoOptions`, and the
reason is the default: a `TwoOptions` input generates as `raw: boolean`, so
"set to false" and "never touched" are the same value and a property cannot
default to on. Opening the record is what nearly every view wants.

`searchColumns` entries are validated against `/^[a-z][a-z0-9_]*$/` and what
cannot be a logical name is dropped rather than sent. A merely *wrong* name is
passed through on purpose — the server's rejection is the only thing that will
ever name it.

Terms are escaped for SQL `LIKE` before they are sent: `%`, `_` and `[` become
`[%]`, `[_]` and `[[]`. Without that, typing `%` matches every record in the
table.

Strings ship in five languages: 1033 English, 1031 German, 1036 French, 1041
Japanese, 3082 Spanish. No framework — plain DOM, styled from Fluent's design
tokens with literal fallbacks. No `feature-usage`: filtering is a method on the
dataset, not a platform service, so the maker is asked for no permission at all.

## On the hub

`demo.fidelity` is **`limited`**, and the first limitation is blunt: **searching
narrows nothing there.** Filtering is server-side and the demo harness has no
server — it treats a filter request the way it treats a sort request, by
accepting it and rendering the same rows.

Everything up to that point is real and visible: the debounce, the expression
the control builds, the paging reset, the refresh. The call log under the demo
is where this control is actually worth watching.

What works fully is everything that never leaves the browser — the box keeps
what you type across every render, Clear empties it, the minimum-character
threshold is observable, and a view with no text column to search disables the
box and says so.

Four presets: the defaults, `contains` over a single named column, a
no-threshold no-pause configuration that shows what the debounce is for, and a
compact read-only shape for a form section.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-view-filter/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
npm run smoke      # assertions against the built bundle — see dev/
```

`npm start` renders the control; `dev/` is for the states it cannot reach. Build
first, then `npm run smoke` for the assertions, or open `dev/harness.html` in a
browser for the switches — field-level security, a failed business rule, a host
that publishes no theme or no column metadata, and for a dataset control, more
than one page. Both read the bundle `npm run build` wrote, and both are
described in the header of `dev/smoke.js`.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `ViewFilter/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `ViewFilter/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `dev/` | A stand-in host: `npm run smoke` asserts, `harness.html` shows |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
