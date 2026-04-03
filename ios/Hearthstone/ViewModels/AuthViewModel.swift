import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var email = ""
    @Published var code = ""
    @Published var householdName = ""
    @Published var isLoading = false
    @Published var error: String?
    @Published var step: AuthStep = .welcome

    enum AuthStep: Equatable {
        case welcome, verifyCode, setupHousehold, done
    }

    func sendCode() async {
        guard !email.isEmpty else { return }
        isLoading = true
        error = nil
        do {
            // Try register first; if 409 (already exists), do login
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

    private var isNewUser = false

    func verifyCode() async {
        guard code.count == 6 else { return }
        isLoading = true
        error = nil
        do {
            if isNewUser {
                // New user: register/verify creates the person, then login with same code
                _ = try await APIClient.shared.registerVerify(email: email, code: code)
                // Now send a login code (register/verify consumed the first one)
                _ = try await APIClient.shared.loginEmail(email: email)
                // For v0, skip passkey — go straight to email login
                // User needs to enter a new code
                self.code = ""
                self.isNewUser = false
                self.error = "Account created! Enter the new code we just sent."
                isLoading = false
                return
            }

            // Existing user (or second code entry): login with email code
            let response = try await APIClient.shared.loginEmailVerify(email: email, code: code)
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
