import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var email = ""
    @Published var code = ""
    @Published var ownerName = ""
    @Published var householdName = ""
    @Published var isLoading = false
    @Published var error: String?
    @Published var step: AuthStep = .welcome

    enum AuthStep: Equatable {
        case welcome, verifyCode, setupHousehold, done
    }

    private var isNewUser = false

    func sendCode() async {
        guard !email.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            // Try register first; if 409 (already exists), send login code
            do {
                _ = try await APIClient.shared.register(email: email)
                isNewUser = true
            } catch let apiError as APIError {
                if case .server(409, _) = apiError {
                    _ = try await APIClient.shared.loginEmail(email: email)
                    isNewUser = false
                } else {
                    throw apiError
                }
            }
            step = .verifyCode
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func verifyCode() async {
        guard code.count == 6 else { return }
        isLoading = true
        error = nil
        do {
            let response: APIClient.AuthResponse
            if isNewUser {
                // New user: registerVerify creates person + issues JWT in one step
                response = try await APIClient.shared.registerVerify(email: email, code: code, name: ownerName.isEmpty ? nil : ownerName)
            } else {
                // Existing user: login with email code
                response = try await APIClient.shared.loginEmailVerify(email: email, code: code)
            }

            KeychainService.shared.ownerToken = response.token
            if response.household != nil {
                step = .done
            } else {
                step = .setupHousehold
            }
        } catch {
            self.error = "Invalid or expired code"
        }
        isLoading = false
    }

    func createHousehold() async {
        guard !householdName.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            _ = try await APIClient.shared.createHousehold(name: householdName)
            step = .done
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
