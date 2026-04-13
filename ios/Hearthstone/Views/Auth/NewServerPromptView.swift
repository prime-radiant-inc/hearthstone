import SwiftUI

struct NewServerPromptView: View {
    let host: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(spacing: 24) {
            Text("New server")
                .font(Theme.heading(22))
                .foregroundColor(theme.charcoal)
                .padding(.top, 32)

            Image(systemName: "server.rack")
                .font(.system(size: 48, weight: .light))
                .foregroundColor(theme.hearth)

            VStack(spacing: 10) {
                Text("You're about to connect to a new server:")
                    .font(.system(size: 15))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                Text(host)
                    .font(.system(size: 17, weight: .semibold, design: .monospaced))
                    .foregroundColor(theme.charcoal)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(theme.creamWarm)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            Text("Only accept invites from servers you trust.")
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()

            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text("Cancel")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .foregroundColor(theme.charcoalSoft)
                        .background(theme.creamWarm)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                }
                HearthButton(title: "Continue", isLoading: false, action: onConfirm)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.cream)
    }
}
