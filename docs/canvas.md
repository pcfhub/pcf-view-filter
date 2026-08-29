---
title: Canvas apps
description: Adding View Filter to a canvas app or custom page.
order: 3
---

# Using it in a canvas app

:::steps
1. From **Insert → Get more components**, open the **Code** tab and import
   **View Filter**.
2. Place it from **Insert → Code components**.
3. Set its **Records** property to a Dataverse table, and pick the columns to
   show in the **Fields** flyout.
4. Bind the properties below.
:::

## Wiring the properties

| Property | Value |
| --- | --- |
| Records | `Accounts` |
| Search columns | `"name, accountnumber"` |
| Match | `startsWith` |
| Minimum characters | `2` |
| Typing pause (ms) | `300` |
| Detail lines | `2` |
| Clicking a record | `open` |

:::callout{type=info}
Pick the columns in the **Fields** flyout deliberately. With **Search columns**
empty, the control searches every text column *that the view supplies* — and in
canvas that is exactly the set you picked there.
:::

## Reading the outputs

Three, and the useful one is the count:

```powerfx
// "No results" in your own words rather than the control's
If(
    ViewFilter1.filteredRecordCount = 0,
    "Nothing matches " & ViewFilter1.searchTerm,
    ViewFilter1.filteredRecordCount & " results"
)
```

`filteredRecordCount` is the server's count of what matched, not the number of
rows on the current page. **It is `-1` on a view the platform did not count**,
which is common on large tables — and it travels as `-1` rather than as `0`
precisely so a formula can tell "none" from "unknown":

```powerfx
Switch(
    true,
    ViewFilter1.filteredRecordCount < 0, "Showing results",
    ViewFilter1.filteredRecordCount = 0, "No results",
    ViewFilter1.filteredRecordCount & " results"
)
```

`openedRecordId` is set just before the control asks the platform to open a
record — and in a canvas app nothing opens, so this is how you navigate:

```powerfx
// OnChange
If(
    !IsBlank(ViewFilter1.openedRecordId),
    Navigate(DetailScreen, ScreenTransition.Cover,
        { SelectedId: ViewFilter1.openedRecordId })
)
```

## What canvas does differently

Filtering and sorting are supported in canvas, on primary-type columns other
than the GUID. The asymmetry is in the *operators*: `NotLike` and `NotNull` are
canvas-only, while `Yesterday`, `Today` and `Tomorrow` are model-driven-only.
This control uses `Like` and nothing else, so it behaves the same on both — see
[Limitations](limitations.md).
