import Foundation

@MainActor
final class DocumentsViewModel: ObservableObject {
    @Published var documents: [Document] = []
    @Published var isLoading = false
    @Published var error: String?

    func load() async {
        isLoading = true
        do {
            documents = try await APIClient.shared.listDocuments()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func refresh(documentId: String) async {
        do {
            _ = try await APIClient.shared.refreshDocument(id: documentId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(documentId: String) async {
        do {
            try await APIClient.shared.deleteDocument(id: documentId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
