import Foundation

@MainActor
final class GuestListViewModel: ObservableObject {
    @Published var guests: [Guest] = []
    @Published var isLoading = false
    @Published var error: String?

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
            _ = try await APIClient.shared.reinviteGuest(id: guestId)
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
