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
                case .loading:
                    LoadingView()
                case .welcome:
                    AuthFlow(router: router)
                case .ownerDashboard(let householdName, let ownerName):
                    NavigationStack {
                        DashboardView(householdName: householdName, ownerName: ownerName)
                    }
                case .guestChat(let householdName):
                    ChatView(viewModel: ChatViewModel(), householdName: householdName)
                case .inviteError(let errorType):
                    InviteErrorView(errorType: errorType)
                case .accessRevoked:
                    AccessRevokedView()
                }
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
    @Published var state: AppState = .loading

    enum AppState {
        case loading
        case welcome
        case ownerDashboard(householdName: String, ownerName: String)
        case guestChat(householdName: String)
        case inviteError(InviteErrorType)
        case accessRevoked
    }

    init() {
        checkAuth()
    }

    func checkAuth() {
        if KeychainService.shared.ownerToken != nil {
            // For now, use placeholder names — in a full implementation
            // we'd decode the JWT or call an API to get user/household info
            state = .ownerDashboard(householdName: "My Home", ownerName: "")
        } else if KeychainService.shared.guestToken != nil {
            state = .guestChat(householdName: "")
        } else {
            state = .welcome
        }
    }

    func handleUniversalLink(_ url: URL) {
        // hearthstone.app/join/{hsi_token}
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.path.hasPrefix("/join/") else { return }

        let pathParts = components.path.split(separator: "/")
        guard pathParts.count >= 2 else { return }
        let token = String(pathParts[1])

        state = .loading

        Task {
            do {
                let response = try await APIClient.shared.redeemInvite(token: token)
                KeychainService.shared.guestToken = response.token
                state = .guestChat(householdName: "")
            } catch let error as APIError {
                if case .server(410, let message) = error {
                    if message.contains("expired") {
                        state = .inviteError(.expired)
                    } else {
                        state = .inviteError(.alreadyUsed)
                    }
                } else if case .server(404, _) = error {
                    state = .inviteError(.notFound)
                } else {
                    state = .inviteError(.notFound)
                }
            } catch {
                state = .inviteError(.notFound)
            }
        }
    }

    func signOut() {
        KeychainService.shared.clearAll()
        state = .welcome
    }
}

// MARK: - Auth Flow Container

struct AuthFlow: View {
    @ObservedObject var router: AppRouter
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        Group {
            switch viewModel.step {
            case .welcome:
                WelcomeView(viewModel: viewModel)
            case .verifyCode:
                VerifyCodeView(viewModel: viewModel)
            case .setupHousehold:
                HouseholdSetupView(viewModel: viewModel)
            case .done:
                Color.clear.onAppear { router.checkAuth() }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: viewModel.step)
    }
}

// MARK: - Loading View

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(Theme.hearth)
            Text("Hearthstone")
                .font(Theme.heading(20))
                .foregroundColor(Theme.hearth)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream)
    }
}
