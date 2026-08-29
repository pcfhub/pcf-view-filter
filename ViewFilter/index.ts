import { IInputs, IOutputs } from './generated/ManifestTypes';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type FilterExpression = ComponentFramework.PropertyHelper.DataSetApi.FilterExpression;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/**
 * `FilterOperator`, which combines the conditions of one expression: 0 And,
 * 1 Or.
 *
 * **The default is And**, and that is the trap: an expression that omits
 * `filterOperator` asks for a term present in *every* named column at once,
 * which matches nothing and reads as a broken query rather than a missing
 * field. Every search across several columns is an Or.
 */
const OR = 1;

/**
 * `ConditionOperator.Like` — 6.
 *
 * Out of roughly ninety operators, `Like` is the one a text search wants and it
 * is supported on both hosts. Several neighbours are not, and the asymmetry
 * runs both ways: `NotLike` (7) and `NotNull` (13) are canvas-only, while
 * `Yesterday` (14), `Today` (15) and `Tomorrow` (16) are model-driven-only.
 * Reaching past this constant is choosing a host, and `docs/limitations.md`
 * carries the table.
 */
const LIKE = 6;

/**
 * The column types a `Like` condition can be built over.
 *
 * A `Like` against a whole number or a lookup is a query the server rejects,
 * and the rejection names the column rather than the control — so the wrong
 * column is chosen here, once, rather than diagnosed later.
 */
const SEARCHABLE = [
    'SingleLine.Text',
    'SingleLine.TextArea',
    'SingleLine.Email',
    'SingleLine.Phone',
    'SingleLine.URL',
    'SingleLine.Ticker',
    'Multiple',
];

/** A Dataverse logical name, and the boundary maker-typed text stops at. */
const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * A search box over the bound view, filtered server-side.
 *
 * **The list under the box is not the point of this control.** It is
 * deliberately plain — a primary line and a couple of details — because a
 * dataset control replaces the grid entirely and something has to render the
 * records. If you want a real table, use `pcf-data-table`; if you want a
 * compact list, `pcf-compact-list`. What is here that is nowhere else is
 * `dataset.filtering`.
 *
 * Three things about filtering are worth knowing before editing this file, and
 * each is a bug somebody ships:
 *
 *  1. **`setFilter` is not a fetch.** It records an expression and nothing
 *     moves until `refresh()`. A control that omits the refresh looks exactly
 *     like one whose filter matched nothing.
 *  2. **Filtering does not reset the page.** Filter from page three and the
 *     control asks for page three of a result set that may have one page in it,
 *     and the platform hands back nothing at all. `paging.reset()` first.
 *  3. **`refresh()` fires `updateView`.** So the filter is applied from the
 *     debounce handler and never from a render, and it is guarded on the
 *     expression it last applied. Without that guard this is an unbounded
 *     refresh loop, which a browser shows as a hang.
 *
 * There is a fourth thing, and it is about the DOM rather than the platform.
 * The scaffolded dataset control rebuilds its entire container on every render,
 * which is fine for records and fatal for a text input: the box the user is
 * typing in would cease to exist on the first keystroke's refresh. So the
 * search bar is built once in `init` and only the results below it are rebuilt.
 */
export class ViewFilter implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    /** Built once and never rebuilt — see the note above. */
    private bar!: HTMLDivElement;
    /** The filled surface the magnifier and the input share. */
    private field!: HTMLDivElement;
    private search!: HTMLInputElement;
    private clear!: HTMLButtonElement;
    /** Rebuilt on every render. */
    private body!: HTMLDivElement;

    private notifyOutputChanged!: () => void;

    /**
     * The most recent context, kept so the debounce handler can reach the
     * dataset a turn after the render that scheduled it.
     */
    private context!: ComponentFramework.Context<IInputs>;

    private openedRecordId = '';
    private term = '';
    private filteredRecordCount = -1;

    /**
     * The expression last handed to the platform, serialised.
     *
     * Compared rather than rebuilt: this is what stops a re-applied identical
     * filter from refreshing.
     *
     * **It starts at `'none'` rather than at `''`, and that is the initial
     * state rather than a sentinel** — a view arrives unfiltered, so "no
     * filter" is what the platform is already doing. Starting from `''` made
     * the first keystroke of every session clear a filter nobody had set:
     * `clearFilter`, `paging.reset` and a `refresh` round trip, before the user
     * had typed enough to search for anything.
     */
    private appliedFilter = 'none';

    /** The pending debounce, which `destroy()` owes a `clearTimeout`. */
    private typing: number | null = null;

    /**
     * The page size this control has already asked the platform for.
     *
     * Guarding on this rather than on `ds.paging.pageSize` is the whole trick:
     * the platform's own value will not equal the requested one until the
     * refresh lands, so comparing against it re-fires at least once more — and
     * if the platform clamps the request, it never converges at all.
     */
    private appliedPageSize = 0;

    private page = 1;

    /**
     * Which chrome button to put focus back on after the next render.
     *
     * The search box does not need this — it is never rebuilt — but the pager
     * is, and paging with the keyboard is otherwise a one-shot: the button is
     * destroyed by the render its own click caused and focus falls back to
     * `<body>`.
     */
    private restoreFocus: 'previous' | 'next' | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.context = context;
        this.container = container;
        this.container.classList.add('ViewFilter');

        this.search = document.createElement('input');
        this.search.className = 'ViewFilter-search';
        // `search` rather than `text`: it is the right semantics, and on iOS it
        // is also what puts a Search key on the keyboard instead of Return.
        this.search.type = 'search';
        this.search.addEventListener('input', this.onInput);
        this.search.addEventListener('keydown', this.onKeyDown);

        /*
         * The input sits inside a surface rather than being the surface.
         *
         * That is what lets the magnifier sit *in* the field the way Fluent's
         * `contentBefore` does, rather than beside it: the wrapper carries the
         * fill, the border and the focus ring, and the input is a hole in it.
         * A `position: absolute` icon over a padded input is the other way to
         * do this, and it overlaps the text at narrow widths.
         *
         * Flex order also means right-to-left needs no code — the container's
         * `dir` flips the magnifier to the other end on its own.
         */
        this.field = document.createElement('div');
        this.field.className = 'ViewFilter-field';
        this.field.append(icon('ViewFilter-searchIcon', SEARCH_PATHS), this.search);

        this.clear = document.createElement('button');
        this.clear.className = 'ViewFilter-clear';
        this.clear.type = 'button';
        /*
         * Icon-only, so its accessible name comes from `aria-label` rather than
         * from text — set in `paintBar` from the same .resx string the label
         * used to be. `title` carries it to a sighted user on hover, which is
         * the half an icon-only button otherwise loses.
         */
        this.clear.append(icon('ViewFilter-clearIcon', CLEAR_PATHS));
        this.clear.addEventListener('click', this.onClear);

        this.bar = document.createElement('div');
        this.bar.className = 'ViewFilter-bar';
        this.bar.append(this.field, this.clear);

        this.body = document.createElement('div');
        this.body.className = 'ViewFilter-body';

        this.container.append(this.bar, this.body);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;

        this.context = context;

        this.applyTheme(context);
        this.applyPageSize(context, dataset);
        this.render(context, dataset);
        this.reportCount(dataset);
    }

    /**
     * `null` is not `undefined` here: the generated `IOutputs` types every
     * output as optional, and `undefined` means "no change" — so a cleared
     * value would be unobservable. Emit the empty string instead.
     */
    public getOutputs(): IOutputs {
        return {
            openedRecordId: this.openedRecordId,
            filteredRecordCount: this.filteredRecordCount,
            searchTerm: this.term,
        };
    }

    public destroy(): void {
        this.search.removeEventListener('input', this.onInput);
        this.search.removeEventListener('keydown', this.onKeyDown);
        this.clear.removeEventListener('click', this.onClear);

        /*
         * The debounce, which is the only timer this control takes and the one
         * thing here that outlives the DOM. Left running it fires against a
         * dataset the platform has already released — and on a form the user is
         * navigating between records, that is every navigation.
         */
        if (this.typing !== null) {
            window.clearTimeout(this.typing);
            this.typing = null;
        }

        this.container.innerHTML = '';
    }

    /**
     * Picks which set of colour fallbacks the stylesheet uses.
     *
     * Only the fallbacks. The stylesheet reads Fluent's design tokens through
     * `var()`, and a model-driven form already mounts a `FluentProvider` above
     * every code component on the page — so where the host publishes them this
     * changes nothing at all. It matters on the hosts that publish nothing: a
     * canvas app, or PCFHub's demo harness.
     *
     * `@media (prefers-color-scheme: dark)` is the obvious hook and it is the
     * wrong question: a model-driven app carries its own theme and the user's
     * OS setting says nothing about it. Absent means absent.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('ViewFilter--dark', isDarkTheme);
    }

    /**
     * Ask for a new page size, but only when it actually changed.
     *
     * The second guarded mutator in this file is the filter, and it skips its
     * own first run for the reason spelled out on `appliedFilter`: on the first
     * `updateView` every "applied" field still holds its initial value, so an
     * unguarded pair fires twice at once and each one refreshes.
     */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw ?? 25;
        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    /* ------------------------------------------------------------ filtering */

    private onInput = (): void => {
        this.term = this.search.value;

        // The term is an output in its own right, so a canvas app can title its
        // own "no results" message. Reported on every keystroke rather than on
        // the debounce: it costs nothing and it is what the user typed, not
        // what was queried.
        this.notifyOutputChanged();
        this.paintBar(this.context);

        if (this.typing !== null) {
            window.clearTimeout(this.typing);
        }

        const wait = Math.max(0, Math.trunc(this.context.parameters.debounceMs.raw ?? 300));

        this.typing = window.setTimeout(() => {
            this.typing = null;
            this.applyFilter(this.context);
        }, wait);
    };

    /** Escape clears, which is what a `type="search"` box is expected to do. */
    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.term !== '') {
            event.stopPropagation();
            this.onClear();
        }
    };

    private onClear = (): void => {
        this.term = '';
        this.search.value = '';

        if (this.typing !== null) {
            window.clearTimeout(this.typing);
            this.typing = null;
        }

        this.notifyOutputChanged();
        this.paintBar(this.context);
        this.search.focus();
        this.applyFilter(this.context);
    };

    /**
     * Set the filter, reset the page, ask for the data. In that order.
     *
     * Called from the debounce and from Clear — never from a render, because
     * `refresh()` causes one.
     */
    private applyFilter(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;
        const filtering = dataset.filtering;

        /*
         * Typed as always present. That is a claim about the type definitions
         * rather than about the host, and this control's whole reason to exist
         * runs through it — so it is checked rather than trusted. With no
         * filtering there is nothing to express a search through, and the bar
         * says so rather than accepting keystrokes that do nothing.
         */
        if (!filtering) {
            return;
        }

        const expression = this.buildExpression(context, dataset);
        const signature = expression === null ? 'none' : JSON.stringify(expression);

        /*
         * **The guard that keeps this from being an infinite loop.**
         *
         * Every path below ends in `refresh()`, and `refresh()` ends in
         * `updateView`. Re-applying an expression the platform is already
         * filtering by would refresh again, and again. `''` is the state before
         * anything has been applied, which is why clearing a filter that was
         * never set does not refresh either.
         */
        if (signature === this.appliedFilter) {
            return;
        }

        this.appliedFilter = signature;

        if (expression === null) {
            filtering.clearFilter();
        } else {
            filtering.setFilter(expression);
        }

        // "Page 4" is meaningless against a different result set, and asking
        // for it returns nothing rather than the first page.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * The expression for what is typed, or `null` to filter nothing.
     *
     * One `Like` condition per searchable column, combined with `Or`. The
     * wildcard placement is the whole of the difference between the two match
     * modes — the server is doing the work either way, and `contains` is the
     * one that cannot use an index.
     */
    private buildExpression(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
    ): FilterExpression | null {
        const term = this.term.trim();
        const minimum = Math.max(1, Math.trunc(context.parameters.minimumCharacters.raw ?? 2));

        if (term.length < minimum) {
            return null;
        }

        const columns = this.searchColumns(context, dataset);

        if (columns.length === 0) {
            return null;
        }

        const escaped = escapeLike(term);
        const value = context.parameters.matchMode.raw === 'contains' ? `%${escaped}%` : `${escaped}%`;

        return {
            filterOperator: OR,
            conditions: columns.map((name) => ({
                attributeName: name,
                conditionOperator: LIKE,
                value,
            })),
        } as FilterExpression;
    }

    /**
     * Which columns to search: the maker's list, or every text column in view.
     *
     * The maker's list is validated against what can be a logical name and the
     * rest is dropped — a typed string is where free text stops being data and
     * starts being part of a query. A name that is merely *wrong* is passed
     * through on purpose: the server's rejection is the only thing that will
     * ever name it, and swallowing that leaves a maker with a search box that
     * does nothing and no way to find out why.
     */
    private searchColumns(context: ComponentFramework.Context<IInputs>, dataset: DataSet): string[] {
        const declared = (context.parameters.searchColumns.raw ?? '')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter((name) => LOGICAL_NAME.test(name));

        if (declared.length > 0) {
            return declared;
        }

        // Hidden columns are left out: a match the user cannot see is a result
        // they cannot account for.
        return (dataset.columns ?? [])
            .filter((column) => !column.isHidden && SEARCHABLE.includes(column.dataType))
            .map((column) => column.name);
    }

    /**
     * Tell the host how many records the filter matched.
     *
     * Straight from `totalResultCount`, which follows the filter — a control
     * that reported the length of the page would report the page size on every
     * view with more than one page. `-1` travels as `-1` rather than as `0`,
     * because "none" and "the platform did not count" are different answers.
     *
     * Guarded on the value changing, because this runs inside `updateView` and
     * `notifyOutputChanged` brings the platform back through it.
     */
    private reportCount(dataset: DataSet): void {
        const total = dataset.loading ? this.filteredRecordCount : dataset.paging.totalResultCount;

        if (total === this.filteredRecordCount) {
            return;
        }

        this.filteredRecordCount = total;
        this.notifyOutputChanged();
    }

    /* -------------------------------------------------------------- render */

    private render(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const getString = (id: string): string => context.resources.getString(id);

        this.body.innerHTML = '';

        // Canvas relies on this; a model-driven form hides the section itself.
        this.container.classList.toggle('ViewFilter--hidden', !context.mode.isVisible);

        if (!context.mode.isVisible) {
            return;
        }

        this.paintBar(context);

        if (dataset.error) {
            this.message(dataset.errorMessage || getString('ViewFilter_Error'));

            return;
        }

        // `isHidden` and `order` are the maker's decisions in the view designer.
        const columns = (dataset.columns ?? [])
            .filter((column) => !column.isHidden)
            .sort((a, b) => a.order - b.order);

        // A canvas app supplies only the columns picked in the Items Fields
        // flyout. None picked is a real state, and an empty list reads as a
        // broken control rather than as an unfinished configuration.
        if (columns.length === 0) {
            this.message(dataset.loading ? getString('ViewFilter_Loading') : getString('ViewFilter_NoColumns'));

            return;
        }

        // `loading` is true on the first updateView, before any records arrive,
        // so rendering the empty state here flashes "No records" on every load.
        const all = dataset.sortedRecordIds ?? [];

        if (all.length === 0) {
            if (dataset.loading) {
                this.message(getString('ViewFilter_Loading'));
            } else if (this.appliedFilter !== 'none') {
                // "No records" and "nothing matched your search" are different
                // sentences, and showing the first after a search reads as an
                // empty view rather than as a search that found nothing.
                this.message(getString('ViewFilter_NoMatches').replace('{0}', this.term.trim()));
            } else {
                this.message(getString('ViewFilter_Empty'));
            }

            return;
        }

        const ids = this.currentPage(all);

        this.body.appendChild(this.list(context, dataset, columns, ids, getString));
        this.body.appendChild(this.pager(dataset, ids.length, getString));

        // The pager button that caused this render no longer exists. Put focus
        // on its replacement, or on the other one when this page turn was the
        // last: a disabled button cannot take focus, and doing nothing here
        // would strand the keyboard at `<body>`.
        if (this.restoreFocus) {
            const wanted = this.restoreFocus;
            this.restoreFocus = null;

            const button = this.body.querySelector<HTMLButtonElement>(`.ViewFilter-${wanted}`);
            const other = this.body.querySelector<HTMLButtonElement>(
                `.ViewFilter-${wanted === 'next' ? 'previous' : 'next'}`,
            );

            (button?.disabled ? other : button)?.focus();
        }
    }

    /**
     * The persistent bar, updated in place.
     *
     * Everything here is assigned rather than rebuilt, because the input is the
     * one element in this control that a user can be in the middle of using.
     * Note that its `value` is not assigned at all after `init`: writing it
     * while somebody is typing moves the caret to the end on every keystroke,
     * and there is no incoming value to reconcile it with — the term belongs to
     * this control rather than to the platform.
     */
    private paintBar(context: ComponentFramework.Context<IInputs>): void {
        const getString = (id: string): string => context.resources.getString(id);
        const minimum = Math.max(1, Math.trunc(context.parameters.minimumCharacters.raw ?? 2));
        const dataset = context.parameters.records;
        const searchable =
            Boolean(dataset.filtering) && this.searchColumns(context, dataset).length > 0;

        this.search.setAttribute('aria-label', context.mode.label || getString('ViewFilter_Search'));
        this.search.placeholder = searchable
            ? getString('ViewFilter_SearchHint').replace('{0}', String(minimum))
            : getString('ViewFilter_Unfilterable');

        /*
         * A view with nothing to search is a real state, and it has two causes
         * that look identical from here: no text column in the view, and a host
         * that supplies no `filtering` at all. Both mean the same thing to
         * whoever is looking at it, so they get the same sentence and the box
         * stops accepting keystrokes that could not do anything.
         */
        this.search.disabled = !searchable || context.mode.isControlDisabled;

        /*
         * The surface carries the disabled look, not the input inside it, so it
         * needs telling. A class rather than `:has(:disabled)` — that selector
         * is fine on a current Chromium and this is one less thing to be true
         * about whatever a customer is running.
         */
        this.field.classList.toggle('ViewFilter-field--disabled', this.search.disabled);

        /*
         * Icon-only, so the .resx string that used to be the button's text is
         * now its accessible name. `title` shows it on hover, which is what an
         * icon-only button otherwise takes away from a sighted user.
         */
        this.clear.setAttribute('aria-label', getString('ViewFilter_Clear'));
        this.clear.title = getString('ViewFilter_Clear');
        this.clear.hidden = this.term === '';
        this.clear.disabled = this.search.disabled;

        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';
        this.container.classList.toggle('ViewFilter--searching', this.typing !== null);
    }

    /**
     * The records belonging to the page the pager says it is on.
     *
     * **This is the one place a dataset control should slice
     * `sortedRecordIds`, and the usual rule is never to do it.** On a platform
     * that honours `loadOnlyNewPage`, that array already *is* the current page.
     * Except that the flag is not honoured: observed on a real model-driven
     * form, `loadNextPage(true)` returns the whole range from page one, and
     * page two renders under page one.
     *
     * So the slice is a repair for one specific platform behaviour, written to
     * disappear the moment that behaviour changes: when the array is no longer
     * than a page it already is the page, and nothing is cut.
     */
    private currentPage(ids: string[]): string[] {
        if (ids.length <= this.appliedPageSize) {
            return ids;
        }

        const start = (this.page - 1) * this.appliedPageSize;
        const slice = ids.slice(start, start + this.appliedPageSize);

        // Never empty the list: showing the wrong page is recoverable by
        // clicking, showing nothing looks like data loss.
        return slice.length > 0 ? slice : ids.slice(-this.appliedPageSize);
    }

    private message(text: string): void {
        const p = document.createElement('p');
        p.className = 'ViewFilter-message';
        p.textContent = text;
        this.body.appendChild(p);
    }

    /**
     * The results, deliberately plain.
     *
     * A primary line and `detailColumns` lines under it. This is the part of
     * the control that is not the contribution — see the class docblock.
     */
    private list(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        columns: Column[],
        ids: string[],
        getString: (id: string) => string,
    ): HTMLElement {
        const list = document.createElement('ul');
        list.className = dataset.loading ? 'ViewFilter-list is-loading' : 'ViewFilter-list';

        const primary = columns.find((column) => column.isPrimary) ?? columns[0];
        const wanted = Math.max(0, Math.trunc(context.parameters.detailColumns.raw ?? 2));
        const details = columns.filter((column) => column.name !== primary.name).slice(0, wanted);
        const opens = context.parameters.itemClick.raw !== 'none';

        for (const id of ids) {
            const record = dataset.records[id];

            // The platform hands over only the records of the current page, so
            // an id without a record is an ordinary state rather than an error.
            if (!record) {
                continue;
            }

            const item = document.createElement('li');
            item.className = 'ViewFilter-item';

            const title = record.getFormattedValue(primary.name);

            if (opens) {
                // A real `<button>`, so opening is reachable by keyboard. A
                // click handler on the `<li>` is not.
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ViewFilter-open';
                button.textContent = title;
                button.title = getString('ViewFilter_OpenRecord').replace('{0}', title);
                button.addEventListener('click', () => this.openRecord(dataset, id));
                item.appendChild(button);
            } else {
                const span = document.createElement('span');
                span.className = 'ViewFilter-title';
                span.textContent = title;
                item.appendChild(span);
            }

            for (const column of details) {
                const line = document.createElement('p');
                line.className = 'ViewFilter-line';

                const label = document.createElement('span');
                label.className = 'ViewFilter-lineLabel';
                label.textContent = column.displayName;

                const value = document.createElement('span');
                value.className = 'ViewFilter-lineValue';
                // `getFormattedValue` takes the column's *name*. With
                // property-set roles the column is found by `alias` and read by
                // `name`, and getting that backwards renders nothing against
                // real data while looking fine in a demo fixture.
                value.textContent = record.getFormattedValue(column.name);

                line.append(label, value);
                item.appendChild(line);
            }

            list.appendChild(item);
        }

        return list;
    }

    private pager(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'ViewFilter-pager';

        /*
         * `hasPreviousPage` answers a different question than it appears to.
         * Observed on a real model-driven form: after paging forward it stays
         * false, so Previous never unlocks. The platform treats the load as the
         * *range* pages 1..N, and a range beginning at page 1 truthfully has
         * nothing before it. The control's own counter drives the button.
         */
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'ViewFilter-previous';
        // Chevron then label. The glyph is decoration on a button that already
        // says what it does, so the accessible name is unchanged.
        previous.append(
            icon('ViewFilter-chevron', CHEVRON_PREVIOUS, STROKED),
            document.createTextNode(getString('ViewFilter_Previous')),
        );
        previous.disabled = this.page <= 1;
        previous.addEventListener('click', () => {
            if (this.page <= 1) {
                return;
            }

            this.restoreFocus = 'previous';
            this.goToPage(dataset, this.page - 1);
        });

        const status = document.createElement('span');
        status.className = 'ViewFilter-pagerStatus';
        status.setAttribute('aria-live', 'polite');
        status.textContent = this.pagerLabel(dataset, rowsOnPage, getString);

        // `hasNextPage` has behaved, and it is the only available answer to
        // "is there more" — a local counter cannot supply that one.
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'ViewFilter-next';
        // Label then chevron, the other way round: the glyph points the way the
        // button goes, so it trails rather than leads.
        next.append(
            document.createTextNode(getString('ViewFilter_Next')),
            icon('ViewFilter-chevron', CHEVRON_NEXT, STROKED),
        );
        next.disabled = !dataset.paging.hasNextPage;
        next.addEventListener('click', () => {
            if (!dataset.paging.hasNextPage) {
                return;
            }

            this.restoreFocus = 'next';
            this.goToPage(dataset, this.page + 1);
        });

        wrap.append(previous, status, next);

        return wrap;
    }

    /**
     * Turn to an absolute page.
     *
     * `loadExactPage` says what a pager means, and it is the documented
     * fallback for a host that ignores `loadOnlyNewPage` — which real ones do.
     * It is typed as required and feature-detected anyway: a required member is
     * a claim about the type definitions, not about the host.
     */
    private goToPage(dataset: DataSet, target: number): void {
        const back = target < this.page;

        this.page = Math.max(1, target);

        if (typeof dataset.paging.loadExactPage === 'function') {
            dataset.paging.loadExactPage(this.page);

            return;
        }

        if (back) {
            dataset.paging.loadPreviousPage(true);
        } else {
            dataset.paging.loadNextPage(true);
        }
    }

    /**
     * `totalResultCount` is -1 when the platform did not count the rows, which
     * is common on large views. Printing "of -1" is the tell that nobody
     * checked, so name the page instead of the range.
     */
    private pagerLabel(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): string {
        const total = dataset.paging.totalResultCount;

        if (total < 0) {
            return getString('ViewFilter_PageStatus').replace('{0}', String(this.page));
        }

        const start = (this.page - 1) * this.appliedPageSize + 1;

        return getString('ViewFilter_RangeStatus')
            .replace('{0}', String(Math.min(start, total)))
            .replace('{1}', String(Math.min(start + rowsOnPage - 1, total)))
            .replace('{2}', String(total));
    }

    /**
     * Notify before opening, so the output is observable even on a host where
     * `openDatasetItem` does nothing — which is the canvas case.
     *
     * It takes an EntityReference, and `getNamedReference()` is the only way to
     * build one; there is no id-based overload.
     */
    private openRecord(dataset: DataSet, id: string): void {
        const record = dataset.records[id];

        if (!record) {
            return;
        }

        this.openedRecordId = id;
        this.notifyOutputChanged();
        dataset.openDatasetItem(record.getNamedReference());
    }
}

/**
 * Escape what SQL `LIKE` treats as a wildcard, so a typed `%` matches a `%`.
 *
 * `%`, `_` and `[` are the three, and the escape is a character class rather
 * than a backslash: `[%]`, `[_]`, `[[]`. A backslash is not an escape character
 * here and would be searched for literally.
 *
 * Without this, typing `%` matches every record in the table — a search box
 * that appears to ignore what was typed — and typing `_` quietly matches any
 * single character.
 */
function escapeLike(term: string): string {
    return term.replace(/[%_[]/g, (character) => `[${character}]`);
}

/** The SVG namespace. `createElement('svg')` makes an *HTML* element of that
 *  name: it parses, it appends, it occupies no space and draws nothing. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fluent's magnifier and dismiss glyphs, filled, on a 20×20 grid. */
const SEARCH_PATHS = ['M8.5 3a5.5 5.5 0 1 0 3.35 9.86l3.65 3.64 1.06-1.06-3.64-3.65A5.5 5.5 0 0 0 8.5 3Zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z'];
const CLEAR_PATHS = ['M4.4 4.55 4.5 4.44a.5.5 0 0 1 .64-.06l.07.06L10 9.29l4.79-4.85a.5.5 0 0 1 .78.63l-.06.07L10.71 10l4.85 4.79a.5.5 0 0 1-.63.78l-.07-.06L10 10.71l-4.79 4.85a.5.5 0 0 1-.78-.63l.06-.07L9.29 10 4.44 5.21a.5.5 0 0 1-.06-.64l.06-.07-.1.11Z'];

/** The pager chevrons, stroked rather than filled — two lines each. */
const CHEVRON_PREVIOUS = ['M12.5 5 7.5 10l5 5'];
const CHEVRON_NEXT = ['M7.5 5l5 5-5 5'];

/** Filled glyph attributes, and stroked ones. */
const FILLED = { fill: 'currentColor' };
const STROKED = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
};

/**
 * An inline `<svg>`, which is the only kind of icon that can follow the theme.
 *
 * An image behind `<img src>` — file or data URL, PNG or SVG — renders as an
 * isolated document that cannot see this page's stylesheet, so a
 * `currentColor` inside it resolves to black and a dark form gets a black icon
 * on a dark background. `pcf-file-drop` shipped exactly that and it was found
 * on a real form. Inline, `currentColor` resolves against the `color` the
 * stylesheet sets, and the icon follows light and dark for free.
 *
 * Always decorative: every icon in this control sits on something that already
 * has an accessible name — the field has its label, the button has its
 * `aria-label` — so announcing the glyph as well would only add a word.
 */
function icon(className: string, paths: string[], attrs: Record<string, string> = FILLED): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

    // `classList`, because `className` on an SVG element is a read-only
    // `SVGAnimatedString` and assigning to it silently does nothing.
    svg.classList.add(className);
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');

        path.setAttribute('d', d);

        for (const [name, value] of Object.entries(attrs)) {
            path.setAttribute(name, value);
        }

        svg.appendChild(path);
    }

    return svg;
}
