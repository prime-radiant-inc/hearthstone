import Foundation

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var inputText = ""
    @Published var isStreaming = false
    @Published var error: String?

    let isPreview: Bool
    private let householdId: String?

    private static let maxMessages = 20
    private static let expiryInterval: TimeInterval = 24 * 60 * 60  // 24 hours

    init(householdId: String? = nil, isPreview: Bool = false) {
        self.householdId = householdId
        self.isPreview = isPreview
        if let householdId, !isPreview {
            loadFromDisk(householdId: householdId)
        }
    }

    func clearChat() {
        messages = []
        if let householdId {
            Self.deleteFile(householdId: householdId)
        }
    }

    func send(_ text: String? = nil) async {
        let message = text ?? inputText
        guard !message.isEmpty, !isStreaming else { return }

        let userMessage = ChatMessage(role: .user, content: message, sources: [])
        messages.append(userMessage)
        inputText = ""

        var assistantMessage = ChatMessage(role: .assistant, content: "", sources: [])
        messages.append(assistantMessage)
        isStreaming = true

        let history = messages.dropLast(2).map { msg in
            SSEClient.HistoryMessage(role: msg.role == .user ? "user" : "assistant", content: msg.content)
        }

        do {
            for try await event in SSEClient.streamChat(message: message, history: Array(history), isPreview: isPreview) {
                if let delta = event.delta {
                    assistantMessage.content += delta
                    if let lastIndex = messages.indices.last {
                        messages[lastIndex].content = assistantMessage.content
                    }
                }
                if let sources = event.sources {
                    assistantMessage.sources = sources
                    if let lastIndex = messages.indices.last {
                        messages[lastIndex].sources = sources
                        // Strip the "Sources: [1], [2]" line from displayed text
                        messages[lastIndex].content = stripSourcesLine(messages[lastIndex].content)
                        assistantMessage.content = messages[lastIndex].content
                    }
                }
            }
        } catch {
            self.error = "Something went wrong. Please try again."
        }
        isStreaming = false
        saveToDisk()
    }

    private func stripSourcesLine(_ text: String) -> String {
        text.replacingOccurrences(of: #"\n*\s*Sources?:\s*\[[\d\],\s\[]*\]\s*$"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Persistence

    private struct PersistedChat: Codable {
        let messages: [ChatMessage]
        let savedAt: Date
    }

    private func saveToDisk() {
        guard let householdId, !isPreview, !messages.isEmpty else { return }
        let recent = Array(messages.suffix(Self.maxMessages))
        let data = try? JSONEncoder().encode(PersistedChat(messages: recent, savedAt: Date()))
        try? data?.write(to: Self.fileURL(householdId: householdId))
    }

    private func loadFromDisk(householdId: String) {
        let url = Self.fileURL(householdId: householdId)
        guard let data = try? Data(contentsOf: url),
              let persisted = try? JSONDecoder().decode(PersistedChat.self, from: data) else { return }

        // Expire after 24h
        if Date().timeIntervalSince(persisted.savedAt) > Self.expiryInterval {
            Self.deleteFile(householdId: householdId)
            return
        }
        messages = persisted.messages
    }

    private static func fileURL(householdId: String) -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("chat-\(householdId).json")
    }

    private static func deleteFile(householdId: String) {
        try? FileManager.default.removeItem(at: fileURL(householdId: householdId))
    }
}
