import Foundation

@MainActor
final class GuestListViewModel: ObservableObject {
    struct ReinviteResult: Identifiable {
        let id = UUID()
        let guestName: String
        let pin: String
        let joinUrl: String
        let expiresAt: String
    }

    @Published var guests: [Guest] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var reinviteResult: ReinviteResult?

    private var client: APIClient? {
        SessionStore.shared.activeSession?.apiClient()
    }

    func load() async {
        isLoading = true
        guard let client else {
            isLoading = false
            return
        }
        do {
            guests = try await client.listGuests()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func revoke(guestId: String) async {
        guard let client else { return }
        do {
            try await client.revokeGuest(id: guestId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func reinvite(guestId: String) async {
        guard let client else { return }
        do {
            let guest = guests.first { $0.id == guestId }
            let response = try await client.reinviteGuest(id: guestId)
            reinviteResult = ReinviteResult(
                guestName: guest?.name ?? "Guest",
                pin: response.pin,
                joinUrl: response.joinUrl,
                expiresAt: response.expiresAt
            )
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(guestId: String) async {
        guard let client else { return }
        do {
            try await client.deleteGuest(id: guestId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
