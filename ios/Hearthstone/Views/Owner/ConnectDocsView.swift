import SwiftUI

struct ConnectDocsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var docsVM = DocumentsViewModel()
    @StateObject private var connVM = ConnectionsViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Connection status
                if connVM.connections.isEmpty {
                    // No Drive connected
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task {
            await connVM.load()
            await docsVM.load()
        }
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
