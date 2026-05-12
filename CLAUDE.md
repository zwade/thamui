# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`thamui` is a terminal UI library. It is published as an ESM package (`./dist/index.js`) and a Node module loader hook (`./dist/styles/register-hooks.js`, exported as `thamui/hook`). The repo was originally the codebase for a game called "thaumography"; the game has been deleted and only the UI library remains, which is why the package name and some history don't match the repo name.

Everything underneath this library is hand-rolled. There is no React, no Ink, no standard CSS engine — only `yoga-layout` (flexbox), `chalk` (ANSI colors), `css`/`sass` (parsers), `immutable` (for the style map), and `effectual` (the author's own React/Vue-like framework, published separately on npm).

## Commands

- **Build**: `yarn prepublish` (just runs `tsc`). Output goes to `./dist`.
- **Run the demo app**: `node --import ./dist/styles/register-hooks.js dist/effectual-bindings/test.js`
  - The `--import` is mandatory: it installs a Node module-resolution hook that compiles `.scss`/`.sass`/`.css` imports into JSON style trees at load time. Without it, any `import "...scss"` will fail.
- **Lint**: `yarn r lint` (or `npx eslint src`).
- The `r` block in `package.json` (`app:watch`, `lint`, `test:run`) is consumed by [`yarn-plugin-script-daemon`](https://github.com/zwade/yarn-plugin-script-daemon), which runs long-lived/watching scripts as managed background processes. The commands inside it are the canonical ways to dev/watch.
- **Tests**: there is no test framework. `dist/effectual-bindings/test.js` is a manual smoke-test app, not a test suite.

## Architecture

### Rendering pipeline (`src/effectual-bindings/index.tsx`)

`mount(App)` boots a `setInterval` loop at ~16 fps that does:

1. **Reconcile** — `effectual`'s `expand()` + `reconcile()` diff the JSX tree against a `TerminalTarget` (a `HydrationTarget` impl that builds `Block`/`Button`/`TerminalText` nodes instead of DOM elements).
2. **Cascade styles** — `rootElement.pushStyles(...)` walks the node tree, evaluating selectors and merging declarations into each node's computed style. The user-agent stylesheet (`styles/user-agent-styles.scss`) is loaded once at module init.
3. **Layout** — every node owns a `yoga-layout` node; `applyStyles` (`src/terminal/style-parsers.ts`) translates CSS-ish properties into Yoga calls, then `calculateLayout` runs flexbox on the whole tree.
4. **Paint** — `rootElement.render(matrix, {0,0})` writes into an `RleMatrix`; the loop emits the matrix row-by-row to stdout, repositioning the cursor to `1;1` each frame.

The loop early-outs unless `globalThis.__effectual__.isDirty` is set or `forceReflow` was triggered (resize / mouse event).

### Node tree (`src/terminal/`)

- `TerminalNode = TerminalContent | TerminalText`. `TerminalContent` is the base class for "element" nodes; `Block` and `Button` extend it and implement `render`.
- `TerminalTarget.createElement(tag)` falls back to `Block` for any unknown tag. Only `button` gets a distinct class. There's no real element registry.
- `TerminalContent` carries: tag/attributes, a `style` proxy (so writes mark the node dirty), a Yoga node, an event map, a `states: Set<Selector.State>` for `:hover`/`:active`, and an optional `rawStylesheet` injected via the `data-stylesheet` attribute (the JSON string from a SCSS import — this is a documented hack to work around the absence of `display: contents`).
- `RleMatrix` / `RleBuffer` / `Segment` (`rle-buffer.ts`) is a run-length-encoded 2D buffer of chalk-styled string segments. Drawing is "copyIn" of submatrices; `Segment.toString()` invokes chalk lazily so the matrix can be edited freely before serialization.
- Mouse input is xterm mouse-tracking mode (`\x1b[?1003h`). The handler parses `\x1b[M`-prefixed sequences, hit-tests with `rootElement.probe(point)`, and dispatches `mouseenter`/`mouseleave`/`mousedown`/`mouseup` to mutate pseudo-state and fire listeners. Exit keys are ESC (`\x1b`), Ctrl-C (`\x03`), and Ctrl-\ (`\x1c`).

### Styles (`src/styles/`)

- `hooks.ts` + `register-hooks.ts` register a Node `LoadHook`/`ResolveHook` that compiles SCSS through `sass`, parses the resulting CSS with `css`, and emits `export const styles = JSON.stringify([...])` — i.e. SCSS files become JSON-string modules at runtime. This is why the `--import` flag is required before running any code that imports stylesheets.
- `selector.ts` is a hand-written CSS selector implementation (class, id, tag, `:hover`/`:active`/`:focus`, `:first-child`/`:last-child`/`:nth-child(...)`). Specificity is computed simply: `10000 * id + 100 * classes + tag`.
- `styles-runtime.ts` builds an Immutable `StyleMap` (a nested trie keyed by serialized selector) and propagates it down via `propagateStyles`, which:
  - inherits a fixed set of properties (`color`, `backgroundColor`, `fontSize`, `fontFamily`, `textAlign`) from the parent,
  - picks every rule in the current scope that matches this node, sorted by specificity,
  - merges defaults < inherited < matched < inline overrides.
- `style-parsers.ts` is where CSS strings get translated to Yoga values (`measureWithAuto`, `flexDirection`, `border`, `borderRadius`, etc.). `applyStyles(node, styles)` is the authoritative list of supported properties.

### Effectual integration

The library targets `effectual` as the JSX runtime (`jsxFactory: "F._jsx"`, `jsxFragmentFactory: "F._fragment"` in `tsconfig.json`). Components use `$state(initial)` for reactive state and `$on:<event>` JSX props for listeners (see `src/effectual-bindings/app.tsx` for the canonical example). `effectual`'s `HydrationTarget`/`HTContentNode`/`HTTextNode` interfaces are what `TerminalTarget` and `TerminalContent`/`TerminalText` implement.

## Things to be careful about

- **Always run with the loader hook.** Any entrypoint that touches the library must be launched with `--import .../register-hooks.js`, or SCSS imports will throw at resolve time.
- **`data-stylesheet` is special.** `setAttribute("data-stylesheet", json)` does *not* set an attribute — it replaces the node's scoped stylesheet (see `terminal-nodes.ts` ~line 270). Don't treat it as a normal attribute.
- **Yoga nodes are manually allocated.** `allocateYoga()` / `deallocateYoga()` are explicit; freeing recursively is the caller's responsibility. Avoid leaking when removing nodes outside the normal reconciler path.
- **`tagName` is free-form.** Any JSX tag becomes a `Block`. Don't assume `div`/`button` are the only valid tags — but also don't expect non-builtin tags to do anything special.
- **The publish artifact is `./dist`.** Source lives in `src/`; the `exports` field points at compiled output, so consumers will hit type-resolution errors if you forget to `tsc` before publishing.
