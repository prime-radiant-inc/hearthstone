import Foundation
import AuthenticationServices
import UIKit

@MainActor
final class ConnectionsViewModel: ObservableObject {
    @Published var connections: [Connection] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var newConnectionId: String?

    private var client: APIClient? {
        SessionStore.shared.activeSession?.apiClient()
    }

    func load() async {
        guard let client else { return }
        do {
            connections = try await client.listConnections()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func connectGoogleDrive() async {
        guard let client else {
            self.error = "No active session."
            return
        }
        do {
            let response = try await client.connectGoogleDrive()
            guard let authURL = URL(string: response.authUrl) else {
                self.error = "Invalid auth URL"
                return
            }

            let callbackURL = try await startAuthSession(url: authURL)
            let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)

            if callbackURL.host == "drive-connected",
               let connectionId = components?.queryItems?.first(where: { $0.name == "connection_id" })?.value {
                await load()
                newConnectionId = connectionId
            } else if callbackURL.host == "drive-error" {
                let message = components?.queryItems?.first(where: { $0.name == "message" })?.value ?? "Connection failed"
                self.error = message.replacingOccurrences(of: "+", with: " ")
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // User cancelled — not an error
        } catch {
            self.error = error.localizedDescription
        }
    }

    func removeConnection(id: String) async {
        guard let client else { return }
        do {
            try await client.deleteConnection(id: id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startAuthSession(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "hearthstone"
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                }
            }
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = ASWebAuthSessionContextProvider.shared
            session.start()
        }
    }
}

// Provides the window anchor for ASWebAuthenticationSession
final class ASWebAuthSessionContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = ASWebAuthSessionContextProvider()
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
