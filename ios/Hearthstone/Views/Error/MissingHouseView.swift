import SwiftUI

struct MissingHouseView: View {
    let householdName: String
    let status: HouseStatus
    let onRemove: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    private var icon: String {
        status == .gone ? "🏚️" : "🔒"
    }

    private var title: String {
        status == .gone
            ? "This house has been removed"
            : "You no longer have access"
    }

    private var explanation: String {
        status == .gone
            ? "\u{201C}\(householdName)\u{201D} has been deleted from Hearthstone. All of its documents, guests, and chat history are gone."
            : "Your access to \u{201C}\(householdName)\u{201D} has been removed. If this is a mistake, contact the homeowner to request a new invite."
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header — same hearth gradient as the dashboard hero
            VStack(alignment: .leading, spacing: 2) {
                Text(householdName.isEmpty ? "Household" : householdName)
                    .font(Theme.heading(20))
                    .strikethrough(status == .gone, color: .white.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .foregroundColor(.white)
            .background(
                LinearGradient(
                    colors: [theme.revokedHeaderStart, theme.revokedHeaderEnd],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )

            // Body
            VStack(spacing: 0) {
                Spacer()

                Circle()
                    .fill(theme.revokedIconCircle)
                    .frame(width: 72, height: 72)
                    .overlay(Text(icon).font(.system(size: 32)))
                    .padding(.bottom, 24)

                Text(title)
                    .font(Theme.heading(22))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text(explanation)
                    .font(.system(size: 15))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 36)

                Button(action: onRemove) {
                    Text("Remove from sidebar")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(theme.hearth)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                }
                .padding(.bottom, 16)

                Text("Or swipe from the left edge to pick a different house.")
                    .font(.system(size: 13))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)

                Spacer()
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
        .background(theme.cream)
    }
}
