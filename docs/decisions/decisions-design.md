# Design Decisions

How Hearthstone looks and feels — the palette, the typography, the dark mode story, and the rules that keep the iOS app, the join page, and the admin UI feeling like the same product even though they're rendered by completely different runtimes.

## Vision

Warm and homey but not hokey. The metaphor is a hearth — fire, amber, lamplight, well-worn paper — applied with restraint. Hearthstone is a household tool, not a children's app and not enterprise SaaS, so the UI lands somewhere between a personal journal and a kitchen-counter notebook.

Three principles guide every visual decision:

1. **Warm-tinted, not gray-tinted.** Backgrounds and surfaces are slightly creamy in light mode and slightly brown in dark mode. Neutral grays read as corporate; warm grays read as domestic.
2. **Quiet, not branded.** There's no logo treatment beyond a 🏠 emoji on the join page and a fire glyph in the iOS sidebar. The product feels like *a tool you keep in your house*, not *an app from a company*.
3. **Same palette across surfaces.** The iOS app, the `/join/:pin` HTML deeplink page, and the `/admin` operator page all share the same cream/charcoal/terracotta vocabulary. They're rendered by SwiftUI, server-rendered HTML, and server-rendered HTML respectively, but a screenshot of any one of them should look obviously like the same product.

## The palette

The full color system lives in `ios/Hearthstone/Theme.swift` as a `ResolvedTheme` struct. Every color is a computed property keyed off `ColorScheme`, so light/dark variants live side by side instead of in two separate files.

### Surfaces (light → dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `cream` | `#FBF7F0` | `#1E1A16` | Page background |
| `creamWarm` | `#F5EDE0` | `#2A2420` | Card / well background |
| `creamDeep` | `#EDE3D1` | `#3D3529` | Inset / divider tint |

The light cream is genuinely cream, not eggshell white — it has a warm yellow-brown tint that's especially obvious next to true white. The dark sibling is a warm brown-black, deliberately *not* `#1a1a1a` neutral.

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `charcoal` | `#2C2520` | `#E8DFD4` | Primary text |
| `charcoalSoft` | `#5C524A` | `#B5A899` | Secondary text |
| `stone` | `#9B8E82` | `#7A7164` | Muted metadata, low-emphasis labels |

### Brand

| Token | Light | Dark | Use |
|---|---|---|---|
| `hearth` | `#B5712D` | `#C8833A` | Primary action / accent |
| `hearthDark` | `#8B5A1E` | `#B5712D` | Hover / pressed state |

The accent is amber-sienna — clearly orange but well past "tech orange." It darkens to a richer brown for pressed states. In dark mode, the accent lifts a step (the dark `hearth` is the same RGB as the light `hearthDark`) so it stays visually equivalent against the warmer dark background.

### Status

| Token | Both modes | Use |
|---|---|---|
| `sage` | `#7A8B6F` | Success / connected indicator |
| `rose` | `#C46B5A` | Errors / destructive states |

Sage and rose are constant across light/dark — only their `*Light` background tints flex with the scheme. They were picked specifically to *not* be the system green/red, which read as too saturated against the warm palette.

### Badges

Three badge variants with paired background and text colors:

| Badge | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| `goldBadge` | `#F0E5C8` | `#8B6914` | `#3A3424` | `#B59D52` |
| `greenBadge` | `#D7E8D0` | `#3D6B2E` | `#283025` | `#7A9B6F` |
| `grayBadge` | `#ECEAE7` | `#7B7570` | `#2A2826` | `#8A8480` |

Badges are pill-shaped status markers — "active," "pending," "revoked," etc. The three colors are deliberately the only badge palette. Anything that needs to read as a badge picks one of these three.

## Dark mode

Dark mode shipped in v0.2.0 (2026-04-08). The architecture:

- **`ResolvedTheme(scheme:)` resolves all colors at view time.** Every view reads `@Environment(\.colorScheme)` and constructs a `theme` computed property via `Theme.resolved(for: colorScheme)`. There's no "light theme object" and "dark theme object" to swap between — there's one struct, scheme-aware.
- **System-automatic.** The app follows the iOS system setting. No in-app toggle. *Why:* respecting the OS preference is the right default and avoids the entire "remember user choice across launches" surface for what's already a low-stakes preference.
- **Warm dark, not neutral dark.** Dark surfaces are warm browns (`#1E1A16` page background, `#2A2420` cards). Pure-gray dark mode would feel like a different product.
- **Shadows scale with mode.** `theme.shadow` is `Color.black.opacity(0.3)` in dark mode and a faint warm `rgba(44, 37, 32, 0.08)` in light. Lifted card surfaces look distinct in both modes without a hard border.

### The sidebar exception

The sidebar uses its own permanently-dark palette regardless of system scheme. `theme.sidebarBackground`, `theme.sidebarSurface`, and friends have no `scheme ==` branch — they return the same warm dark values in both modes.

This is intentional and load-bearing. The sidebar is a navigation surface that sits *behind* the content; making it stay dark gives the app a visual anchor in light mode and a depth cue in dark mode. The visual effect is "you slid the kitchen drawer open and the inside is darker than the counter."

If you find yourself wanting to make the sidebar light-mode-aware: don't. Add a new component that uses the regular palette instead.

## Typography

**Headings:** `Theme.heading(_ size: CGFloat)` returns `.system(size: size, weight: .medium, design: .serif)`. That's the iOS system serif (New York), not a custom font. The original design intent named Fraunces as the heading face, but no font asset is bundled in the project — the system-serif fallback shipped instead, and we've decided that's fine. iOS system serif is genuinely good and shipping a font would add bundle size for a marginal aesthetic gain.

**Body text:** the iOS system sans (San Francisco) at default weight. There's no `Theme.body()` helper — body text just uses SwiftUI's defaults. DM Sans was on the original mood board; like Fraunces, it never shipped.

**Monospace:** ui-monospace (SF Mono on Apple platforms) is used in the join page CSS for invite codes and copy fields. The iOS app uses default monospace in the very few places it needs it (debug-ish surfaces, mostly).

**Principle:** chrome that reads as "text" uses sans, anything that reads as "title" or "heading" uses serif. There is no custom font loading anywhere, in any surface. If a future design pass wants real Fraunces / DM Sans, the place to add them is `Theme.swift` and the assets directory; nothing else needs to change.

## Radii

Three corner radii, used consistently:

| Token | Value | Use |
|---|---|---|
| `Theme.radiusLarge` | `16` | Modal sheets, large surfaces, full-bleed cards |
| `Theme.radiusMedium` | `10` | Buttons, input fields, regular cards |
| `Theme.radiusSmall` | `6` | Pills, badges, compact controls |

Picking a fourth value is a yellow flag. If you want one, ask whether the existing three would do.

## The two product surfaces

The iOS app has *two distinct UIs* for its two roles, and they are deliberately not parallel:

### Owner

Information-dense. Multiple panels: dashboard, document list, guest list, sidebar with multi-house switcher, settings. Cards on cards, lists, modals, copy buttons. The owner is a person managing configuration; the UI shows them everything.

### Guest

A single screen: chat. Below it, source-document references when an answer cites them. Above it, the household name and (if the guest taps in) a brief documents pane. That's it. No settings, no profile, no "explore," no inbox. The guest is a person asking a question; the UI shows them what they need to ask and read.

These two UIs share the palette, the radii, the warm dark mode, and the sidebar — but the *density* of each is wildly different on purpose. Adding owner-style configuration to the guest experience would change what the product is.

## HTML surfaces

Two HTML surfaces ship from the backend. Both are server-rendered, both use inline `<style>` blocks (no external CSS, no build step), and both share the iOS palette:

### `/join/:pin` deeplink page

Lives in `backend/src/html/join-page.ts`. Single-purpose: redirect into the iOS app via the `hearthstone://join?server=...&pin=...` custom scheme. It has a 🏠 emoji, a heading, a paragraph of warm copy, and one big terracotta gradient button. The PIN itself is not displayed (no fallback for manual entry — see `decisions-tech.md` §Auth and `decisions-product.md` §What's in the box).

The page background is `#faf9f6` (cream), text is `#3d3529` (charcoal), the button is a `linear-gradient(135deg, #c97b5e, #a65a3e)` terracotta. These are slightly different hex values from the `Theme.swift` tokens because the page predates the formal palette and nobody has unified them. They read as the same color family to a human eye, which is the bar.

### `/admin` operator page

Lives in `backend/src/html/admin-page.ts`. Same palette family: cream background, charcoal text, terracotta gradient buttons, `ui-monospace` for the things that should look like data. It has a card-on-page layout, an `.info-grid` for diagnostics, modal sheets for create-house and owner-invite flows, and a `.qr-box` for rendering the join URL as a scannable QR.

The admin page is intentionally not part of the iOS-app design conversation — it doesn't need to be beautiful, it needs to be functional in two minutes from a fresh deploy. But it does need to feel like the same product, so it shares the palette.

### Why two parallel CSS implementations

Because there's no front-end build step, no shared stylesheet, and no template engine — both files are TypeScript template literals returning strings. The duplication is small (each page has maybe 50 lines of CSS), and unifying them would mean introducing a build step or a templating layer for a problem that isn't biting yet. If a third HTML surface gets added, that's the trigger to extract.

## Behavioral rules

These are constraints that apply across surfaces. When building any view, check these before reaching for a one-off treatment:

### Color usage

- Backgrounds use `theme.cream` / `theme.creamWarm` / `theme.creamDeep`. Never `Color.white`.
- Text uses `theme.charcoal` / `theme.charcoalSoft` / `theme.stone`. The choice is about emphasis: charcoal for primary, charcoalSoft for secondary, stone for low-emphasis metadata.
- The single accent is `theme.hearth`. It's used for primary action buttons and active-state highlights. It's not used for body text, never for backgrounds (that's `creamWarm`), and never for borders alone.
- Status colors are `sage` (good) and `rose` (bad). They have low-saturation `*Light` background variants for tint-fill use.

### Buttons

There are essentially three button styles in the iOS app — primary (filled `hearth`), secondary (outline `charcoalSoft`), destructive (text in `rose`). Avoid inventing a fourth. The HTML surfaces use the same conceptual tiers translated to gradient-fill / outline / text-link.

### Empty states

Empty states get warm copy ("Your journal is empty," "No guests yet," "Connect a document to get started") rather than `No items` placeholders. This is a vibe rule, not a structural one — nobody enforces it, but a generic empty state should feel slightly off when reviewed.

### Source citations

When a chat answer in the guest UI cites source chunks, the citations are tappable and link to the source document view. The citation visual treatment is `stone` muted text — a citation is information, not decoration. Hiding citations or treating them as a background detail would undermine `decisions-product.md` §Source-grounded answers.

### Sidebar gesture

The sidebar opens with a horizontal swipe from the leading edge. There's a related quirk worth knowing: SwiftUI's `NavigationStack` blocks `ignoresSafeArea` underneath it, which broke the sidebar gesture in an early version. The fix was to remove `NavigationStack` from views that don't actually need its routing features. See the `feedback_navigation_stack` memory.

