import Foundation

enum HouseRole: String, Codable {
    case owner
    case guest
}

struct HouseSession: Identifiable, Codable, Equatable {
    let id: String
    let serverURL: URL
    let householdId: String
    var householdName: String
    let role: HouseRole
    var personName: String?
    let addedAt: Date

    static func == (lhs: HouseSession, rhs: HouseSession) -> Bool {
        lhs.id == rhs.id
    }
}
