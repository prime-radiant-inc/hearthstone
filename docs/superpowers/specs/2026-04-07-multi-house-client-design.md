# Multi-House Client Design

## Goal

Let a single person accumulate multiple house sessions — as owner, guest, or both — and switch between them from anywhere in the app.

## Problem

The app assumes one role at a time. A guest in chat has no way to navigate out. An owner who is also a guest of another household cannot switch. The Keychain stores exactly one owner token and one guest token.

## Design

### Session Model

Replace the single-token Keychain model with a list of `HouseSession` values.

```
HouseSession
  id: String              // stable local ID (UUID)
  householdId: String     // server-side household ID
  householdName: String   // display name
  role: Role              // .owner or .guest
  token: String           // JWT (owner) or session token (guest)
  addedAt: Date           // for stable sort order
```

**Storage:** Session metadata (id, householdId, householdName, role, addedAt) lives in a JSON file in the app's documents directory. Tokens stay in Keychain, keyed by session ID. This keeps secrets out of plaintext while keeping metadata easy to read and update.

A `SessionStore` class owns this state. It replaces `KeychainService` as the source of truth for auth. It exposes:

- `sessions: [HouseSession]` — all sessions, sorted by addedAt
- `activeSessionId: String?` — the currently selected session
- `activeSession: HouseSession?` — computed from the above
- `add(session:)` — add a new house (from PIN redemption)
- `remove(id:)` — delete one session (token from Keychain, entry from list)
- `removeAll()` — sign out of everything
- `switchTo(id:)` — change the active session

`APIClient` reads the active session's token from `SessionStore` instead of `KeychainService`. The existing `auth` parameter on `request()` (`.owner` / `.guest` / `.none`) is replaced: the client always sends the active session's token regardless of role. The server decides what's authorized — the client doesn't need to know whether it's holding an owner JWT or a guest session token.

### Sidebar (House Drawer)

A panel that slides in from the left edge, available on every screen via swipe-right gesture.

**Contents (top to bottom):**
1. Section header: "Your Houses"
2. List of house rows — each shows house name, role badge (Owner/Guest), active indicator (left accent border on the current house)
3. Divider
4. "+ Enter PIN" button to add a house
5. "Sign Out of All" at the bottom

**Interactions:**
- Tap a house → switch active session, close drawer, app transitions to the appropriate view (dashboard for owners, chat for guests)
- Swipe left on a house row → reveal red "Remove" action. Removes that session locally (deletes token, removes from list). If it was the active session, switch to the next one. If it was the last session, return to PIN entry.
- Tap "+ Enter PIN" → present PIN entry as a sheet. On success, add the new session and switch to it.
- Tap "Sign Out of All" → clear all sessions, return to PIN entry.
- Tap the dimmed content area → close drawer without switching.

**Visual treatment:** Dark background (#2C2520) matching Hearthstone's charcoal palette. House rows in slightly lighter cards. Active house has a left border in the hearth accent color. Role badges in small caps.

### AppRouter Refactor

`AppRouter` currently holds a single `AppState` enum. Replace this with a model that derives state from `SessionStore`.

**New AppRouter state:**

```
enum AppState {
    case empty                                // no sessions → PIN entry
    case active(HouseSession)                 // show dashboard or chat based on role
    case accessRevoked(householdName: String)  // guest got 401'd
}
```

The router observes `SessionStore`. When the active session changes, the router computes the new state. The sidebar is always available (as an overlay) when state is `.active`.

**First launch (no sessions):** Shows PIN entry full-screen, no sidebar.

**One session:** Sidebar is swipe-accessible but not prompted. The app behaves like today except the sidebar exists as an escape hatch.

**Multiple sessions:** Same as one session. No UI changes — the sidebar just has more rows.

### PIN Entry Changes

`PINEntryView` currently calls `onOwnerAuth` or `onGuestAuth` callbacks that set tokens directly. Refactor it to return a `HouseSession` through a single callback. The caller (AppRouter or sidebar sheet) adds the session to `SessionStore`.

The PIN entry view itself doesn't change visually. It just returns richer data:

```
onAuthenticated: (HouseSession) -> Void
```

The PIN redemption API response already returns the role, person, household name, and token — everything needed to construct a `HouseSession`.

### View Hierarchy

```
HearthstoneApp
  └── ZStack
      ├── MainContent (switches on AppRouter.state)
      │   ├── PINEntryView        (state == .empty)
      │   ├── DashboardView       (state == .active, role == .owner)
      │   ├── ChatView            (state == .active, role == .guest)
      │   └── AccessRevokedView   (state == .accessRevoked)
      └── SidebarOverlay          (available when state == .active)
          ├── Gesture: drag from left edge
          └── SidebarView (the drawer content)
```

The sidebar is an overlay on top of the main content, not inside a NavigationStack. This means it works regardless of what screen you're on — including deep inside the owner dashboard's sheets (documents, guest list) or mid-conversation in guest chat.

### Guest Session Revocation

When a guest gets a 401 and `guestSessionRevoked` fires, the router should:

1. Remove that session from `SessionStore`
2. If there are other sessions, switch to the next one
3. If there are no sessions left, show access revoked screen
4. If the revoked session was NOT the active one (background request), just silently remove it

This is a change from today where revocation always navigates to the access revoked screen.

### What Doesn't Change

- **Backend:** No backend changes. PINs, tokens, and auth middleware work as-is. Each session just stores a different token.
- **DashboardView, ChatView, all owner/guest views:** These views don't know about multi-house. They receive a household name and a token and do their thing.
- **API contract:** No new endpoints. The existing PIN redemption response has all the data we need.

## Scope Boundaries

**In scope:**
- SessionStore (replaces KeychainService for auth)
- Sidebar drawer with house list
- Swipe-to-remove houses
- "Enter PIN" from sidebar
- AppRouter refactor
- PINEntryView callback refactor

**Out of scope (future chunks):**
- Multi-owner backend (household_members table) — Chunk 2
- QR code scanning in PIN entry — Chunk 3
- Owner invite flow (invite another owner) — Chunk 2
- Household name sync (what if the owner renames the house after you joined?) — deferred

## File Impact

| File | Action |
|------|--------|
| `SessionStore.swift` | Create — new session list manager |
| `SidebarView.swift` | Create — drawer content |
| `SidebarOverlay.swift` | Create — gesture + overlay wrapper |
| `HearthstoneApp.swift` | Modify — refactor AppRouter, add sidebar overlay |
| `PINEntryView.swift` | Modify — single callback returning HouseSession |
| `KeychainService.swift` | Modify — add per-key read/write helpers, keep for token storage |
| `APIClient.swift` | Modify — read token from SessionStore instead of KeychainService |
| `SSEClient.swift` | Modify — same token source change |
| `DashboardView.swift` | Minor — remove onSignOut callback (sidebar handles this now) |

## Testing

- Add a house via PIN → appears in sidebar
- Switch between houses → correct view loads (dashboard vs chat)
- Swipe-to-remove a house → session deleted, token cleared
- Remove active house → switches to next house
- Remove last house → returns to PIN entry
- Sign Out of All → clears everything, PIN entry
- Guest revocation with multiple houses → only that session removed
- App restart → sessions persist, active session restored
