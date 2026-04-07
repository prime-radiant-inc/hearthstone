// HearthstoneApp.swift
// Hearthstone

import SwiftUI

@main
struct HearthstoneApp: App {
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            Group {
                switch router.state {
                case .empty:
                    PINEntryView { session, token in
                        router.addSession(session, token: token)
                    }
                case .active(let session):
                    SidebarOverlay(router: router) {
                        if session.role == .owner {
                            NavigationStack {
                                DashboardView(
                                    householdName: session.householdName,
                                    ownerName: ""
                                )
                            }
                        } else {
                            ChatView(
                                viewModel: ChatViewModel(),
                                householdName: session.householdName
                            )
                        }
                    }
                }
            }
            .sheet(item: $router.showAccessRevoked) { name in
                AccessRevokedView(householdName: name)
            }
            .onOpenURL { url in
                router.handleUniversalLink(url)
            }
        }
    }
}

// MARK: - App Router

@MainActor
final class AppRouter: ObservableObject {
    @Published var state: AppState = .empty
    @Published var showAccessRevoked: String? = nil

    let store = SessionStore.shared

    enum AppState: Equatable {
        case empty
        case active(HouseSession)

        static func == (lhs: AppState, rhs: AppState) -> Bool {
            switch (lhs, rhs) {
            case (.empty, .empty): return true
            case (.active(let a), .active(let b)): return a.id == b.id
            default: return false
            }
        }
    }

    init() {
        syncState()
        NotificationCenter.default.addObserver(forName: .guestSessionRevoked, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if let active = self.store.activeSession, active.role == .guest {
                    let name = active.householdName
                    self.store.remove(id: active.id)
                    if self.store.sessions.isEmpty {
                        self.showAccessRevoked = name
                    }
                    self.syncState()
                }
            }
        }
    }

    func syncState() {
        if let session = store.activeSession {
            state = .active(session)
        } else {
            state = .empty
        }
    }

    func addSession(_ session: HouseSession, token: String) {
        store.add(session: session, token: token)
        syncState()
    }

    func signOutAll() {
        store.removeAll()
        KeychainService.shared.clearAll()
        UserDefaults.standard.removeObject(forKey: "guestHouseholdName")
        syncState()
    }

    func handleUniversalLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.path.hasPrefix("/join/") else { return }

        let pathParts = components.path.split(separator: "/")
        guard pathParts.count >= 2 else { return }
        let token = String(pathParts[1])

        Task {
            do {
                let response = try await APIClient.shared.redeemInvite(token: token)
                let session = HouseSession(
                    id: UUID().uuidString,
                    householdId: response.guest.householdId,
                    householdName: response.householdName,
                    role: .guest,
                    addedAt: Date()
                )
                addSession(session, token: response.sessionToken)
            } catch {
                // Invite errors handled later
            }
        }
    }
}

// MARK: - String Identifiable

extension String: @retroactive Identifiable {
    public var id: String { self }
}
