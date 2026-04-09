# Dark Mode & Sidebar Gesture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add system-automatic dark mode with a warm dark palette, and rewrite the sidebar swipe gesture for 1:1 finger tracking with spring physics.

**Architecture:** Replace the static `Theme` enum colors with a `ResolvedTheme` struct that reads `ColorScheme`. Every view gets `@Environment(\.colorScheme)` and a `theme` computed property. The sidebar overlay gesture is rewritten with `@GestureState` for continuous tracking and `.spring()` animation.

**Tech Stack:** SwiftUI, iOS 17+

---

### Task 1: Create ResolvedTheme

**Files:**
- Modify: `ios/Hearthstone/Theme.swift`

- [ ] **Step 1: Replace Theme.swift with ResolvedTheme**

Replace the entire contents of `Theme.swift` with:

```swift
// Theme.swift
// Hearthstone
//
// Warm amber/sienna design system — light and dark mode

import SwiftUI

struct ResolvedTheme {
    let scheme: ColorScheme

    // MARK: - Backgrounds

    var cream: Color {
        scheme == .dark
            ? Color(red: 30/255, green: 26/255, blue: 22/255)
            : Color(red: 251/255, green: 247/255, blue: 240/255)
    }

    var creamWarm: Color {
        scheme == .dark
            ? Color(red: 42/255, green: 36/255, blue: 32/255)
            : Color(red: 245/255, green: 237/255, blue: 224/255)
    }

    var creamDeep: Color {
        scheme == .dark
            ? Color(red: 61/255, green: 53/255, blue: 41/255)
            : Color(red: 237/255, green: 227/255, blue: 209/255)
    }

    // MARK: - Text

    var charcoal: Color {
        scheme == .dark
            ? Color(red: 232/255, green: 223/255, blue: 212/255)
            : Color(red: 44/255, green: 37/255, blue: 32/255)
    }

    var charcoalSoft: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 168/255, blue: 153/255)
            : Color(red: 92/255, green: 82/255, blue: 74/255)
    }

    var stone: Color {
        scheme == .dark
            ? Color(red: 122/255, green: 113/255, blue: 100/255)
            : Color(red: 155/255, green: 142/255, blue: 130/255)
    }

    // MARK: - Brand

    var hearth: Color {
        scheme == .dark
            ? Color(red: 200/255, green: 131/255, blue: 58/255)
            : Color(red: 181/255, green: 113/255, blue: 45/255)
    }

    var hearthDark: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 113/255, blue: 45/255)
            : Color(red: 139/255, green: 90/255, blue: 30/255)
    }

    // MARK: - Status

    var sage: Color {
        Color(red: 122/255, green: 139/255, blue: 111/255)
    }

    var sageLight: Color {
        scheme == .dark
            ? Color(red: 45/255, green: 58/255, blue: 40/255)
            : Color(red: 232/255, green: 237/255, blue: 228/255)
    }

    var rose: Color {
        Color(red: 196/255, green: 107/255, blue: 90/255)
    }

    var roseLight: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 36/255, blue: 32/255)
            : Color(red: 242/255, green: 224/255, blue: 220/255)
    }

    // MARK: - Badges

    var goldBadge: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 52/255, blue: 36/255)
            : Color(red: 240/255, green: 229/255, blue: 200/255)
    }

    var goldBadgeText: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 157/255, blue: 82/255)
            : Color(red: 139/255, green: 105/255, blue: 20/255)
    }

    var greenBadge: Color {
        scheme == .dark
            ? Color(red: 40/255, green: 48/255, blue: 37/255)
            : Color(red: 215/255, green: 232/255, blue: 208/255)
    }

    var greenBadgeText: Color {
        scheme == .dark
            ? Color(red: 122/255, green: 155/255, blue: 111/255)
            : Color(red: 61/255, green: 107/255, blue: 46/255)
    }

    var grayBadge: Color {
        scheme == .dark
            ? Color(red: 42/255, green: 40/255, blue: 38/255)
            : Color(red: 236/255, green: 234/255, blue: 231/255)
    }

    var grayBadgeText: Color {
        scheme == .dark
            ? Color(red: 138/255, green: 132/255, blue: 128/255)
            : Color(red: 123/255, green: 117/255, blue: 112/255)
    }

    // MARK: - Sidebar (constant dark in both modes)

    var sidebarBackground: Color {
        Color(red: 0.17, green: 0.14, blue: 0.13)
    }

    var sidebarSurface: Color {
        Color(red: 0.24, green: 0.20, blue: 0.18)
    }

    var sidebarText: Color {
        Color(red: 0.94, green: 0.90, blue: 0.83)
    }

    var sidebarTextMuted: Color {
        Color(red: 0.61, green: 0.56, blue: 0.51)
    }

    var sidebarTextInactive: Color {
        Color(red: 0.83, green: 0.77, blue: 0.66)
    }

    var sidebarAccent: Color {
        Color(red: 0.71, green: 0.44, blue: 0.18)
    }

    var sidebarDivider: Color {
        Color(red: 0.24, green: 0.20, blue: 0.18)
    }

    // MARK: - Derived convenience colors

    /// For icon backgrounds in manage section (warm tint)
    var iconBackgroundWarm: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 48/255, blue: 36/255)
            : Color(red: 255/255, green: 243/255, blue: 220/255)
    }

    /// For icon backgrounds (cool/purple tint)
    var iconBackgroundCool: Color {
        scheme == .dark
            ? Color(red: 45/255, green: 40/255, blue: 55/255)
            : Color(red: 232/255, green: 227/255, blue: 240/255)
    }

    /// Onboarding checklist gradient
    var onboardingGradientStart: Color {
        scheme == .dark ? goldBadge : Color(red: 1.0, green: 0.988, blue: 0.945)
    }

    var onboardingGradientEnd: Color {
        scheme == .dark ? goldBadge : Color(red: 1.0, green: 0.973, blue: 0.902)
    }

    /// Connected banner gradient
    var connectedBannerStart: Color {
        scheme == .dark ? goldBadge : Color(red: 1, green: 0.99, blue: 0.95)
    }

    var connectedBannerEnd: Color {
        scheme == .dark ? goldBadge : Color(red: 1, green: 0.97, blue: 0.9)
    }

    /// Preview banner gradient
    var previewBannerStart: Color {
        Color(red: 92/255, green: 82/255, blue: 74/255)
    }

    var previewBannerEnd: Color {
        Color(red: 61/255, green: 53/255, blue: 48/255)
    }

    /// Revoked header gradient
    var revokedHeaderStart: Color {
        Color(red: 139/255, green: 123/255, blue: 107/255)
    }

    var revokedHeaderEnd: Color {
        Color(red: 107/255, green: 93/255, blue: 80/255)
    }

    /// Revoked icon circle background
    var revokedIconCircle: Color {
        scheme == .dark
            ? Color(red: 50/255, green: 47/255, blue: 45/255)
            : Color(red: 240/255, green: 237/255, blue: 237/255)
    }

    /// Shadow color based on scheme
    var shadow: Color {
        scheme == .dark
            ? Color.black.opacity(0.3)
            : Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.08)
    }

    var shadowLight: Color {
        scheme == .dark
            ? Color.black.opacity(0.2)
            : Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.06)
    }
}

// MARK: - Theme namespace (static utilities + resolver)

enum Theme {
    static func resolved(for scheme: ColorScheme) -> ResolvedTheme {
        ResolvedTheme(scheme: scheme)
    }

    // Typography — system serif as Fraunces fallback
    static func heading(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .serif)
    }

    // Radii
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 10
    static let radiusSmall: CGFloat = 6
}
```

- [ ] **Step 2: Build to see all compile errors**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | grep "error:"`

Expected: Many errors like `Type 'Theme' has no member 'cream'` — one per usage of the old static colors. This confirms every call site needs updating, and nothing was missed.

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Theme.swift
git commit -m "refactor(theme): replace static colors with ResolvedTheme for dark mode"
```

---

### Task 2: Rewrite Sidebar Gesture

**Files:**
- Modify: `ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift`

- [ ] **Step 1: Replace SidebarOverlay with spring-physics gesture**

Replace the entire contents of `SidebarOverlay.swift` with:

```swift
import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    @State private var isOpen = false
    @GestureState private var dragOffset: CGFloat = 0

    private let sidebarWidth: CGFloat = 260
    private let edgeZone: CGFloat = 80

    var body: some View {
        GeometryReader { _ in
            ZStack(alignment: .leading) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if isOpen || dragOffset != 0 {
                    Color.black
                        .opacity(overlayOpacity)
                        .ignoresSafeArea()
                        .onTapGesture { close() }
                }

                HStack(spacing: 0) {
                    SidebarView(router: router, onClose: { close() })
                        .frame(width: sidebarWidth)

                    Spacer(minLength: 0)
                }
                .offset(x: currentOffset - sidebarWidth)
            }
            .gesture(
                DragGesture(minimumDistance: 10, coordinateSpace: .global)
                    .updating($dragOffset) { value, state, _ in
                        if isOpen {
                            // Closing: drag left from open position
                            let drag = min(0, value.translation.width)
                            state = sidebarWidth + drag
                        } else if value.startLocation.x < edgeZone {
                            // Opening: drag right from left edge
                            state = max(0, min(sidebarWidth, value.translation.width))
                        }
                    }
                    .onEnded { value in
                        let velocity = value.predictedEndTranslation.width - value.translation.width
                        if isOpen {
                            // Close if dragged far enough left or flicked left
                            if value.translation.width < -80 || velocity < -300 {
                                close()
                            }
                            // Otherwise stays open (isOpen remains true, dragOffset resets to 0)
                        } else if value.startLocation.x < edgeZone {
                            // Open if dragged far enough or flicked right
                            if dragOffset > sidebarWidth / 3 || velocity > 300 {
                                open()
                            }
                            // Otherwise stays closed (dragOffset resets to 0)
                        }
                    }
            )
            .animation(.spring(response: 0.35, dampingFraction: 0.86), value: isOpen)
            .animation(.spring(response: 0.35, dampingFraction: 0.86), value: dragOffset)
        }
    }

    private var currentOffset: CGFloat {
        if dragOffset != 0 {
            return dragOffset
        }
        return isOpen ? sidebarWidth : 0
    }

    private var overlayOpacity: Double {
        Double(currentOffset / sidebarWidth) * 0.4
    }

    private func open() {
        isOpen = true
    }

    private func close() {
        isOpen = false
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift
git commit -m "fix(sidebar): rewrite gesture with 1:1 tracking, spring physics, wider edge zone"
```

---

### Task 3: Migrate SidebarView to ResolvedTheme

**Files:**
- Modify: `ios/Hearthstone/Views/Sidebar/SidebarView.swift`

- [ ] **Step 1: Add environment and replace hardcoded colors**

Replace the entire contents of `SidebarView.swift` with:

```swift
import SwiftUI

struct SidebarView: View {
    @ObservedObject var router: AppRouter
    let onClose: () -> Void
    @State private var showPINEntry = false

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    private var store: SessionStore { router.store }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("YOUR HOUSES")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(theme.sidebarTextMuted)
                .kerning(1)
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)

            List {
                ForEach(store.sessions) { session in
                    HouseRow(
                        session: session,
                        isActive: session.id == store.activeSessionId,
                        onTap: {
                            store.switchTo(id: session.id)
                            router.syncState()
                            onClose()
                        }
                    )
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            store.remove(id: session.id)
                            router.syncState()
                            if store.sessions.isEmpty {
                                onClose()
                            }
                        } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 3, leading: 12, bottom: 3, trailing: 12))
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)

            Divider()
                .background(theme.sidebarDivider)
                .padding(.vertical, 8)

            Button {
                showPINEntry = true
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Enter PIN")
                        .fontWeight(.semibold)
                }
                .font(.system(size: 14))
                .foregroundColor(theme.sidebarAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(theme.sidebarSurface)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 12)

            Button {
                router.signOutAll()
                onClose()
            } label: {
                Text("Sign Out of All")
                    .font(.system(size: 13))
                    .foregroundColor(theme.sidebarTextMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(theme.sidebarBackground)
        .sheet(isPresented: $showPINEntry) {
            PINEntryView { session, token in
                router.addSession(session, token: token)
                showPINEntry = false
                onClose()
            }
        }
    }
}

struct HouseRow: View {
    let session: HouseSession
    let isActive: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Text(session.role == .owner ? "🏠" : "🏡")
                    .font(.system(size: 16))

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.householdName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(isActive ? theme.sidebarText : theme.sidebarTextInactive)

                    Text(session.role == .owner ? "OWNER" : "GUEST")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(isActive ? theme.sidebarAccent : theme.sidebarTextMuted)
                }

                Spacer()
            }
            .padding(10)
            .background(theme.sidebarSurface)
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle()
                        .fill(theme.sidebarAccent)
                        .frame(width: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Views/Sidebar/SidebarView.swift
git commit -m "refactor(sidebar): migrate hardcoded colors to ResolvedTheme"
```

---

### Task 4: Migrate Component Views

**Files:**
- Modify: `ios/Hearthstone/Views/Components/HearthButton.swift`
- Modify: `ios/Hearthstone/Views/Components/HearthTextField.swift`
- Modify: `ios/Hearthstone/Views/Components/ProgressDots.swift`
- Modify: `ios/Hearthstone/Views/Components/StatusBadge.swift`

These are used by many other views, so they must be migrated first.

- [ ] **Step 1: Migrate HearthButton**

Replace entire contents of `HearthButton.swift`:

```swift
import SwiftUI

struct HearthButton: View {
    let title: String
    var isLoading: Bool = false
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                LinearGradient(colors: [theme.hearth, theme.hearthDark], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: theme.hearth.opacity(0.3), radius: 7, y: 4)
        }
        .disabled(isLoading)
    }
}
```

- [ ] **Step 2: Migrate HearthTextField**

Replace entire contents of `HearthTextField.swift`:

```swift
import SwiftUI

struct HearthTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var autocapitalization: TextInputAutocapitalization = .sentences

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(theme.charcoalSoft)
                .tracking(0.8)

            TextField(placeholder, text: $text)
                .font(.system(size: 17))
                .padding(16)
                .background(theme.creamWarm)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(theme.creamDeep, lineWidth: 1.5)
                )
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
        }
    }
}
```

- [ ] **Step 3: Migrate ProgressDots**

Replace entire contents of `ProgressDots.swift`:

```swift
import SwiftUI

/// Horizontal progress indicator: filled dots for completed/current steps, muted for remaining.
struct ProgressDots: View {
    let active: Int
    let total: Int

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(index < active ? theme.hearth : theme.creamDeep)
                    .frame(maxWidth: .infinity)
                    .frame(height: 4)
            }
        }
    }
}

#Preview {
    ProgressDots(active: 2, total: 3)
        .padding()
}
```

- [ ] **Step 4: Migrate StatusBadge**

Replace entire contents of `StatusBadge.swift`:

```swift
import SwiftUI

struct StatusBadge: View {
    let status: GuestStatus

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(backgroundColor)
            .foregroundColor(textColor)
            .clipShape(Capsule())
    }

    private var backgroundColor: Color {
        switch status {
        case .active: return theme.greenBadge
        case .pending: return theme.goldBadge
        case .revoked: return theme.grayBadge
        }
    }

    private var textColor: Color {
        switch status {
        case .active: return theme.greenBadgeText
        case .pending: return theme.goldBadgeText
        case .revoked: return theme.grayBadgeText
        }
    }
}
```

- [ ] **Step 5: Build to verify components compile**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | grep "error:" | head -20`

Expected: Errors only from views that haven't been migrated yet (Auth, Guest, Owner, Error views). No errors from component files.

- [ ] **Step 6: Commit**

```bash
git add ios/Hearthstone/Views/Components/
git commit -m "refactor(components): migrate HearthButton, HearthTextField, ProgressDots, StatusBadge to ResolvedTheme"
```

---

### Task 5: Migrate Auth Views

**Files:**
- Modify: `ios/Hearthstone/Views/Auth/WelcomeView.swift`
- Modify: `ios/Hearthstone/Views/Auth/VerifyCodeView.swift`
- Modify: `ios/Hearthstone/Views/Auth/PINEntryView.swift`
- Modify: `ios/Hearthstone/Views/Auth/HouseholdSetupView.swift`

QRScannerView uses UIKit with camera overlay — its `.black` background and `.white` text are correct for a camera viewfinder regardless of dark mode. No changes needed.

- [ ] **Step 1: Migrate WelcomeView**

Add after the existing imports and struct declaration opening:
```swift
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }
```

Then replace all `Theme.cream` → `theme.cream`, `Theme.creamWarm` → `theme.creamWarm`, `Theme.hearth` → `theme.hearth`, `Theme.hearthDark` → `theme.hearthDark`, `Theme.charcoal` → `theme.charcoal`, `Theme.charcoalSoft` → `theme.charcoalSoft`, `Theme.rose` → `theme.rose`, `Theme.stone` → `theme.stone` throughout the file.

Full replacement of `WelcomeView.swift`:

```swift
import SwiftUI

struct WelcomeView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.cream, theme.creamWarm],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo
                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [theme.hearth, theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text("Your household knowledge, always at hand for the people who need it.")
                    .font(.system(size: 16))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 48)

                HearthTextField(
                    label: "Email",
                    placeholder: "you@example.com",
                    text: $viewModel.email,
                    keyboardType: .emailAddress,
                    autocapitalization: .never
                )
                .padding(.horizontal, 32)
                .padding(.bottom, 16)

                if let error = viewModel.error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(theme.rose)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 12)
                }

                HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                    Task { await viewModel.sendCode() }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                Text("We'll send a verification code to your email.\nNo password needed — ever.")
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)

                Spacer()
            }
        }
    }
}

#Preview {
    WelcomeView(viewModel: AuthViewModel())
}
```

- [ ] **Step 2: Migrate VerifyCodeView**

Replace entire contents of `VerifyCodeView.swift`:

```swift
import SwiftUI

struct VerifyCodeView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressDots(active: 1, total: 3)
                .padding(.bottom, 36)

            Text("Check your inbox")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(theme.hearth)
                .padding(.bottom, 8)

            Text("Enter your code")
                .font(Theme.heading(28))
                .foregroundColor(theme.charcoal)
                .padding(.bottom, 10)

            Group {
                Text("We sent a 6-digit code to ")
                    .foregroundColor(theme.charcoalSoft)
                + Text(viewModel.email)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.charcoal)
            }
            .font(.system(size: 15))
            .lineSpacing(4)
            .padding(.bottom, 32)

            TextField("", text: $viewModel.code)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .tracking(12)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
                .background(theme.creamWarm)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(
                            viewModel.code.isEmpty ? theme.creamDeep : theme.hearth,
                            lineWidth: 1.5
                        )
                )
                .onChange(of: viewModel.code) { _, newValue in
                    let filtered = String(newValue.filter(\.isNumber).prefix(6))
                    if filtered != newValue { viewModel.code = filtered }
                    if filtered.count == 6 {
                        Task { await viewModel.verifyCode() }
                    }
                }
                .padding(.bottom, 24)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(theme.rose)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 12)
            }

            HStack {
                Spacer()
                Text("Didn't get it? ")
                    .font(.system(size: 14))
                    .foregroundColor(theme.stone)
                + Text("Resend code")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(theme.hearth)
                Spacer()
            }

            if viewModel.isLoading {
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(theme.hearth)
                        .padding(.top, 24)
                    Spacer()
                }
            }

            Spacer()

            Text("Code expires in 10 minutes")
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.cream.ignoresSafeArea())
    }
}

#Preview {
    VerifyCodeView(viewModel: {
        let vm = AuthViewModel()
        vm.email = "fred@example.com"
        return vm
    }())
}
```

- [ ] **Step 3: Migrate PINEntryView**

Replace entire contents of `PINEntryView.swift`:

```swift
import SwiftUI

struct PINEntryView: View {
    let onAuthenticated: (HouseSession, String) -> Void

    @State private var pin = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var showScanner = false

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.cream, theme.creamWarm],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [theme.hearth, theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text("Enter your access code")
                    .font(.system(size: 16))
                    .foregroundColor(theme.charcoalSoft)
                    .padding(.bottom, 40)

                TextField("000000", text: $pin)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced))
                    .foregroundColor(theme.charcoal)
                    .frame(maxWidth: 200)
                    .padding(.vertical, 16)
                    .background(theme.creamWarm)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusMedium)
                            .stroke(theme.creamDeep, lineWidth: 1.5)
                    )
                    .padding(.horizontal, 80)
                    .onChange(of: pin) { _, newValue in
                        let filtered = String(newValue.prefix(6).filter(\.isNumber))
                        if filtered != newValue { pin = filtered }
                        if filtered.count == 6 {
                            Task { await redeemPin() }
                        }
                    }

                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(theme.rose)
                        .padding(.top, 12)
                }

                Button {
                    showScanner = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "qrcode.viewfinder")
                        Text("Scan QR Code")
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(theme.hearth)
                }
                .padding(.top, 20)

                Spacer()

                HearthButton(title: "Continue", isLoading: isLoading) {
                    Task { await redeemPin() }
                }
                .disabled(pin.count != 6)
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                Text("Get your code from the homeowner\nor check your server's terminal.")
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)

                Spacer()
            }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView { scannedPin in
                pin = scannedPin
                showScanner = false
            }
        }
    }

    private func redeemPin() async {
        guard pin.count == 6, !isLoading else { return }
        isLoading = true
        error = nil
        do {
            let response = try await APIClient.shared.redeemPin(pin: pin)
            let session = HouseSession(
                id: UUID().uuidString,
                householdId: response.household?.id ?? response.guest?.householdId ?? "",
                householdName: response.household?.name ?? response.householdName ?? "",
                role: response.role == "owner" ? .owner : .guest,
                personName: response.person?.name?.isEmpty == false ? response.person?.name : response.person?.email,
                addedAt: Date()
            )
            onAuthenticated(session, response.token)
        } catch let err as APIError {
            if case .server(_, let message) = err {
                error = message
            } else {
                error = err.localizedDescription
            }
            pin = ""
        } catch {
            self.error = error.localizedDescription
            pin = ""
        }
        isLoading = false
    }
}
```

- [ ] **Step 4: Migrate HouseholdSetupView**

Replace entire contents of `HouseholdSetupView.swift`:

```swift
import SwiftUI

struct HouseholdSetupView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressDots(active: 2, total: 3)
                .padding(.bottom, 36)

            Text("Welcome")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(theme.hearth)
                .padding(.bottom, 8)

            Text("Name your household")
                .font(Theme.heading(28))
                .foregroundColor(theme.charcoal)
                .lineLimit(2)
                .padding(.bottom, 10)

            Text("This is what your guests will see when they open the app. You can change it anytime.")
                .font(.system(size: 15))
                .foregroundColor(theme.charcoalSoft)
                .lineSpacing(4)
                .padding(.bottom, 40)

            HearthTextField(
                label: "Household Name",
                placeholder: "The Anderson Home",
                text: $viewModel.householdName
            )
            .padding(.bottom, 8)

            Text("e.g. \"The Anderson Home\", \"123 Oak Street\", \"Beach House\"")
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
                .padding(.bottom, 24)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(theme.rose)
                    .padding(.bottom, 12)
            }

            Spacer()
            Text("🏡")
                .font(.system(size: 64))
                .opacity(0.6)
                .frame(maxWidth: .infinity, alignment: .center)
            Spacer()

            HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                Task { await viewModel.createHousehold() }
            }
            .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.cream.ignoresSafeArea())
    }
}

#Preview {
    HouseholdSetupView(viewModel: AuthViewModel())
}
```

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/Views/Auth/
git commit -m "refactor(auth): migrate WelcomeView, VerifyCodeView, PINEntryView, HouseholdSetupView to ResolvedTheme"
```

---

### Task 6: Migrate Guest Views

**Files:**
- Modify: `ios/Hearthstone/Views/Guest/ChatView.swift`
- Modify: `ios/Hearthstone/Views/Guest/MessageBubble.swift`
- Modify: `ios/Hearthstone/Views/Guest/SuggestionChips.swift`
- Modify: `ios/Hearthstone/Views/Guest/SourceDocumentView.swift`

The pattern is the same: add `@Environment(\.colorScheme)` + `theme` computed property, replace `Theme.x` with `theme.x`, replace `Color.white` backgrounds with `theme.creamWarm`.

For each file, add these two lines after the first `@State`/`@StateObject`/`@ObservedObject`/`@Environment` declaration:

```swift
@Environment(\.colorScheme) private var colorScheme
private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }
```

Then apply these replacements throughout each file:
- `Theme.cream` → `theme.cream`
- `Theme.creamWarm` → `theme.creamWarm`
- `Theme.creamDeep` → `theme.creamDeep`
- `Theme.charcoal` → `theme.charcoal`
- `Theme.charcoalSoft` → `theme.charcoalSoft`
- `Theme.stone` → `theme.stone`
- `Theme.hearth` → `theme.hearth`
- `Theme.hearthDark` → `theme.hearthDark`
- `Theme.rose` → `theme.rose`
- `Theme.roseLight` → `theme.roseLight`
- `Theme.sage` → `theme.sage`
- `Theme.sageLight` → `theme.sageLight`
- `Theme.goldBadge` → `theme.goldBadge`
- `Theme.goldBadgeText` → `theme.goldBadgeText`
- `Theme.greenBadge` → `theme.greenBadge`
- `Theme.greenBadgeText` → `theme.greenBadgeText`
- `Theme.grayBadge` → `theme.grayBadge`
- `Theme.grayBadgeText` → `theme.grayBadgeText`
- `Color.white` (used as background) → `theme.creamWarm`
- `Color.white` (used as foreground on accent buttons) → keep as `.white`
- `Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.06)` → `theme.shadowLight`

**Special cases in MessageBubble.swift:**
- Assistant bubble background: `Color.white` → `theme.creamWarm`
- Assistant bubble shadow: `Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.06)` → `theme.shadowLight`
- User bubble text `.white` stays as `.white` (text on accent)
- `Theme.hearth.opacity(0.08)` for source pills → `theme.hearth.opacity(0.08)` (works in both modes)

**Note:** `MessageBubble` and `SuggestionChips` both contain sub-structs. Each struct that uses Theme colors needs its own `@Environment(\.colorScheme)` + `theme`. The `FlowLayout` struct in SuggestionChips does NOT use colors — leave it unchanged. The `RoundedCorners` shape in MessageBubble does NOT use colors — leave it unchanged.

- [ ] **Step 1: Migrate all 4 guest view files** using the pattern above
- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Views/Guest/
git commit -m "refactor(guest): migrate ChatView, MessageBubble, SuggestionChips, SourceDocumentView to ResolvedTheme"
```

---

### Task 7: Migrate Owner Views

**Files:**
- Modify: `ios/Hearthstone/Views/Owner/DashboardView.swift`
- Modify: `ios/Hearthstone/Views/Owner/ConnectDocsView.swift`
- Modify: `ios/Hearthstone/Views/Owner/DriveFilePickerView.swift`
- Modify: `ios/Hearthstone/Views/Owner/GuestListView.swift`
- Modify: `ios/Hearthstone/Views/Owner/AddGuestView.swift`
- Modify: `ios/Hearthstone/Views/Owner/GuestPINView.swift`
- Modify: `ios/Hearthstone/Views/Owner/InviteOwnerView.swift`
- Modify: `ios/Hearthstone/Views/Owner/OwnerPreviewView.swift`

Same pattern as Task 6. Add `@Environment(\.colorScheme)` + `theme` to every struct that uses colors.

**Special cases in DashboardView.swift:**

The file has multiple private structs. Each one that uses Theme/Color needs its own `@Environment` + `theme`:
- `DashboardView` — add theme
- `HeroHeader` — `.white` foreground color stays `.white` (text on gradient). Replace `Theme.hearth`/`Theme.hearthDark` with `theme.hearth`/`theme.hearthDark`. The `Color.white.opacity(0.06)` decorative circle stays as-is.
- `StatCard` — `Color.white` background → `theme.creamWarm`. Shadow → `theme.shadow`.
- `OnboardingChecklist` — Light gradient → `LinearGradient(colors: [theme.onboardingGradientStart, theme.onboardingGradientEnd], ...)`. All badge colors → theme versions.
- `ChecklistRow` — `Color.clear` stays. Theme colors → theme versions. `.white` checkmark text stays.
- `ManageSection` — Theme colors → theme versions.
- `ManageRow` — `Color.white` background → `theme.creamWarm`. `Color(red: 1.0, green: 0.953, blue: 0.863)` → `theme.iconBackgroundWarm`. `Color(red: 0.910, green: 0.890, blue: 0.941)` → `theme.iconBackgroundCool`. Shadow → `theme.shadowLight`.

**Special cases in ConnectDocsView.swift:**

- Connected banner gradient: `Color(red: 1, green: 0.99, blue: 0.95)` / `Color(red: 1, green: 0.97, blue: 0.9)` → `theme.connectedBannerStart` / `theme.connectedBannerEnd`
- `DocumentRow` and `DocStatusBadge` need their own `@Environment` + `theme`

**Special cases in GuestListView.swift:**

- `GuestCard` — `Color.white` background → `theme.creamWarm`. Shadow → `theme.shadowLight`.
- `GuestAvatar` — All badge colors → theme versions.
- `GuestActionButton` — All Theme colors → theme versions.
- Each private struct needs its own `@Environment` + `theme`.

**Special cases in GuestPINView.swift:**

- `Color.white` for PIN box and QR background → `theme.creamWarm`

**Special cases in OwnerPreviewView.swift:**

- Preview banner gradient: `Color(red: 92/255, green: 82/255, blue: 74/255)` / `Color(red: 61/255, green: 53/255, blue: 48/255)` → `theme.previewBannerStart` / `theme.previewBannerEnd`
- `.white` foreground stays `.white` (text on dark banner)

- [ ] **Step 1: Migrate all 8 owner view files** using the patterns above
- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Views/Owner/
git commit -m "refactor(owner): migrate all owner views to ResolvedTheme"
```

---

### Task 8: Migrate Error Views

**Files:**
- Modify: `ios/Hearthstone/Views/Error/AccessRevokedView.swift`
- Modify: `ios/Hearthstone/Views/Error/InviteErrorView.swift`

**AccessRevokedView special cases:**
- Header gradient: `Color(red: 139/255, green: 123/255, blue: 107/255)` / `Color(red: 107/255, green: 93/255, blue: 80/255)` → `theme.revokedHeaderStart` / `theme.revokedHeaderEnd`
- Icon circle: `Color(red: 240/255, green: 237/255, blue: 237/255)` → `theme.revokedIconCircle`
- `.white` foreground stays (text on dark header)

**InviteErrorView special cases:**
- `Color.white` button background → `theme.creamWarm`

- [ ] **Step 1: Migrate both error view files**
- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Views/Error/
git commit -m "refactor(error): migrate AccessRevokedView, InviteErrorView to ResolvedTheme"
```

---

### Task 9: Build, Verify, Push

- [ ] **Step 1: Full build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 2: Visual verification**

Launch the app in the simulator. Test both modes:

```bash
# Switch simulator to dark mode
xcrun simctl ui booted appearance dark

# Switch back to light mode
xcrun simctl ui booted appearance light
```

Verify:
- Light mode looks identical to before (no visual regression)
- Dark mode uses warm dark palette throughout
- Sidebar stays dark in both modes
- Sidebar swipe gesture tracks finger 1:1 from left edge
- Sidebar has spring bounce on release
- Fast flick opens/closes sidebar even from small distance

- [ ] **Step 3: Push**

```bash
git push origin main
```
