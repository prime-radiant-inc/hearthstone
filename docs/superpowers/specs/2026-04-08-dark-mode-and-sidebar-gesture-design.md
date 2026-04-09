# Dark Mode & Sidebar Gesture Polish

**Date:** 2026-04-08
**Status:** Approved
**Scope:** iOS only — no backend changes

## Problem

1. The Drive file picker uses system `List` which respects iOS dark mode, but the rest of the app uses hardcoded light colors — making the app unreadable at night.
2. The sidebar swipe gesture is hard to trigger and has no visual feedback during the drag. No spring animation, narrow edge zone, no velocity awareness.

## Decisions

- **Dark mode follows system setting.** No in-app toggle. `@Environment(\.colorScheme)` drives everything.
- **Warm dark palette.** Dark browns and warm grays that match the hearth/firelight brand identity.
- **Sidebar stays dark in both modes.** Its hardcoded dark-brown palette works as-is; we just move the colors into the theme system for consistency.

---

## 1. ResolvedTheme Architecture

Replace the current static color properties on `Theme` with a `ResolvedTheme` struct that takes `ColorScheme` and returns scheme-appropriate colors.

### Current (static, light-only)

```swift
enum Theme {
    static let cream = Color(red: 0.984, green: 0.969, blue: 0.941)
    static let charcoal = Color(red: 0.173, green: 0.145, blue: 0.125)
    // ...
}
```

### New (scheme-aware)

```swift
struct ResolvedTheme {
    let scheme: ColorScheme

    var cream: Color {
        scheme == .dark
            ? Color(red: 0.118, green: 0.102, blue: 0.086)
            : Color(red: 0.984, green: 0.969, blue: 0.941)
    }
    // ... all colors as computed properties

    // Non-color properties stay static
    static func heading(size: CGFloat) -> Font { ... }
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 10
    static let radiusSmall: CGFloat = 6
}

extension Theme {
    static func resolved(for scheme: ColorScheme) -> ResolvedTheme {
        ResolvedTheme(scheme: scheme)
    }
}
```

### View adoption pattern

```swift
struct SomeView: View {
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Text("Hello")
            .foregroundColor(theme.charcoal)
            .background(theme.cream)
    }
}
```

The old `Theme.cream` static properties are removed. The compiler catches every call site.

---

## 2. Color Mapping

### Backgrounds

| Name | Light | Dark | Usage |
|---|---|---|---|
| cream | #faf7f0 | #1e1a16 | Base/page background |
| creamWarm | #f5ede0 | #2a2420 | Elevated surfaces, cards, input fields |
| creamDeep | #ede3d1 | #3d3529 | Borders, dividers, inactive states |

### Text

| Name | Light | Dark | Usage |
|---|---|---|---|
| charcoal | #2c2520 | #e8dfd4 | Primary text |
| charcoalSoft | #5c524a | #b5a899 | Secondary text |
| stone | #9b8e82 | #7a7164 | Tertiary/muted text |

### Brand

| Name | Light | Dark | Usage |
|---|---|---|---|
| hearth | #b5712d | #c8833a | Primary accent, buttons, links |
| hearthDark | #8b5a1e | #b5712d | Gradient partner for hearth |

### Status

| Name | Light | Dark | Usage |
|---|---|---|---|
| sage | #7a8b6f | #7a8b6f | Success/green accent (same both) |
| sageLight | #e8ede4 | #2d3a28 | Success badge background |
| rose | #c46b5a | #c46b5a | Error accent (same both) |
| roseLight | #f2e0dc | #3a2420 | Error badge background |

### Badges

| Name | Light | Dark | Usage |
|---|---|---|---|
| goldBadge | #f0e5c8 | #3a3424 | Warning/pending background |
| goldBadgeText | #8b6914 | #b59d52 | Warning/pending text |
| greenBadge | #d7e8d0 | #283025 | Active/success background |
| greenBadgeText | #3d6b2e | #7a9b6f | Active/success text |
| grayBadge | #eceae7 | #2a2826 | Disabled/revoked background |
| grayBadgeText | #7b7570 | #8a8480 | Disabled/revoked text |

### Sidebar (constant in both modes)

| Name | Value | Usage |
|---|---|---|
| sidebarBackground | #2b2320 | Sidebar base |
| sidebarSurface | #3d352e | Cards, button backgrounds |
| sidebarText | #d4c8ac | Primary text |
| sidebarTextMuted | #9c8f83 | Secondary text |
| sidebarAccent | #b5712d | Active indicator, accent |

### Hardcoded `.white` Replacements

All current `Color.white` usage maps to `theme.creamWarm` (elevated surface color). In light mode this is near-white; in dark mode it's the warm dark card color.

Exception: `.white` used as foreground text on `hearth`-colored buttons stays as `.white` — it's semantic "text on accent," not a background.

---

## 3. Sidebar Gesture Rewrite

### Current Issues

- **Edge zone too narrow:** `startLocation.x < 50` — 50pt is tight, especially with phone cases
- **No finger tracking:** Sidebar doesn't follow the finger during drag; it snaps open/closed
- **No spring animation:** Uses `easeOut(duration: 0.25)` — feels mechanical
- **Animation only on `isOpen` bool:** `dragOffset` changes aren't animated
- **Scroll gesture conflict:** `minimumDistance: 12` competes with content scrolling

### New Implementation

```
Edge zone:        80pt from left edge (open) / full sidebar width (close)
Minimum distance: 10pt
Tracking:         1:1 finger following via continuous dragOffset
Completion:       offset > 1/3 sidebar width OR velocity > 300pt/s
Animation:        .spring(response: 0.35, dampingFraction: 0.86)
```

### Key Changes

1. **`@GestureState` for live tracking** — `dragOffset` updates continuously during the gesture, resets automatically on cancel.

2. **Velocity-aware snap** — `predictedEndTranslation` determines completion. A fast flick from the edge opens the sidebar even if the finger only moved 30pt.

3. **Spring animation on all offset changes** — the sidebar bounces slightly at rest position, giving tactile feedback that matches Slack/Discord.

4. **`coordinateSpace: .global`** — prevents coordinate confusion from nested geometry readers.

5. **Separate open vs close gesture zones:**
   - Open: start within 80pt of left edge
   - Close: drag anywhere leftward when open (full sidebar acts as grab area)

---

## 4. Files Changed

### New/Modified

| File | Change |
|---|---|
| `Theme.swift` | Add `ResolvedTheme` struct, remove old static color properties |
| `SidebarOverlay.swift` | Rewrite gesture with spring physics and 1:1 tracking |
| `SidebarView.swift` | Replace hardcoded colors with `theme.sidebar*` properties |
| All 21 other view files | `@Environment(\.colorScheme)` + `theme` property, replace all `Theme.x` and `Color.white` |

### Not Changed

- Backend (no changes)
- No asset catalog additions (colors stay in code for single source of truth)
- No new SwiftUI files

### Total: ~24 files modified, 0 files created
