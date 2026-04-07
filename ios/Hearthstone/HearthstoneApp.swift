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
                case .needsHousehold:
                    HouseholdSetupFlow(router: router)
                case .ownerDashboard(let householdName, let ownerName):
                    NavigationStack {
                        DashboardView(householdName: householdName, ownerName: ownerName)
                    }
                case .guestChat(let householdName):
                    ChatView(viewModel: ChatViewModel(), householdName: householdName)
                case .inviteError(let errorType):
                    InviteErrorView(errorType: errorType) {
                        if errorType == .alreadyUsed {
                            router.checkAuth()
                        } else {
                            router.signOut()
                        }
                    }
                case .accessRevoked(let householdName):
                    AccessRevokedView(householdName: householdName)
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
        case needsHousehold(email: String)
        case ownerDashboard(householdName: String, ownerName: String)
        case guestChat(householdName: String)
        case inviteError(InviteErrorType)
        case accessRevoked(householdName: String)
    }

    init() {
        checkAuth()
        NotificationCenter.default.addObserver(forName: .guestSessionRevoked, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                let name = UserDefaults.standard.string(forKey: "guestHouseholdName") ?? ""
                KeychainService.shared.guestToken = nil
                UserDefaults.standard.removeObject(forKey: "guestHouseholdName")
                self?.state = .accessRevoked(householdName: name)
            }
        }
    }

    func checkAuth() {
        if KeychainService.shared.ownerToken != nil {
            state = .loading
            Task {
                do {
                    let me = try await APIClient.shared.getMe()
                    if let household = me.household {
                        state = .ownerDashboard(householdName: household.name, ownerName: me.person.email)
                    } else {
                        state = .needsHousehold(email: me.person.email)
                    }
                } catch {
                    // Token invalid — clear and start fresh
                    KeychainService.shared.ownerToken = nil
                    state = .welcome
                }
            }
        } else if KeychainService.shared.guestToken != nil {
            let name = UserDefaults.standard.string(forKey: "guestHouseholdName") ?? ""
            state = .guestChat(householdName: name)
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
                KeychainService.shared.guestToken = response.sessionToken
                UserDefaults.standard.set(response.householdName, forKey: "guestHouseholdName")
                state = .guestChat(householdName: response.householdName)
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

// MARK: - Household Setup Flow (for users who have an account but no household)

struct HouseholdSetupFlow: View {
    @ObservedObject var router: AppRouter
    @State private var householdName = ""
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule()
                        .fill(i < 2 ? Theme.hearth : Theme.creamDeep)
                        .frame(height: 4)
                }
            }
            .padding(.bottom, 36)

            Text("Welcome")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.hearth)
                .padding(.bottom, 8)

            Text("Name your household")
                .font(Theme.heading(28))
                .foregroundColor(Theme.charcoal)
                .padding(.bottom, 10)

            Text("This is what your guests will see when they open the app. You can change it anytime.")
                .font(.system(size: 15))
                .foregroundColor(Theme.charcoalSoft)
                .lineSpacing(4)
                .padding(.bottom, 40)

            HearthTextField(
                label: "Household Name",
                placeholder: "e.g. The Anderson Home",
                text: $householdName
            )

            if let error {
                Text(error)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Theme.rose)
                    .padding(.top, 12)
            }

            Spacer()

            HearthButton(title: "Continue", isLoading: isLoading) {
                Task {
                    guard !householdName.isEmpty else { return }
                    isLoading = true
                    error = nil
                    do {
                        _ = try await APIClient.shared.createHousehold(name: householdName)
                        router.checkAuth()
                    } catch {
                        self.error = error.localizedDescription
                    }
                    isLoading = false
                }
            }
            .padding(.bottom, 16)
        }
        .padding(24)
        .background(Theme.cream)
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
