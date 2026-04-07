import Foundation

extension Notification.Name {
    static let guestSessionRevoked = Notification.Name("guestSessionRevoked")
}

// MARK: - AnyCodable

/// Minimal wrapper for round-tripping arbitrary JSON from the server (e.g. WebAuthn registration options).
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self)   { value = v; return }
        if let v = try? container.decode(Int.self)    { value = v; return }
        if let v = try? container.decode(Double.self) { value = v; return }
        if let v = try? container.decode(String.self) { value = v; return }
        if let v = try? container.decode([String: AnyCodable].self) {
            value = v.mapValues { $0.value }; return
        }
        if let v = try? container.decode([AnyCodable].self) {
            value = v.map { $0.value }; return
        }
        if container.decodeNil() { value = NSNull(); return }
        throw DecodingError.dataCorruptedError(in: container,
            debugDescription: "AnyCodable: unsupported JSON type")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as Bool:              try container.encode(v)
        case let v as Int:               try container.encode(v)
        case let v as Double:            try container.encode(v)
        case let v as String:            try container.encode(v)
        case let v as [String: Any]:
            try container.encode(v.mapValues { AnyCodable($0) })
        case let v as [Any]:
            try container.encode(v.map { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}

// MARK: - Auth level

enum APIAuth {
    case none
    case owner
    case guest
}

// MARK: - Response wrappers

private struct ServerError: Decodable {
    let message: String
}

// MARK: - APIClient

final class APIClient {
    static let shared = APIClient()
    private init() {}

    #if DEBUG
    private let baseURL = "http://localhost:3000"
    #else
    private let baseURL = "https://hearthstone-mhat.fly.dev"
    #endif

    private let session = URLSession.shared
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    // MARK: - Core request machinery

    private func request(
        method: String,
        path: String,
        auth: APIAuth = .none,
        body: (any Encodable)? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: baseURL + path) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

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

        if let body {
            req.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await session.data(for: req)
        let http = response as! HTTPURLResponse

        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 && auth == .guest {
                NotificationCenter.default.post(name: .guestSessionRevoked, object: nil)
            }
            if let serverErr = try? decoder.decode(ServerError.self, from: data) {
                throw APIError.server(http.statusCode, serverErr.message)
            }
            throw APIError.http(http.statusCode)
        }

        return (data, http)
    }

    /// Sends a request and decodes the JSON response body.
    private func call<T: Decodable>(
        method: String,
        path: String,
        auth: APIAuth = .none,
        body: (any Encodable)? = nil
    ) async throws -> T {
        let (data, _) = try await request(method: method, path: path, auth: auth, body: body)
        return try decoder.decode(T.self, from: data)
    }

    /// Sends a request and discards the response body (for 204 No Content and similar).
    private func callVoid(
        method: String,
        path: String,
        auth: APIAuth = .none,
        body: (any Encodable)? = nil
    ) async throws {
        _ = try await request(method: method, path: path, auth: auth, body: body)
    }

    // MARK: - Auth endpoints

    struct RegisterResponse: Decodable {
        let message: String
        let email: String
    }

    func register(email: String) async throws -> RegisterResponse {
        struct Body: Encodable { let email: String }
        return try await call(method: "POST", path: "/auth/register",
                              body: Body(email: email))
    }

    func registerVerify(email: String, code: String) async throws -> AuthResponse {
        struct Body: Encodable { let email: String; let code: String }
        return try await call(method: "POST", path: "/auth/register/verify",
                              body: Body(email: email, code: code))
    }

    struct LoginEmailResponse: Decodable {
        let message: String
    }

    func loginEmail(email: String) async throws -> LoginEmailResponse {
        struct Body: Encodable { let email: String }
        return try await call(method: "POST", path: "/auth/login/email",
                              body: Body(email: email))
    }

    struct AuthResponse: Decodable {
        let token: String
        let person: Person
        let household: Household?
    }

    func loginEmailVerify(email: String, code: String) async throws -> AuthResponse {
        struct Body: Encodable { let email: String; let code: String }
        return try await call(method: "POST", path: "/auth/login/email/verify",
                              body: Body(email: email, code: code))
    }

    struct InviteRedeemResponse: Decodable {
        let sessionToken: String
        let guest: InviteGuest
        let householdName: String

        struct InviteGuest: Decodable {
            let id: String
            let name: String
            let householdId: String

            enum CodingKeys: String, CodingKey {
                case id, name
                case householdId = "household_id"
            }
        }

        enum CodingKeys: String, CodingKey {
            case sessionToken = "session_token"
            case guest
            case householdName = "household_name"
        }
    }

    func redeemInvite(token: String) async throws -> InviteRedeemResponse {
        struct Body: Encodable {
            let inviteToken: String
            enum CodingKeys: String, CodingKey {
                case inviteToken = "invite_token"
            }
        }
        return try await call(method: "POST", path: "/auth/invite/redeem",
                              body: Body(inviteToken: token))
    }

    struct PinRedeemResponse: Decodable {
        let token: String
        let role: String
        let person: Person?
        let household: Household?
        let guest: InviteRedeemResponse.InviteGuest?
        let householdName: String?

        enum CodingKeys: String, CodingKey {
            case token, role, person, household, guest
            case householdName = "household_name"
        }
    }

    func redeemPin(pin: String) async throws -> PinRedeemResponse {
        struct Body: Encodable { let pin: String }
        return try await call(method: "POST", path: "/auth/pin/redeem",
                              body: Body(pin: pin))
    }

    // MARK: - Me

    struct MeResponse: Decodable {
        let person: Person
        let household: Household?
    }

    func getMe() async throws -> MeResponse {
        try await call(method: "GET", path: "/me", auth: .owner)
    }

    // MARK: - Household endpoints

    func createHousehold(name: String) async throws -> Household {
        struct Body: Encodable { let name: String }
        return try await call(method: "POST", path: "/household", auth: .owner,
                              body: Body(name: name))
    }

    func updateHousehold(name: String) async throws -> Household {
        struct Body: Encodable { let name: String }
        return try await call(method: "PATCH", path: "/household", auth: .owner,
                              body: Body(name: name))
    }

    // MARK: - Guest endpoints

    func listGuests() async throws -> [Guest] {
        struct Response: Decodable { let guests: [Guest] }
        let r: Response = try await call(method: "GET", path: "/guests", auth: .owner)
        return r.guests
    }

    struct CreateGuestResponse: Decodable {
        let guest: CreatedGuest
        let pin: String
        let expiresAt: String

        struct CreatedGuest: Decodable {
            let id: String
            let name: String
            let status: GuestStatus
        }

        enum CodingKeys: String, CodingKey {
            case guest, pin
            case expiresAt = "expires_at"
        }
    }

    func createGuest(name: String, email: String?) async throws -> CreateGuestResponse {
        struct Body: Encodable { let name: String; let email: String? }
        return try await call(method: "POST", path: "/guests", auth: .owner,
                              body: Body(name: name, email: email))
    }

    func revokeGuest(id: String) async throws {
        try await callVoid(method: "POST", path: "/guests/\(id)/revoke", auth: .owner)
    }

    struct ReinviteResponse: Decodable {
        let pin: String
        let expiresAt: String
        enum CodingKeys: String, CodingKey {
            case pin
            case expiresAt = "expires_at"
        }
    }

    func reinviteGuest(id: String) async throws -> ReinviteResponse {
        return try await call(method: "POST", path: "/guests/\(id)/reinvite", auth: .owner)
    }

    func deleteGuest(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/guests/\(id)", auth: .owner)
    }

    // MARK: - Connection endpoints

    func listConnections() async throws -> [Connection] {
        struct Response: Decodable { let connections: [Connection] }
        let r: Response = try await call(method: "GET", path: "/connections", auth: .owner)
        return r.connections
    }

    struct GoogleDriveAuthResponse: Decodable {
        let authUrl: String
        enum CodingKeys: String, CodingKey { case authUrl = "auth_url" }
    }

    func connectGoogleDrive() async throws -> GoogleDriveAuthResponse {
        return try await call(method: "POST", path: "/connections/google-drive", auth: .owner)
    }

    func deleteConnection(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/connections/\(id)", auth: .owner)
    }

    func listDriveFiles(connectionId: String) async throws -> [DriveFile] {
        struct Response: Decodable { let files: [DriveFile] }
        let r: Response = try await call(method: "GET", path: "/connections/\(connectionId)/files", auth: .owner)
        return r.files
    }

    // MARK: - Document endpoints

    func listDocuments() async throws -> [Document] {
        struct Response: Decodable { let documents: [Document] }
        let r: Response = try await call(method: "GET", path: "/documents", auth: .owner)
        return r.documents
    }

    func connectDocument(driveFileId: String, title: String) async throws -> Document {
        struct Body: Encodable {
            let driveFileId: String
            let title: String
            enum CodingKeys: String, CodingKey {
                case driveFileId = "drive_file_id"
                case title
            }
        }
        return try await call(method: "POST", path: "/documents", auth: .owner,
                              body: Body(driveFileId: driveFileId, title: title))
    }

    func refreshDocument(id: String) async throws -> Document {
        return try await call(method: "POST", path: "/documents/\(id)/refresh", auth: .owner)
    }

    func deleteDocument(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/documents/\(id)", auth: .owner)
    }

    func uploadDocument(title: String, docxData: Data) async throws -> Document {
        var req = URLRequest(url: URL(string: baseURL + "/documents/upload")!)
        req.httpMethod = "POST"

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        if let token = KeychainService.shared.ownerToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()
        // Title field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"title\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(title)\r\n".data(using: .utf8)!)
        // File field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"document.docx\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n".data(using: .utf8)!)
        body.append(docxData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body

        let (data, response) = try await session.data(for: req)
        let httpResponse = response as! HTTPURLResponse
        guard (200...299).contains(httpResponse.statusCode) else {
            if let err = try? decoder.decode(ServerError.self, from: data) {
                throw APIError.server(httpResponse.statusCode, err.message)
            }
            throw APIError.http(httpResponse.statusCode)
        }
        return try decoder.decode(Document.self, from: data)
    }

    func getDocumentContent(id: String, auth: APIAuth) async throws -> DocumentContent {
        return try await call(method: "GET", path: "/documents/\(id)/content", auth: auth)
    }

    // MARK: - Chat endpoints

    func getSuggestions() async throws -> SuggestionsResponse {
        return try await call(method: "GET", path: "/chat/suggestions", auth: .guest)
    }
}
