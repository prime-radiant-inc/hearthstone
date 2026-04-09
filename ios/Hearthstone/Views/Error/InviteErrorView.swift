import SwiftUI

enum InviteErrorType {
    case expired, alreadyUsed, notFound
}

struct InviteErrorView: View {
    let errorType: InviteErrorType
    let onDismiss: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Circle()
                .fill(iconBackground)
                .frame(width: 80, height: 80)
                .overlay(Text(iconEmoji).font(.system(size: 36)))
                .padding(.bottom, 24)

            Text(title)
                .font(Theme.heading(24))
                .foregroundColor(theme.charcoal)
                .multilineTextAlignment(.center)
                .padding(.bottom, 12)

            Text(detail)
                .font(.system(size: 16))
                .foregroundColor(theme.charcoalSoft)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 40)
                .padding(.bottom, 36)

            Button(buttonTitle) { onDismiss() }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(theme.charcoalSoft)
                .padding(.horizontal, 32)
                .padding(.vertical, 14)
                .background(theme.creamWarm)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.creamDeep, lineWidth: 1.5))

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [theme.cream, theme.creamWarm], startPoint: .top, endPoint: .bottom)
        )
    }

    private var iconBackground: Color {
        switch errorType {
        case .expired: return theme.goldBadge
        case .alreadyUsed: return theme.roseLight
        case .notFound: return theme.grayBadge
        }
    }

    private var iconEmoji: String {
        switch errorType {
        case .expired: return "⏳"
        case .alreadyUsed: return "✓"
        case .notFound: return "?"
        }
    }

    private var title: String {
        switch errorType {
        case .expired: return "This invite has expired"
        case .alreadyUsed: return "This invite has already been used"
        case .notFound: return "Invite not found"
        }
    }

    private var detail: String {
        switch errorType {
        case .expired: return "Invite links are valid for 7 days. Ask the homeowner to send you a new one."
        case .alreadyUsed: return "Each invite link works once. If you've already set up access, just open the app normally."
        case .notFound: return "This invite link doesn't exist. Check with the homeowner for the correct link."
        }
    }

    private var buttonTitle: String {
        switch errorType {
        case .expired: return "Close"
        case .alreadyUsed: return "Open Hearthstone"
        case .notFound: return "Close"
        }
    }
}
