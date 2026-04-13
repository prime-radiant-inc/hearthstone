import Foundation

// Stub — full implementation lands in Task 15.
enum JoinURLParser {
    static func parse(_ string: String) -> JoinPayload? { nil }
}

struct JoinPayload: Equatable {
    let serverURL: URL
    let pin: String
}
