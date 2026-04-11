import SwiftUI

// MARK: - DashboardView

struct DashboardView: View {
    let sessionId: String
    @State var householdName: String
    @State var ownerName: String

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @StateObject private var viewModel = DashboardViewModel()
    @State private var showDocuments = false
    @State private var showGuestList = false
    @State private var showOwnerPreview = false
    @State private var showInviteOwner = false
    @State private var isEditingName = false
    @State private var editedName = ""
    @State private var isSavingName = false
    @State private var showNamePrompt = false
    @State private var promptedName = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HeroHeader(
                    householdName: householdName,
                    ownerName: ownerName,
                    isEditing: $isEditingName,
                    editedName: $editedName,
                    isSaving: isSavingName,
                    onSave: {
                        let newName = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !newName.isEmpty, newName != householdName else {
                            isEditingName = false
                            return
                        }
                        isSavingName = true
                        Task {
                            do {
                                let updated = try await APIClient.shared.updateHousehold(name: newName)
                                householdName = updated.name
                            } catch {}
                            isSavingName = false
                            isEditingName = false
                        }
                    }
                )

                StatRow(
                    documentCount: viewModel.documentCount,
                    guestCount: viewModel.activeGuestCount + viewModel.pendingGuestCount,
                    onDocumentsTap: { showDocuments = true },
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
                    documentSubtitle: documentSubtitle,
                    guestSubtitle: guestSubtitle,
                    onDocumentsTap: { showDocuments = true },
                    onGuestsTap: { showGuestList = true },
                    onPreviewTap: { showOwnerPreview = true },
                    onInviteOwnerTap: { showInviteOwner = true }
                )
                .padding(.top, 24)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(theme.cream.ignoresSafeArea())
        .task { await viewModel.load() }
        .sheet(isPresented: $showDocuments) {
            ConnectDocsView()
        }
        .sheet(isPresented: $showGuestList) {
            GuestListView()
        }
        .sheet(isPresented: $showOwnerPreview) {
            OwnerPreviewView(householdName: householdName)
        }
        .sheet(isPresented: $showInviteOwner) {
            InviteOwnerView()
        }
        .onChange(of: showDocuments) { _, isShowing in
            if !isShowing { Task { await viewModel.load() } }
        }
        .onChange(of: showGuestList) { _, isShowing in
            if !isShowing { Task { await viewModel.load() } }
        }
        .alert("What's your name?", isPresented: $showNamePrompt) {
            TextField("Your name", text: $promptedName)
            Button("Save") {
                let name = promptedName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task {
                    do {
                        _ = try await APIClient.shared.updateMe(name: name)
                        ownerName = name
                        SessionStore.shared.updateSession(id: sessionId, personName: name)
                    } catch { }
                }
            }
            Button("Skip", role: .cancel) {}
        } message: {
            Text("This shows on your dashboard instead of your email.")
        }
        .onAppear {
            if ownerName.isEmpty || ownerName.contains("@") {
                showNamePrompt = true
            }
        }
    }

    private var documentSubtitle: String {
        switch viewModel.documentCount {
        case 0: return "No docs connected yet"
        case 1: return "1 doc connected"
        default: return "\(viewModel.documentCount) docs connected"
        }
    }

    private var guestSubtitle: String {
        if viewModel.activeGuestCount == 0 && viewModel.pendingGuestCount == 0 {
            return "No guests yet"
        }
        var parts: [String] = []
        if viewModel.activeGuestCount > 0 {
            parts.append("\(viewModel.activeGuestCount) active")
        }
        if viewModel.pendingGuestCount > 0 {
            parts.append("\(viewModel.pendingGuestCount) pending")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - HeroHeader

private struct HeroHeader: View {
    let householdName: String
    let ownerName: String
    @Binding var isEditing: Bool
    @Binding var editedName: String
    let isSaving: Bool
    let onSave: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

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

                if isEditing {
                    HStack(spacing: 8) {
                        TextField("Household name", text: $editedName)
                            .font(Theme.heading(26))
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                            .tint(.white)
                            .onSubmit { onSave() }

                        if isSaving {
                            ProgressView().tint(.white)
                        } else {
                            Button { onSave() } label: {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 22))
                                    .foregroundColor(.white.opacity(0.9))
                            }
                        }
                    }
                } else {
                    Text(householdName)
                        .font(Theme.heading(26))
                        .fontWeight(.semibold)
                        .onLongPressGesture {
                            editedName = householdName
                            isEditing = true
                        }
                }

                if !ownerName.isEmpty {
                    Text("Welcome back, \(ownerName)")
                        .font(.system(size: 14))
                        .opacity(0.75)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 28)
        }
        .foregroundColor(.white)
        .background(
            LinearGradient(
                colors: [theme.hearth, theme.hearthDark],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
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
            Button(action: onDocumentsTap) {
                StatCard(number: documentCount, label: "Documents")
            }
            .buttonStyle(.plain)

            Button(action: onGuestsTap) {
                StatCard(number: guestCount, label: "Guests")
            }
            .buttonStyle(.plain)
        }
    }
}

private struct StatCard: View {
    let number: Int
    let label: String

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(number)")
                .font(Theme.heading(32))
                .fontWeight(.semibold)
                .foregroundColor(theme.charcoal)
                .lineLimit(1)

            Text(label)
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.creamWarm)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
        .shadow(color: theme.shadow, radius: 6, x: 0, y: 4)
    }
}

// MARK: - OnboardingChecklist

private struct OnboardingChecklist: View {
    let hasConnections: Bool
    let hasDocuments: Bool
    let hasGuests: Bool

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("✦")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(theme.goldBadgeText)
                Text("Getting started")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(theme.goldBadgeText)
            }
            .padding(.bottom, 14)

            ChecklistRow(label: "Create your household", isDone: true)
            Divider().background(theme.goldBadge).padding(.vertical, 2)
            ChecklistRow(label: "Connect your documents", isDone: hasDocuments || hasConnections)
            Divider().background(theme.goldBadge).padding(.vertical, 2)
            ChecklistRow(label: "Invite your first guest", isDone: hasGuests)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(
            LinearGradient(
                colors: [
                    theme.onboardingGradientStart,
                    theme.onboardingGradientEnd
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusLarge)
                .stroke(theme.goldBadge, lineWidth: 1.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge))
    }
}

private struct ChecklistRow: View {
    let label: String
    let isDone: Bool

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(isDone ? theme.hearth : Color.clear)
                    .frame(width: 26, height: 26)
                Circle()
                    .stroke(isDone ? Color.clear : theme.goldBadge, lineWidth: 2)
                    .frame(width: 26, height: 26)
                if isDone {
                    Text("✓")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                } else {
                    Text("•")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(theme.goldBadgeText)
                }
            }

            Text(label)
                .font(.system(size: 14))
                .foregroundColor(isDone ? theme.stone : theme.charcoalSoft)
                .strikethrough(isDone, color: theme.stone)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - ManageSection

private struct ManageSection: View {
    let documentSubtitle: String
    let guestSubtitle: String
    let onDocumentsTap: () -> Void
    let onGuestsTap: () -> Void
    let onPreviewTap: () -> Void
    let onInviteOwnerTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("MANAGE")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.2)
                .foregroundColor(theme.stone)
                .padding(.bottom, 12)

            ManageRow(
                icon: "📄",
                iconBackground: theme.iconBackgroundWarm,
                title: "Documents",
                subtitle: documentSubtitle,
                onTap: onDocumentsTap
            )

            ManageRow(
                icon: "👥",
                iconBackground: theme.sageLight,
                title: "Guests",
                subtitle: guestSubtitle,
                onTap: onGuestsTap
            )

            ManageRow(
                icon: "🔑",
                iconBackground: theme.iconBackgroundWarm,
                title: "Invite Owner",
                subtitle: "Give someone owner access",
                onTap: onInviteOwnerTap
            )

            ManageRow(
                icon: "💬",
                iconBackground: theme.iconBackgroundCool,
                title: "Preview as Guest",
                subtitle: "See what your guests see",
                onTap: onPreviewTap
            )
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 32)
    }
}

private struct ManageRow: View {
    let icon: String
    let iconBackground: Color
    let title: String
    let subtitle: String
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

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
                        .foregroundColor(theme.charcoal)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(theme.stone)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(theme.creamDeep)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(theme.creamWarm)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            .shadow(color: theme.shadowLight, radius: 2, x: 0, y: 1)
        }
        .padding(.bottom, 10)
    }
}
