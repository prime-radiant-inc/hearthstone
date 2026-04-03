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
