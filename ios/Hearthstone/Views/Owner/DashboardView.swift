import SwiftUI

// MARK: - DashboardView

struct DashboardView: View {
    let householdName: String
    let ownerName: String

    @StateObject private var viewModel = DashboardViewModel()
    @State private var showGuestList = false
    @State private var showOwnerPreview = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HeroHeader(
                    householdName: householdName,
                    ownerName: ownerName
                )

                StatRow(
                    documentCount: viewModel.documentCount,
                    guestCount: viewModel.activeGuestCount + viewModel.pendingGuestCount,
                    onDocumentsTap: { /* navigate to documents */ },
                    onGuestsTap: { showGuestList = true }
                )
                .padding(.top, -16)
                .padding(.horizontal, 24)
                .zIndex(2)

                if !viewModel.isSetupComplete {
                    OnboardingChecklist(
                        hasConnections: viewModel.hasConnections,
                        hasDocuments: viewModel.documentCount > 0,
                        hasGuests: (viewModel.activeGuestCount + viewModel.pendingGuestCount) > 0
                    )
                    .padding(.top, 20)
                    .padding(.horizontal, 24)
                }

                ManageSection(
                    documentCount: viewModel.documentCount,
                    guestCount: viewModel.activeGuestCount + viewModel.pendingGuestCount,
                    onDocumentsTap: { /* navigate to documents */ },
                    onGuestsTap: { showGuestList = true },
                    onPreviewTap: { showOwnerPreview = true }
                )
                .padding(.top, 24)
            }
        }
        .background(Theme.cream.ignoresSafeArea())
        .task { await viewModel.load() }
        .sheet(isPresented: $showGuestList) {
            Text("Guest List")
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showOwnerPreview) {
            Text("Owner Preview as Guest")
                .presentationDetents([.large])
        }
    }
}

// MARK: - HeroHeader

private struct HeroHeader: View {
    let householdName: String
    let ownerName: String

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Circle()
                .fill(Color.white.opacity(0.06))
                .frame(width: 140, height: 140)
                .offset(x: 30, y: -30)

            VStack(alignment: .leading, spacing: 4) {
                Text("YOUR HOUSEHOLD")
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(1.2)
                    .opacity(0.7)

                Text(householdName)
                    .font(Theme.heading(26))
                    .fontWeight(.semibold)

                Text("Welcome back, \(ownerName)")
                    .font(.system(size: 14))
                    .opacity(0.75)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 4)
            .padding(.bottom, 28)
        }
        .foregroundColor(.white)
        .background(
            LinearGradient(
                colors: [Theme.hearth, Theme.hearthDark],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipped()
    }
}

// MARK: - StatRow

private struct StatRow: View {
    let documentCount: Int
    let guestCount: Int
    let onDocumentsTap: () -> Void
    let onGuestsTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            StatCard(
                number: documentCount,
                label: "Documents",
                onManageTap: onDocumentsTap
            )
            StatCard(
                number: guestCount,
                label: "Guests",
                onManageTap: onGuestsTap
            )
        }
    }
}

// MARK: - StatCard

private struct StatCard: View {
    let number: Int
    let label: String
    let onManageTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(number)")
                .font(Theme.heading(32))
                .fontWeight(.semibold)
                .foregroundColor(Theme.charcoal)
                .lineLimit(1)

            Text(label)
                .font(.system(size: 13))
                .foregroundColor(Theme.stone)

            Button(action: onManageTap) {
                Text("Manage →")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.hearth)
            }
            .padding(.top, 8)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
        .shadow(color: Theme.charcoal.opacity(0.08), radius: 6, x: 0, y: 4)
    }
}

// MARK: - OnboardingChecklist

private struct OnboardingChecklist: View {
    let hasConnections: Bool
    let hasDocuments: Bool
    let hasGuests: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("✦")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Theme.goldBadgeText)
                Text("Getting started")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.goldBadgeText)
            }
            .padding(.bottom, 14)

            ChecklistRow(
                label: "Create your household",
                isDone: true
            )

            Divider()
                .background(Theme.goldBadge)
                .padding(.vertical, 2)

            ChecklistRow(
                label: "Connect your documents",
                isDone: hasDocuments || hasConnections
            )

            Divider()
                .background(Theme.goldBadge)
                .padding(.vertical, 2)

            ChecklistRow(
                label: "Invite your first guest",
                isDone: hasGuests
            )
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 1.0, green: 0.988, blue: 0.945),
                    Color(red: 1.0, green: 0.973, blue: 0.902)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusLarge)
                .stroke(Theme.goldBadge, lineWidth: 1.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge))
    }
}

// MARK: - ChecklistRow

private struct ChecklistRow: View {
    let label: String
    let isDone: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(isDone ? Theme.hearth : Color.clear)
                    .frame(width: 26, height: 26)
                Circle()
                    .stroke(isDone ? Color.clear : Theme.goldBadge, lineWidth: 2)
                    .frame(width: 26, height: 26)
                if isDone {
                    Text("✓")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                } else {
                    Text("•")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Theme.goldBadgeText)
                }
            }

            Text(label)
                .font(.system(size: 14))
                .foregroundColor(isDone ? Theme.stone : Theme.charcoalSoft)
                .strikethrough(isDone, color: Theme.stone)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - ManageSection

private struct ManageSection: View {
    let documentCount: Int
    let guestCount: Int
    let onDocumentsTap: () -> Void
    let onGuestsTap: () -> Void
    let onPreviewTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("MANAGE")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.2)
                .foregroundColor(Theme.stone)
                .padding(.bottom, 12)

            ManageRow(
                icon: "📄",
                iconBackground: Color(red: 1.0, green: 0.953, blue: 0.863),
                title: "Documents",
                subtitle: documentCount == 1 ? "1 document connected" : "\(documentCount) documents connected",
                onTap: onDocumentsTap
            )

            ManageRow(
                icon: "👥",
                iconBackground: Theme.sageLight,
                title: "Guests",
                subtitle: guestCount == 1 ? "1 guest" : "\(guestCount) guests",
                onTap: onGuestsTap
            )

            ManageRow(
                icon: "💬",
                iconBackground: Color(red: 0.910, green: 0.890, blue: 0.941),
                title: "Preview as Guest",
                subtitle: "See the experience your guests have",
                onTap: onPreviewTap
            )
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 32)
    }
}

// MARK: - ManageRow

private struct ManageRow: View {
    let icon: String
    let iconBackground: Color
    let title: String
    let subtitle: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(iconBackground)
                        .frame(width: 42, height: 42)
                    Text(icon)
                        .font(.system(size: 20))
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.charcoal)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(Theme.stone)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Theme.creamDeep)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            .shadow(color: Theme.charcoal.opacity(0.06), radius: 2, x: 0, y: 1)
        }
        .padding(.bottom, 10)
    }
}

// MARK: - Preview

#Preview("Setup incomplete") {
    DashboardView(householdName: "The Miller Home", ownerName: "Sarah")
}

#Preview("Ready state") {
    let vm = DashboardViewModel()
    return DashboardView(householdName: "The Miller Home", ownerName: "Sarah")
}
