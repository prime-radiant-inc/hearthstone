import SwiftUI

struct DriveFilePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @StateObject private var viewModel: DriveFilePickerViewModel
    var onReconnect: (() -> Void)?

    init(sessionId: String, connectionId: String, onReconnect: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: DriveFilePickerViewModel(sessionId: sessionId, connectionId: connectionId))
        self.onReconnect = onReconnect
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    VStack(spacing: 12) {
                        ProgressView().tint(theme.hearth)
                        Text("Loading your documents...")
                            .font(.system(size: 14))
                            .foregroundColor(theme.stone)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = viewModel.error, viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text(viewModel.isAuthError ? "🔑" : "⚠️").font(.system(size: 40))
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(theme.rose)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        if viewModel.isAuthError {
                            Button("Reconnect Google Drive") {
                                dismiss()
                                onReconnect?()
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(theme.hearth)
                            .clipShape(Capsule())
                        } else {
                            Button("Retry") {
                                Task { await viewModel.load() }
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(theme.hearth)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No Google Docs found")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(theme.charcoalSoft)
                        Text("Create a Google Doc in your Drive and it will appear here.")
                            .font(.system(size: 14))
                            .foregroundColor(theme.stone)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(viewModel.files) { file in
                            DriveFileRow(
                                file: file,
                                isConnecting: viewModel.connectingFileIds.contains(file.id),
                                isConnected: viewModel.connectedFileIds.contains(file.id)
                            ) {
                                Task { await viewModel.connect(file: file) }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(theme.cream)
            .navigationTitle("Select Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task {
            await viewModel.load()
        }
        .alert("Error", isPresented: .init(
            get: { viewModel.error != nil && !viewModel.files.isEmpty },
            set: { if !$0 { viewModel.error = nil } }
        )) {
            Button("OK") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }
}

struct DriveFileRow: View {
    let file: DriveFile
    let isConnecting: Bool
    let isConnected: Bool
    let onConnect: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(theme.charcoal)

                Text(formattedDate)
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
            }

            Spacer()

            if isConnected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(theme.sage)
                    .font(.system(size: 20))
            } else if isConnecting {
                ProgressView()
                    .tint(theme.hearth)
            } else {
                Button {
                    onConnect()
                } label: {
                    Text("Add")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(theme.hearth)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }

    private var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: file.modifiedTime) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: file.modifiedTime) else {
                return file.modifiedTime
            }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}
