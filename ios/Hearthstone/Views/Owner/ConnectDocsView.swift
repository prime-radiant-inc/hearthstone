import SwiftUI

struct ConnectDocsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var docsVM = DocumentsViewModel()
    @StateObject private var connVM = ConnectionsViewModel()
    @State private var showFilePicker = false
    @State private var isRefreshingAll = false
    @State private var showDisconnectConfirm = false
    @State private var pendingReconnect = false

    /// The connection ID to use for the file picker — either from a fresh OAuth or existing connection
    private var activeConnectionId: String? {
        connVM.newConnectionId ?? connVM.connections.first?.id
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Connection status
                if connVM.connections.isEmpty {
                    Button {
                        Task { await connVM.connectGoogleDrive() }
                    } label: {
                        HStack {
                            Image(systemName: "link")
                            Text("Connect Google Drive")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.hearth)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                } else {
                    // Drive connected banner
                    HStack(spacing: 6) {
                        Text("⚡")
                        Text("Connected to Google Drive")
                            .fontWeight(.medium)
                        if let email = connVM.connections.first?.email {
                            Text("· \(email)")
                        }
                        Spacer()
                        Button {
                            showDisconnectConfirm = true
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(Theme.stone)
                                .font(.system(size: 16))
                        }
                        .buttonStyle(.plain)
                    }
                    .font(.system(size: 13))
                    .foregroundColor(Theme.goldBadgeText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        LinearGradient(colors: [Color(red: 1, green: 0.99, blue: 0.95), Color(red: 1, green: 0.97, blue: 0.9)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.goldBadge, lineWidth: 1))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)

                    // Add Documents button
                    Button {
                        showFilePicker = true
                    } label: {
                        HStack {
                            Image(systemName: "plus.circle.fill")
                            Text("Add Documents")
                                .fontWeight(.semibold)
                        }
                        .font(.system(size: 15))
                        .foregroundColor(Theme.hearth)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if docsVM.documents.isEmpty && !docsVM.isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No documents connected")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Theme.charcoalSoft)
                        Text("Connect your Google Drive and select documents to make them searchable by your guests.")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    Spacer()
                } else {
                    List {
                        ForEach(docsVM.documents) { doc in
                            DocumentRow(document: doc)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        Task { await docsVM.remove(documentId: doc.id) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .swipeActions(edge: .leading) {
                                    Button {
                                        Task { await docsVM.refresh(documentId: doc.id) }
                                    } label: {
                                        Label("Refresh", systemImage: "arrow.clockwise")
                                    }
                                    .tint(Theme.sage)
                                }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(Theme.cream)
            .navigationTitle("Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !docsVM.documents.isEmpty {
                        Button {
                            Task {
                                isRefreshingAll = true
                                await docsVM.refreshAll()
                                isRefreshingAll = false
                            }
                        } label: {
                            if isRefreshingAll {
                                ProgressView().tint(Theme.hearth)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .foregroundColor(Theme.hearth)
                            }
                        }
                        .disabled(isRefreshingAll)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Theme.hearth)
                        .fontWeight(.semibold)
                }
            }
            .sheet(isPresented: $showFilePicker, onDismiss: {
                Task {
                    await docsVM.load()
                    if pendingReconnect {
                        pendingReconnect = false
                        await reconnect()
                    }
                }
            }) {
                if let connectionId = activeConnectionId {
                    DriveFilePickerView(connectionId: connectionId) {
                        pendingReconnect = true
                    }
                }
            }
        }
        .task {
            await connVM.load()
            await docsVM.load()
        }
        .onChange(of: connVM.newConnectionId) { _, connectionId in
            if connectionId != nil {
                showFilePicker = true
            }
        }
        .alert("Error", isPresented: .init(
            get: { connVM.error != nil },
            set: { if !$0 { connVM.error = nil } }
        )) {
            Button("OK") { connVM.error = nil }
        } message: {
            Text(connVM.error ?? "")
        }
        .alert("Disconnect Google Drive?", isPresented: $showDisconnectConfirm) {
            Button("Disconnect", role: .destructive) {
                Task {
                    if let id = connVM.connections.first?.id {
                        await connVM.removeConnection(id: id)
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can reconnect at any time. Your documents will remain until you remove them.")
        }
    }

    private func reconnect() async {
        if let id = connVM.connections.first?.id {
            await connVM.removeConnection(id: id)
        }
        await connVM.connectGoogleDrive()
    }
}

struct DocumentRow: View {
    let document: Document

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(document.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Theme.charcoal)

                HStack(spacing: 8) {
                    DocStatusBadge(status: document.status)
                    if let synced = document.lastSynced {
                        Text("Synced \(synced)")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.stone)
                    }
                }
            }

            Spacer()

            if let count = document.chunkCount, count > 0 {
                Text("\(count) chunks")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
            }
        }
        .padding(.vertical, 4)
    }
}

struct DocStatusBadge: View {
    let status: DocumentStatus

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.system(size: 11, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(backgroundColor)
            .foregroundColor(textColor)
            .clipShape(Capsule())
    }

    private var backgroundColor: Color {
        switch status {
        case .ready: return Theme.greenBadge
        case .indexing: return Theme.goldBadge
        case .error: return Theme.roseLight
        }
    }

    private var textColor: Color {
        switch status {
        case .ready: return Theme.greenBadgeText
        case .indexing: return Theme.goldBadgeText
        case .error: return Theme.rose
        }
    }
}
