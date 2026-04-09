import SwiftUI

struct AccessRevokedView: View {
    let householdName: String

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            // Dark header
            VStack(alignment: .leading, spacing: 2) {
                Text(householdName.isEmpty ? "Household" : householdName)
                    .font(Theme.heading(20))
                Text("Guest Access")
                    .font(.system(size: 13))
                    .opacity(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .foregroundColor(.white)
            .background(
                LinearGradient(colors: [theme.revokedHeaderStart, theme.revokedHeaderEnd], startPoint: .topLeading, endPoint: .bottomTrailing)
            )

            // Body
            VStack(spacing: 0) {
                Spacer()

                Circle()
                    .fill(theme.revokedIconCircle)
                    .frame(width: 72, height: 72)
                    .overlay(Text("🔒").font(.system(size: 32)))
                    .padding(.bottom, 24)

                Text("Your access has been revoked")
                    .font(Theme.heading(22))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text("The homeowner has removed your access to this household's information.")
                    .font(.system(size: 15))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 36)

                Text("If you think this is a mistake, contact the homeowner to request a new invite.")
                    .font(.system(size: 13))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .frame(maxWidth: 280)
                    .background(theme.creamWarm)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))

                Spacer()
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
        .background(theme.cream)
    }
}
