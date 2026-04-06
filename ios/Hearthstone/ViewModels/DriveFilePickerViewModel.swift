import Foundation

@MainActor
final class DriveFilePickerViewModel: ObservableObject {
    @Published var files: [DriveFile] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var connectingFileIds: Set<String> = []
    @Published var connectedFileIds: Set<String> = []

    private let connectionId: String

    init(connectionId: String) {
        self.connectionId = connectionId
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            files = try await APIClient.shared.listDriveFiles(connectionId: connectionId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func connect(file: DriveFile) async {
        connectingFileIds.insert(file.id)
        do {
            _ = try await APIClient.shared.connectDocument(driveFileId: file.id, title: file.name)
            connectingFileIds.remove(file.id)
            connectedFileIds.insert(file.id)
        } catch {
            connectingFileIds.remove(file.id)
            self.error = error.localizedDescription
        }
    }
}
