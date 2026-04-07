import SwiftUI

struct PINEntryView: View {
    let onAuthenticated: (HouseSession, String) -> Void

    @State private var pin = ""
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Theme.cream, Theme.creamWarm],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [Theme.hearth, Theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: Theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(Theme.charcoal)
                    .padding(.bottom, 10)

                Text("Enter your access code")
                    .font(.system(size: 16))
                    .foregroundColor(Theme.charcoalSoft)
                    .padding(.bottom, 40)

                TextField("000000", text: $pin)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced))
                    .foregroundColor(Theme.charcoal)
                    .frame(maxWidth: 200)
                    .padding(.vertical, 16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusMedium)
                            .stroke(Theme.creamDeep, lineWidth: 1.5)
                    )
                    .padding(.horizontal, 80)
                    .onChange(of: pin) { _, newValue in
                        let filtered = String(newValue.prefix(6).filter(\.isNumber))
                        if filtered != newValue { pin = filtered }
                        if filtered.count == 6 {
                            Task { await redeemPin() }
                        }
                    }

                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(Theme.rose)
                        .padding(.top, 12)
                }

                Spacer()

                HearthButton(title: "Continue", isLoading: isLoading) {
                    Task { await redeemPin() }
                }
                .disabled(pin.count != 6)
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                Text("Get your code from the homeowner\nor check your server's terminal.")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)

                Spacer()
            }
        }
    }

    private func redeemPin() async {
        guard pin.count == 6, !isLoading else { return }
        isLoading = true
        error = nil
        do {
            let response = try await APIClient.shared.redeemPin(pin: pin)
            let session = HouseSession(
                id: UUID().uuidString,
                householdId: response.household?.id ?? response.guest?.householdId ?? "",
                householdName: response.household?.name ?? response.householdName ?? "",
                role: response.role == "owner" ? .owner : .guest,
                personName: response.person?.email,
                addedAt: Date()
            )
            onAuthenticated(session, response.token)
        } catch let err as APIError {
            if case .server(_, let message) = err {
                error = message
            } else {
                error = err.localizedDescription
            }
            pin = ""
        } catch {
            self.error = error.localizedDescription
            pin = ""
        }
        isLoading = false
    }
}
