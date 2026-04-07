import Foundation

@MainActor
final class GuestListViewModel: ObservableObject {
    struct ReinviteResult: Identifiable {
        let id = UUID()
        let guestName: String
        let pin: String
        let expiresAt: String
    }

    @Published var guests: [Guest] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var reinviteResult: ReinviteResult?

    func load() async {
        isLoading = true
        do {
            guests = try await APIClient.shared.listGuests()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func revoke(guestId: String) async {
        do {
            try await APIClient.shared.revokeGuest(id: guestId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func reinvite(guestId: String) async {
        do {
            let guest = guests.first { $0.id == guestId }
            let response = try await APIClient.shared.reinviteGuest(id: guestId)
            reinviteResult = ReinviteResult(guestName: guest?.name ?? "Guest", pin: response.pin, expiresAt: response.expiresAt)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(guestId: String) async {
        do {
            try await APIClient.shared.deleteGuest(id: guestId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
