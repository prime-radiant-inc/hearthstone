import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var household: Household?
    @Published var documentCount = 0
    @Published var activeGuestCount = 0
    @Published var pendingGuestCount = 0
    @Published var isSetupComplete = false
    @Published var hasConnections = false

    func load() async {
        do {
            let guests = try await APIClient.shared.listGuests()
            activeGuestCount = guests.filter { $0.status == .active }.count
            pendingGuestCount = guests.filter { $0.status == .pending }.count

            let docs = try await APIClient.shared.listDocuments()
            documentCount = docs.count

            let connections = try await APIClient.shared.listConnections()
            hasConnections = !connections.isEmpty

            isSetupComplete = !docs.isEmpty && !guests.isEmpty
        } catch {
            // Dashboard still shows with zeros
        }
    }
}
