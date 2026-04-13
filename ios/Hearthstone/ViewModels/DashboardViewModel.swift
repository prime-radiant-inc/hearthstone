import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var household: Household?
    @Published var documentCount = 0
    @Published var activeGuestCount = 0
    @Published var pendingGuestCount = 0
    @Published var isSetupComplete = false
    @Published var hasConnections = false
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
        self.error = nil
        guard let client else {
            self.error = "No active session."
            return
        }
        do {
            let guests = try await client.listGuests()
            activeGuestCount = guests.filter { $0.status == .active }.count
            pendingGuestCount = guests.filter { $0.status == .pending }.count

            let docs = try await client.listDocuments()
            documentCount = docs.count

            let connections = try await client.listConnections()
            hasConnections = !connections.isEmpty

            isSetupComplete = !docs.isEmpty && !guests.isEmpty
        } catch {
            self.error = error.localizedDescription
        }
    }
}
