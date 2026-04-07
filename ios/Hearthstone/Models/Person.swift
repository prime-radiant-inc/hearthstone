import Foundation

struct Person: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
}
