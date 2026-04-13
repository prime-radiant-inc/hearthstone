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
                            DashboardView(
                                sessionId: session.id,
                                householdName: session.householdName,
                                ownerName: session.personName ?? ""
                            )
                        } else {
                            ChatView(
                                viewModel: ChatViewModel(householdId: session.householdId),
                                householdName: session.householdName
                            )
                        }
                    }
                }
            }
            .sheet(item: $router.showAccessRevoked) { name in
                AccessRevokedView(householdName: name)
            }
            .sheet(item: $router.pendingServerPrompt) { payload in
                NewServerPromptView(
                    host: payload.serverURL.host ?? payload.serverURL.absoluteString,
                    onConfirm: {
                        router.pendingServerPrompt = nil
                        router.performRedeem(payload: payload)
                    },
                    onCancel: {
                        router.pendingServerPrompt = nil
                    }
                )
            }
            .alert("Couldn't open invite", isPresented: .init(
                get: { router.redemptionError != nil },
                set: { if !$0 { router.redemptionError = nil } }
            )) {
                Button("OK") { router.redemptionError = nil }
            } message: {
                Text(router.redemptionError ?? "")
            }
            .onOpenURL { url in
                router.handleIncomingURL(url)
            }
        }
    }
}

// MARK: - App Router

@MainActor
final class AppRouter: ObservableObject {
    @Published var state: AppState = .empty
    @Published var showAccessRevoked: String? = nil
    @Published var pendingServerPrompt: JoinPayload? = nil
    @Published var redemptionError: String? = nil

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

    func handleIncomingURL(_ url: URL) {
        guard let payload = JoinURLParser.parse(url.absoluteString) else { return }
        redeem(payload: payload)
    }

    func redeem(payload: JoinPayload) {
        let host = payload.serverURL.host ?? ""
        let isKnown = store.hasSession(forServerHost: host)
        if !isKnown {
            pendingServerPrompt = payload
            return
        }
        performRedeem(payload: payload)
    }

    func performRedeem(payload: JoinPayload) {
        Task { @MainActor in
            let client = UnauthenticatedClient(serverURL: payload.serverURL)
            do {
                let result = try await client.redeemPin(payload.pin)
                let role: HouseRole = result.role == "owner" ? .owner : .guest
                let householdId = result.household?.id ?? result.guest?.householdId ?? ""
                let householdName = result.household?.name ?? result.householdName ?? ""
                let personName: String? = role == .owner
                    ? (result.person?.name?.isEmpty == false ? result.person?.name : result.person?.email)
                    : nil
                let session = HouseSession(
                    id: UUID().uuidString,
                    serverURL: payload.serverURL,
                    householdId: householdId,
                    householdName: householdName,
                    role: role,
                    personName: personName,
                    addedAt: Date()
                )
                store.add(session: session, token: result.token)
                syncState()
            } catch {
                if let apiErr = error as? APIError, case .server(_, let msg) = apiErr {
                    self.redemptionError = msg
                } else {
                    self.redemptionError = "Could not redeem this invite."
                }
            }
        }
    }
}

// MARK: - String Identifiable

extension String: @retroactive Identifiable {
    public var id: String { self }
}
