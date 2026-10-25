# HAQI Web Design System

Single entry for how the web app should look and behave. Read this before adding or restyling UI.
Live preview of every primitive (light/dark): `bun run dev` then open `/design.html` (`?theme=dark`).

Telegraph style: rules first, reasons after.

## 1. Principles

**Visual = Instagram. Interaction = Apple HIG.** Neither is copied; each owns one layer.

| Layer | Source | Rules |
|---|---|---|
| Look | Instagram | Monochrome zinc palette; pills and big radii; whitespace over borders; flat (no heavy shadows); brand red only for unread / live |
| Behaviour | Apple HIG | 44px touch targets; 16px input text; 8px minimum spacing; clear hierarchy (one primary action per view); 150-200ms ease-out motion, honour `prefers-reduced-motion` |

Concrete rules:

1. **One primary action per view.** Exactly one filled (black/white) button; everything else secondary / ghost.
2. **44px on phones.** Every tappable target has a >= 44px hit area. Glyph may be smaller: use `IconButton` (44) or pad the hit area (`after:` pseudo-element, see `AssistantChat/hitArea.ts`). Dense desktop toolbars may use `size="sm"` (36).
3. **Inputs are 16px.** Smaller makes iOS Safari zoom the page on focus.
4. **Only the tokens below.** No raw `#hex`, no `bg-red-500` / `text-gray-600`. Need a new colour -> add a token first.
5. **Only the radius / type scales below.** No `rounded-lg`, `rounded-[10px]`, `font-medium`, `text-[13px]` (use `text-footnote`).
6. **Prefer less.** If a label, hint or divider adds no information, delete it (see the simplified question overlay).
7. **Dark mode is not optional.** Every screen is checked in light and dark.
8. **Behaviour-preserving refactors.** Restyling never changes logic, i18n keys or APIs.
9. **No visible scrollbars.** Every pane still scrolls (wheel, trackpad, touch, keyboard), but no scrollbar is ever drawn. A global rule in `web/src/index.css` hides them (`scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`; Chrome 121+ needs both). Never re-enable one for a single pane; if position matters, show it in the content (e.g. a jump-to-latest button).

## 2. Tokens

Single source: `web/src/index.css`. `:root` = light, `[data-theme="dark"]` = dark. Components read tokens through `var(--token)`; no per-component colour constants.

### 2.1 Colour (`--social-*` is the source of truth)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--social-surface` | `#ffffff` | `#09090b` | Page / panel background |
| `--social-muted` | `#f4f4f5` | `#1c1c1f` | Secondary fill: pill inputs, segmented track, secondary buttons |
| `--social-hover` | `#f8f8f9` | `#141416` | Hover / grouped-list background |
| `--social-border` | `#e4e4e7` | `#27272a` | Borders, outlines |
| `--social-divider` | `#f0f0f2` | `#1c1c1f` | Hairlines between rows |
| `--social-fg` | `#09090b` | `#fafafa` | Primary text |
| `--social-fg-muted` | `#71717a` | `#a1a1aa` | Secondary text, inactive icons |
| `--social-fg-subtle` | `#a1a1aa` | `#71717a` | Placeholders, tertiary icons |
| `--social-primary` / `-fg` | `#18181b` / `#fafafa` | `#fafafa` / `#09090b` | Filled primary button and its text |
| `--social-badge` | `#ff3040` | `#ff3040` | Unread / live / recording (brand red) |
| `--social-danger` | `#e5484d` | `#ff6369` | Destructive actions, errors |
| `--social-success` | `#10b981` | `#34d399` | Success |
| `--social-warning` | `#f59e0b` | `#fbbf24` | Warning |
| `--social-on-accent` | `#ffffff` | `#ffffff` | Text / icon on solid danger, warning, badge fills and the switch knob (never write `text-white`) |
| `--social-bar-bg` | `rgba(255,255,255,.86)` | `rgba(9,9,11,.86)` | Translucent header / tab bar (with blur) |

Status tints (soft fill + text), used by `Badge` and notices: `--app-badge-{info,success,warning,error}-{bg,text,border}` (domain tokens, kept under the `--app-` prefix).

### 2.2 Aliases and domain tokens

- The old `--app-*` aliases (`bg fg hint link border divider subtle-bg secondary-bg button banner-*`) are **removed**. Use `--social-*` only. If JS reads a token (e.g. the terminal theme) read the `--social-*` name.
- Domain tokens, not part of the generic scale: `--app-code-bg`, `--app-inline-code-bg`, `--app-diff-*` (diff view), `--app-git-*` (git status colours), `--cli-*` (terminal-style CLI messages), `--app-font-scale` (user font size, 0.8-1.2). `--app-scrollbar-*` and the `app-scrollbar` class are leftovers: scrollbars are hidden everywhere (rule 9), so they draw nothing.

### 2.2b Shadows, scrims, avatars, file types

Flat by default: cards, bubbles and tool cards have **no shadow**. Only floating things get one, always via token:

| Token | Use |
|---|---|
| `--shadow-raised` | Small raised thing: switch knob, selected segment |
| `--shadow-card` | Composer card (very soft) |
| `--shadow-float` | Menus, popovers, toasts, dialogs, overlays, install prompt (`shadow-[var(--shadow-float)]`) |
| `--shadow-sheet` / `--shadow-panel` | Bottom sheet / right-hand panel |
| `--scrim-soft` / `--scrim` / `--scrim-strong` | Dim layers behind dialogs and sheets, and the gradient on image captions (never `bg-black/50`) |

Illustration palettes are tokens too: `--orb-<family>-<slot>` (18 avatar orb families, 4 colours each), `--orb-shade/edge/sheen/glaze-*/gloss` (orb lighting), `--ring-live` / `--ring-pending` (story rings), `--filetype-<ext>` (file-icon accents). Add a colour here, not as a hex in a component.

Allowed raw colours (documented exceptions): xterm fallback colours in `Terminal/TerminalView.tsx` (xterm needs real colour strings when the token cannot be read) and the rainbow keyframes of the ultrathink highlight (`LazyRainbowText`) in `index.css`.

### 2.3 Radius (only these)

| Class | px | Use |
|---|---|---|
| `rounded-full` | pill | Buttons, chips, badges, address / search bars, avatars, switches |
| `rounded-2xl` | 16 | Cards, panels, dialogs, sheets (top corners), grouped lists |
| `rounded-xl` | 12 | Text fields, list rows, menu items, segmented-control segments |
| `rounded-md` | 8 | Tiny tags, inline code |

Intentional exceptions: the single-line mobile composer input (`rounded-[22px]`, it grows to multiple lines) and chat-bubble tail corners (`rounded-br-md` / `rounded-tl-md`). Bare `rounded` is not used (write `rounded-md`).

**Press / hover highlight must sit inside a rounded shape.** A row inside a `ListGroup` is clipped by the group. A standalone full-width row (e.g. a settings section header using `social-pressable`) must be inset and rounded itself (`mx-2 w-[calc(100%-1rem)] rounded-2xl`), otherwise the highlight shows as a square band next to rounded cards.

### 2.4 Type

Use the named sizes only. They are rem, so every size follows the font-size setting (`--app-font-scale` sets the `html` font size). A px size (`text-[13px]`) ignores that setting, and a rem size multiplied by the scale again (`calc(1rem * var(--app-font-scale))`) applies it twice: don't write either.

| Class | px at 100% | Use |
|---|---|---|
| `text-caption` | 12 | Captions, section titles (uppercase, tracking-wide) |
| `text-footnote` | 13 | Secondary text, small buttons, chips |
| `text-body` | 15 | Body, list rows, default buttons |
| `text-headline` | 16 | Page titles, inputs, question text |
| `text-title` | 20 | Section headings |
| `text-display` | 32 | Showcase hero only |

Defined in `web/tailwind.config.ts` (`theme.extend.fontSize`). `cn()` (`web/src/lib/utils.ts`) teaches tailwind-merge these names; without that, `text-footnote` reads as a colour and drops `text-[var(--…)]`. Add a new size in both places. Tailwind's own `text-xs` (12) and `text-base` (16) are on the scale and allowed in existing code; prefer the names in new code.

Weights: **400** and **600** only (`font-semibold`). System font stack (SF / PingFang), set in `html.social-app`.

### 2.5 Spacing, size, motion

- Spacing: multiples of 4; gaps between sibling controls >= 8.
- Heights: touch min `--touch-min` 44; button 44 (sm 36, lg 48); chip 32 (hit area 44); badge 24; count badge 18; list row >= 52.
- Motion: `--motion-fast` 150ms, `--motion-base` 200ms, `--motion-ease` `cubic-bezier(.2,0,0,1)`. Press feedback `active:scale-[.98]` on buttons. No decorative animation; `animate-pulse` only for live state. Exception: surfaces that travel across the screen take longer — bottom sheet `animate-sheet-up` 280ms, side panel `animate-panel-in` 260ms. Menus and popovers use `animate-menu-pop` (180ms).

## 3. Components

All in `web/src/components/ui/` unless noted. Business pages compose these; do not hand-write `<button className="rounded-... border ...">`.

| Component | File | Use / key props |
|---|---|---|
| `Button` | `button.tsx` | `variant`: default (primary) / secondary / outline / ghost / destructive; `size`: default 44 / sm 36 / lg 48 / xs 28 (keeps a 44px hit area); pill. `buttonVariants()` for link-as-button. |
| `IconButton` | `IconButton.tsx` | Icon-only, `label` **required** (aria + tooltip); `variant` ghost / muted / filled; `size` default 44 / sm 36 / xs 28 (code blocks, attachments, card headers; keeps a 44px hit area). Never shrink it with `h-6`/`h-7`. |
| `TextField` | `TextField.tsx` | 44px, 16px. `variant` field (bordered, 12px) / pill (borderless address / search bar); `leading`, `trailing`, `invalid`. Textareas: use `DIALOG_INPUT_CLASS` (`RenameSessionDialog.tsx`). |
| `AutoTextarea` | `AutoTextarea.tsx` | Multi-line field that grows with its text (`minRows`, `maxRows`), dialog-field look. Enter is a new line; submit with a button or `onSubmitKey` (Cmd/Ctrl+Enter). New-task text and edits on a task card. |
| `FormField`, `FieldHint`, `SelectInput`, `ChoiceChips`, `SegmentedControl` | `FormControls.tsx` | Caption + control + hint; native select skin; single-choice pills; 2-3 option segmented control. |
| `Chip` | `Chip.tsx` | 32px pill, `selected` = filled. Filters, choices, shortcuts. `size="sm"` (24px, `text-caption`, 44px hit area) for a chip inside a line of text. `tagChipClass()` (`tagChip.ts`) = same look for session tags. |
| `Badge` | `badge.tsx` | **State** pill (no border): default / solid / info / success / warning / destructive; `dot`, `live`. Never for actions. |
| `CountBadge`, `DotBadge` | `badge.tsx` | **Unread** (brand red). Position with `absolute -right-1 -top-1` on a `relative` parent. |
| `FitText` | `FitText.tsx` | Text that may not fit. `kind`: `value` (wraps, never cut: email, path, model in a key-value row), `title` (up to `lines`, default 2), `label` (narrow caption: `candidates` long -> short, shows the longest that fits), `id` (one line, cut in the middle: `~/dev/…/fish`), `preview` (clamped; the full text is one tap away). Full text is the hover title when cut. `ListRow` titles and `SheetRow` values already use it. `FitLine` (same file): a heading or caption that may be any node, in 1-2 lines; a string fits as a label with `candidates`. |
| `ListGroup`, `ListRow` | `ListRow.tsx` | iOS grouped list: rounded-2xl container, hairlines, >= 52px rows; `icon`, `title`, `subtitle`, `trailing`, `onClick` (adds chevron), `wrap`, `disabled`, `destructive`. Settings rows.; `className` for a row outside a group. |
| `FeedRow` | `FeedRow.tsx` | Avatar + title (two lines) + one preview line: the session, group, loop and scheduled-task lists. `aside` (time, badges right of the title), `status` (start of the second line), `subtitle` (string), `end` (progress). Takes button props (`onClick`, long-press handlers, `aria-current`). |
| `CheckRow` | `CheckRow.tsx` | A row the user ticks on or off: 44px checkbox, text, optional `subtitle` and `tag` (a source `Badge`), and with `onEdit` a pencil `IconButton` on the right. Unticked stays visible, struck through. Acceptance criteria on a task card. |
| `Switch`, `SwitchTrack` | `Switch.tsx` | Monochrome toggle. |
| `SettingChip`, `ToggleChip` | `SettingChip.tsx` | Composer-toolbar setting that opens a sheet (phone) or menu (desktop). |
| `SwitchChip` | `SettingChip.tsx` | Two-state setting shown as its value; one tap flips it (send mode: direct / queue). |
| `Dialog*`, `ConfirmDialog` | `dialog.tsx`, `ConfirmDialog.tsx` | Radix dialog; bottom sheet on phones (`.app-dialog-content`). |
| `Toast` | `Toast.tsx` | Transient message. |
| `Card*` | `card.tsx` | The only card: `rounded-2xl`, `border-[var(--social-border)]`, `bg-[var(--social-surface)]`, no shadow. Grouped settings lists use `ListGroup`; chat bubbles use `.social-bubble-self` / `.social-bubble-other` (`index.css`). |
| `EmptyState` | `EmptyState.tsx` | Every empty list or pane. `variant` `inline` (default: one muted `text-footnote` line inside a list) or `page` (centred: `illustration`, `title`, `subtitle`, one primary `action` or custom `children`). Don't hand-write "No … yet" text. |
| `Spinner` | `components/Spinner.tsx` | The only loading indicator. `size` xs 12 / sm 16 / md 20 / lg 24; `label={null}` when decorative. Don't hand-write `animate-spin rounded-full border`. |
| Icons | `components/mobile/icons.tsx` | The only icon set. Same action = same icon everywhere (archive = `ArchiveBoxIcon`, close = `CloseIcon`, check = `CheckIcon`). Collapsible groups and trees use `DisclosureIcon`. Add a missing icon here, never a local `function XIcon()` in a component. |
| `BottomSheet`, `SheetSection/Row/Option/SwitchRow`, `ContextMenu` | `components/mobile/` | Phone sheets and long-press / right-click menus (>= 44px rows, scroll when tall). `SheetOption multiple` = checkbox row. `CONTEXT_MENU_SURFACE` + `ContextMenuItem` is the one popover/menu look, also for autocomplete and the language switcher (`active` = keyboard highlight, `wrapDescription` = two-line hint). |
| `ActionTile` | `components/mobile/ActionTile.tsx` | Icon-over-label tile for quick actions (session info card, composer "+" panel); `badge` for a count. |
| `OptionRow` | `components/ToolCard/OptionRow.tsx` | Answer option in question / user-input prompts; `mode` single / multi. |
| `InputHistory` | `ui/InputHistory.tsx` | Chevron on a text input that opens its history (recent paths, preview URLs) as a dropdown. Built on `CONTEXT_MENU_SURFACE` + `ContextMenuItem` (`components/mobile/ContextMenu.tsx`), the same surface and rows as menus. Never a row of chips. |
| `.social-float-card`, `BottomSheet popoverAnchor` | `index.css`, `components/mobile/BottomSheet.tsx` | Opaque floating card anchored under a button (desktop session info). Phones keep the sheet. No frosted glass: content behind it hurts reading. |
| `SessionDockLayout`, `useSessionDock` | `components/`, `hooks/` | Desktop: terminal / preview docked left or right of the chat, resizable, open on the right by default. |
| `SubPageHeader`, `SubPageHeaderButton`, `MobileTabBar`, `SessionAvatar`, `MobileSearchField` | `components/mobile/` | Page chrome. Full-screen detail pages on phones (tool card, turn details) use `SubPageHeader` too; never draw a custom back row. Chat, group and loop pages on phones use it with `avatar`, `onTitleClick` (opens the info) and `titleCandidates` (one-line title). |
| Settings helpers | `components/settings/SettingsParts.tsx` | `SettingsGroup`, `SettingsBlock`, `SettingsSelectRow`, ... built on `ListGroup` / `ListRow`. |
| Report kit | `components/report/` | The lead's live report: `ReportSummary` + `StatTiles` (conclusion first), `DecisionCard` / `DecisionPeek` / `DecisionConfirmation` (options with upside / cost, one primary answer), `ProgressList` (ring orb + one-line status per goal), `Checklist` (acceptance checks, live rows open detail), `RiskNotice`, `SectionCaption`, `LeadComposer` (latest message + pill input), `VerdictBar` (approve / needs changes), `ProgressOrb`, `CheckRing`. Presentational: business passes data; fixed labels via `report.*` i18n keys. |
| `HIT_AREA_CLASS`, `TEXT_HIT_AREA_CLASS` | `components/AssistantChat/hitArea.ts` | Pad a small visual to a 44px hit area. For a 28px button use `size="xs"` instead. |

Showcase: `web/design.html` + `web/src/design/DesignShowcase.tsx`. Add every new primitive there (light + dark) in the same change.

## 3b. Text that does not fit

Cutting the end off is the last resort. Decide by what the text is:

| Kind | Example | Do |
|---|---|---|
| `value` | account email, machine, model, directory | wrap; never cut |
| `title` | session title in a list | two lines (measured: 7 of 9 cut titles at 390px fit in two) |
| `label` | caption under a pinned avatar (56px) | pass shorter forms: `getSessionLabelCandidates(session)` (title, title without its leading tag, the agent's `short_title`; never the project folder, it names every session of a project the same) |
| `id` | path, email, id on one line | cut the middle so both ends stay |
| `preview` | last message under a title | cut; opening it shows all |

A native `<select>` cuts its label: `SelectInput` already shows the chosen option as wrapping text with the select invisible over it; a select outside a form does the same (`SessionHeader` account row).
`truncate` / `line-clamp-*` (or a `truncate()` helper) anywhere but `FitText.tsx` fail `src/lib/textFit.guard.test.ts`. There are none left; keep it that way.

## 4. Do / don't

| Do | Don't |
|---|---|
| `<Button>` / `<IconButton label=...>` | `<button className="rounded-lg border px-3 py-1 ...">` |
| `text-[var(--social-fg-muted)]` | `text-gray-500`, `#71717a` |
| `Badge` for state, `CountBadge` for unread | tinted bordered divs, hand-drawn red dots |
| `rounded-2xl` card, `rounded-xl` input | `rounded-lg`, `rounded-[10px]` |
| `font-semibold` for emphasis | `font-medium`, `font-bold` |
| One filled button per view | Two competing primary buttons |
| Icon-only action with `label` | Icon-only action without an accessible name |
| Delete the extra helper text | Titles, descriptions and hints that repeat the obvious |

## 5. Checklist for a UI change

1. Uses primitives and tokens only (grep your diff for `#`, `-gray-`, `-red-`, `rounded-lg`, `font-medium`, `text-[`…`px]`).
1b. No scrollbar re-enabled (grep your diff for `scrollbar-width`, `scrollbar-gutter`, `::-webkit-scrollbar`).
2. Phone (390px) and desktop (1200px), light and dark, screenshotted and looked at.
3. Touch targets >= 44px on phone; inputs 16px.
4. New primitive? Added to the showcase and to section 3 here.
5. `bun typecheck` and `bun run test` pass.

## 6. Where things live

- Tokens / theme: `web/src/index.css` (`:root`, `[data-theme="dark"]`, `html.social-app` font). Theme switching: `web/src/hooks/useTheme.ts` (`data-theme` on `<html>`).
- Primitives: `web/src/components/ui/`, phone chrome `web/src/components/mobile/`.
- Showcase: `web/design.html`.
- CLI (terminal) visual language is separate: `docs/cli-design-language.md`.
