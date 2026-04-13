import Foundation

@MainActor
final class DocumentsViewModel: ObservableObject {
    @Published var documents: [Document] = []
    @Published var isLoading = false
    @Published var error: String?

    let sessionId: String

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    private var client: APIClient? {
        guard let session = SessionStore.shared.sessions.first(where: { $0.id == sessionId }) else { return nil }
        return session.apiClient()
    }

    func load() async {
        isLoading = true
        guard let client else {
            self.error = "No active session."
            isLoading = false
            return
        }
        do {
            documents = try await client.listDocuments()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func refresh(documentId: String) async {
        guard let client else { return }
        do {
            _ = try await client.refreshDocument(id: documentId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(documentId: String) async {
        guard let client else { return }
        do {
            try await client.deleteDocument(id: documentId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refreshAll() async {
        isLoading = true
        guard let client else {
            isLoading = false
            return
        }
        for doc in documents {
            do {
                _ = try await client.refreshDocument(id: doc.id)
            } catch {
                // Continue refreshing remaining docs even if one fails
            }
        }
        await load()
    }
}
