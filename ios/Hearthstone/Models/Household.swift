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
