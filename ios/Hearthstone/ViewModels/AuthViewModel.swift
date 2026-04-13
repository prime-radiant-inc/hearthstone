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

    // Legacy email/passkey auth paths are no longer wired up. The flows are
    // replaced by QR/link redemption via UnauthenticatedClient. These methods
    // remain so existing previews/views still compile, but they are not used.

    func sendCode() async {
        self.error = "Email auth has been removed. Use a QR or join link instead."
    }

    func verifyCode() async {
        self.error = "Email auth has been removed. Use a QR or join link instead."
    }

    func createHousehold() async {
        self.error = "Households are now created from the admin web UI."
    }
}
