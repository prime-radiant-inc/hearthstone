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
