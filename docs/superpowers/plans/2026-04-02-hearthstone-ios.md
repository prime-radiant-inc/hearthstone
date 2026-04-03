# Hearthstone iOS App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hearthstone iOS app in SwiftUI — owner dashboard, guest management, document connection, AI chat with streaming, source document viewer, and passkey authentication.

**Architecture:** Single-target SwiftUI app (iOS 17+). APIClient handles all networking. KeychainService stores tokens. Navigation via NavigationStack with path-based routing. Chat uses URLSession for SSE streaming. Auth uses AuthenticationServices for passkeys.

**Tech Stack:** SwiftUI, iOS 17+, AuthenticationServices (passkeys), URLSession (networking + SSE), Security framework (Keychain), Swift Concurrency (async/await)

**Design:** Warm amber/sienna palette. Fraunces serif for headings, system sans for body. Mocks at `mocks/01-entry-points.html`, `mocks/02-owner-hub.html`, `mocks/03-chat-experience.html`.

---

## File Structure

```
ios/
├── Hearthstone/
│   ├── HearthstoneApp.swift              — App entry point, routing
│   ├── Theme.swift                       — Colors, fonts, shared styles
│   ├── Models/
│   │   ├── Person.swift                  — Owner account model
│   │   ├── Household.swift               — Household model
│   │   ├── Guest.swift                   — Guest model with status enum
│   │   ├── Document.swift                — Connected document model
│   │   ├── Connection.swift              — Document source connection model
│   │   ├── ChatMessage.swift             — Chat message model (user/assistant)
│   │   └── Suggestion.swift              — Suggestion chip model
│   ├── Services/
│   │   ├── APIClient.swift               — All HTTP calls to backend
│   │   ├── KeychainService.swift         — Token storage (owner JWT + guest hss_)
│   │   ├── AuthService.swift             — Passkey + email verification orchestration
│   │   └── SSEClient.swift               — Server-Sent Events streaming client
│   ├── ViewModels/
│   │   ├── AuthViewModel.swift           — Sign in / register state
│   │   ├── DashboardViewModel.swift      — Dashboard data loading
│   │   ├── GuestListViewModel.swift      — Guest CRUD
│   │   ├── DocumentsViewModel.swift      — Document connection + management
│   │   ├── ChatViewModel.swift           — Chat messages + streaming
│   │   └── ConnectionsViewModel.swift    — Drive connection management
│   ├── Views/
│   │   ├── Auth/
│   │   │   ├── WelcomeView.swift         — Email entry screen
│   │   │   ├── VerifyCodeView.swift      — 6-digit code entry
│   │   │   └── HouseholdSetupView.swift  — Name your household
│   │   ├── Owner/
│   │   │   ├── DashboardView.swift       — Main owner screen (setup + ready states)
│   │   │   ├── GuestListView.swift       — Guest cards with actions
│   │   │   ├── AddGuestView.swift        — Sheet: name + email/phone
│   │   │   ├── ConnectDocsView.swift     — Sheet: Drive doc picker
│   │   │   └── OwnerPreviewView.swift    — Chat with preview banner
│   │   ├── Guest/
│   │   │   ├── ChatView.swift            — Main chat interface
│   │   │   ├── MessageBubble.swift       — Individual message rendering
│   │   │   ├── SuggestionChips.swift     — Chip row component
│   │   │   └── SourceDocumentView.swift  — Modal: rendered Markdown
│   │   ├── Error/
│   │   │   ├── InviteErrorView.swift     — Expired / already used
│   │   │   └── AccessRevokedView.swift   — Revoked guest state
│   │   └── Components/
│   │       ├── HearthButton.swift        — Primary button component
│   │       ├── HearthTextField.swift     — Styled text field
│   │       └── StatusBadge.swift         — Active/Pending/Revoked badge
│   └── Assets.xcassets/                  — App icon, colors
├── Hearthstone.xcodeproj/               — Generated or created manually
└── Package.swift                         — SPM dependencies (if any)
```

---

## Task 1: Xcode Project + Theme

**Files:**
- Create: `ios/Hearthstone/HearthstoneApp.swift`
- Create: `ios/Hearthstone/Theme.swift`
- Create: `ios/Hearthstone/Assets.xcassets/` (color set)

- [ ] **Step 1: Create project directory structure**

```bash
mkdir -p ios/Hearthstone/{Models,Services,ViewModels,Views/{Auth,Owner,Guest,Error,Components},Assets.xcassets}
```

- [ ] **Step 2: Write Theme.swift**

```swift
// ios/Hearthstone/Theme.swift
import SwiftUI

enum Theme {
    // MARK: - Colors
    static let hearth = Color(red: 181/255, green: 113/255, blue: 45/255)
    static let hearthDark = Color(red: 139/255, green: 90/255, blue: 30/255)
    static let cream = Color(red: 251/255, green: 247/255, blue: 240/255)
    static let creamWarm = Color(red: 245/255, green: 237/255, blue: 224/255)
    static let creamDeep = Color(red: 237/255, green: 227/255, blue: 209/255)
    static let charcoal = Color(red: 44/255, green: 37/255, blue: 32/255)
    static let charcoalSoft = Color(red: 92/255, green: 82/255, blue: 74/255)
    static let stone = Color(red: 155/255, green: 142/255, blue: 130/255)
    static let sage = Color(red: 122/255, green: 139/255, blue: 111/255)
    static let sageLight = Color(red: 232/255, green: 237/255, blue: 228/255)
    static let rose = Color(red: 196/255, green: 107/255, blue: 90/255)
    static let roseLight = Color(red: 242/255, green: 224/255, blue: 220/255)
    static let goldBadge = Color(red: 240/255, green: 229/255, blue: 200/255)
    static let goldBadgeText = Color(red: 139/255, green: 105/255, blue: 20/255)
    static let greenBadge = Color(red: 215/255, green: 232/255, blue: 208/255)
    static let greenBadgeText = Color(red: 61/255, green: 107/255, blue: 46/255)
    static let grayBadge = Color(red: 236/255, green: 234/255, blue: 231/255)
    static let grayBadgeText = Color(red: 123/255, green: 117/255, blue: 112/255)

    // MARK: - Typography
    // Fraunces needs to be bundled or use system serif as fallback
    static func heading(_ size: CGFloat) -> Font {
        .custom("Fraunces-Medium", size: size, relativeTo: .title)
    }
    static func headingFallback(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .serif)
    }

    // MARK: - Radii
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 10
    static let radiusSmall: CGFloat = 6
}
```

- [ ] **Step 3: Write HearthstoneApp.swift (minimal, routes later)**

```swift
// ios/Hearthstone/HearthstoneApp.swift
import SwiftUI

@main
struct HearthstoneApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        Text("Hearthstone")
            .font(Theme.headingFallback(28))
            .foregroundColor(Theme.hearth)
    }
}
```

- [ ] **Step 4: Create Xcode project**

Use `xcodebuild` or create manually. The project should:
- Target iOS 17.0
- Use SwiftUI lifecycle
- Bundle ID: `app.hearthstone.ios` (placeholder)
- Include all files from `ios/Hearthstone/`

If `xcodebuild` project creation isn't available from CLI, create a `project.yml` for XcodeGen:
```yaml
name: Hearthstone
options:
  bundleIdPrefix: app.hearthstone
  deploymentTarget:
    iOS: "17.0"
targets:
  Hearthstone:
    type: application
    platform: iOS
    sources: [Hearthstone]
    settings:
      INFOPLIST_FILE: Hearthstone/Info.plist
      PRODUCT_BUNDLE_IDENTIFIER: app.hearthstone.ios
      SWIFT_VERSION: "5.9"
```

If neither xcodegen nor xcodebuild is available, just create the file structure and note that the .xcodeproj needs to be created in Xcode. This is fine — the code is what matters.

- [ ] **Step 5: Commit**

```bash
git add ios/
git commit -m "feat(ios): project scaffold with theme and color system"
```

---

## Task 2: Models

**Files:**
- Create: `ios/Hearthstone/Models/Person.swift`
- Create: `ios/Hearthstone/Models/Household.swift`
- Create: `ios/Hearthstone/Models/Guest.swift`
- Create: `ios/Hearthstone/Models/Document.swift`
- Create: `ios/Hearthstone/Models/Connection.swift`
- Create: `ios/Hearthstone/Models/ChatMessage.swift`
- Create: `ios/Hearthstone/Models/Suggestion.swift`

- [ ] **Step 1: Write all model files**

```swift
// Models/Person.swift
import Foundation

struct Person: Codable, Identifiable {
    let id: String
    let email: String
}

// Models/Household.swift
import Foundation

struct Household: Codable, Identifiable {
    let id: String
    var name: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case createdAt = "created_at"
    }
}

// Models/Guest.swift
import Foundation

enum GuestStatus: String, Codable {
    case pending, active, revoked
}

struct Guest: Codable, Identifiable {
    let id: String
    let name: String
    let contact: String
    let contactType: String
    let status: GuestStatus
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, contact, status
        case contactType = "contact_type"
        case createdAt = "created_at"
    }
}

// Models/Document.swift
import Foundation

enum DocumentStatus: String, Codable {
    case indexing, ready, error
}

struct Document: Codable, Identifiable {
    let id: String
    let title: String
    let driveFileId: String
    let status: DocumentStatus
    let chunkCount: Int?
    let lastSynced: String?

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case driveFileId = "drive_file_id"
        case chunkCount = "chunk_count"
        case lastSynced = "last_synced"
    }
}

struct DocumentContent: Codable {
    let id: String
    let title: String
    let markdown: String
}

// Models/Connection.swift
import Foundation

struct Connection: Codable, Identifiable {
    let id: String
    let provider: String
    let email: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, provider, email
        case createdAt = "created_at"
    }
}

// Models/ChatMessage.swift
import Foundation

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: Role
    var content: String
    var sources: [ChatSource]

    enum Role {
        case user, assistant
    }
}

struct ChatSource: Codable, Identifiable {
    var id: String { documentId }
    let documentId: String
    let title: String
    let chunkIndex: Int

    enum CodingKeys: String, CodingKey {
        case documentId = "document_id"
        case title
        case chunkIndex = "chunk_index"
    }
}

// Models/Suggestion.swift
import Foundation

struct SuggestionsResponse: Codable {
    let suggestions: [String]
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Models/
git commit -m "feat(ios): data models — Person, Household, Guest, Document, Connection, ChatMessage"
```

---

## Task 3: KeychainService

**Files:**
- Create: `ios/Hearthstone/Services/KeychainService.swift`

- [ ] **Step 1: Write KeychainService**

```swift
// Services/KeychainService.swift
import Foundation
import Security

final class KeychainService {
    static let shared = KeychainService()
    private init() {}

    private let ownerTokenKey = "hearthstone_owner_jwt"
    private let guestTokenKey = "hearthstone_guest_hss"

    // MARK: - Owner JWT

    var ownerToken: String? {
        get { read(key: ownerTokenKey) }
        set {
            if let value = newValue {
                save(key: ownerTokenKey, value: value)
            } else {
                delete(key: ownerTokenKey)
            }
        }
    }

    // MARK: - Guest Session Token

    var guestToken: String? {
        get { read(key: guestTokenKey) }
        set {
            if let value = newValue {
                save(key: guestTokenKey, value: value)
            } else {
                delete(key: guestTokenKey)
            }
        }
    }

    // MARK: - Keychain Operations

    private func save(key: String, value: String) {
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

    private func read(key: String) -> String? {
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

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    func clearAll() {
        ownerToken = nil
        guestToken = nil
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Services/KeychainService.swift
git commit -m "feat(ios): KeychainService — owner JWT + guest hss_ token storage"
```

---

## Task 4: APIClient

**Files:**
- Create: `ios/Hearthstone/Services/APIClient.swift`

- [ ] **Step 1: Write APIClient**

All backend calls go through this single service. It handles auth headers, JSON encoding/decoding, and error mapping.

```swift
// Services/APIClient.swift
import Foundation

final class APIClient {
    static let shared = APIClient()

    #if DEBUG
    private let baseURL = "http://localhost:3000"
    #else
    private let baseURL = "https://api.hearthstone.app"
    #endif

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private let encoder = JSONEncoder()

    // MARK: - Auth: Register

    struct RegisterResponse: Codable {
        let message: String
        let email: String
    }

    func register(email: String) async throws -> RegisterResponse {
        try await post("/auth/register", body: ["email": email])
    }

    struct RegisterVerifyRequest: Codable {
        let email: String
        let code: String
    }

    struct RegisterVerifyResponse: Codable {
        let registrationOptions: AnyCodable  // WebAuthn options passed to iOS
        let personId: String

        enum CodingKeys: String, CodingKey {
            case registrationOptions = "registration_options"
            case personId = "person_id"
        }
    }

    func registerVerify(email: String, code: String) async throws -> RegisterVerifyResponse {
        try await post("/auth/register/verify", body: RegisterVerifyRequest(email: email, code: code))
    }

    struct LoginEmailResponse: Codable {
        let message: String
    }

    func loginEmail(email: String) async throws -> LoginEmailResponse {
        try await post("/auth/login/email", body: ["email": email])
    }

    struct AuthResponse: Codable {
        let token: String
        let person: Person
        let household: Household?
        let isNew: Bool?

        enum CodingKeys: String, CodingKey {
            case token, person, household
            case isNew = "is_new"
        }
    }

    func loginEmailVerify(email: String, code: String) async throws -> AuthResponse {
        try await post("/auth/login/email/verify", body: RegisterVerifyRequest(email: email, code: code))
    }

    // MARK: - Auth: Guest Invite

    struct InviteRedeemResponse: Codable {
        let sessionToken: String
        let guest: Guest

        enum CodingKeys: String, CodingKey {
            case sessionToken = "session_token"
            case guest
        }
    }

    func redeemInvite(token: String) async throws -> InviteRedeemResponse {
        try await post("/auth/invite/redeem", body: ["invite_token": token])
    }

    // MARK: - Household

    func createHousehold(name: String) async throws -> Household {
        try await post("/household", body: ["name": name], auth: .owner)
    }

    func updateHousehold(name: String) async throws -> Household {
        try await request("/household", method: "PATCH", body: ["name": name], auth: .owner)
    }

    // MARK: - Guests

    struct GuestsResponse: Codable {
        let guests: [Guest]
    }

    func listGuests() async throws -> [Guest] {
        let response: GuestsResponse = try await get("/guests", auth: .owner)
        return response.guests
    }

    struct CreateGuestRequest: Codable {
        let name: String
        let email: String?
        let phone: String?
    }

    struct CreateGuestResponse: Codable {
        let guest: Guest
        let magicLink: String
        let inviteToken: String

        enum CodingKeys: String, CodingKey {
            case guest
            case magicLink = "magic_link"
            case inviteToken = "invite_token"
        }
    }

    func createGuest(name: String, email: String?, phone: String?) async throws -> CreateGuestResponse {
        try await post("/guests", body: CreateGuestRequest(name: name, email: email, phone: phone), auth: .owner)
    }

    struct RevokeResponse: Codable {
        let guestId: String
        let revokedAt: String

        enum CodingKeys: String, CodingKey {
            case guestId = "guest_id"
            case revokedAt = "revoked_at"
        }
    }

    func revokeGuest(id: String) async throws -> RevokeResponse {
        try await post("/guests/\(id)/revoke", auth: .owner)
    }

    func deleteGuest(id: String) async throws {
        try await delete("/guests/\(id)", auth: .owner)
    }

    // MARK: - Connections

    struct ConnectionsResponse: Codable {
        let connections: [Connection]
    }

    func listConnections() async throws -> [Connection] {
        let response: ConnectionsResponse = try await get("/connections", auth: .owner)
        return response.connections
    }

    struct ConnectDriveResponse: Codable {
        let authUrl: String

        enum CodingKeys: String, CodingKey {
            case authUrl = "auth_url"
        }
    }

    func connectGoogleDrive() async throws -> ConnectDriveResponse {
        try await post("/connections/google-drive", auth: .owner)
    }

    func deleteConnection(id: String) async throws {
        try await delete("/connections/\(id)", auth: .owner)
    }

    // MARK: - Documents

    struct DocumentsResponse: Codable {
        let documents: [Document]
    }

    func listDocuments() async throws -> [Document] {
        let response: DocumentsResponse = try await get("/documents", auth: .owner)
        return response.documents
    }

    struct ConnectDocRequest: Codable {
        let driveFileId: String
        let title: String?

        enum CodingKeys: String, CodingKey {
            case driveFileId = "drive_file_id"
            case title
        }
    }

    func connectDocument(driveFileId: String, title: String?) async throws -> Document {
        try await post("/documents", body: ConnectDocRequest(driveFileId: driveFileId, title: title), auth: .owner)
    }

    func refreshDocument(id: String) async throws -> Document {
        try await post("/documents/\(id)/refresh", auth: .owner)
    }

    func deleteDocument(id: String) async throws {
        try await delete("/documents/\(id)", auth: .owner)
    }

    func getDocumentContent(id: String, auth: AuthType = .guest) async throws -> DocumentContent {
        try await get("/documents/\(id)/content", auth: auth)
    }

    // MARK: - Chat

    func getSuggestions() async throws -> [String] {
        let response: SuggestionsResponse = try await get("/chat/suggestions", auth: .guest)
        return response.suggestions
    }

    // Chat streaming is handled by SSEClient, not here

    // MARK: - Networking Core

    enum AuthType {
        case none, owner, guest
    }

    private func get<T: Decodable>(_ path: String, auth: AuthType = .none) async throws -> T {
        try await request(path, method: "GET", auth: auth)
    }

    private func post<T: Decodable>(_ path: String, auth: AuthType = .none) async throws -> T {
        try await request(path, method: "POST", auth: auth)
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B, auth: AuthType = .none) async throws -> T {
        try await request(path, method: "POST", body: body, auth: auth)
    }

    private func delete(_ path: String, auth: AuthType = .none) async throws {
        let _: EmptyResponse = try await request(path, method: "DELETE", auth: auth)
    }

    private func request<T: Decodable>(_ path: String, method: String, auth: AuthType = .none) async throws -> T {
        try await request(path, method: method, body: Optional<EmptyBody>.none, auth: auth)
    }

    private func request<B: Encodable, T: Decodable>(_ path: String, method: String, body: B? = nil, auth: AuthType = .none) async throws -> T {
        var urlRequest = URLRequest(url: URL(string: baseURL + path)!)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body = body {
            urlRequest.httpBody = try encoder.encode(body)
        }

        switch auth {
        case .none: break
        case .owner:
            if let token = KeychainService.shared.ownerToken {
                urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        case .guest:
            if let token = KeychainService.shared.guestToken {
                urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let httpResponse = response as! HTTPURLResponse

        if httpResponse.statusCode == 204 {
            return EmptyResponse() as! T
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorBody = try? decoder.decode(ErrorResponse.self, from: data) {
                throw APIError.server(httpResponse.statusCode, errorBody.message)
            }
            throw APIError.http(httpResponse.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }

    private struct EmptyBody: Encodable {}
    struct EmptyResponse: Codable {}
    private struct ErrorResponse: Codable {
        let message: String
    }
}

enum APIError: LocalizedError {
    case http(Int)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .http(let code): return "Request failed (\(code))"
        case .server(_, let message): return message
        }
    }
}

// Simple wrapper for untyped JSON (WebAuthn options)
struct AnyCodable: Codable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let dict = value as? [String: Any] {
            try container.encode(dict.mapValues { AnyCodable(value: $0) })
        } else if let string = value as? String {
            try container.encode(string)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else {
            try container.encodeNil()
        }
    }

    init(value: Any) {
        self.value = value
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Services/APIClient.swift
git commit -m "feat(ios): APIClient — all backend endpoints with auth header injection"
```

---

## Task 5: SSEClient (Server-Sent Events)

**Files:**
- Create: `ios/Hearthstone/Services/SSEClient.swift`

- [ ] **Step 1: Write SSEClient**

```swift
// Services/SSEClient.swift
import Foundation

final class SSEClient {
    struct ChatRequest: Encodable {
        let message: String
        let history: [HistoryMessage]
    }

    struct HistoryMessage: Encodable {
        let role: String
        let content: String
    }

    struct DeltaEvent: Decodable {
        let delta: String?
        let sources: [ChatSource]?
        let error: String?
    }

    static func streamChat(
        message: String,
        history: [HistoryMessage],
        isPreview: Bool = false,
        baseURL: String = {
            #if DEBUG
            return "http://localhost:3000"
            #else
            return "https://api.hearthstone.app"
            #endif
        }()
    ) -> AsyncThrowingStream<DeltaEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                let path = isPreview ? "/chat/preview" : "/chat"
                var request = URLRequest(url: URL(string: baseURL + path)!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

                let token = isPreview
                    ? KeychainService.shared.ownerToken
                    : KeychainService.shared.guestToken

                if let token = token {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }

                let body = ChatRequest(message: message, history: history)
                request.httpBody = try? JSONEncoder().encode(body)

                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let httpResponse = response as! HTTPURLResponse

                    guard httpResponse.statusCode == 200 else {
                        continuation.finish(throwing: APIError.http(httpResponse.statusCode))
                        return
                    }

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst(6))

                        if payload == "[DONE]" {
                            continuation.finish()
                            return
                        }

                        if let data = payload.data(using: .utf8),
                           let event = try? JSONDecoder().decode(DeltaEvent.self, from: data) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/Hearthstone/Services/SSEClient.swift
git commit -m "feat(ios): SSEClient — async stream of chat deltas via Server-Sent Events"
```

---

## Task 6: Shared Components

**Files:**
- Create: `ios/Hearthstone/Views/Components/HearthButton.swift`
- Create: `ios/Hearthstone/Views/Components/HearthTextField.swift`
- Create: `ios/Hearthstone/Views/Components/StatusBadge.swift`

- [ ] **Step 1: Write HearthButton**

```swift
// Views/Components/HearthButton.swift
import SwiftUI

struct HearthButton: View {
    let title: String
    var isLoading: Bool = false
    let action: () -> Void

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
                LinearGradient(
                    colors: [Theme.hearth, Theme.hearthDark],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: Theme.hearth.opacity(0.3), radius: 7, y: 4)
        }
        .disabled(isLoading)
    }
}
```

- [ ] **Step 2: Write HearthTextField**

```swift
// Views/Components/HearthTextField.swift
import SwiftUI

struct HearthTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var autocapitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Theme.charcoalSoft)
                .tracking(0.8)

            TextField(placeholder, text: $text)
                .font(.system(size: 17))
                .padding(16)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(Theme.creamDeep, lineWidth: 1.5)
                )
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
        }
    }
}
```

- [ ] **Step 3: Write StatusBadge**

```swift
// Views/Components/StatusBadge.swift
import SwiftUI

struct StatusBadge: View {
    let status: GuestStatus

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
        case .active: return Theme.greenBadge
        case .pending: return Theme.goldBadge
        case .revoked: return Theme.grayBadge
        }
    }

    private var textColor: Color {
        switch status {
        case .active: return Theme.greenBadgeText
        case .pending: return Theme.goldBadgeText
        case .revoked: return Theme.grayBadgeText
        }
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/Views/Components/
git commit -m "feat(ios): shared components — HearthButton, HearthTextField, StatusBadge"
```

---

## Task 7: Auth Views + ViewModel

**Files:**
- Create: `ios/Hearthstone/ViewModels/AuthViewModel.swift`
- Create: `ios/Hearthstone/Views/Auth/WelcomeView.swift`
- Create: `ios/Hearthstone/Views/Auth/VerifyCodeView.swift`
- Create: `ios/Hearthstone/Views/Auth/HouseholdSetupView.swift`

- [ ] **Step 1: Write AuthViewModel**

```swift
// ViewModels/AuthViewModel.swift
import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var email = ""
    @Published var code = ""
    @Published var householdName = ""
    @Published var isLoading = false
    @Published var error: String?
    @Published var step: AuthStep = .welcome

    enum AuthStep {
        case welcome
        case verifyCode
        case setupHousehold
        case done
    }

    func sendCode() async {
        guard !email.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            // Try register first; if 409 (already exists), do login
            do {
                _ = try await APIClient.shared.register(email: email)
            } catch let apiError as APIError {
                if case .server(409, _) = apiError {
                    _ = try await APIClient.shared.loginEmail(email: email)
                } else {
                    throw apiError
                }
            }
            step = .verifyCode
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func verifyCode() async {
        guard code.count == 6 else { return }
        isLoading = true
        error = nil
        do {
            // Try login verify first (existing user)
            let response = try await APIClient.shared.loginEmailVerify(email: email, code: code)
            KeychainService.shared.ownerToken = response.token
            if response.household != nil {
                step = .done
            } else {
                step = .setupHousehold
            }
        } catch {
            self.error = "Invalid or expired code"
        }
        isLoading = false
    }

    func createHousehold() async {
        guard !householdName.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            _ = try await APIClient.shared.createHousehold(name: householdName)
            step = .done
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```

- [ ] **Step 2: Write WelcomeView**

```swift
// Views/Auth/WelcomeView.swift
import SwiftUI

struct WelcomeView: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo
            RoundedRectangle(cornerRadius: 24)
                .fill(LinearGradient(colors: [Theme.hearth, Theme.hearthDark], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 88, height: 88)
                .overlay(Text("🏠").font(.system(size: 44)))
                .shadow(color: Theme.hearth.opacity(0.3), radius: 10, y: 6)
                .padding(.bottom, 28)

            Text("Hearthstone")
                .font(Theme.headingFallback(32))
                .foregroundColor(Theme.charcoal)
                .padding(.bottom, 10)

            Text("Your household knowledge, always at hand\nfor the people who need it.")
                .font(.system(size: 16))
                .foregroundColor(Theme.charcoalSoft)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.bottom, 48)

            HearthTextField(
                label: "Email",
                placeholder: "you@example.com",
                text: $viewModel.email,
                keyboardType: .emailAddress,
                autocapitalization: .never
            )
            .padding(.horizontal, 32)
            .padding(.bottom, 20)

            HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                Task { await viewModel.sendCode() }
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 20)

            Text("We'll send a verification code to your email.\nNo password needed — ever.")
                .font(.system(size: 12))
                .foregroundColor(Theme.stone)
                .multilineTextAlignment(.center)
                .lineSpacing(3)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Theme.rose)
                    .padding(.top, 12)
            }

            Spacer()
            Spacer()
        }
        .background(Theme.cream)
    }
}
```

- [ ] **Step 3: Write VerifyCodeView**

```swift
// Views/Auth/VerifyCodeView.swift
import SwiftUI

struct VerifyCodeView: View {
    @ObservedObject var viewModel: AuthViewModel
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Progress dots
            HStack(spacing: 6) {
                ForEach(0..<3) { i in
                    Capsule()
                        .fill(i < 1 ? Theme.hearth : Theme.creamDeep)
                        .frame(height: 4)
                }
            }
            .padding(.bottom, 36)

            Text("Check your inbox")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.hearth)
                .padding(.bottom, 8)

            Text("Enter your code")
                .font(Theme.headingFallback(28))
                .foregroundColor(Theme.charcoal)
                .padding(.bottom, 10)

            Text("We sent a 6-digit code to **\(viewModel.email)**")
                .font(.system(size: 15))
                .foregroundColor(Theme.charcoalSoft)
                .padding(.bottom, 32)

            // Code input
            TextField("", text: $viewModel.code)
                .keyboardType(.numberPad)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .padding(16)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(Theme.hearth, lineWidth: 1.5)
                )
                .focused($isFocused)
                .onChange(of: viewModel.code) { _, newValue in
                    if newValue.count == 6 {
                        Task { await viewModel.verifyCode() }
                    }
                }
                .padding(.bottom, 24)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Theme.rose)
                    .padding(.bottom, 12)
            }

            HStack {
                Spacer()
                Text("Didn't get it?")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.stone)
                Button("Resend code") {
                    Task { await viewModel.sendCode() }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.hearth)
                Spacer()
            }

            Spacer()

            Text("Code expires in 10 minutes")
                .font(.system(size: 13))
                .foregroundColor(Theme.stone)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 16)
        }
        .padding(24)
        .background(Theme.cream)
        .onAppear { isFocused = true }
    }
}
```

- [ ] **Step 4: Write HouseholdSetupView**

```swift
// Views/Auth/HouseholdSetupView.swift
import SwiftUI

struct HouseholdSetupView: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Progress dots
            HStack(spacing: 6) {
                ForEach(0..<3) { i in
                    Capsule()
                        .fill(i < 2 ? Theme.hearth : Theme.creamDeep)
                        .frame(height: 4)
                }
            }
            .padding(.bottom, 36)

            Text("Welcome")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.hearth)
                .padding(.bottom, 8)

            Text("Name your household")
                .font(Theme.headingFallback(28))
                .foregroundColor(Theme.charcoal)
                .padding(.bottom, 10)

            Text("This is what your guests will see when they open the app. You can change it anytime.")
                .font(.system(size: 15))
                .foregroundColor(Theme.charcoalSoft)
                .lineSpacing(4)
                .padding(.bottom, 40)

            HearthTextField(
                label: "Household Name",
                placeholder: "e.g. The Anderson Home",
                text: $viewModel.householdName
            )
            .padding(.bottom, 8)

            Text("e.g. \"The Anderson Home\", \"123 Oak Street\", \"Beach House\"")
                .font(.system(size: 13))
                .foregroundColor(Theme.stone)

            Spacer()

            HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                Task { await viewModel.createHousehold() }
            }
            .padding(.bottom, 16)
        }
        .padding(24)
        .background(Theme.cream)
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/ViewModels/AuthViewModel.swift ios/Hearthstone/Views/Auth/
git commit -m "feat(ios): auth flow — WelcomeView, VerifyCodeView, HouseholdSetupView"
```

---

## Task 8: Dashboard View + ViewModel

**Files:**
- Create: `ios/Hearthstone/ViewModels/DashboardViewModel.swift`
- Create: `ios/Hearthstone/Views/Owner/DashboardView.swift`

- [ ] **Step 1: Write DashboardViewModel**

```swift
// ViewModels/DashboardViewModel.swift
import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var household: Household?
    @Published var documentCount = 0
    @Published var activeGuestCount = 0
    @Published var pendingGuestCount = 0
    @Published var isSetupComplete = false
    @Published var hasConnections = false

    func load() async {
        do {
            let guests = try await APIClient.shared.listGuests()
            activeGuestCount = guests.filter { $0.status == .active }.count
            pendingGuestCount = guests.filter { $0.status == .pending }.count

            let docs = try await APIClient.shared.listDocuments()
            documentCount = docs.count

            let connections = try await APIClient.shared.listConnections()
            hasConnections = !connections.isEmpty

            isSetupComplete = !docs.isEmpty && !guests.isEmpty
        } catch {
            // Silently handle — dashboard still shows with zeros
        }
    }
}
```

- [ ] **Step 2: Write DashboardView**

Follow the mock at `mocks/02-owner-hub.html` — amber hero header, stat cards, onboarding checklist (when setup incomplete), manage rows.

```swift
// Views/Owner/DashboardView.swift
import SwiftUI

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @State private var showGuestList = false
    @State private var showDocuments = false
    @State private var showPreview = false

    let householdName: String
    let ownerName: String

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Hero header
                VStack(alignment: .leading, spacing: 4) {
                    Text("YOUR HOUSEHOLD")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.2)
                        .opacity(0.7)
                    Text(householdName)
                        .font(Theme.headingFallback(26))
                    Text("Welcome back, \(ownerName)")
                        .font(.system(size: 14))
                        .opacity(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 28)
                .foregroundColor(.white)
                .background(
                    LinearGradient(colors: [Theme.hearth, Theme.hearthDark], startPoint: .topLeading, endPoint: .bottomTrailing)
                )

                // Stat cards
                HStack(spacing: 12) {
                    StatCard(number: viewModel.documentCount, label: "Documents", action: { showDocuments = true })
                    StatCard(number: viewModel.activeGuestCount, label: "Active guests", action: { showGuestList = true })
                }
                .padding(.horizontal, 24)
                .offset(y: -16)

                // Onboarding checklist (when not fully set up)
                if !viewModel.isSetupComplete {
                    OnboardingChecklist(
                        hasHousehold: true,
                        hasDocuments: viewModel.documentCount > 0,
                        hasGuests: viewModel.activeGuestCount > 0
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 4)
                }

                // Manage section
                VStack(alignment: .leading, spacing: 10) {
                    Text("MANAGE")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Theme.stone)
                        .tracking(1.2)
                        .padding(.bottom, 2)

                    ManageRow(icon: "📄", iconBg: Color(red: 1, green: 0.95, blue: 0.86),
                              title: "Documents",
                              subtitle: viewModel.documentCount == 0 ? "No docs connected yet" : "\(viewModel.documentCount) docs connected") {
                        showDocuments = true
                    }

                    ManageRow(icon: "👥", iconBg: Theme.sageLight,
                              title: "Guests",
                              subtitle: guestSubtitle) {
                        showGuestList = true
                    }

                    ManageRow(icon: "💬", iconBg: Color(red: 0.91, green: 0.89, blue: 0.94),
                              title: "Preview as Guest",
                              subtitle: "See what your guests see") {
                        showPreview = true
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
            }
        }
        .background(Theme.cream)
        .navigationBarHidden(true)
        .task { await viewModel.load() }
        .sheet(isPresented: $showGuestList) { GuestListView() }
        .sheet(isPresented: $showPreview) { OwnerPreviewView() }
    }

    private var guestSubtitle: String {
        if viewModel.activeGuestCount == 0 && viewModel.pendingGuestCount == 0 {
            return "No guests yet"
        }
        var parts: [String] = []
        if viewModel.activeGuestCount > 0 { parts.append("\(viewModel.activeGuestCount) active") }
        if viewModel.pendingGuestCount > 0 { parts.append("\(viewModel.pendingGuestCount) pending") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Subviews

struct StatCard: View {
    let number: Int
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(number)")
                    .font(Theme.headingFallback(32))
                    .foregroundColor(Theme.charcoal)
                Text(label)
                    .font(.system(size: 13))
                    .foregroundColor(Theme.stone)
                Text("Manage →")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.hearth)
                    .padding(.top, 6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            .shadow(color: .black.opacity(0.06), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
    }
}

struct OnboardingChecklist: View {
    let hasHousehold: Bool
    let hasDocuments: Bool
    let hasGuests: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("⚡ Get started")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Theme.goldBadgeText)

            ChecklistRow(done: hasHousehold, number: 1, text: "Create your household")
            ChecklistRow(done: hasDocuments, number: 2, text: "Connect your Google Docs")
            ChecklistRow(done: hasGuests, number: 3, text: "Invite your first guest")
        }
        .padding(18)
        .background(
            LinearGradient(colors: [Color(red: 1, green: 0.99, blue: 0.95), Color(red: 1, green: 0.97, blue: 0.9)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge).stroke(Theme.goldBadge, lineWidth: 1.5))
    }
}

struct ChecklistRow: View {
    let done: Bool
    let number: Int
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            if done {
                Circle()
                    .fill(Theme.hearth)
                    .frame(width: 26, height: 26)
                    .overlay(Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundColor(.white))
            } else {
                Circle()
                    .strokeBorder(Theme.goldBadge, lineWidth: 2)
                    .frame(width: 26, height: 26)
                    .overlay(Text("\(number)").font(.system(size: 12, weight: .bold)).foregroundColor(Theme.goldBadgeText))
            }

            Text(text)
                .font(.system(size: 14))
                .foregroundColor(done ? Theme.stone : Theme.charcoalSoft)
                .strikethrough(done)
        }
    }
}

struct ManageRow: View {
    let icon: String
    let iconBg: Color
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Text(icon)
                    .font(.system(size: 20))
                    .frame(width: 42, height: 42)
                    .background(iconBg)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.charcoal)
                    Text(subtitle).font(.system(size: 13)).foregroundColor(Theme.stone)
                }

                Spacer()

                Text("›")
                    .font(.system(size: 18))
                    .foregroundColor(Theme.creamDeep)
            }
            .padding(16)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            .shadow(color: .black.opacity(0.04), radius: 3, y: 1)
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/ViewModels/DashboardViewModel.swift ios/Hearthstone/Views/Owner/DashboardView.swift
git commit -m "feat(ios): DashboardView — hero header, stats, onboarding checklist, manage rows"
```

---

## Task 9: Guest List + Add Guest

**Files:**
- Create: `ios/Hearthstone/ViewModels/GuestListViewModel.swift`
- Create: `ios/Hearthstone/Views/Owner/GuestListView.swift`
- Create: `ios/Hearthstone/Views/Owner/AddGuestView.swift`

The GuestListView shows guest cards with status badges and contextual actions (Revoke for active/pending, Re-invite + Remove for revoked). AddGuestView is a sheet with name, email/phone toggle, and Send Invite button. Follow the mocks in `mocks/02-owner-hub.html`.

- [ ] **Step 1: Write GuestListViewModel**

Handles load, create, revoke, delete operations. Publishes `guests: [Guest]`, `isLoading`, `error`.

- [ ] **Step 2: Write GuestListView**

NavigationStack with list of GuestCard views. Each card shows avatar (initials), name, contact, status badge, time added, and action buttons.

- [ ] **Step 3: Write AddGuestView**

Sheet presented from GuestListView. Name field, Email/Phone segmented picker, contact field, Send Invite button.

- [ ] **Step 4: Commit**

```bash
git add ios/Hearthstone/ViewModels/GuestListViewModel.swift ios/Hearthstone/Views/Owner/GuestListView.swift ios/Hearthstone/Views/Owner/AddGuestView.swift
git commit -m "feat(ios): guest management — GuestListView with cards + AddGuestView sheet"
```

---

## Task 10: Chat View + ViewModel

**Files:**
- Create: `ios/Hearthstone/ViewModels/ChatViewModel.swift`
- Create: `ios/Hearthstone/Views/Guest/ChatView.swift`
- Create: `ios/Hearthstone/Views/Guest/MessageBubble.swift`
- Create: `ios/Hearthstone/Views/Guest/SuggestionChips.swift`

The chat is the core guest experience. Empty state with suggestion chips, streaming message display, source citations on each assistant message. Follow `mocks/03-chat-experience.html`.

- [ ] **Step 1: Write ChatViewModel**

```swift
// ViewModels/ChatViewModel.swift
import Foundation

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var inputText = ""
    @Published var suggestions: [String] = []
    @Published var isStreaming = false
    @Published var error: String?

    let isPreview: Bool

    init(isPreview: Bool = false) {
        self.isPreview = isPreview
    }

    func loadSuggestions() async {
        guard messages.isEmpty else { return }
        do {
            suggestions = try await APIClient.shared.getSuggestions()
        } catch {
            // Non-fatal — chips just don't show
        }
    }

    func send(_ text: String? = nil) async {
        let message = text ?? inputText
        guard !message.isEmpty, !isStreaming else { return }

        let userMessage = ChatMessage(role: .user, content: message, sources: [])
        messages.append(userMessage)
        inputText = ""
        suggestions = [] // Hide chips after first message

        var assistantMessage = ChatMessage(role: .assistant, content: "", sources: [])
        messages.append(assistantMessage)
        isStreaming = true

        let history = messages.dropLast(2).map { msg in
            SSEClient.HistoryMessage(
                role: msg.role == .user ? "user" : "assistant",
                content: msg.content
            )
        }

        do {
            for try await event in SSEClient.streamChat(message: message, history: Array(history), isPreview: isPreview) {
                if let delta = event.delta {
                    assistantMessage.content += delta
                    // Update the last message in place
                    if let lastIndex = messages.indices.last {
                        messages[lastIndex].content = assistantMessage.content
                    }
                }
                if let sources = event.sources {
                    assistantMessage.sources = sources
                    if let lastIndex = messages.indices.last {
                        messages[lastIndex].sources = sources
                    }
                }
            }
        } catch {
            self.error = "Something went wrong. Please try again."
        }

        isStreaming = false
    }
}
```

- [ ] **Step 2: Write ChatView, MessageBubble, SuggestionChips**

ChatView: header with household avatar + name, scrollable message list, suggestion chips (when empty), input bar with send button.
MessageBubble: user messages in amber, assistant in white card, source links below assistant messages.
SuggestionChips: horizontal wrapping chip buttons.

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/ViewModels/ChatViewModel.swift ios/Hearthstone/Views/Guest/
git commit -m "feat(ios): chat interface — streaming messages, suggestion chips, source citations"
```

---

## Task 11: Source Document View + Owner Preview

**Files:**
- Create: `ios/Hearthstone/Views/Guest/SourceDocumentView.swift`
- Create: `ios/Hearthstone/Views/Owner/OwnerPreviewView.swift`

- [ ] **Step 1: Write SourceDocumentView**

Modal sheet showing rendered Markdown content of a source document. Fetches from `/documents/:id/content`. Shows title in header, rendered text in body, Done button to dismiss. Follow `mocks/03-chat-experience.html` source document modal.

- [ ] **Step 2: Write OwnerPreviewView**

Wraps ChatView with `isPreview: true` and adds a persistent dark banner at top reading "👁 Owner Preview" with an "Exit Preview" button. Follow the owner preview mock.

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Views/Guest/SourceDocumentView.swift ios/Hearthstone/Views/Owner/OwnerPreviewView.swift
git commit -m "feat(ios): source document modal + owner preview mode with persistent banner"
```

---

## Task 12: Error Views

**Files:**
- Create: `ios/Hearthstone/Views/Error/InviteErrorView.swift`
- Create: `ios/Hearthstone/Views/Error/AccessRevokedView.swift`

- [ ] **Step 1: Write InviteErrorView**

Handles both expired and already-used invite states. Takes an error type enum parameter. Shows icon, title, description, and action button. Follow `mocks/01-entry-points.html` error states.

- [ ] **Step 2: Write AccessRevokedView**

Shows when a guest's session returns 401. Dark header with household name, lock icon, "Your access has been revoked" message, contact hint. Follow the access revoked mock.

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/Views/Error/
git commit -m "feat(ios): error views — invite expired/used, access revoked"
```

---

## Task 13: App Navigation + Routing

**Files:**
- Modify: `ios/Hearthstone/HearthstoneApp.swift`

- [ ] **Step 1: Write the root navigation**

The app needs to determine the user's state on launch and route accordingly:

1. **Has owner JWT?** → Validate, show Dashboard
2. **Has guest hss_ token?** → Validate, show Chat
3. **Neither?** → Show WelcomeView
4. **Opened via Universal Link (`/join/{hsi_token}`)?** → Redeem invite, then Chat

```swift
// HearthstoneApp.swift
import SwiftUI

@main
struct HearthstoneApp: App {
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            Group {
                switch router.state {
                case .loading:
                    LoadingView()
                case .welcome:
                    AuthFlow(router: router)
                case .ownerDashboard(let name, let ownerName):
                    NavigationStack {
                        DashboardView(householdName: name, ownerName: ownerName)
                    }
                case .guestChat(let householdName):
                    ChatView(viewModel: ChatViewModel(), householdName: householdName)
                case .inviteError(let type):
                    InviteErrorView(errorType: type)
                case .accessRevoked:
                    AccessRevokedView()
                }
            }
            .onOpenURL { url in
                router.handleUniversalLink(url)
            }
        }
    }
}

struct AuthFlow: View {
    @ObservedObject var router: AppRouter
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        Group {
            switch viewModel.step {
            case .welcome:
                WelcomeView(viewModel: viewModel)
            case .verifyCode:
                VerifyCodeView(viewModel: viewModel)
            case .setupHousehold:
                HouseholdSetupView(viewModel: viewModel)
            case .done:
                Color.clear.onAppear { router.checkAuth() }
            }
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack {
            ProgressView()
            Text("Hearthstone")
                .font(Theme.headingFallback(20))
                .foregroundColor(Theme.hearth)
                .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream)
    }
}
```

- [ ] **Step 2: Write AppRouter**

```swift
// HearthstoneApp.swift (continued, or separate file)

@MainActor
final class AppRouter: ObservableObject {
    @Published var state: AppState = .loading

    enum AppState {
        case loading
        case welcome
        case ownerDashboard(householdName: String, ownerName: String)
        case guestChat(householdName: String)
        case inviteError(InviteErrorType)
        case accessRevoked
    }

    init() {
        checkAuth()
    }

    func checkAuth() {
        if KeychainService.shared.ownerToken != nil {
            // TODO: validate token, fetch household name
            state = .ownerDashboard(householdName: "My Home", ownerName: "")
        } else if KeychainService.shared.guestToken != nil {
            state = .guestChat(householdName: "")
        } else {
            state = .welcome
        }
    }

    func handleUniversalLink(_ url: URL) {
        // hearthstone.app/join/{hsi_token}
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.path.hasPrefix("/join/"),
              let token = components.path.split(separator: "/").last else { return }

        Task {
            do {
                let response = try await APIClient.shared.redeemInvite(token: String(token))
                KeychainService.shared.guestToken = response.sessionToken
                state = .guestChat(householdName: "")
            } catch let error as APIError {
                if case .server(410, let message) = error {
                    if message.contains("expired") {
                        state = .inviteError(.expired)
                    } else {
                        state = .inviteError(.alreadyUsed)
                    }
                } else if case .server(404, _) = error {
                    state = .inviteError(.notFound)
                }
            } catch {
                state = .inviteError(.notFound)
            }
        }
    }

    func signOut() {
        KeychainService.shared.clearAll()
        state = .welcome
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/HearthstoneApp.swift
git commit -m "feat(ios): app navigation — routing by auth state + Universal Link handling"
```

---

## Task 14: Connect Documents View

**Files:**
- Create: `ios/Hearthstone/ViewModels/DocumentsViewModel.swift`
- Create: `ios/Hearthstone/ViewModels/ConnectionsViewModel.swift`
- Create: `ios/Hearthstone/Views/Owner/ConnectDocsView.swift`

- [ ] **Step 1: Write ViewModels**

DocumentsViewModel: load, refresh, delete documents.
ConnectionsViewModel: load connections, initiate Drive OAuth, delete connection.

- [ ] **Step 2: Write ConnectDocsView**

Sheet showing connected documents list with status, refresh button, delete action. "Connect Google Drive" button if no connections. Follow `mocks/02-owner-hub.html` connect documents screen (simplified — flat list, no folder hierarchy per design decision).

- [ ] **Step 3: Commit**

```bash
git add ios/Hearthstone/ViewModels/DocumentsViewModel.swift ios/Hearthstone/ViewModels/ConnectionsViewModel.swift ios/Hearthstone/Views/Owner/ConnectDocsView.swift
git commit -m "feat(ios): document management — ConnectDocsView with Drive connection"
```
