import Foundation
import UIKit

@MainActor
final class ConnectionsViewModel: ObservableObject {
    @Published var connections: [Connection] = []
    @Published var isLoading = false
    @Published var error: String?

    func load() async {
        do {
            connections = try await APIClient.shared.listConnections()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func connectGoogleDrive() async {
        do {
            let response = try await APIClient.shared.connectGoogleDrive()
            // Open the OAuth URL in Safari
            if let url = URL(string: response.authUrl) {
                UIApplication.shared.open(url)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func removeConnection(id: String) async {
        do {
            try await APIClient.shared.deleteConnection(id: id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
