# Google Drive Integration Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Google Drive OAuth flow, add a Drive file picker, and add refresh controls so owners can connect Drive, browse their docs, and select which ones to index.

**Architecture:** iOS uses `ASWebAuthenticationSession` for OAuth, which redirects back to the app via a custom URL scheme (`hearthstone://`). The backend's existing callback handler is modified to 302 redirect instead of returning JSON. A new backend endpoint lists Drive files. A new iOS screen lets owners pick files from Drive. All Google API access is proxied through the backend — iOS never talks to Google directly.

**Tech Stack:** SwiftUI, AuthenticationServices framework, Bun/TypeScript backend, Google Drive API v3

**Spec:** `docs/superpowers/specs/2026-04-06-google-drive-flow-design.md`

---

## File Structure

### Backend (TypeScript)
- **Modify:** `backend/src/routes/connections.ts` — change callback to 302 redirect, add `handleListDriveFiles` handler
- **Modify:** `backend/src/index.ts` — wire new `GET /connections/:id/files` route
- **Modify:** `backend/src/services/google-drive.ts` — add `listDriveFiles` function

### iOS (Swift)
- **Create:** `ios/Hearthstone/Models/DriveFile.swift` — model for Google Drive file listing
- **Create:** `ios/Hearthstone/Views/Owner/DriveFilePickerView.swift` — file picker screen
- **Create:** `ios/Hearthstone/ViewModels/DriveFilePickerViewModel.swift` — picker logic
- **Modify:** `ios/Hearthstone/Services/APIClient.swift` — add `listDriveFiles` method
- **Modify:** `ios/Hearthstone/ViewModels/ConnectionsViewModel.swift` — switch to `ASWebAuthenticationSession`
- **Modify:** `ios/Hearthstone/Views/Owner/ConnectDocsView.swift` — add "Add Documents" button, "Refresh All" button, wire picker
- **Modify:** `ios/Hearthstone/ViewModels/DocumentsViewModel.swift` — add `refreshAll` method
- **Modify:** `ios/Hearthstone.xcodeproj/project.pbxproj` — register custom URL scheme (via Info.plist file)
- **Create:** `ios/Hearthstone/Info.plist` — define `hearthstone://` URL scheme

---

### Task 1: Backend — Change OAuth Callback to 302 Redirect

**Files:**
- Modify: `backend/src/routes/connections.ts` (lines 31-76, `handleGoogleDriveCallback`)

Currently the callback returns `{ status: 200, body: { connection } }`. Change it to return a redirect URL that the iOS app's `ASWebAuthenticationSession` can capture.

- [ ] **Step 1: Modify `handleGoogleDriveCallback` to return redirect URLs**

In `backend/src/routes/connections.ts`, replace the success and error returns:

```typescript
export async function handleGoogleDriveCallback(
  db: Database.Database,
  code: string,
  state: string
): Promise<{ status: number; body: any; redirect?: string }> {
  if (!code || !state) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Missing+code+or+state" };
  }

  let householdId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    householdId = decoded.householdId;
    if (!householdId) throw new Error("missing householdId");
  } catch {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Invalid+state" };
  }

  const household = db
    .prepare("SELECT id FROM households WHERE id = ?")
    .get(householdId);
  if (!household) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Household+not+found" };
  }

  const redirectUri = `${config.appBaseUrl}/connections/google-drive/callback`;

  try {
    const { refreshToken, email } = await exchangeCodeForDrive(code, redirectUri);

    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, householdId, "google_drive", refreshToken, email ?? null, now);

    return { status: 302, body: null, redirect: `hearthstone://drive-connected?connection_id=${id}` };
  } catch (err) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Google+authorization+failed" };
  }
}
```

- [ ] **Step 2: Update `index.ts` to handle redirect responses from the callback**

In `backend/src/index.ts`, the callback route currently does `return json(result.body, result.status)`. Change it to handle the redirect:

```typescript
if (method === "GET" && pathname === "/connections/google-drive/callback") {
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const result = await handleGoogleDriveCallback(getDb(), code, state);
  if (result.redirect) {
    return new Response(null, {
      status: 302,
      headers: { Location: result.redirect },
    });
  }
  return json(result.body, result.status);
}
```

- [ ] **Step 3: Test manually**

Run: `cd backend && bun run src/index.ts`

Verify the server starts without errors. The redirect behavior will be tested end-to-end with the iOS app later.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/connections.ts backend/src/index.ts
git commit -m "feat(backend): OAuth callback returns 302 redirect to hearthstone:// scheme"
```

---

### Task 2: Backend — Add Drive File Listing Endpoint

**Files:**
- Modify: `backend/src/services/google-drive.ts` — add `listDriveFiles` function
- Modify: `backend/src/routes/connections.ts` — add `handleListDriveFiles` handler
- Modify: `backend/src/index.ts` — wire `GET /connections/:id/files` route

- [ ] **Step 1: Add `listDriveFiles` to `google-drive.ts`**

In `backend/src/services/google-drive.ts`, add:

```typescript
export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function listDriveFiles(
  refreshToken: string
): Promise<DriveFileInfo[]> {
  const accessToken = await getAccessToken(refreshToken);

  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.document'",
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "100",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);

  const data = (await res.json()) as { files: DriveFileInfo[] };
  return data.files || [];
}
```

- [ ] **Step 2: Add `handleListDriveFiles` to `connections.ts`**

In `backend/src/routes/connections.ts`, add the import and handler:

```typescript
import { listDriveFiles } from "../services/google-drive";

export async function handleListDriveFiles(
  db: Database.Database,
  householdId: string,
  connectionId: string
): Promise<{ status: number; body: any }> {
  const connection = db
    .prepare(
      "SELECT id, refresh_token FROM connections WHERE id = ? AND household_id = ?"
    )
    .get(connectionId, householdId) as any;

  if (!connection) {
    return { status: 404, body: { message: "Connection not found" } };
  }

  try {
    const allFiles = await listDriveFiles(connection.refresh_token);

    // Filter out docs already connected to this household
    const existingDriveIds = db
      .prepare("SELECT drive_file_id FROM documents WHERE household_id = ?")
      .all(householdId)
      .map((row: any) => row.drive_file_id);

    const existingSet = new Set(existingDriveIds);
    const files = allFiles
      .filter((f) => !existingSet.has(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name,
        modified_time: f.modifiedTime,
      }));

    return { status: 200, body: { files } };
  } catch (err) {
    return { status: 502, body: { message: "Failed to list Drive files" } };
  }
}
```

- [ ] **Step 3: Wire the route in `index.ts`**

Add import of `handleListDriveFiles` to the import block in `backend/src/index.ts`:

```typescript
import {
  handleListConnections,
  handleConnectGoogleDrive,
  handleGoogleDriveCallback,
  handleDeleteConnection,
  handleListDriveFiles,
} from "./routes/connections";
```

Add the route handler in the connection routes section, **before** the `deleteConnParams` matcher (since `parsePathParams("/connections/:id", pathname)` would also match `/connections/:id/files`):

```typescript
const connFilesParams = parsePathParams("/connections/:id/files", pathname);
if (method === "GET" && connFilesParams) {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const result = await handleListDriveFiles(getDb(), owner.householdId, connFilesParams.id);
  return json(result.body, result.status);
}
```

- [ ] **Step 4: Test manually**

Run: `cd backend && bun run src/index.ts`

Verify the server starts without errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/google-drive.ts backend/src/routes/connections.ts backend/src/index.ts
git commit -m "feat(backend): add GET /connections/:id/files — list Google Drive docs"
```

---

### Task 3: iOS — Register Custom URL Scheme

**Files:**
- Create: `ios/Hearthstone/Info.plist`
- Modify: `ios/Hearthstone.xcodeproj/project.pbxproj` — reference Info.plist (via Xcode build settings)

The project uses `GENERATE_INFOPLIST_FILE = YES` with no custom Info.plist. We need to create one with the URL scheme and point the build settings at it.

- [ ] **Step 1: Create `Info.plist` with URL scheme**

Create `ios/Hearthstone/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>com.hearthstone.app</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>hearthstone</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
```

- [ ] **Step 2: Update project.pbxproj to use the Info.plist**

In `ios/Hearthstone.xcodeproj/project.pbxproj`, in both the Debug and Release build settings sections, change:

```
GENERATE_INFOPLIST_FILE = YES;
```

to:

```
GENERATE_INFOPLIST_FILE = YES;
INFOPLIST_FILE = Hearthstone/Info.plist;
```

The `GENERATE_INFOPLIST_FILE = YES` stays so Xcode still auto-generates launch screen and orientation keys, but `INFOPLIST_FILE` lets our custom keys (URL scheme) merge in.

- [ ] **Step 3: Verify build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Info.plist ios/Hearthstone.xcodeproj/project.pbxproj
git commit -m "feat(ios): register hearthstone:// custom URL scheme"
```

---

### Task 4: iOS — DriveFile Model and APIClient Method

**Files:**
- Create: `ios/Hearthstone/Models/DriveFile.swift`
- Modify: `ios/Hearthstone/Services/APIClient.swift`

- [ ] **Step 1: Create `DriveFile` model**

Create `ios/Hearthstone/Models/DriveFile.swift`:

```swift
import Foundation

struct DriveFile: Codable, Identifiable {
    let id: String
    let name: String
    let modifiedTime: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case modifiedTime = "modified_time"
    }
}
```

- [ ] **Step 2: Add `listDriveFiles` to `APIClient`**

In `ios/Hearthstone/Services/APIClient.swift`, in the Connection endpoints section (after `deleteConnection`), add:

```swift
func listDriveFiles(connectionId: String) async throws -> [DriveFile] {
    struct Response: Decodable { let files: [DriveFile] }
    let r: Response = try await call(method: "GET", path: "/connections/\(connectionId)/files", auth: .owner)
    return r.files
}
```

- [ ] **Step 3: Verify build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Models/DriveFile.swift ios/Hearthstone/Services/APIClient.swift
git commit -m "feat(ios): add DriveFile model and listDriveFiles API method"
```

---

### Task 5: iOS — Switch OAuth to ASWebAuthenticationSession

**Files:**
- Modify: `ios/Hearthstone/ViewModels/ConnectionsViewModel.swift`

Replace the Safari bounce with `ASWebAuthenticationSession`. The ViewModel gains a `connectionId` property that gets set on successful OAuth, which the view will use to present the file picker.

- [ ] **Step 1: Rewrite `ConnectionsViewModel`**

Replace the entire contents of `ios/Hearthstone/ViewModels/ConnectionsViewModel.swift`:

```swift
import Foundation
import AuthenticationServices
import UIKit

@MainActor
final class ConnectionsViewModel: ObservableObject {
    @Published var connections: [Connection] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var newConnectionId: String?

    func load() async {
        do {
            connections = try await APIClient.shared.listConnections()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func connectGoogleDrive() async {
        do {
            let response = try await APIClient.shared.connectGoogleDrive()
            guard let authURL = URL(string: response.authUrl) else {
                self.error = "Invalid auth URL"
                return
            }

            let callbackURL = try await startAuthSession(url: authURL)
            let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)

            if callbackURL.host == "drive-connected",
               let connectionId = components?.queryItems?.first(where: { $0.name == "connection_id" })?.value {
                await load()
                newConnectionId = connectionId
            } else if callbackURL.host == "drive-error" {
                let message = components?.queryItems?.first(where: { $0.name == "message" })?.value ?? "Connection failed"
                self.error = message.replacingOccurrences(of: "+", with: " ")
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // User cancelled — not an error
        } catch {
            self.error = error.localizedDescription
        }
    }

    func removeConnection(id: String) async {
        do {
            try await APIClient.shared.deleteConnection(id: id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startAuthSession(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "hearthstone"
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                }
            }
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = ASWebAuthSessionContextProvider.shared
            session.start()
        }
    }
}

// Provides the window anchor for ASWebAuthenticationSession
final class ASWebAuthSessionContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = ASWebAuthSessionContextProvider()
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
```

- [ ] **Step 2: Verify build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/ViewModels/ConnectionsViewModel.swift
git commit -m "feat(ios): switch OAuth to ASWebAuthenticationSession with hearthstone:// redirect"
```

---

### Task 6: iOS — Drive File Picker View and ViewModel

**Files:**
- Create: `ios/Hearthstone/ViewModels/DriveFilePickerViewModel.swift`
- Create: `ios/Hearthstone/Views/Owner/DriveFilePickerView.swift`

- [ ] **Step 1: Create `DriveFilePickerViewModel`**

Create `ios/Hearthstone/ViewModels/DriveFilePickerViewModel.swift`:

```swift
import Foundation

@MainActor
final class DriveFilePickerViewModel: ObservableObject {
    @Published var files: [DriveFile] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var connectingFileIds: Set<String> = []
    @Published var connectedFileIds: Set<String> = []

    private let connectionId: String

    init(connectionId: String) {
        self.connectionId = connectionId
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            files = try await APIClient.shared.listDriveFiles(connectionId: connectionId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func connect(file: DriveFile) async {
        connectingFileIds.insert(file.id)
        do {
            _ = try await APIClient.shared.connectDocument(driveFileId: file.id, title: file.name)
            connectingFileIds.remove(file.id)
            connectedFileIds.insert(file.id)
        } catch {
            connectingFileIds.remove(file.id)
            self.error = error.localizedDescription
        }
    }
}
```

- [ ] **Step 2: Create `DriveFilePickerView`**

Create `ios/Hearthstone/Views/Owner/DriveFilePickerView.swift`:

```swift
import SwiftUI

struct DriveFilePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: DriveFilePickerViewModel

    init(connectionId: String) {
        _viewModel = StateObject(wrappedValue: DriveFilePickerViewModel(connectionId: connectionId))
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    VStack(spacing: 12) {
                        ProgressView().tint(Theme.hearth)
                        Text("Loading your documents...")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = viewModel.error, viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text("⚠️").font(.system(size: 40))
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.rose)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        Button("Retry") {
                            Task { await viewModel.load() }
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.hearth)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No Google Docs found")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Theme.charcoalSoft)
                        Text("Create a Google Doc in your Drive and it will appear here.")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(viewModel.files) { file in
                            DriveFileRow(
                                file: file,
                                isConnecting: viewModel.connectingFileIds.contains(file.id),
                                isConnected: viewModel.connectedFileIds.contains(file.id)
                            ) {
                                Task { await viewModel.connect(file: file) }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(Theme.cream)
            .navigationTitle("Select Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task {
            await viewModel.load()
        }
    }
}

struct DriveFileRow: View {
    let file: DriveFile
    let isConnecting: Bool
    let isConnected: Bool
    let onConnect: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Theme.charcoal)

                Text(formattedDate)
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
            }

            Spacer()

            if isConnected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(Theme.sage)
                    .font(.system(size: 20))
            } else if isConnecting {
                ProgressView()
                    .tint(Theme.hearth)
            } else {
                Button {
                    onConnect()
                } label: {
                    Text("Add")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Theme.hearth)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }

    private var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: file.modifiedTime) else {
            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: file.modifiedTime) else {
                return file.modifiedTime
            }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}
```

- [ ] **Step 3: Verify build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/ViewModels/DriveFilePickerViewModel.swift ios/Hearthstone/Views/Owner/DriveFilePickerView.swift
git commit -m "feat(ios): add Drive file picker — browse and connect Google Docs"
```

---

### Task 7: iOS — Update ConnectDocsView with Picker and Refresh All

**Files:**
- Modify: `ios/Hearthstone/Views/Owner/ConnectDocsView.swift`
- Modify: `ios/Hearthstone/ViewModels/DocumentsViewModel.swift`

- [ ] **Step 1: Add `refreshAll` to `DocumentsViewModel`**

In `ios/Hearthstone/ViewModels/DocumentsViewModel.swift`, add a method after `remove`:

```swift
func refreshAll() async {
    isLoading = true
    for doc in documents {
        do {
            _ = try await APIClient.shared.refreshDocument(id: doc.id)
        } catch {
            // Continue refreshing remaining docs even if one fails
        }
    }
    await load()
}
```

- [ ] **Step 2: Rewrite `ConnectDocsView`**

Replace the entire contents of `ios/Hearthstone/Views/Owner/ConnectDocsView.swift`:

```swift
import SwiftUI

struct ConnectDocsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var docsVM = DocumentsViewModel()
    @StateObject private var connVM = ConnectionsViewModel()
    @State private var showFilePicker = false
    @State private var isRefreshingAll = false

    /// The connection ID to use for the file picker — either from a fresh OAuth or existing connection
    private var activeConnectionId: String? {
        connVM.newConnectionId ?? connVM.connections.first?.id
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Connection status
                if connVM.connections.isEmpty {
                    Button {
                        Task { await connVM.connectGoogleDrive() }
                    } label: {
                        HStack {
                            Image(systemName: "link")
                            Text("Connect Google Drive")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.hearth)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                } else {
                    // Drive connected banner
                    HStack(spacing: 6) {
                        Text("⚡")
                        Text("Connected to Google Drive")
                            .fontWeight(.medium)
                        if let email = connVM.connections.first?.email {
                            Text("· \(email)")
                        }
                    }
                    .font(.system(size: 13))
                    .foregroundColor(Theme.goldBadgeText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        LinearGradient(colors: [Color(red: 1, green: 0.99, blue: 0.95), Color(red: 1, green: 0.97, blue: 0.9)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.goldBadge, lineWidth: 1))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)

                    // Add Documents button
                    Button {
                        showFilePicker = true
                    } label: {
                        HStack {
                            Image(systemName: "plus.circle.fill")
                            Text("Add Documents")
                                .fontWeight(.semibold)
                        }
                        .font(.system(size: 15))
                        .foregroundColor(Theme.hearth)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if docsVM.documents.isEmpty && !docsVM.isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No documents connected")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Theme.charcoalSoft)
                        Text("Connect your Google Drive and select documents to make them searchable by your guests.")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    Spacer()
                } else {
                    List {
                        ForEach(docsVM.documents) { doc in
                            DocumentRow(document: doc)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        Task { await docsVM.remove(documentId: doc.id) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .swipeActions(edge: .leading) {
                                    Button {
                                        Task { await docsVM.refresh(documentId: doc.id) }
                                    } label: {
                                        Label("Refresh", systemImage: "arrow.clockwise")
                                    }
                                    .tint(Theme.sage)
                                }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(Theme.cream)
            .navigationTitle("Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !docsVM.documents.isEmpty {
                        Button {
                            Task {
                                isRefreshingAll = true
                                await docsVM.refreshAll()
                                isRefreshingAll = false
                            }
                        } label: {
                            if isRefreshingAll {
                                ProgressView().tint(Theme.hearth)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .foregroundColor(Theme.hearth)
                            }
                        }
                        .disabled(isRefreshingAll)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Theme.hearth)
                        .fontWeight(.semibold)
                }
            }
            .sheet(isPresented: $showFilePicker, onDismiss: {
                Task { await docsVM.load() }
            }) {
                if let connectionId = activeConnectionId {
                    DriveFilePickerView(connectionId: connectionId)
                }
            }
        }
        .task {
            await connVM.load()
            await docsVM.load()
        }
        .onChange(of: connVM.newConnectionId) { connectionId in
            if connectionId != nil {
                showFilePicker = true
            }
        }
        .alert("Error", isPresented: .init(
            get: { connVM.error != nil },
            set: { if !$0 { connVM.error = nil } }
        )) {
            Button("OK") { connVM.error = nil }
        } message: {
            Text(connVM.error ?? "")
        }
    }
}

struct DocumentRow: View {
    let document: Document

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(document.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Theme.charcoal)

                HStack(spacing: 8) {
                    DocStatusBadge(status: document.status)
                    if let synced = document.lastSynced {
                        Text("Synced \(synced)")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.stone)
                    }
                }
            }

            Spacer()

            if let count = document.chunkCount, count > 0 {
                Text("\(count) chunks")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
            }
        }
        .padding(.vertical, 4)
    }
}

struct DocStatusBadge: View {
    let status: DocumentStatus

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.system(size: 11, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(backgroundColor)
            .foregroundColor(textColor)
            .clipShape(Capsule())
    }

    private var backgroundColor: Color {
        switch status {
        case .ready: return Theme.greenBadge
        case .indexing: return Theme.goldBadge
        case .error: return Theme.roseLight
        }
    }

    private var textColor: Color {
        switch status {
        case .ready: return Theme.greenBadgeText
        case .indexing: return Theme.goldBadgeText
        case .error: return Theme.rose
        }
    }
}
```

- [ ] **Step 3: Verify build**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Views/Owner/ConnectDocsView.swift ios/Hearthstone/ViewModels/DocumentsViewModel.swift
git commit -m "feat(ios): wire Drive file picker into ConnectDocsView, add Refresh All"
```

---

## Summary

| Task | What | Backend/iOS |
|------|------|-------------|
| 1 | OAuth callback → 302 redirect | Backend |
| 2 | `GET /connections/:id/files` endpoint | Backend |
| 3 | Register `hearthstone://` URL scheme | iOS |
| 4 | `DriveFile` model + `listDriveFiles` API method | iOS |
| 5 | `ASWebAuthenticationSession` OAuth flow | iOS |
| 6 | `DriveFilePickerView` + ViewModel | iOS |
| 7 | Wire picker into `ConnectDocsView` + Refresh All | iOS |

Tasks 1-2 (backend) are independent of Tasks 3-5 (iOS foundation) and can be done in parallel. Task 6 depends on Task 4. Task 7 depends on Tasks 5 and 6.
