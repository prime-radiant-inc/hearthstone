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
