import SwiftUI

struct StatusBadge: View {
    let status: GuestStatus

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(backgroundColor)
            .foregroundColor(textColor)
            .clipShape(Capsule())
    }

    private var backgroundColor: Color {
        switch status {
        case .active: return theme.greenBadge
        case .pending: return theme.goldBadge
        case .revoked: return theme.grayBadge
        }
    }

    private var textColor: Color {
        switch status {
        case .active: return theme.greenBadgeText
        case .pending: return theme.goldBadgeText
        case .revoked: return theme.grayBadgeText
        }
    }
}
