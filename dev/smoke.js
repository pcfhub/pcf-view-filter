/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/ViewFilter/bundle.js` the way a form would, binds it to a
 * twelve-record view with three pages in it, and asserts what the control did —
 * both what it rendered and what it asked the platform for.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: half of what a
 * dataset control does is ask the platform for things, and a rendered table
 * shows none of it. Whether a sort *replaced* the order or appended to it,
 * whether a page turn asked for page two or for "one more page", whether a page
 * size change settles or loops — those are decisions, they are what regresses,
 * and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking. CI runs it after the msbuild pack, so there it drives
 * the production bundle.
 *
 * **What passing here does NOT mean.** Every record below is supplied by this
 * file. It cannot tell you that a real view hands over what this fixture hands
 * over, that server-side sorting sorts the same way, that `openDatasetItem`
 * opens anything, or that the control looks right. Keep those in SPEC.md under
 * "Not verified".
 *
 * **The quirks default to the platform's observed misbehaviour, not to its
 * documentation**, and that is load-bearing. See the header of `dev/host.js`:
 * a harness modelling the platform as written down passes a control that cannot
 * page on a real form.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any dataset control;
 * the examples exercise the scaffolded table and are meant to be thrown away
 * with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'ViewFilter', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/ViewFilter. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here — no injectable clock parameter, and therefore no production
 * code bent to suit a harness.
 *
 * A dataset control is likelier to want a timer than a field control is: an
 * auto-refreshing view, a debounce around `dataset.refresh()`, a countdown in a
 * cell. A control with none is unaffected — nothing schedules and
 * `time.pending()` stays at zero — but the teardown assertion at the bottom of
 * this file is written against it either way.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, supplied under the names the bundle actually asks
 * for — read out of the bundle rather than written down here.
 *
 * A `<platform-library>` entry becomes a webpack external, and the global it
 * compiles to carries a version in its name. **That version is not the one the
 * manifest declares.** `pcf-scripts` maps a declared version onto the platform
 * build it supports, so Fluent `9.46.2` arrives as `FluentUIReactv940` and
 * React `16.14.0` as `Reactv16`. Hardcoding either is a trap that springs on
 * the next version bump, with a `ReferenceError` naming a global that appears
 * nowhere in the repository.
 *
 * A standard control has no externals at all, in which case both lists are
 * empty and nothing below runs.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded: every component resolves to its own
 * name as an element type, so the props the control passed survive for
 * inspection. These assertions are about the control's decisions, not about how
 * Fluent renders them — and Fluent 9 ships no UMD build to load anyway.
 */
const fluent = new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined) });

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

vm.runInThisContext(source, { filename: 'bundle.js' });

/**
 * Render what a virtual control returned, executing the component body.
 *
 * **`updateView` only *builds* an element.** A virtual control's component does
 * not run until something renders it, so an assertion that reads props alone
 * cannot see a crash inside the component — and half of what a React dataset
 * control does lives there. That is not hypothetical: the `dataset.sorting`
 * crash below is in the component, and a props-only suite passes against the
 * broken control.
 *
 * `react-dom/server` needs no DOM and no browser. Fluent is stubbed, so its
 * components render as their own names and the markup is meaningless — the
 * point is entirely whether rendering threw.
 *
 * Returns `null` for a standard control, which has no element and no react-dom.
 */
function renderDeep(element) {
    if (element === undefined || element === null || React === null) {
        return null;
    }

    let server = null;

    try {
        server = require(path.join(root, 'node_modules', 'react-dom', 'server'));
    } catch (error) {
        return null;
    }

    // React's development warnings about unknown element types would bury the
    // report; the assertions are about throwing, not about tag names.
    const warn = console.error;
    console.error = () => {};

    try {
        return server.renderToStaticMarkup(element);
    } finally {
        console.error = warn;
    }
}

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source".
const marked = (key) => `resx:${key}`;

/**
 * Bind a fresh control to a fresh view and render until it settles.
 *
 * The returned handle exposes both halves: what was drawn (or, for a virtual
 * control, what was passed down), and what the platform was asked to do.
 */
/**
 * Every control bound and not yet destroyed.
 *
 * A suite that binds and walks away is testing something other than what it
 * says: an abandoned control keeps its interval and its `document` listeners,
 * so the next section's counts include them. That is the leak the teardown
 * assertion exists to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function bind(options) {
    const handle = host.createHost(fixture, { getString: marked, ...options });
    const container = dom.createElement('div');
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(handle.context, () => {
        notifications += 1;
    }, {}, container);

    let driven = host.drive(instance, handle, 10);

    const view = {
        instance,
        container,
        handle,
        get driven() {
            return driven;
        },
        /** The props a virtual control passed down; `{}` for a standard one. */
        props: () => (driven.element && driven.element.props) || {},
        calls: () => handle.state.calls,
        /** How many times the control said its outputs changed. */
        notifications: () => notifications,
        outputs: () => (instance.getOutputs ? instance.getOutputs() : {}),
        find: (selector) => container.querySelector(selector),
        findAll: (selector) => container.querySelectorAll(selector),
        /** Let the platform catch up after something the control asked for. */
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
        /** Unmount, as the platform does when the form closes or navigates. */
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(view);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
    };

    live.push(view);

    return view;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ======================================================================== *
 *  What this control decides.
 *
 *  Most of it is about `dataset.filtering`, which nothing else in the
 *  catalogue touches — so these assertions are as much about the contract as
 *  about the control: set an expression, reset the page, refresh, and never
 *  from inside a render.
 *
 *  The list under the search box is deliberately plain and there is very little
 *  here about it. That is not an oversight; it is not the contribution.
 * ======================================================================== */

/** The control's own inputs, at the defaults the manifest declares. */
const INPUTS = {
    searchColumns: '',
    matchMode: 'startsWith',
    minimumCharacters: 2,
    debounceMs: 300,
    detailColumns: 2,
    itemClick: 'open',
};

const filter = (options = {}) => bind({ ...options, inputs: { ...INPUTS, ...(options.inputs || {}) } });

/** Type into the search box the way a user does, then let the debounce fire. */
function type(view, text, { settle = true } = {}) {
    const box = view.find('.ViewFilter-search');

    box.value = text;
    box.dispatchEvent({ type: 'input', target: box });

    if (settle) {
        // Past whatever `debounceMs` the caller set; the longest here is 300.
        time.advance(1000);
        view.settle();
    }

    return box;
}

/** Everything the control asked the platform for, since binding. */
const calls = (view) => view.calls().join(' ');

/** The expression currently set on the view, if any. */
const expressionOn = (view) => view.handle.dataset.filtering && view.handle.dataset.filtering.getFilter();

const view = filter({});

/*
 * A control that mutates in `updateView` without a guard never stops. Two
 * passes is the settled number — one render, then one more for the page size it
 * asked for on the first — and the limit being reached is the loop.
 */
check(
    'settles instead of refreshing forever',
    !view.driven.looping && view.driven.passes === 2,
    `${view.driven.passes} passes, calls: ${calls(view)}`,
);

/* ------------------------------------------------------------ the search box */

/*
 * **The structural claim this control rests on.**
 *
 * The scaffolded dataset control rebuilds its whole container on every render,
 * which is fine for records and fatal for a text input: `refresh()` causes a
 * render, so the box the user is typing in would cease to exist on the first
 * keystroke. Same element, same value, after the platform has been through
 * several passes.
 */
const typing = filter({});
const box = typing.find('.ViewFilter-search');

box.value = 'contoso';
typing.settle();
typing.settle();

check(
    'the search box survives a render, because it is built once and never rebuilt',
    typing.find('.ViewFilter-search') === box && box.value === 'contoso',
    typing.find('.ViewFilter-search') === box ? `value: ${box.value}` : 'the element was replaced',
);

check(
    'its accessible name is the maker’s label for this control, not a resource string',
    box.getAttribute('aria-label') === 'Active Accounts',
    box.getAttribute('aria-label'),
);

check(
    'and the placeholder names the number of characters it is waiting for',
    view.find('.ViewFilter-search').placeholder === 'resx:ViewFilter_SearchHint',
    view.find('.ViewFilter-search').placeholder,
);

/* ------------------------------------------------------------------ icons */

/*
 * **Both icons are inline `<svg>`, and that is a theming decision.**
 *
 * The same glyph behind an `<img src>` — a file resource or a data URL, PNG or
 * SVG — renders in an isolated document that cannot see this control's
 * stylesheet, so its `currentColor` resolves to black and a dark form gets a
 * black icon on a dark background. `pcf-file-drop` shipped exactly that and it
 * was found on a real form, not here.
 *
 * Asserted on the element name because that is the whole of it: an `<img>`
 * would look identical in a light theme and wrong in a dark one.
 */
for (const [what, selector] of [['magnifier', '.ViewFilter-searchIcon'], ['clear glyph', '.ViewFilter-clearIcon']]) {
    check(
        `the ${what} is an inline svg, not an image`,
        view.find(selector) && view.find(selector).tagName.toLowerCase() === 'svg',
        view.find(selector) ? view.find(selector).tagName : 'missing',
    );

    check(
        `and is filled with currentColor, so the stylesheet decides the ${what}'s colour`,
        view
            .find(selector)
            .querySelectorAll('path')
            .every((path) => path.getAttribute('fill') === 'currentColor'),
    );

    /*
     * Decorative. The field has its label and the button its `aria-label`, so
     * announcing the glyph as well would add a word and no meaning.
     */
    check(
        `and hidden from the accessibility tree, because the ${what} names nothing`,
        view.find(selector).getAttribute('aria-hidden') === 'true',
    );
}

/*
 * **An icon-only button still has to have a name**, and this is the assertion
 * that keeps it. The label used to be the button's text; it is now an
 * `aria-label` read from the same .resx key, so a screen reader hears exactly
 * what it heard before and a sighted user gets it back on hover as a `title`.
 * Dropping the text without this is how an icon button ships as "button".
 */
check(
    'the clear button carries no text, and takes its name from the .resx instead',
    view.find('.ViewFilter-clear').textContent === ''
        && view.find('.ViewFilter-clear').getAttribute('aria-label') === 'resx:ViewFilter_Clear'
        && view.find('.ViewFilter-clear').title === 'resx:ViewFilter_Clear',
    `text: ${JSON.stringify(view.find('.ViewFilter-clear').textContent)}, `
        + `label: ${view.find('.ViewFilter-clear').getAttribute('aria-label')}`,
);

/* ------------------------------------------------------------- filtering */

/*
 * **Below the minimum, nothing is asked for at all.**
 *
 * Not "a filter that matches everything" — no filter, and no refresh either.
 * A control that queries on the first keystroke asks the server for `a%` across
 * every text column of the table, which is the most expensive query it will
 * ever send and the least useful.
 */
const short = filter({});

type(short, 'c');

check(
    'a term below the minimum never touches the platform — no clear, no reset, no refresh',
    expressionOn(short) === undefined && !calls(short).includes('filtering.'),
    calls(short),
);

const filtered = filter({});

type(filtered, 'contoso');

/*
 * **The order is the contract**: set the expression, reset the page, then
 * refresh. Each one is a bug on its own — an unset filter is a search that does
 * nothing, an unreset page asks for page three of a one-page result set and
 * gets nothing back, and a missing refresh looks exactly like a filter that
 * matched nothing.
 */
const sequence = filtered.calls();
const setAt = sequence.findIndex((call) => call.startsWith('filtering.setFilter'));
const resetAt = sequence.indexOf('paging.reset', setAt);
const refreshAt = sequence.indexOf('refresh', resetAt);

check(
    'sets the filter, resets the page, then refreshes — in that order',
    setAt !== -1 && resetAt > setAt && refreshAt > resetAt,
    sequence.join(' '),
);

const expression = expressionOn(filtered);

check(
    'the expression is an Or, because a term in every column at once matches nothing',
    expression && expression.filterOperator === host.OR,
    expression ? `filterOperator: ${expression.filterOperator}` : 'no expression',
);

/*
 * A `Like` against a whole number or a lookup is a query the server rejects,
 * and the rejection names the column rather than the control. The fixture's
 * five columns include an OptionSet, a Lookup and a hidden one; three are text.
 */
check(
    'over the view’s text columns only, and not the hidden one',
    expression
        && expression.conditions.every((condition) => condition.conditionOperator === host.OPERATOR.Like)
        && expression.conditions.map((condition) => condition.attributeName).sort().join(',')
            === 'accountnumber,name,primarycontactname',
    expression ? expression.conditions.map((condition) => condition.attributeName).join(',') : 'none',
);

check(
    'and it actually narrows the view',
    filtered.handle.dataset.paging.totalResultCount === 1,
    `${filtered.handle.dataset.paging.totalResultCount} of ${fixture.records.length}`,
);

/*
 * **The guard that keeps this from being an infinite loop.**
 *
 * Every filter path ends in `refresh()`, and `refresh()` ends in `updateView`.
 * Re-applying an expression the platform is already filtering by would refresh
 * again, and again — which a browser shows as a hang rather than as a loop.
 */
const before = filtered.calls().length;

type(filtered, 'contoso');

check(
    're-applying the same term asks for nothing further',
    filtered.calls().length === before,
    `${before} → ${filtered.calls().length} calls`,
);

/*
 * The debounce is the difference between one query and one per keystroke. Three
 * keystrokes inside the window are one request.
 */
const debounced = filter({});

type(debounced, 'con', { settle: false });
time.advance(100);
type(debounced, 'cont', { settle: false });
time.advance(100);
type(debounced, 'contoso', { settle: false });
time.advance(1000);
debounced.settle();

check(
    'keystrokes inside the debounce window produce one query, not one each',
    debounced.calls().filter((call) => call.startsWith('filtering.setFilter')).length === 1,
    debounced.calls().filter((call) => call.startsWith('filtering.setFilter')).join(' '),
);

/* ------------------------------------------------------------- the term */

/*
 * **`%` and `_` are wildcards, and a user typing one means the character.**
 *
 * Unescaped, a typed `%` matches every record in the table — a search box that
 * appears to ignore what was typed — and `_` quietly matches any single
 * character. The escape is a character class, `[%]`, because a backslash is not
 * an escape character in SQL `LIKE`.
 */
const wildcard = filter({});

type(wildcard, '50%');

check(
    'a typed wildcard is escaped as a character class, not passed through',
    expressionOn(wildcard) && expressionOn(wildcard).conditions[0].value === '50[%]%',
    expressionOn(wildcard) ? expressionOn(wildcard).conditions[0].value : 'no expression',
);

const contains = filter({ inputs: { matchMode: 'contains' } });

type(contains, 'logistics');

check(
    'contains wraps the term; starts-with only appends',
    expressionOn(contains) && expressionOn(contains).conditions[0].value === '%logistics%',
    expressionOn(contains) ? expressionOn(contains).conditions[0].value : 'no expression',
);

/*
 * A maker's typed column list is where free text stops being data and starts
 * being part of a query. What cannot be a logical name is dropped; what is
 * merely *wrong* is passed through, because the server's rejection is the only
 * thing that will ever name it.
 */
const named = filter({ inputs: { searchColumns: 'name, accountnumber ,DROP TABLE, cr123_notacolumn' } });

type(named, 'contoso');

check(
    'searches the columns the maker named, dropping what cannot be a logical name',
    expressionOn(named)
        && expressionOn(named).conditions.map((condition) => condition.attributeName).join(',')
            === 'name,accountnumber,cr123_notacolumn',
    expressionOn(named)
        ? expressionOn(named).conditions.map((condition) => condition.attributeName).join(',')
        : 'no expression',
);

/* -------------------------------------------------------------- clearing */

const cleared = filter({});

type(cleared, 'contoso');
cleared.find('.ViewFilter-clear').click();
time.advance(1000);
cleared.settle();

check(
    'Clear empties the box and clears the filter',
    cleared.find('.ViewFilter-search').value === ''
        && calls(cleared).includes('filtering.clearFilter')
        && expressionOn(cleared) === undefined,
    calls(cleared),
);

check(
    'and the whole view comes back',
    cleared.handle.dataset.paging.totalResultCount === fixture.records.length,
    String(cleared.handle.dataset.paging.totalResultCount),
);

/*
 * "No records" and "nothing matched your search" are different sentences, and
 * showing the first after a search reads as an empty view rather than as a
 * search that found nothing.
 */
const nothing = filter({});

type(nothing, 'zzzzz');

check(
    'a search that matches nothing says so, rather than saying the view is empty',
    nothing.find('.ViewFilter-message')
        && nothing.find('.ViewFilter-message').textContent === 'resx:ViewFilter_NoMatches',
    nothing.find('.ViewFilter-message') && nothing.find('.ViewFilter-message').textContent,
);

check(
    'and an unfiltered empty view still says the view is empty',
    filter({ records: [] }).find('.ViewFilter-message').textContent === 'resx:ViewFilter_Empty',
);

/* -------------------------------------------------------- nothing to search */

/*
 * **The host that supplies no `dataset.filtering`.**
 *
 * Typed as always present, which is a claim about the type definitions rather
 * than about the host — and this control's entire reason to exist runs through
 * it. It must not throw, and it must not accept keystrokes that could not do
 * anything.
 */
let absentError = null;
let unfilterable = null;

try {
    unfilterable = filter({ quirks: { filteringAbsent: true } });
    renderDeep(unfilterable.driven.element);
} catch (error) {
    absentError = `${error.constructor.name}: ${error.message}`;
}

check(
    'renders on a host that supplies no filtering object',
    absentError === null && unfilterable !== null,
    absentError || 'filtering was undefined',
);

check(
    'and says so in the box rather than accepting keystrokes that do nothing',
    unfilterable
        && unfilterable.find('.ViewFilter-search').disabled === true
        && unfilterable.find('.ViewFilter-search').placeholder === 'resx:ViewFilter_Unfilterable',
    unfilterable && unfilterable.find('.ViewFilter-search').placeholder,
);

/*
 * A view of nothing but numbers and lookups is the same state from the user's
 * side, so it gets the same sentence. Both are "there is nothing here to
 * search", and distinguishing them would be describing the implementation.
 */
const numbersOnly = filter({
    columns: [
        { name: 'revenue', displayName: 'Revenue', dataType: 'Currency', alias: 'revenue', order: 0, isPrimary: true },
        { name: 'ownerid', displayName: 'Owner', dataType: 'Lookup.Simple', alias: 'ownerid', order: 1 },
    ],
});

check(
    'a view with no text column to search says the same thing',
    numbersOnly.find('.ViewFilter-search').disabled === true,
    numbersOnly.find('.ViewFilter-search').placeholder,
);

/* --------------------------------------------------------------- outputs */

const reporting = filter({});

check(
    'reports the view’s count before anything is typed',
    reporting.outputs().filteredRecordCount === fixture.records.length,
    JSON.stringify(reporting.outputs()),
);

type(reporting, 'contoso');

check(
    'and the filtered count afterwards, from totalResultCount rather than the page',
    reporting.outputs().filteredRecordCount === 1 && reporting.outputs().searchTerm === 'contoso',
    JSON.stringify(reporting.outputs()),
);

/*
 * `-1` is what the platform reports for a view it did not count, and it travels
 * as `-1`: "none" and "unknown" are different answers, and a canvas formula can
 * tell them apart only if the control does not flatten them.
 */
check(
    'an uncounted view reports -1 rather than 0',
    filter({ quirks: { uncounted: true } }).outputs().filteredRecordCount === -1,
    String(filter({ quirks: { uncounted: true } }).outputs().filteredRecordCount),
);

/* ----------------------------------------------------------- the results */

check(
    'lists one item per record on the page, not the whole view',
    view.findAll('.ViewFilter-item').length === 5,
    `${view.findAll('.ViewFilter-item').length} items for a page size of 5 over ${fixture.records.length} records`,
);

check(
    'shows the primary column as the record’s own line',
    view.find('.ViewFilter-open') && view.find('.ViewFilter-open').textContent === 'Fabrikam Manufacturing',
    view.find('.ViewFilter-open') && view.find('.ViewFilter-open').textContent,
);

check(
    'with as many detail lines under it as the maker asked for',
    view.findAll('.ViewFilter-item')[0].querySelectorAll('.ViewFilter-line').length === 2,
    String(view.findAll('.ViewFilter-item')[0].querySelectorAll('.ViewFilter-line').length),
);

/*
 * A button that does nothing is worse than no button: it takes a tab stop and
 * promises an action. Where clicking is configured to do nothing, the record's
 * line is a span.
 */
const inert = filter({ inputs: { itemClick: 'none' } });

check(
    'renders no button where clicking a record is configured to do nothing',
    !inert.find('.ViewFilter-open') && Boolean(inert.find('.ViewFilter-title')),
);

/* ------------------------------------------------------------ the states */

check(
    'renders nothing visible when the host says it is hidden',
    filter({ visible: false }).container.classList.contains('ViewFilter--hidden'),
);

check(
    'takes no position on the theme when the host publishes none',
    !filter({ host: 'canvas' }).container.classList.contains('ViewFilter--dark'),
);

check(
    'and follows the host theme where there is one',
    filter({ host: 'model-driven', dark: true }).container.classList.contains('ViewFilter--dark'),
);

/* ---------------------------------------------------- what destroy owes */

/*
 * **Keep this when the assertions above go.** It is written against no
 * particular control and needs no knowledge of what yours takes.
 *
 * `destroy` is the lifecycle method with nothing visible riding on it, so it is
 * the one that quietly does nothing. A dataset control makes it worse than a
 * field control does: it is the shape that ends up on a subgrid, in a gallery,
 * or on a form the user navigates between records on — so it is mounted and
 * unmounted repeatedly, and each pass leaves whatever the last one did not
 * release.
 */
disposeAll();

const timersBefore = time.pending();
const listeners = () => Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);
const listenersBefore = listeners();

filter({}).destroy();

check(
    'destroy() releases every timer the control took',
    time.pending() === timersBefore,
    `${timersBefore} → ${time.pending()}`,
);

check('and every document-level listener', listeners() === listenersBefore, `${listenersBefore} → ${listeners()}`);

/*
 * **The one this control actually has to pay**, and the reason the assertion
 * above is not enough on its own: the debounce is scheduled by a keystroke
 * rather than by mounting, so a control that never clears it passes every
 * teardown check that only ever binds and destroys. Left running, it fires
 * against a dataset the platform has already released.
 */
const midSearch = filter({});

type(midSearch, 'contoso', { settle: false });

const scheduled = time.pending();

midSearch.destroy();

check(
    'and the debounce still waiting to fire when the form closed',
    scheduled > timersBefore && time.pending() === timersBefore,
    `${scheduled} pending while typing → ${time.pending()} after destroy`,
);

/*
 * The other half, and the leak this shape is famous for. `updateView` runs
 * again every time the platform finishes a page, a sort or a filter, which is
 * far more often than a field control sees.
 */
const rerendered = filter({});
const afterFirst = time.pending();

rerendered.settle();
rerendered.settle();
rerendered.settle();

check('and re-rendering does not add another one', time.pending() === afterFirst, `${afterFirst} → ${time.pending()}`);

disposeAll();

report();

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real view still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
