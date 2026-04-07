import SwiftUI

struct DriveFilePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: DriveFilePickerViewModel

    init(connectionId: String) {
        _viewModel = StateObject(wrappedValue: DriveFilePickerViewModel(connectionId: connectionId))
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    VStack(spacing: 12) {
                        ProgressView().tint(Theme.hearth)
                        Text("Loading your documents...")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = viewModel.error, viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text("⚠️").font(.system(size: 40))
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.rose)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        Button("Retry") {
                            Task { await viewModel.load() }
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.hearth)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.files.isEmpty {
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No Google Docs found")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Theme.charcoalSoft)
                        Text("Create a Google Doc in your Drive and it will appear here.")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.stone)
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
            .background(Theme.cream)
            .navigationTitle("Select Documents")
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

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Theme.charcoal)

                Text(formattedDate)
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
            }

            Spacer()

            if isConnected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(Theme.sage)
                    .font(.system(size: 20))
            } else if isConnecting {
                ProgressView()
                    .tint(Theme.hearth)
            } else {
                Button {
                    onConnect()
                } label: {
                    Text("Add")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Theme.hearth)
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
