---
title: Installation
description: Import the solution and make the control available.
order: 2
---

# Installation

:::steps
1. Download the **managed** solution for your environment.
2. In the Power Platform admin centre, import the solution.
3. Publish all customizations.
4. Enable **Code components for canvas apps** if this control is used there.
:::

:::callout{type=warning}
Import the managed solution into production. The unmanaged one is for a
development environment where you intend to change the control itself — it
cannot be cleanly uninstalled.
:::

## Requirements

- A Dataverse environment on a currently supported Power Platform version. The
  control uses no preview API and declares no platform library.
- A view, subgrid or canvas table with **at least one text column**. The search
  is built from `Like` conditions, which the server rejects against numbers and
  lookups — so a view of nothing but those has nothing to search, and the
  control says so rather than pretending otherwise.

## Permissions

**None.** The control declares no `feature-usage` at all, so a maker installing
it is asked for nothing. Filtering is a method on the dataset rather than a
platform service: `filtering.setFilter()` and `refresh()` need no permission,
the same way `openDatasetItem()` does not.

That is worth checking against controls that offer the same feature by calling
the Web API — those need `WebAPI` granted, and they query a table rather than
the view the maker configured.
