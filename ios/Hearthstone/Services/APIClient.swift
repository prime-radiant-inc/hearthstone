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

// MARK: - Response wrappers

private struct ServerError: Decodable {
    let message: String
}

// MARK: - APIClient

final class APIClient {
    let serverURL: URL
    let token: String

    init(serverURL: URL, token: String) {
        self.serverURL = serverURL
        self.token = token
    }

    private let session = URLSession.shared
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder = JSONDecoder()

    // MARK: - Core request machinery

    private func request(
        method: String,
        path: String,
        body: (any Encodable)? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = serverURL.appendingPathComponent(trimmed)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        if let body {
            req.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await session.data(for: req)
        let http = response as! HTTPURLResponse

        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 {
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
        body: (any Encodable)? = nil
    ) async throws -> T {
        let (data, _) = try await request(method: method, path: path, body: body)
        return try decoder.decode(T.self, from: data)
    }

    /// Sends a request and discards the response body (for 204 No Content and similar).
    private func callVoid(
        method: String,
        path: String,
        body: (any Encodable)? = nil
    ) async throws {
        _ = try await request(method: method, path: path, body: body)
    }

    // MARK: - Me

    struct MeResponse: Decodable {
        let person: Person
        let household: Household?
    }

    func getMe() async throws -> MeResponse {
        try await call(method: "GET", path: "/me")
    }

    struct UpdateMeResponse: Decodable {
        let person: Person
    }

    func updateMe(name: String) async throws -> UpdateMeResponse {
        struct Body: Encodable { let name: String }
        return try await call(method: "PATCH", path: "/me", body: Body(name: name))
    }

    // MARK: - Household endpoints

    func createHousehold(name: String) async throws -> Household {
        struct Body: Encodable { let name: String }
        return try await call(method: "POST", path: "/household", body: Body(name: name))
    }

    func updateHousehold(name: String) async throws -> Household {
        struct Body: Encodable { let name: String }
        return try await call(method: "PATCH", path: "/household", body: Body(name: name))
    }

    // MARK: - Guest endpoints

    func listGuests() async throws -> [Guest] {
        struct Response: Decodable { let guests: [Guest] }
        let r: Response = try await call(method: "GET", path: "/guests")
        return r.guests
    }

    struct CreateGuestResponse: Decodable {
        let guest: CreatedGuest
        let pin: String
        let joinUrl: String
        let expiresAt: String

        struct CreatedGuest: Decodable {
            let id: String
            let name: String
            let status: GuestStatus
        }

        enum CodingKeys: String, CodingKey {
            case guest, pin
            case joinUrl = "join_url"
            case expiresAt = "expires_at"
        }
    }

    func createGuest(name: String, email: String?) async throws -> CreateGuestResponse {
        struct Body: Encodable { let name: String; let email: String? }
        return try await call(method: "POST", path: "/guests",
                              body: Body(name: name, email: email))
    }

    func revokeGuest(id: String) async throws {
        try await callVoid(method: "POST", path: "/guests/\(id)/revoke")
    }

    struct ReinviteResponse: Decodable {
        let pin: String
        let joinUrl: String
        let expiresAt: String
        enum CodingKeys: String, CodingKey {
            case pin
            case joinUrl = "join_url"
            case expiresAt = "expires_at"
        }
    }

    func reinviteGuest(id: String) async throws -> ReinviteResponse {
        return try await call(method: "POST", path: "/guests/\(id)/reinvite")
    }

    func deleteGuest(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/guests/\(id)")
    }

    // MARK: - Connection endpoints

    func listConnections() async throws -> [Connection] {
        struct Response: Decodable { let connections: [Connection] }
        let r: Response = try await call(method: "GET", path: "/connections")
        return r.connections
    }

    struct GoogleDriveAuthResponse: Decodable {
        let authUrl: String
        enum CodingKeys: String, CodingKey { case authUrl = "auth_url" }
    }

    func connectGoogleDrive() async throws -> GoogleDriveAuthResponse {
        return try await call(method: "POST", path: "/connections/google-drive")
    }

    func deleteConnection(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/connections/\(id)")
    }

    func listDriveFiles(connectionId: String) async throws -> [DriveFile] {
        struct Response: Decodable { let files: [DriveFile] }
        let r: Response = try await call(method: "GET", path: "/connections/\(connectionId)/files")
        return r.files
    }

    // MARK: - Document endpoints

    func listDocuments() async throws -> [Document] {
        struct Response: Decodable { let documents: [Document] }
        let r: Response = try await call(method: "GET", path: "/documents")
        return r.documents
    }

    func listGuestDocuments() async throws -> [Document] {
        struct Response: Decodable { let documents: [Document] }
        let r: Response = try await call(method: "GET", path: "/guest/documents")
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
        return try await call(method: "POST", path: "/documents",
                              body: Body(driveFileId: driveFileId, title: title))
    }

    func refreshDocument(id: String) async throws -> Document {
        return try await call(method: "POST", path: "/documents/\(id)/refresh")
    }

    func deleteDocument(id: String) async throws {
        try await callVoid(method: "DELETE", path: "/documents/\(id)")
    }

    func uploadDocument(title: String, docxData: Data) async throws -> Document {
        let url = serverURL.appendingPathComponent("documents/upload")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

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

    func getDocumentContent(id: String) async throws -> DocumentContent {
        return try await call(method: "GET", path: "/documents/\(id)/content")
    }

    // MARK: - Owner endpoints

    struct InviteOwnerResponse: Decodable {
        let pin: String
        let joinUrl: String
        let expiresAt: String
        enum CodingKeys: String, CodingKey {
            case pin
            case joinUrl = "join_url"
            case expiresAt = "expires_at"
        }
    }

    func inviteOwner(name: String, email: String) async throws -> InviteOwnerResponse {
        struct Body: Encodable { let name: String; let email: String }
        return try await call(method: "POST", path: "/household/owners",
                              body: Body(name: name, email: email))
    }

    // MARK: - Chat endpoints

    func getSuggestions() async throws -> SuggestionsResponse {
        return try await call(method: "GET", path: "/chat/suggestions")
    }
}

// MARK: - HouseSession convenience

extension HouseSession {
    @MainActor
    func apiClient() -> APIClient? {
        guard let token = KeychainService.shared.read(key: "hst_\(id)") else { return nil }
        return APIClient(serverURL: serverURL, token: token)
    }
}
