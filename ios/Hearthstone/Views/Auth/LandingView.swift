import SwiftUI

struct LandingView: View {
    @ObservedObject var router: AppRouter

    @State private var showScanner = false
    @State private var showPasteField = false
    @State private var pastedText = ""
    @State private var parseError: String?
    @State private var initialSessionCount: Int = 0

    @Environment(\.dismiss) private var dismiss
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
                    Text("🏠").font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 12)

                Text("Your household knowledge, shared.")
                    .font(.system(size: 16))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 40)

                VStack(spacing: 14) {
                    HearthButton(title: "Scan QR code", isLoading: false) {
                        showScanner = true
                    }
                    Button {
                        pastedText = UIPasteboard.general.string ?? ""
                        showPasteField = true
                    } label: {
                        Text("Paste link")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(theme.hearth)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 32)

                if let parseError {
                    Text(parseError)
                        .font(.system(size: 13))
                        .foregroundColor(theme.rose)
                        .padding(.top, 10)
                }

                Spacer()

                Text("You'll get an invite link or QR code\nfrom the person who runs your house.")
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView { scanned in
                showScanner = false
                handle(scanned)
            }
        }
        .sheet(isPresented: $showPasteField) {
            VStack(spacing: 20) {
                Text("Paste invite link")
                    .font(Theme.heading(20))
                    .foregroundColor(theme.charcoal)
                    .padding(.top, 32)
                TextField("https://...", text: $pastedText, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 24)
                HStack(spacing: 12) {
                    Button("Cancel") {
                        showPasteField = false
                        pastedText = ""
                    }
                    .foregroundColor(theme.charcoalSoft)
                    HearthButton(title: "Open", isLoading: false) {
                        showPasteField = false
                        handle(pastedText)
                        pastedText = ""
                    }
                }
                .padding(.horizontal, 24)
                Spacer()
            }
            .background(theme.cream)
            .presentationDetents([.medium])
        }
        .onAppear {
            initialSessionCount = router.store.sessions.count
        }
        .onReceive(router.store.$sessions) { newSessions in
            // If a session was added while this view is visible (e.g. add-house
            // from the sidebar), dismiss back to the sidebar. When LandingView
            // is the root (empty state), dismiss() is a no-op — the root view
            // swap in HearthstoneApp handles that transition.
            if newSessions.count > initialSessionCount {
                dismiss()
            }
        }
    }

    private func handle(_ raw: String) {
        guard let payload = JoinURLParser.parse(raw) else {
            parseError = "That doesn't look like a Hearthstone invite link."
            return
        }
        parseError = nil
        router.redeem(payload: payload)
    }
}
