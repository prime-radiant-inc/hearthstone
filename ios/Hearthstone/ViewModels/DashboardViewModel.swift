import Foundation

enum HouseStatus {
    case loading
    case ready
    case gone       // 410 — house was deleted
    case accessLost // 401 — removed from house or bad token
}

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var household: Household?
    @Published var documentCount = 0
    @Published var activeGuestCount = 0
    @Published var pendingGuestCount = 0
    @Published var isSetupComplete = false
    @Published var hasConnections = false
    @Published var houseStatus: HouseStatus = .loading
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
        self.houseStatus = .loading
        guard let client else {
            self.houseStatus = .accessLost
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
            houseStatus = .ready
        } catch let apiError as APIError {
            switch apiError {
            case .server(410, "house_deleted"):
                houseStatus = .gone
            case .server(401, _), .http(401):
                houseStatus = .accessLost
            default:
                houseStatus = .ready
                self.error = apiError.localizedDescription
            }
        } catch {
            houseStatus = .ready
            self.error = error.localizedDescription
        }
    }
}
