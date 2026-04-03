import Foundation

enum DocumentStatus: String, Codable {
    case indexing, ready, error
}

struct Document: Codable, Identifiable {
    let id: String
    let title: String
    let driveFileId: String?
    let status: DocumentStatus
    let chunkCount: Int?
    let lastSynced: String?

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case driveFileId = "drive_file_id"
        case chunkCount = "chunk_count"
        case lastSynced = "last_synced"
    }
}

struct DocumentContent: Codable {
    let id: String
    let title: String
    let markdown: String
    let html: String
}
