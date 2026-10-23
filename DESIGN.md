# Design

The panel borrows the look of [svelte.dev](https://svelte.dev): the tokens below come from
`packages/site-kit/src/lib/styles/tokens/*.css` in [sveltejs/svelte.dev](https://github.com/sveltejs/svelte.dev),
and the component shapes from its playground (file tabs, output tabs, console bar).

All tokens live as `--skrd-*` custom properties on `.skrd` in `src/client/ui/Panel.svelte`. Components only
read variables; a hex literal in a component is a bug.

## Units

svelte.dev sets `html { font-size: 62.5% }`, so its `rem` values assume a 10px root. The panel runs inside
someone else's app, so every value here is converted to **px**: `1.3rem` → 13px, `0.4rem` → 4px.

## Type

| Role | svelte.dev token | Panel |
| --- | --- | --- |
| UI chrome: tabs, buttons, chips, labels | `--sk-font-ui-small` | `13px/1.5 var(--skrd-font-ui)` |
| Data: calls, values, signatures, URLs | `--sk-font-mono` | `12px/1.6 var(--skrd-font-mono)` (default for the panel) |
| Small labels (badges, counters) | none | 11px UI font |

- `--skrd-font-ui`: `'Fira Sans', -apple-system, system-ui, sans-serif`
- `--skrd-font-mono`: `'Fira Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

svelte.dev self-hosts Fira. The panel ships no fonts, so it renders in Fira only where the host app or the OS
has it, and falls back to the system UI and mono fonts elsewhere. That is deliberate: no font dependency.

Bold is used sparingly: function names and the page path. svelte.dev sets `strong` to 400; the panel keeps 600
for names because they anchor each row.

## Colour

Light is the default. Dark follows `prefers-color-scheme: dark`, using svelte.dev's dark palette with hue 220.

| Role | Variable | Light | Dark |
| --- | --- | --- | --- |
| Panel background | `--skrd-bg` | `--sk-bg-1` hsl(0 0% 100%) | `--sk-bg-1` hsl(220 10% 12%) |
| Toolbars, sunken areas | `--skrd-toolbar-bg` | `--sk-bg-3` hsl(0 0% 98.2%) | `--sk-bg-2` hsl(220 12% 14%) |
| Code, detail panes | `--skrd-code-bg` / `--skrd-detail-bg` | `--sk-bg-2` | `--sk-bg-0` hsl(220 8% 10%) |
| Hover, chips | `--skrd-hover` / `--skrd-chip` | `--sk-bg-4` hsl(0 0% 95%) | `--sk-bg-4` hsl(220 15% 21%) |
| Borders (all of them) | `--skrd-line` | `--sk-border` hsl(0 0% 92%) | `--sk-border` hsl(220 15% 22%) |
| Headings, names | `--skrd-fg-strong` | `--sk-fg-1` | `--sk-fg-1` |
| Body text | `--skrd-fg` | `--sk-fg-2` | `--sk-fg-2` |
| Secondary text | `--skrd-muted` | `--sk-fg-3` | `--sk-fg-3` |
| Faded text, comments | `--skrd-dim` | `--sk-fg-4` | `--sk-fg-4` |
| Accent: active tab, focus, writes | `--skrd-accent` | `--sk-fg-accent` hsl(12 93% 43%) | hsl(12 94% 62%) |
| Reads (queries), links | `--skrd-blue` | `--shiki-token-keyword` hsl(204 100% 38%) | hsl(204 88% 65%) |
| Strings | `--skrd-str` | `--shiki-token-string` hsl(30 100% 30%) | hsl(41 37% 68%) |
| Numbers | `--skrd-num` | `--shiki-token-function` (accent) | hsl(19 67% 75%) |
| Dates, special values | `--skrd-date` | `--skrd-blue` | `--skrd-blue` |

svelte.dev has no status colours, so these are added in the same low-saturation spirit:
`--skrd-ok` green, `--skrd-bad` red, `--skrd-warn` amber (see `Panel.svelte`).

The accent is the Svelte orange. Use it for state (the active tab, focus rings, "write" kinds), never as a
large fill. Queries are blue and commands/forms orange, so reads and writes separate at a glance.

## Shape

- Radius: 4px (`--sk-border-radius`) for buttons, inputs and the panel; 2px (`--sk-border-radius-inner`) for
  badges inside rows. Pills (999px) only for the floating toggle, like svelte.dev's search box.
- Borders: 1px `--skrd-line`. No inner shadows, no gradients.
- Shadow: one soft shadow on the floating panel only (`--sk-shadow`: 0 0 14px rgba(0 0 0 / 0.1); darker in
  dark mode). Nothing inside the panel casts a shadow.

## Components

- **Tabs** (like the playground's "Result / JS output"): UI font, no background, text `--skrd-fg`. The
  active tab gets a 1px `--skrd-accent` bottom border. Hover changes only the text colour.
- **Buttons**: transparent, 1px border, 4px radius, `3px 8px` padding, `--skrd-muted` text, UPPERCASE in
  the UI font (playground "CLEAR" / "CONSOLE"). A primary button uses the accent as its text and border
  colour, not as a fill.
- **Chips / filters**: UI font, 4px radius, `--skrd-chip` background; the selected one gets an accent border.
- **Kind badges** (`query`, `command`, …): mono 10px, outlined in currentColor, blue for reads, accent for
  writes, `--skrd-muted` for prerender.
- **Inputs**: `--skrd-code-bg` background, 1px border, 4px radius; focus is a 1px accent outline.
- **Rows**: mono, separated by 1px `--skrd-line`; hover is `--skrd-hover`. No zebra stripes.
- **Focus**: every focusable element shows a visible accent outline (`:focus-visible`), as on svelte.dev.

## Don't

- No emoji or icon fonts as branding. The tab labels are the brand.
- No neon palettes (the old Tokyo Night theme), no glow, no gradient fills.
- No hard-coded colours in components: add a variable in `Panel.svelte` and document it here.
