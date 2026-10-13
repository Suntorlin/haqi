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
5. **Only the radius / type scales below.** No `rounded-lg`, `rounded-[10px]`, `font-medium`, `text-[14.5px]`.
6. **Prefer less.** If a label, hint or divider adds no information, delete it (see the simplified question overlay).
7. **Dark mode is not optional.** Every screen is checked in light and dark.
8. **Behaviour-preserving refactors.** Restyling never changes logic, i18n keys or APIs.

## 2. Tokens

Single source: `web/src/index.css`. `:root` = light, `[data-theme="dark"]` = dark. Components read tokens through `var(--token)`; no per-component colour constants.

### 2.1 Colour (`--social-*` is the source of truth)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--social-surface` | `#ffffff` | `#09090b` | Page / panel background (`--app-bg` aliases it) |
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
| `--social-bar-bg` | `rgba(255,255,255,.86)` | `rgba(9,9,11,.86)` | Translucent header / tab bar (with blur) |

Status tints (soft fill + text), used by `Badge` and notices: `--app-badge-{info,success,warning,error}-{bg,text,border}`.

### 2.2 Aliases and domain tokens

- `--app-*` (`bg fg hint link border divider subtle-bg secondary-bg button button-text banner-*`) are **aliases** of `--social-*`. Kept so older components follow the theme; new code should use `--social-*`. Target: delete the aliases once nothing references them.
- Domain tokens, not part of the generic scale: `--app-code-bg`, `--app-inline-code-bg`, `--app-diff-*` (diff view), `--app-git-*` (git status colours), `--app-scrollbar-*`, `--cli-*` (terminal-style CLI messages), `--app-font-scale` (user font size, 0.8-1.2).

### 2.3 Radius (only these)

| Class | px | Use |
|---|---|---|
| `rounded-full` | pill | Buttons, chips, badges, address / search bars, avatars, switches |
| `rounded-2xl` | 16 | Cards, panels, dialogs, sheets (top corners), grouped lists |
| `rounded-xl` | 12 | Text fields, list rows, menu items, segmented-control segments |
| `rounded-md` | 8 | Tiny tags, inline code |

Only intentional exception: the single-line mobile composer input (`rounded-[22px]`) because it grows to multiple lines.

### 2.4 Type

Sizes (px): **12** captions / section titles (uppercase, tracking-wide), **13** secondary text / small buttons / chips, **15** body / list rows / default buttons, **16** page titles / inputs / question text, **20** section headings, **32** showcase hero only. Weights: **400** and **600** only (`font-semibold`). System font stack (SF / PingFang), set in `html.social-app`.

### 2.5 Spacing, size, motion

- Spacing: multiples of 4; gaps between sibling controls >= 8.
- Heights: touch min `--touch-min` 44; button 44 (sm 36, lg 48); chip 32 (hit area 44); badge 24; count badge 18; list row >= 52.
- Motion: `--motion-fast` 150ms, `--motion-base` 200ms, `--motion-ease` `cubic-bezier(.2,0,0,1)`. Press feedback `active:scale-[.98]` on buttons. No decorative animation; `animate-pulse` only for live state.

## 3. Components

All in `web/src/components/ui/` unless noted. Business pages compose these; do not hand-write `<button className="rounded-... border ...">`.

| Component | File | Use / key props |
|---|---|---|
| `Button` | `button.tsx` | `variant`: default (primary) / secondary / outline / ghost / destructive; `size`: default 44 / sm 36 / lg 48; pill. `buttonVariants()` for link-as-button. |
| `IconButton` | `IconButton.tsx` | Icon-only, `label` **required** (aria + tooltip); `variant` ghost / muted / filled; `size` default 44 / sm 36. |
| `TextField` | `TextField.tsx` | 44px, 16px. `variant` field (bordered, 12px) / pill (borderless address / search bar); `leading`, `trailing`, `invalid`. Textareas: use `DIALOG_INPUT_CLASS` (`RenameSessionDialog.tsx`). |
| `FormField`, `FieldHint`, `SelectInput`, `ChoiceChips`, `SegmentedControl`, `SuggestionChip` | `FormControls.tsx` | Caption + control + hint; native select skin; single-choice pills; 2-3 option segmented control; fill-a-field shortcuts. |
| `Chip` | `Chip.tsx` | 32px pill, `selected` = filled. Filters, choices, shortcuts. `tagChipClass()` (`tagChip.ts`) = same look for session tags. |
| `Badge` | `badge.tsx` | **State** pill (no border): default / solid / info / success / warning / destructive; `dot`, `live`. Never for actions. |
| `CountBadge`, `DotBadge` | `badge.tsx` | **Unread** (brand red). Position with `absolute -right-1 -top-1` on a `relative` parent. |
| `ListGroup`, `ListRow` | `ListRow.tsx` | iOS grouped list: rounded-2xl container, hairlines, >= 52px rows; `icon`, `title`, `subtitle`, `trailing`, `onClick` (adds chevron), `wrap`, `disabled`, `destructive`. Settings rows. |
| `Switch`, `SwitchTrack` | `Switch.tsx` | Monochrome toggle. |
| `SettingChip`, `ToggleChip` | `SettingChip.tsx` | Composer-toolbar setting that opens a sheet (phone) or menu (desktop). |
| `Dialog*`, `ConfirmDialog` | `dialog.tsx`, `ConfirmDialog.tsx` | Radix dialog; bottom sheet on phones (`.app-dialog-content`). |
| `Toast`, `Card*` | `Toast.tsx`, `card.tsx` | Transient message; plain card. |
| `BottomSheet`, `SheetSection/Row/Option/SwitchRow`, `ContextMenu` | `components/mobile/` | Phone sheets and long-press / right-click menus (>= 44px rows, scroll when tall). |
| `SubPageHeader`, `SubPageHeaderButton`, `MobileTabBar`, `SessionAvatar`, `MobileSearchField` | `components/mobile/` | Page chrome. |
| Settings helpers | `components/settings/SettingsParts.tsx` | `SettingsGroup`, `SettingsBlock`, `SettingsSelectRow`, ... built on `ListGroup` / `ListRow`. |
| `HIT_AREA_CLASS` | `components/AssistantChat/hitArea.ts` | Pad a small visual to a 44px hit area. |

Showcase: `web/design.html` + `web/src/design/DesignShowcase.tsx`. Add every new primitive there (light + dark) in the same change.

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

1. Uses primitives and tokens only (grep your diff for `#`, `-gray-`, `-red-`, `rounded-lg`, `font-medium`).
2. Phone (390px) and desktop (1200px), light and dark, screenshotted and looked at.
3. Touch targets >= 44px on phone; inputs 16px.
4. New primitive? Added to the showcase and to section 3 here.
5. `bun typecheck` and `bun run test` pass.

## 6. Where things live

- Tokens / theme: `web/src/index.css` (`:root`, `[data-theme="dark"]`, `html.social-app` font). Theme switching: `web/src/hooks/useTheme.ts` (`data-theme` on `<html>`).
- Primitives: `web/src/components/ui/`, phone chrome `web/src/components/mobile/`.
- Showcase: `web/design.html`.
- CLI (terminal) visual language is separate: `docs/cli-design-language.md`.
