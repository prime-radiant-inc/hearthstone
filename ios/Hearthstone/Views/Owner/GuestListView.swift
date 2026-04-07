import SwiftUI

struct GuestListView: View {
    @StateObject private var viewModel = GuestListViewModel()
    @State private var showAddGuest = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()

            VStack(spacing: 0) {
                // Navigation bar
                HStack {
                    Button(action: { dismiss() }) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .semibold))
                            Text("Dashboard")
                                .font(.system(size: 16, weight: .medium))
                        }
                        .foregroundColor(Theme.hearth)
                    }

                    Spacer()

                    Button(action: { showAddGuest = true }) {
                        Text("+ Add Guest")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Theme.hearth)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)

                // Title + count
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Guests")
                            .font(Theme.heading(26))
                            .foregroundColor(Theme.charcoal)
                        Spacer()
                    }
                    if !viewModel.guests.isEmpty {
                        Text(guestCountSubtitle)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                Divider()
                    .background(Theme.creamDeep)

                if viewModel.isLoading && viewModel.guests.isEmpty {
                    Spacer()
                    ProgressView()
                        .tint(Theme.hearth)
                    Spacer()
                } else if viewModel.guests.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Text("👥")
                            .font(.system(size: 40))
                        Text("No guests yet")
                            .font(Theme.heading(18))
                            .foregroundColor(Theme.charcoal)
                        Text("Tap \"+ Add Guest\" to invite someone.")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.guests) { guest in
                                GuestCard(guest: guest, viewModel: viewModel)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                    }
                }

                // Error banner
                if let error = viewModel.error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(Theme.rose)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 12)
                }
            }
        }
        .navigationBarHidden(true)
        .task { await viewModel.load() }
        .sheet(isPresented: $showAddGuest) {
            AddGuestView(onSuccess: {
                Task { await viewModel.load() }
            })
        }
    }

    private var guestCountSubtitle: String {
        let active = viewModel.guests.filter { $0.status == .active }.count
        let pending = viewModel.guests.filter { $0.status == .pending }.count
        var parts: [String] = []
        if active > 0 { parts.append("\(active) active") }
        if pending > 0 { parts.append("\(pending) pending") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Guest Card

private struct GuestCard: View {
    let guest: Guest
    @ObservedObject var viewModel: GuestListViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Top row: avatar + name/contact + meta
            HStack(alignment: .top, spacing: 12) {
                GuestAvatar(name: guest.name, status: guest.status)

                VStack(alignment: .leading, spacing: 2) {
                    Text(guest.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.charcoal)
                    Text(guest.contact ?? "")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.charcoalSoft)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    StatusBadge(status: guest.status)
                    Text(relativeTime(from: guest.createdAt))
                        .font(.system(size: 11))
                        .foregroundColor(Theme.stone)
                }
            }

            // Action buttons
            HStack(spacing: 8) {
                switch guest.status {
                case .active:
                    GuestActionButton(title: "Resend link", style: .normal) {
                        Task { await viewModel.reinvite(guestId: guest.id) }
                    }
                    GuestActionButton(title: "Revoke", style: .danger) {
                        Task { await viewModel.revoke(guestId: guest.id) }
                    }
                case .pending:
                    GuestActionButton(title: "Resend invite", style: .normal) {
                        Task { await viewModel.reinvite(guestId: guest.id) }
                    }
                    GuestActionButton(title: "Revoke", style: .danger) {
                        Task { await viewModel.revoke(guestId: guest.id) }
                    }
                case .revoked:
                    GuestActionButton(title: "Re-invite", style: .restore) {
                        Task { await viewModel.reinvite(guestId: guest.id) }
                    }
                    GuestActionButton(title: "Remove", style: .danger) {
                        Task { await viewModel.remove(guestId: guest.id) }
                    }
                }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge))
        .shadow(color: Theme.charcoal.opacity(0.06), radius: 4, y: 2)
        .opacity(guest.status == .revoked ? 0.65 : 1.0)
    }

    private func relativeTime(from iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return ""
        }
        let diff = Date().timeIntervalSince(date)
        switch diff {
        case ..<60: return "Just now"
        case ..<3600: return "\(Int(diff / 60))m ago"
        case ..<86400: return "\(Int(diff / 3600))h ago"
        case ..<604800: return "\(Int(diff / 86400))d ago"
        default:
            let cal = Calendar.current
            let weeks = cal.dateComponents([.weekOfYear], from: date, to: Date()).weekOfYear ?? 0
            let months = cal.dateComponents([.month], from: date, to: Date()).month ?? 0
            if months >= 1 { return "\(months)mo ago" }
            return "\(weeks)w ago"
        }
    }
}

// MARK: - Avatar

private struct GuestAvatar: View {
    let name: String
    let status: GuestStatus

    var body: some View {
        let initials = avatarInitials(name)
        let (bg, fg) = avatarColors(name: name, status: status)

        Text(initials)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(fg)
            .frame(width: 42, height: 42)
            .background(bg)
            .clipShape(Circle())
    }

    private func avatarInitials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        switch parts.count {
        case 0: return "?"
        case 1: return String(parts[0].prefix(2)).uppercased()
        default: return (String(parts[0].prefix(1)) + String(parts[1].prefix(1))).uppercased()
        }
    }

    private func avatarColors(name: String, status: GuestStatus) -> (Color, Color) {
        if status == .revoked {
            return (Theme.grayBadge, Theme.grayBadgeText)
        }
        let hash = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        switch hash % 3 {
        case 0: return (Theme.goldBadge, Theme.goldBadgeText)        // amber
        case 1: return (Theme.greenBadge, Theme.greenBadgeText)       // green
        default: return (Theme.roseLight, Theme.rose)                 // rose
        }
    }
}

// MARK: - Action Button

private enum GuestActionStyle { case normal, danger, restore }

private struct GuestActionButton: View {
    let title: String
    let style: GuestActionStyle
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(foregroundColor)
                .padding(.vertical, 7)
                .padding(.horizontal, 14)
                .background(backgroundColor)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusSmall)
                        .stroke(borderColor, lineWidth: 1)
                )
        }
    }

    private var foregroundColor: Color {
        switch style {
        case .normal: return Theme.charcoalSoft
        case .danger: return Theme.rose
        case .restore: return Theme.sage
        }
    }

    private var backgroundColor: Color {
        switch style {
        case .normal: return Theme.creamWarm
        case .danger: return Theme.roseLight
        case .restore: return Theme.sageLight
        }
    }

    private var borderColor: Color {
        switch style {
        case .normal: return Theme.creamDeep
        case .danger: return Theme.rose.opacity(0.3)
        case .restore: return Theme.sage.opacity(0.3)
        }
    }
}

#Preview {
    GuestListView()
}
