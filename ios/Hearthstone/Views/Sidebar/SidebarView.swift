import SwiftUI

struct SidebarView: View {
    @ObservedObject var router: AppRouter
    let onClose: () -> Void
    @State private var showPINEntry = false

    private var store: SessionStore { router.store }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("YOUR HOUSES")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Color(red: 0.61, green: 0.56, blue: 0.51))
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
                .background(Color(red: 0.24, green: 0.20, blue: 0.18))
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
                .foregroundColor(Color(red: 0.71, green: 0.44, blue: 0.18))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color(red: 0.24, green: 0.20, blue: 0.18))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 12)

            Button {
                router.signOutAll()
                onClose()
            } label: {
                Text("Sign Out of All")
                    .font(.system(size: 13))
                    .foregroundColor(Color(red: 0.61, green: 0.56, blue: 0.51))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color(red: 0.17, green: 0.14, blue: 0.13))
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

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Text(session.role == .owner ? "🏠" : "🏡")
                    .font(.system(size: 16))

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.householdName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(isActive ? Color(red: 0.94, green: 0.90, blue: 0.83) : Color(red: 0.83, green: 0.77, blue: 0.66))

                    Text(session.role == .owner ? "OWNER" : "GUEST")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(isActive ? Color(red: 0.71, green: 0.44, blue: 0.18) : Color(red: 0.61, green: 0.56, blue: 0.51))
                }

                Spacer()
            }
            .padding(10)
            .background(Color(red: 0.24, green: 0.20, blue: 0.18))
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle()
                        .fill(Color(red: 0.71, green: 0.44, blue: 0.18))
                        .frame(width: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
