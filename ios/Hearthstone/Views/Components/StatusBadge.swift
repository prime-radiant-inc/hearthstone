import SwiftUI

struct StatusBadge: View {
    let status: GuestStatus

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
        case .active: return Theme.greenBadge
        case .pending: return Theme.goldBadge
        case .revoked: return Theme.grayBadge
        }
    }

    private var textColor: Color {
        switch status {
        case .active: return Theme.greenBadgeText
        case .pending: return Theme.goldBadgeText
        case .revoked: return Theme.grayBadgeText
        }
    }
}
