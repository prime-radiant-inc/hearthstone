# Google Drive Integration — Complete Flow

## Problem

The Google Drive OAuth flow dead-ends in Safari. After the user authenticates with Google, the backend returns JSON to the browser and the user is stuck. There is also no file picker — no way to browse Drive and select which documents to connect. The OAuth plumbing and doc indexing pipeline work, but the end-to-end flow from "connect Drive" to "pick a doc" to "doc is indexed" is broken.

## Solution

Fix the OAuth flow with `ASWebAuthenticationSession`, add a backend endpoint to list Drive files, build a Drive file picker screen, and add a visible refresh button.

## Architecture Principle

The iOS app never talks to Google. All Google API access is proxied through the Hearthstone backend. The server holds OAuth client credentials and refresh tokens. The iOS app's only role in OAuth is hosting the consent screen.

```
iOS ←→ Hearthstone API ←→ Google Drive API
```

---

## 1. OAuth Flow Fix

### Current (broken)

1. iOS calls `POST /connections/google-drive` → gets `auth_url`
2. Opens Safari with that URL
3. User authenticates with Google
4. Google redirects to `{appBaseUrl}/connections/google-drive/callback`
5. Backend returns JSON `{ connection }` — **user stuck in Safari**

### New

1. iOS calls `POST /connections/google-drive` → gets `auth_url` (unchanged)
2. iOS opens `ASWebAuthenticationSession` with the auth URL
3. User authenticates with Google in the in-app browser sheet
4. Google redirects to `{appBaseUrl}/connections/google-drive/callback?code=...&state=...`
5. Backend exchanges code, stores refresh token, creates connection record (unchanged)
6. Backend returns **302 redirect** to `hearthstone://drive-connected?connection_id={id}`
7. `ASWebAuthenticationSession` captures the custom scheme redirect, dismisses itself
8. iOS parses `connection_id`, transitions to the Drive file picker

### Backend Change

`handleGoogleDriveCallback` currently returns `{ status: 200, body: { connection } }`. Change to return a 302 redirect to `hearthstone://drive-connected?connection_id={id}`. On error, redirect to `hearthstone://drive-error?message={url_encoded_message}`.

### iOS Changes

- Register `hearthstone://` URL scheme in Info.plist
- Replace `UIApplication.shared.open(url)` in `ConnectionsViewModel.connectGoogleDrive()` with `ASWebAuthenticationSession`
- `ASWebAuthenticationSession` configured with `callbackURLScheme: "hearthstone"`
- Parse the callback URL to extract `connection_id` or error
- On success: store connection ID, present `DriveFilePickerView`
- On error or user cancellation: show error alert, stay on ConnectDocsView

---

## 2. Drive File Listing Endpoint

### `GET /connections/:id/files`

**Auth:** Owner session

Uses the connection's stored refresh token to get a fresh access token, then calls the Google Drive API to list the user's Google Docs.

**Google API call:**
```
GET https://www.googleapis.com/drive/v3/files
  ?q=mimeType='application/vnd.google-apps.document'
  &fields=files(id,name,modifiedTime)
  &orderBy=modifiedTime desc
  &pageSize=100
```

**Filtering:** Excludes files whose `id` matches any `drive_file_id` already in the `documents` table for this household. This prevents showing already-connected docs in the picker.

**Response:**
```json
{
  "files": [
    { "id": "1BxiM...", "name": "House Operations", "modified_time": "2026-04-01T12:00:00Z" },
    { "id": "2CyjN...", "name": "Dog Care Guide", "modified_time": "2026-03-28T09:30:00Z" }
  ]
}
```

**Errors:**
- `404` — connection not found or doesn't belong to household
- `502` — Google Drive API unreachable or token expired

---

## 3. Drive File Picker (iOS)

### `DriveFilePickerView`

A sheet presented on top of `ConnectDocsView`.

**States:**
- **Loading** — spinner while fetching file list from `GET /connections/:id/files`
- **Empty** — "No Google Docs found in your Drive" message
- **List** — rows showing doc name + last modified date
- **Error** — error message with retry button

**Behavior:**
- Owner taps a doc → calls `POST /documents` with `{ drive_file_id, title }` from the selected file
- Row shows a brief "Connecting..." state, then checkmark on success
- Connected docs stay in the list with a checkmark (or are removed — either works) so the user can connect multiple docs in one session
- Back/Done dismisses the picker
- `ConnectDocsView` reloads its document list when the picker is dismissed

**ViewModel:** `DriveFilePickerViewModel` — holds file list, loading state, and a `connect(file:)` method.

**APIClient addition:** `listDriveFiles(connectionId: String) async throws -> [DriveFile]`

**New model:** `DriveFile` — `id: String`, `name: String`, `modifiedTime: String`

---

## 4. ConnectDocsView Updates

### Layout changes by state

**No connection:**
- "Connect Google Drive" button (existing) → triggers OAuth → on success, opens file picker

**Has connection, no docs:**
- Connected banner (existing)
- "Add Documents" button → opens `DriveFilePickerView`

**Has connection + docs:**
- Connected banner (existing)
- Doc list with swipe-to-refresh and swipe-to-delete (existing)
- "Add Documents" button → opens `DriveFilePickerView`
- "Refresh All" toolbar button → calls `POST /documents/:id/refresh` for each doc

### "Add Documents" button

Placed below the connected banner. Opens `DriveFilePickerView` as a sheet with the active connection ID.

### "Refresh All" button

Toolbar button (top-right area, next to "Done"). Refreshes all connected docs sequentially. Shows loading state while refreshing.

---

## 5. Scope

### In scope
- `ASWebAuthenticationSession` OAuth flow
- Custom URL scheme `hearthstone://`
- Backend 302 redirect on OAuth callback
- `GET /connections/:id/files` endpoint
- `DriveFilePickerView` with loading/empty/error/list states
- "Add Documents" button on ConnectDocsView
- "Refresh All" button on ConnectDocsView
- APIClient + ViewModel additions

### Out of scope
- Auto-polling `modifiedTime` (future enhancement)
- Google Drive webhooks (v2)
- Folder browsing (flat list only)
- Multi-select in picker (tap-to-connect one at a time)
- Pagination of Drive file list (pageSize=100 is sufficient for v1)
- GitHub repo integration (separate design)
