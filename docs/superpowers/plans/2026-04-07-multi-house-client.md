# Multi-House Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person accumulate multiple house sessions (owner and/or guest) and switch between them via a swipe-right sidebar drawer.

**Architecture:** A `SessionStore` replaces the single-token `KeychainService` as the auth source of truth. It stores a list of `HouseSession` values (metadata in a JSON file, tokens in Keychain). A sidebar overlay sits at the root of the view hierarchy, accessible via swipe-right from any screen. `AppRouter` derives its state from the active session in `SessionStore`.

**Tech Stack:** SwiftUI (iOS 17+), Keychain Services, JSONEncoder/Decoder for persistence

**Spec:** `docs/superpowers/specs/2026-04-07-multi-house-client-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `ios/Hearthstone/Services/SessionStore.swift` | Create | Session list persistence, active session management, token storage |
| `ios/Hearthstone/Models/HouseSession.swift` | Create | HouseSession model and Role enum |
| `ios/Hearthstone/Views/Sidebar/SidebarView.swift` | Create | Drawer content: house list, add PIN, sign out |
| `ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift` | Create | Swipe gesture + dimmed overlay + animation |
| `ios/Hearthstone/HearthstoneApp.swift` | Modify | Refactor AppRouter to use SessionStore, add sidebar |
| `ios/Hearthstone/Views/Auth/PINEntryView.swift` | Modify | Single `onAuthenticated(HouseSession)` callback |
| `ios/Hearthstone/Services/APIClient.swift` | Modify | Read token from SessionStore, remove auth enum |
| `ios/Hearthstone/Services/SSEClient.swift` | Modify | Read token from SessionStore |
| `ios/Hearthstone/Services/KeychainService.swift` | Modify | Add generic key-based read/write, keep for token storage |
| `ios/Hearthstone/Views/Owner/DashboardView.swift` | Modify | Remove onSignOut callback |

---

### Task 1: HouseSession Model

**Files:**
- Create: `ios/Hearthstone/Models/HouseSession.swift`

- [ ] **Step 1: Create the model file**

```swift
// ios/Hearthstone/Models/HouseSession.swift
import Foundation

enum HouseRole: String, Codable {
    case owner
    case guest
}

struct HouseSession: Identifiable, Codable, Equatable {
    let id: String
    let householdId: String
    var householdName: String
    let role: HouseRole
    let addedAt: Date

    static func == (lhs: HouseSession, rhs: HouseSession) -> Bool {
        lhs.id == rhs.id
    }
}
```

Note: The `token` is NOT stored in this struct — it lives in Keychain keyed by `id`. This struct is the metadata that gets serialized to JSON.

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Models/HouseSession.swift
git commit -m "feat(ios): add HouseSession model for multi-house support"
```

---

### Task 2: KeychainService — Add Generic Key-Based Storage

**Files:**
- Modify: `ios/Hearthstone/Services/KeychainService.swift`

The existing `ownerToken` and `guestToken` properties are hardcoded to two keys. We need generic `read(key:)` and `save(key:value:)` methods to be public so `SessionStore` can store tokens keyed by session ID.

- [ ] **Step 1: Make read/write methods public and add a delete method**

In `ios/Hearthstone/Services/KeychainService.swift`, change the three private methods to internal:

```swift
func save(key: String, value: String) {
    let data = Data(value.utf8)
    delete(key: key)
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: key,
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    SecItemAdd(query as CFDictionary, nil)
}

func read(key: String) -> String? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: key,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}

func delete(key: String) {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: key,
    ]
    SecItemDelete(query as CFDictionary)
}
```

Keep the existing `ownerToken`, `guestToken`, and `clearAll()` properties — they'll be removed in a later task when we migrate APIClient.

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Services/KeychainService.swift
git commit -m "refactor(ios): make KeychainService read/write methods internal"
```

---

### Task 3: SessionStore

**Files:**
- Create: `ios/Hearthstone/Services/SessionStore.swift`

- [ ] **Step 1: Create SessionStore**

```swift
// ios/Hearthstone/Services/SessionStore.swift
import Foundation

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var sessions: [HouseSession] = []
    @Published var activeSessionId: String?

    var activeSession: HouseSession? {
        guard let id = activeSessionId else { return nil }
        return sessions.first { $0.id == id }
    }

    /// The active session's token from Keychain.
    var activeToken: String? {
        guard let id = activeSessionId else { return nil }
        return KeychainService.shared.read(key: "hst_\(id)")
    }

    private let metadataURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("sessions.json")
    }()

    private init() {
        load()
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: metadataURL),
              let decoded = try? JSONDecoder().decode(StoredState.self, from: data) else {
            return
        }
        sessions = decoded.sessions
        activeSessionId = decoded.activeSessionId ?? decoded.sessions.first?.id
    }

    private func persist() {
        let state = StoredState(sessions: sessions, activeSessionId: activeSessionId)
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: metadataURL, options: .atomic)
    }

    private struct StoredState: Codable {
        let sessions: [HouseSession]
        let activeSessionId: String?
    }

    // MARK: - Mutations

    func add(session: HouseSession, token: String) {
        // Replace existing session for the same household+role
        sessions.removeAll { $0.householdId == session.householdId && $0.role == session.role }
        sessions.append(session)
        sessions.sort { $0.addedAt < $1.addedAt }
        KeychainService.shared.save(key: "hst_\(session.id)", value: token)
        activeSessionId = session.id
        persist()
    }

    func remove(id: String) {
        sessions.removeAll { $0.id == id }
        KeychainService.shared.delete(key: "hst_\(id)")
        if activeSessionId == id {
            activeSessionId = sessions.first?.id
        }
        persist()
    }

    func removeAll() {
        for session in sessions {
            KeychainService.shared.delete(key: "hst_\(session.id)")
        }
        sessions = []
        activeSessionId = nil
        persist()
    }

    func switchTo(id: String) {
        guard sessions.contains(where: { $0.id == id }) else { return }
        activeSessionId = id
        persist()
    }
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Services/SessionStore.swift
git commit -m "feat(ios): add SessionStore for multi-house session management"
```

---

### Task 4: Wire APIClient and SSEClient to SessionStore

**Files:**
- Modify: `ios/Hearthstone/Services/APIClient.swift`
- Modify: `ios/Hearthstone/Services/SSEClient.swift`

- [ ] **Step 1: Update APIClient.request() to use SessionStore**

In `ios/Hearthstone/Services/APIClient.swift`, replace the auth switch in `request()` (lines 99-110):

```swift
switch auth {
case .none:
    break
case .owner:
    if let token = KeychainService.shared.ownerToken {
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
case .guest:
    if let token = KeychainService.shared.guestToken {
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
}
```

With:

```swift
switch auth {
case .none:
    break
case .owner, .guest:
    if let token = SessionStore.shared.activeToken {
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
}
```

- [ ] **Step 2: Update uploadDocument() to use SessionStore**

In the same file, find the `uploadDocument` method (around line 391):

```swift
if let token = KeychainService.shared.ownerToken {
```

Replace with:

```swift
if let token = SessionStore.shared.activeToken {
```

- [ ] **Step 3: Update SSEClient to use SessionStore**

In `ios/Hearthstone/Services/SSEClient.swift`, replace lines 55-57:

```swift
let token = isPreview
    ? KeychainService.shared.ownerToken
    : KeychainService.shared.guestToken
```

With:

```swift
let token = SessionStore.shared.activeToken
```

- [ ] **Step 4: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/Services/APIClient.swift ios/Hearthstone/Services/SSEClient.swift
git commit -m "refactor(ios): wire APIClient and SSEClient to SessionStore"
```

---

### Task 5: Refactor PINEntryView

**Files:**
- Modify: `ios/Hearthstone/Views/Auth/PINEntryView.swift`

Replace the two separate callbacks with a single `onAuthenticated` callback that returns a `HouseSession` and token.

- [ ] **Step 1: Update PINEntryView**

Replace the struct definition and `redeemPin()` method. Change:

```swift
struct PINEntryView: View {
    let onOwnerAuth: (String, Person, Household) -> Void
    let onGuestAuth: (String, String) -> Void
```

To:

```swift
struct PINEntryView: View {
    let onAuthenticated: (HouseSession, String) -> Void
```

Then replace the `redeemPin()` method:

```swift
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
```

- [ ] **Step 2: Verify it builds**

It will NOT build yet — callers of PINEntryView still use the old callbacks. That's expected; we fix them in the next task.

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Views/Auth/PINEntryView.swift
git commit -m "refactor(ios): PINEntryView returns HouseSession instead of separate callbacks"
```

---

### Task 6: Refactor AppRouter and HearthstoneApp

**Files:**
- Modify: `ios/Hearthstone/HearthstoneApp.swift`

This is the largest change. Replace the single-state AppRouter with one that derives state from SessionStore.

- [ ] **Step 1: Rewrite AppRouter**

Replace the entire `AppRouter` class (from `// MARK: - App Router` through the end of the class) with:

```swift
// MARK: - App Router

@MainActor
final class AppRouter: ObservableObject {
    @Published var state: AppState = .empty
    @Published var showAccessRevoked: String? = nil

    let store = SessionStore.shared

    enum AppState: Equatable {
        case empty
        case active(HouseSession)

        static func == (lhs: AppState, rhs: AppState) -> Bool {
            switch (lhs, rhs) {
            case (.empty, .empty): return true
            case (.active(let a), .active(let b)): return a.id == b.id
            default: return false
            }
        }
    }

    init() {
        syncState()
        NotificationCenter.default.addObserver(forName: .guestSessionRevoked, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if let active = self.store.activeSession, active.role == .guest {
                    let name = active.householdName
                    self.store.remove(id: active.id)
                    if self.store.sessions.isEmpty {
                        self.showAccessRevoked = name
                    }
                    self.syncState()
                }
            }
        }
    }

    func syncState() {
        if let session = store.activeSession {
            state = .active(session)
        } else {
            state = .empty
        }
    }

    func addSession(_ session: HouseSession, token: String) {
        store.add(session: session, token: token)
        syncState()
    }

    func signOutAll() {
        store.removeAll()
        // Also clear legacy tokens
        KeychainService.shared.clearAll()
        UserDefaults.standard.removeObject(forKey: "guestHouseholdName")
        syncState()
    }
}
```

- [ ] **Step 2: Rewrite the main app body**

Replace the `HearthstoneApp` body with:

```swift
@main
struct HearthstoneApp: App {
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            Group {
                switch router.state {
                case .empty:
                    PINEntryView { session, token in
                        router.addSession(session, token: token)
                    }
                case .active(let session):
                    SidebarOverlay(router: router) {
                        if session.role == .owner {
                            NavigationStack {
                                DashboardView(
                                    householdName: session.householdName,
                                    ownerName: ""
                                )
                            }
                        } else {
                            ChatView(
                                viewModel: ChatViewModel(),
                                householdName: session.householdName
                            )
                        }
                    }
                }
            }
            .sheet(item: $router.showAccessRevoked) { name in
                AccessRevokedView(householdName: name)
            }
            .onOpenURL { url in
                router.handleUniversalLink(url)
            }
        }
    }
}
```

Note: `showAccessRevoked` needs to conform to `Identifiable` for the sheet binding. The simplest approach: make it an optional String and use a wrapper. Add this extension at the bottom of HearthstoneApp.swift:

```swift
extension String: @retroactive Identifiable {
    public var id: String { self }
}
```

- [ ] **Step 3: Add handleUniversalLink to the new AppRouter**

Add this method to `AppRouter`:

```swift
func handleUniversalLink(_ url: URL) {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.path.hasPrefix("/join/") else { return }

    let pathParts = components.path.split(separator: "/")
    guard pathParts.count >= 2 else { return }
    let token = String(pathParts[1])

    Task {
        do {
            let response = try await APIClient.shared.redeemInvite(token: token)
            let session = HouseSession(
                id: UUID().uuidString,
                householdId: response.guest.householdId,
                householdName: response.householdName,
                role: .guest,
                addedAt: Date()
            )
            addSession(session, token: response.sessionToken)
        } catch {
            // Invite errors can be handled with an alert in a future iteration
        }
    }
}
```

- [ ] **Step 4: Remove old flows**

Delete the `AuthFlow`, `HouseholdSetupFlow`, and `LoadingView` structs from HearthstoneApp.swift. These are no longer reachable — the app now goes straight from PIN entry to active session.

Also delete the old `InviteErrorType` enum and related code if present.

- [ ] **Step 5: Remove onSignOut from DashboardView**

In `ios/Hearthstone/Views/Owner/DashboardView.swift`, remove the `onSignOut` property and any UI that references it (the sign-out button in the header). The sidebar now handles sign-out.

Find and remove:

```swift
var onSignOut: (() -> Void)?
```

And any button that calls `onSignOut?()`. Read the file first to find the exact locations.

- [ ] **Step 6: Verify it builds**

It will NOT build yet — `SidebarOverlay` doesn't exist. Create a stub:

```swift
// ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift
import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
    }
}
```

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED (sidebar is a passthrough stub)

- [ ] **Step 7: Commit**

```bash
git add ios/Hearthstone/HearthstoneApp.swift ios/Hearthstone/Views/Owner/DashboardView.swift ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift
git commit -m "refactor(ios): AppRouter derives state from SessionStore, sidebar stub"
```

---

### Task 7: SidebarView (Drawer Content)

**Files:**
- Create: `ios/Hearthstone/Views/Sidebar/SidebarView.swift`

- [ ] **Step 1: Create SidebarView**

```swift
// ios/Hearthstone/Views/Sidebar/SidebarView.swift
import SwiftUI

struct SidebarView: View {
    @ObservedObject var router: AppRouter
    let onClose: () -> Void
    @State private var showPINEntry = false

    private var store: SessionStore { router.store }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("YOUR HOUSES")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Color(red: 0.61, green: 0.56, blue: 0.51))
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
                .background(Color(red: 0.24, green: 0.20, blue: 0.18))
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
                .foregroundColor(Color(red: 0.71, green: 0.44, blue: 0.18))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color(red: 0.24, green: 0.20, blue: 0.18))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 12)

            Button {
                router.signOutAll()
                onClose()
            } label: {
                Text("Sign Out of All")
                    .font(.system(size: 13))
                    .foregroundColor(Color(red: 0.61, green: 0.56, blue: 0.51))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color(red: 0.17, green: 0.14, blue: 0.13))
        .sheet(isPresented: $showPINEntry) {
            PINEntryView { session, token in
                router.addSession(session, token: token)
                showPINEntry = false
                onClose()
            }
        }
    }
}

// MARK: - House Row

struct HouseRow: View {
    let session: HouseSession
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Text(session.role == .owner ? "🏠" : "🏡")
                    .font(.system(size: 16))

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.householdName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(isActive ? Color(red: 0.94, green: 0.90, blue: 0.83) : Color(red: 0.83, green: 0.77, blue: 0.66))

                    Text(session.role == .owner ? "OWNER" : "GUEST")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(isActive ? Color(red: 0.71, green: 0.44, blue: 0.18) : Color(red: 0.61, green: 0.56, blue: 0.51))
                }

                Spacer()
            }
            .padding(10)
            .background(Color(red: 0.24, green: 0.20, blue: 0.18))
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle()
                        .fill(Color(red: 0.71, green: 0.44, blue: 0.18))
                        .frame(width: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 2: Add new files to the Xcode project**

The new files in `Views/Sidebar/` need to be added to the Xcode project's file references and build phase. Add both `SidebarView.swift` and `SidebarOverlay.swift` to the project. Read the pbxproj to understand the pattern, then add file references and source build entries matching existing files.

- [ ] **Step 3: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Views/Sidebar/SidebarView.swift ios/Hearthstone.xcodeproj/project.pbxproj
git commit -m "feat(ios): add SidebarView with house list and swipe-to-remove"
```

---

### Task 8: SidebarOverlay (Gesture + Animation)

**Files:**
- Modify: `ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift` (replace the stub)

- [ ] **Step 1: Implement the overlay with drag gesture**

Replace the stub content of `SidebarOverlay.swift` with:

```swift
// ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift
import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    @State private var isOpen = false
    @State private var dragOffset: CGFloat = 0

    private let sidebarWidth: CGFloat = 260

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                // Main content
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Dimmed overlay
                if isOpen || dragOffset > 0 {
                    Color.black
                        .opacity(overlayOpacity)
                        .ignoresSafeArea()
                        .onTapGesture { close() }
                }

                // Sidebar
                HStack(spacing: 0) {
                    SidebarView(router: router, onClose: { close() })
                        .frame(width: sidebarWidth)

                    Spacer(minLength: 0)
                }
                .offset(x: sidebarOffset - sidebarWidth)
            }
            .gesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { value in
                        if isOpen {
                            // Dragging to close
                            let drag = min(0, value.translation.width)
                            dragOffset = sidebarWidth + drag
                        } else if value.startLocation.x < 30 {
                            // Edge swipe to open
                            dragOffset = max(0, min(sidebarWidth, value.translation.width))
                        }
                    }
                    .onEnded { value in
                        if isOpen {
                            // Close if dragged more than 1/3 or velocity is high
                            if value.translation.width < -80 || value.predictedEndTranslation.width < -120 {
                                close()
                            } else {
                                open()
                            }
                        } else {
                            // Open if dragged more than 1/3 or velocity is high
                            if dragOffset > sidebarWidth / 3 || value.predictedEndTranslation.width > 120 {
                                open()
                            } else {
                                close()
                            }
                        }
                    }
            )
            .animation(.easeOut(duration: 0.25), value: isOpen)
        }
    }

    private var sidebarOffset: CGFloat {
        if isOpen && dragOffset == 0 {
            return sidebarWidth
        }
        return dragOffset
    }

    private var overlayOpacity: Double {
        Double(sidebarOffset / sidebarWidth) * 0.4
    }

    private func open() {
        dragOffset = 0
        isOpen = true
    }

    private func close() {
        dragOffset = 0
        isOpen = false
    }
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Views/Sidebar/SidebarOverlay.swift
git commit -m "feat(ios): implement sidebar overlay with swipe-from-edge gesture"
```

---

### Task 9: Migration — Adopt Existing Sessions

**Files:**
- Modify: `ios/Hearthstone/Services/SessionStore.swift`

Users who already have tokens in the old KeychainService format need those migrated on first launch.

- [ ] **Step 1: Add migration logic to SessionStore.init()**

After the `load()` call in `init()`, add:

```swift
migrateFromLegacyIfNeeded()
```

Then add this method:

```swift
private func migrateFromLegacyIfNeeded() {
    // If we already have sessions, migration is done
    guard sessions.isEmpty else { return }

    // Check for legacy owner token
    if let ownerToken = KeychainService.shared.read(key: "hearthstone_owner_jwt") {
        let session = HouseSession(
            id: UUID().uuidString,
            householdId: "migrated-owner",
            householdName: "My House",
            role: .owner,
            addedAt: Date()
        )
        add(session: session, token: ownerToken)
        KeychainService.shared.delete(key: "hearthstone_owner_jwt")

        // Try to fetch the real household name
        Task {
            do {
                let me = try await APIClient.shared.getMe()
                if let household = me.household,
                   var session = sessions.first(where: { $0.role == .owner }) {
                    sessions.removeAll { $0.id == session.id }
                    let updated = HouseSession(
                        id: session.id,
                        householdId: household.id,
                        householdName: household.name,
                        role: .owner,
                        addedAt: session.addedAt
                    )
                    sessions.append(updated)
                    sessions.sort { $0.addedAt < $1.addedAt }
                    persist()
                }
            } catch {
                // Migration succeeded with placeholder name — user can re-enter PIN if needed
            }
        }
    }

    // Check for legacy guest token
    if let guestToken = KeychainService.shared.read(key: "hearthstone_guest_hss") {
        let householdName = UserDefaults.standard.string(forKey: "guestHouseholdName") ?? "Guest House"
        let session = HouseSession(
            id: UUID().uuidString,
            householdId: "migrated-guest",
            householdName: householdName,
            role: .guest,
            addedAt: Date()
        )
        add(session: session, token: guestToken)
        KeychainService.shared.delete(key: "hearthstone_guest_hss")
        UserDefaults.standard.removeObject(forKey: "guestHouseholdName")
    }
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Services/SessionStore.swift
git commit -m "feat(ios): migrate legacy single-token sessions to SessionStore"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Full build**

Run:
```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -10
```
Expected: BUILD SUCCEEDED with zero errors

- [ ] **Step 2: Manual test plan**

Run the app in the simulator. Verify:

1. App launches to PIN entry (no existing sessions)
2. Enter an owner PIN → lands on dashboard
3. Swipe right from dashboard → sidebar appears with one house
4. Tap "+ Enter PIN" → PIN entry sheet appears
5. Enter a guest PIN for a different house → sidebar now has two houses
6. Tap the guest house → chat view loads
7. Swipe right from chat → sidebar appears (this was the original "stuck in chat" bug)
8. Tap the owner house → dashboard loads
9. Swipe left on a house row → "Remove" action appears
10. Remove the guest house → sidebar has one house
11. Tap "Sign Out of All" → returns to PIN entry

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(ios): adjustments from end-to-end testing"
```
