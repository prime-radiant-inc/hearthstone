import SwiftUI

struct PINEntryView: View {
    let onAuthenticated: (HouseSession, String) -> Void

    @State private var pin = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var showScanner = false

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.cream, theme.creamWarm],
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
                                colors: [theme.hearth, theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text("Enter your access code")
                    .font(.system(size: 16))
                    .foregroundColor(theme.charcoalSoft)
                    .padding(.bottom, 40)

                TextField("000000", text: $pin)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced))
                    .foregroundColor(theme.charcoal)
                    .frame(maxWidth: 200)
                    .padding(.vertical, 16)
                    .background(theme.creamWarm)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusMedium)
                            .stroke(theme.creamDeep, lineWidth: 1.5)
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
                        .foregroundColor(theme.rose)
                        .padding(.top, 12)
                }

                Button {
                    showScanner = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "qrcode.viewfinder")
                        Text("Scan QR Code")
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(theme.hearth)
                }
                .padding(.top, 20)

                Spacer()

                HearthButton(title: "Continue", isLoading: isLoading) {
                    Task { await redeemPin() }
                }
                .disabled(pin.count != 6)
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                Text("Get your code from the homeowner\nor check your server's terminal.")
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)

                Spacer()
            }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView { scannedPin in
                pin = scannedPin
                showScanner = false
            }
        }
    }

    private func redeemPin() async {
        // Deprecated: this view is replaced by LandingView in Task 18. Stubbed for build only.
        guard pin.count == 6, !isLoading else { return }
        isLoading = true
        error = nil
        do {
            let client = UnauthenticatedClient(serverURL: SessionStore.legacyDefaultServer)
            let response = try await client.redeemPin(pin)
            let session = HouseSession(
                id: UUID().uuidString,
                serverURL: SessionStore.legacyDefaultServer,
                householdId: response.household?.id ?? response.guest?.householdId ?? "",
                householdName: response.household?.name ?? response.householdName ?? "",
                role: response.role == "owner" ? .owner : .guest,
                personName: response.person?.name?.isEmpty == false ? response.person?.name : response.person?.email,
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
