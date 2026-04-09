import SwiftUI

struct SidebarView: View {
    @ObservedObject var router: AppRouter
    let onClose: () -> Void
    @State private var showPINEntry = false

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    private var store: SessionStore { router.store }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("YOUR HOUSES")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(theme.sidebarTextMuted)
                .kerning(1)
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)

            List {
                ForEach(store.sessions) { session in
                    HouseRow(
                        session: session,
                        isActive: session.id == store.activeSessionId,
                        onTap: {
                            store.switchTo(id: session.id)
                            router.syncState()
                            onClose()
                        }
                    )
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            store.remove(id: session.id)
                            router.syncState()
                            if store.sessions.isEmpty {
                                onClose()
                            }
                        } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 3, leading: 12, bottom: 3, trailing: 12))
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)

            Divider()
                .background(theme.sidebarDivider)
                .padding(.vertical, 8)

            Button {
                showPINEntry = true
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Enter PIN")
                        .fontWeight(.semibold)
                }
                .font(.system(size: 14))
                .foregroundColor(theme.sidebarAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(theme.sidebarSurface)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 12)

            Button {
                router.signOutAll()
                onClose()
            } label: {
                Text("Sign Out of All")
                    .font(.system(size: 13))
                    .foregroundColor(theme.sidebarTextMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(theme.sidebarBackground)
        .sheet(isPresented: $showPINEntry) {
            PINEntryView { session, token in
                router.addSession(session, token: token)
                showPINEntry = false
                onClose()
            }
        }
    }
}

struct HouseRow: View {
    let session: HouseSession
    let isActive: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Text(session.role == .owner ? "🏠" : "🏡")
                    .font(.system(size: 16))

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.householdName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(isActive ? theme.sidebarText : theme.sidebarTextInactive)

                    Text(session.role == .owner ? "OWNER" : "GUEST")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(isActive ? theme.sidebarAccent : theme.sidebarTextMuted)
                }

                Spacer()
            }
            .padding(10)
            .background(theme.sidebarSurface)
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle()
                        .fill(theme.sidebarAccent)
                        .frame(width: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
