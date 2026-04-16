import SwiftUI

// MARK: - DashboardView

struct DashboardView: View {
    let sessionId: String

    @ObservedObject private var store = SessionStore.shared
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @StateObject private var viewModel: DashboardViewModel
    @State private var showDocuments = false
    @State private var showGuestList = false
    @State private var showOwnerPreview = false
    @State private var showInviteOwner = false
    @State private var isEditingName = false
    @State private var editedName = ""
    @State private var isSavingName = false
    @State private var saveError: String?
    @State private var showNamePrompt = false
    @State private var promptedName = ""
    @State private var showDeleteConfirmation = false
    @State private var deleteConfirmationText = ""
    @State private var isDeleting = false
    @State private var deleteError: String?

    init(sessionId: String) {
        self.sessionId = sessionId
        _viewModel = StateObject(wrappedValue: DashboardViewModel(sessionId: sessionId))
    }

    /// Live view of this dashboard's session. Returns `nil` only during the
    /// brief window after the session is removed and before the router
    /// switches away — callers fall back to empty strings.
    private var session: HouseSession? {
        store.sessions.first(where: { $0.id == sessionId })
    }

    private var householdName: String { session?.householdName ?? "" }
    private var ownerName: String { session?.personName ?? "" }

    var body: some View {
        switch viewModel.houseStatus {
        case .gone, .accessLost:
            MissingHouseView(
                householdName: householdName,
                status: viewModel.houseStatus,
                onRemove: {
                    store.remove(id: sessionId)
                }
            )
        case .loading, .ready:
            dashboardContent
        }
    }

    private var dashboardContent: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    HeroHeader(
                        householdName: householdName,
                        ownerName: ownerName,
                        isEditing: $isEditingName,
                        editedName: $editedName,
                        isSaving: isSavingName,
                        safeAreaTop: geo.safeAreaInsets.top,
                        onSave: saveHouseholdName
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
                        onInviteOwnerTap: { showInviteOwner = true },
                        onDeleteHouseTap: {
                            deleteConfirmationText = ""
                            showDeleteConfirmation = true
                        }
                    )
                    .padding(.top, 24)
                }
            }
            .ignoresSafeArea(edges: .top)
            .background(theme.cream)
        }
        .task(id: store.activeSessionId) { await viewModel.load() }
        .sheet(isPresented: $showDocuments) {
            ConnectDocsView(sessionId: sessionId)
        }
        .sheet(isPresented: $showGuestList) {
            GuestListView(sessionId: sessionId)
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
                    if let session, let client = session.apiClient() {
                        do {
                            _ = try await client.updateMe(name: name)
                            store.updateSession(id: sessionId, personName: name)
                        } catch { }
                    }
                }
            }
            Button("Skip", role: .cancel) {}
        } message: {
            Text("This shows on your dashboard instead of your email.")
        }
        .alert(
            "Couldn't rename household",
            isPresented: Binding(
                get: { saveError != nil },
                set: { if !$0 { saveError = nil } }
            ),
            presenting: saveError
        ) { _ in
            Button("OK") { saveError = nil }
        } message: { message in
            Text(message)
        }
        .sheet(isPresented: $showDeleteConfirmation) {
            DeleteHouseConfirmationView(
                householdName: householdName,
                confirmationText: $deleteConfirmationText,
                isDeleting: isDeleting,
                error: deleteError,
                onConfirm: deleteHousehold,
                onCancel: {
                    showDeleteConfirmation = false
                    deleteError = nil
                }
            )
            .presentationDetents([.medium])
        }
        .onAppear {
            if ownerName.isEmpty || ownerName.contains("@") {
                showNamePrompt = true
            }
        }
    }

    private func deleteHousehold() {
        guard let session, let client = session.apiClient() else { return }
        isDeleting = true
        deleteError = nil
        Task {
            do {
                try await client.deleteHousehold()
                store.remove(id: sessionId)
                showDeleteConfirmation = false
                isDeleting = false
            } catch {
                isDeleting = false
                deleteError = error.localizedDescription
            }
        }
    }

    private func saveHouseholdName() {
        let newName = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !newName.isEmpty, newName != householdName else {
            isEditingName = false
            return
        }
        guard let session, let client = session.apiClient() else {
            isEditingName = false
            return
        }
        isSavingName = true
        Task {
            do {
                let updated = try await client.updateHousehold(name: newName)
                store.updateSession(id: sessionId, householdName: updated.name)
                isSavingName = false
                isEditingName = false
            } catch {
                isSavingName = false
                saveError = error.localizedDescription
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
    var safeAreaTop: CGFloat = 0
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
            .padding(.top, safeAreaTop + 12)
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
    let onDeleteHouseTap: () -> Void

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

            // Danger zone
            Text("DANGER ZONE")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.2)
                .foregroundColor(theme.rose)
                .padding(.top, 24)
                .padding(.bottom, 12)

            DangerRow(
                title: "Delete this house\u{2026}",
                subtitle: "Permanently remove this household and all its data",
                onTap: onDeleteHouseTap
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

private struct DangerRow: View {
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
                        .fill(theme.roseLight)
                        .frame(width: 42, height: 42)
                    Image(systemName: "trash")
                        .font(.system(size: 18))
                        .foregroundColor(theme.rose)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(theme.rose)
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
            .background(theme.roseLight)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMedium)
                    .stroke(theme.rose.opacity(0.3), lineWidth: 1)
            )
        }
    }
}

// MARK: - Delete House Confirmation

private struct DeleteHouseConfirmationView: View {
    let householdName: String
    @Binding var confirmationText: String
    let isDeleting: Bool
    let error: String?
    let onConfirm: () -> Void
    let onCancel: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    private var nameMatches: Bool {
        confirmationText.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() == householdName.lowercased()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button("Cancel") { onCancel() }
                    .foregroundColor(theme.charcoalSoft)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)

            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(theme.roseLight)
                        .frame(width: 56, height: 56)
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(theme.rose)
                }

                Text("Delete \u{201C}\(householdName)\u{201D}?")
                    .font(Theme.heading(20))
                    .foregroundColor(theme.charcoal)
                    .multilineTextAlignment(.center)

                Text("This permanently removes the household, all of its guests, owners, connected documents, and chat history.")
                    .font(.system(size: 14))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Type the house name to confirm:")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(theme.stone)

                    TextField(householdName, text: $confirmationText)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
                .padding(.horizontal, 24)

                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(theme.rose)
                        .padding(.horizontal, 24)
                }

                Button(action: onConfirm) {
                    HStack(spacing: 8) {
                        if isDeleting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text("Delete house")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(nameMatches && !isDeleting ? theme.rose : theme.rose.opacity(0.4))
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                }
                .disabled(!nameMatches || isDeleting)
                .padding(.horizontal, 24)
            }
            .padding(.bottom, 24)

            Spacer()
        }
        .background(theme.cream)
    }
}
