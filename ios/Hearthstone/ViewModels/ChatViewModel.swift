import Foundation

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var inputText = ""
    @Published var suggestions: [String] = []
    @Published var isStreaming = false
    @Published var error: String?

    let isPreview: Bool

    init(isPreview: Bool = false) {
        self.isPreview = isPreview
    }

    func loadSuggestions() async {
        guard messages.isEmpty else { return }
        do {
            suggestions = try await APIClient.shared.getSuggestions().suggestions
        } catch { }
    }

    func send(_ text: String? = nil) async {
        let message = text ?? inputText
        guard !message.isEmpty, !isStreaming else { return }

        let userMessage = ChatMessage(role: .user, content: message, sources: [])
        messages.append(userMessage)
        inputText = ""
        suggestions = []

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
                    }
                }
            }
        } catch {
            self.error = "Something went wrong. Please try again."
        }
        isStreaming = false
    }
}
