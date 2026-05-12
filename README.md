# Thamui

A terminal UI library for Node.js with web-style ergonomics. JSX components, CSS in real `.scss` files, flexbox layout via Yoga, focus / hover / active states with the corresponding pseudo-class selectors, mouse and keyboard input, and progressive cell-level rendering so static UI costs nothing per frame.

It's built on top of [effectual](https://www.npmjs.com/package/effectual), a small React/Vue-flavored reactive framework. Effectual handles components, JSX, and reconciliation; Thamui handles everything below the line — a hand-rolled selector engine and style cascade, the Yoga bindings, a run-length-encoded matrix that backs each frame, ANSI output via chalk, mouse/keyboard decoding, focus management, and a per-frame cell diff that emits only the cursor moves and characters that actually changed.

<img width="743" height="603" alt="Screenshot 2026-05-12 at 3 48 33 PM" src="https://github.com/user-attachments/assets/44478b61-ca3f-4f02-b603-8351df6e4caf" />

## Highlights

- **JSX, components, reactive state** through effectual.
- **Real CSS.** Write `.scss`, import it in TypeScript, attach with `data-stylesheet={styles}`. Class / id / tag selectors, the usual pseudo-classes (`:focus`, `:hover`, `:active`, `:first-child`, `:last-child`, `:nth-child(n)`), and standard cascade + specificity.
- **Flexbox layout** through Yoga: `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `gap`, `width` / `height` / `min-*` / `max-*`, `padding`, `margin`, `border`, `border-radius`.
- **Built-in elements.** `div`, `button` (focusable, activates on Enter/Space), `input` (with `type="password"`), `textarea` (multi-line, visual-line cursor navigation).
- **Mouse and keyboard.** Hover/active/click tracking, keyboard with named keys (`ArrowUp`, `Backspace`, `Shift+Tab`, …) and `ctrl` / `alt` modifiers.
- **Tab focus traversal** between any `isSelectable` element, automatically.
- **Progressive rendering.** No flicker, no full redraws — only changed cells get repainted.

## Getting started

### 1. Install

```bash
yarn add thamui effectual
```

### 2. Configure TypeScript

Thamui uses effectual's JSX runtime. In your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "jsx": "react",
        "jsxFactory": "F._jsx",
        "jsxFragmentFactory": "F._fragment",
        "module": "nodenext",
        "moduleResolution": "nodenext",
        "target": "esnext"
    }
}
```

### 3. Register the SCSS loader

Thamui ships a Node loader hook that compiles `.scss` imports into the engine's style format at load time. Pass it to `node` with `--import`:

```bash
node --import thamui/hook dist/app.js
```

Optional — declare an ambient type for `.scss` imports so TypeScript is happy:

```ts
declare module "*.scss" {
    const styles: string;
    export default styles;
}
```

### 4. Write an app

`styles/app.scss`:

```scss
.page {
    width: 100%;
    height: 100%;
    background-color: #1a1a2e;
    justify-content: center;
    align-items: center;
}

.btn {
    background-color: #5566cc;
    color: #ffffff;
    padding: 0 2;

    &:hover { background-color: #6677dd; }
    &:focus { background-color: #7788ee; }
}
```

`src/app.tsx`:

```tsx
import { $state, F } from "effectual";
import { mount } from "thamui";

import styles from "../styles/app.scss";

const App = () => {
    const count = $state(0);

    return (
        <div data-stylesheet={styles} class="page">
            <button class="btn" $on:mouseup={() => count.setValue((c) => c + 1)}>
                Clicked {count.getValue()} times
            </button>
        </div>
    );
};

mount(App);
```

Build and run:

```bash
tsc
node --import thamui/hook dist/app.js
```

## Events

Listeners are attached with the `$on:` prefix:

| Event                       | Fires when                         | Data       |
| --------------------------- | ---------------------------------- | ---------- |
| `mousedown` / `mouseup`     | mouse pressed / released over node | —          |
| `mousemove`                 | mouse moves over node              | —          |
| `mouseenter` / `mouseleave` | hover crosses node boundary        | —          |
| `keypress`                  | every key, focused node first      | `KeyEvent` |
| `change`                    | input/textarea value changed       | `string`   |

A `KeyEvent` is `{ key, ctrl, alt, raw }`. `key` is a single character for printables (`"a"`, `" "`, `"!"`), or a name for special keys (`"Enter"`, `"Tab"`, `"Escape"`, `"Backspace"`, `"ArrowUp"`, `"Home"`, `"Shift+Tab"`, …).

## Focus

Any node with `isSelectable = true` participates in focus. `button`, `input`, and `textarea` are selectable by default; to make your own selectable element, subclass `Block` and flip the flag.

- Click focuses.
- `Tab` / `Shift+Tab` traverse selectable nodes in tree order.
- `:focus` styles apply automatically while focused.
- `button`s activate on `Enter` or `Space` (fires `mousedown` + `mouseup`).

## Controlled vs. uncontrolled inputs

`<input>` and `<textarea>` work either way:

```tsx
// uncontrolled — the element's internal buffer is the source of truth
<input $on:change={(v) => console.log(v)} />

// controlled — your state is the source of truth
<input value={state.getValue()} $on:change={(v) => state.setValue(v)} />
```

The element only re-syncs its internal buffer when the incoming `value` differs from what the buffer currently holds, so the round-trip through `$on:change` → state → `value` is idempotent.

## Exit and resize

Esc, Ctrl-C, and Ctrl-\ exit the program. Resize is detected automatically and triggers a full redraw.

## License

MIT
