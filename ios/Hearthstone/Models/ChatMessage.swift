import Foundation

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: Role
    var content: String
    var sources: [ChatSource]

    init(role: Role, content: String, sources: [ChatSource]) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.sources = sources
    }

    enum Role: String, Codable {
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
