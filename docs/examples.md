---
title: Examples
description: Worked configurations of View Filter.
order: 6
---

# Examples

## Finding an account on a large table

The goal: a full-page view of 40,000 accounts where people search by name or
account number, and the search has to come back quickly.

| Property | Value |
| --- | --- |
| Search columns | `name, accountnumber` |
| Match | `Starts with` |
| Minimum characters | `3` |
| Typing pause (ms) | `400` |
| Detail lines | `2` |
| Clicking a record | `Opens it` |

Three deliberate choices, all about the size of the table:

- **Two named columns, not every text column.** Empty would search the
  description as well, which is a memo and has no index behind it.
- **Three characters, not two.** At two, `ab%` across 40,000 accounts returns
  thousands of rows nobody wanted.
- **A longer pause.** 400ms rather than 300 costs nothing a typist notices and
  removes a query per word.

## A contact subgrid on an account form

The goal: a subgrid of contacts on an account, where there are rarely more than
a few dozen and finding one by any part of their details is the job.

| Property | Value |
| --- | --- |
| Search columns | *(empty — every text column)* |
| Match | `Contains` |
| Minimum characters | `2` |
| Typing pause (ms) | `300` |
| Detail lines | `2` |
| Clicking a record | `Opens it` |

`Contains` reads every row, which is exactly the wrong choice on the example
above and exactly the right one here: a few dozen rows cost nothing, and being
able to type a fragment of an email address is worth more than an index.

## A picker in a canvas app

The goal: search a table, tap a record, go to a detail screen. The control lists
the records; the app decides what happens next.

| Property | Value |
| --- | --- |
| Records | `Contacts` |
| Search columns | `fullname, emailaddress1` |
| Detail lines | `1` |
| Clicking a record | `Opens it` |

```powerfx
// OnChange
If(
    !IsBlank(ViewFilter1.openedRecordId),
    Navigate(ContactDetail, ScreenTransition.Cover,
        { SelectedId: ViewFilter1.openedRecordId })
)
```

In a canvas app `openDatasetItem()` opens nothing, so `openedRecordId` is the
whole of the interaction — it is set just before the platform is asked, which is
what makes it observable on a host where the asking does nothing.

:::callout{type=success}
Set **Clicking a record** to *Does nothing* if the app navigates from somewhere
else. The record's line then renders as text rather than as a button, which
saves a tab stop that promises an action it will not perform.
:::
