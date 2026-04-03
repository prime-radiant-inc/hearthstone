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
