import Foundation

@MainActor
final class DriveFilePickerViewModel: ObservableObject {
    @Published var files: [DriveFile] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var isAuthError = false
    @Published var connectingFileIds: Set<String> = []
    @Published var connectedFileIds: Set<String> = []

    private let connectionId: String

    init(connectionId: String) {
        self.connectionId = connectionId
    }

    private var client: APIClient? {
        SessionStore.shared.activeSession?.apiClient()
    }

    func load() async {
        isLoading = true
        error = nil
        isAuthError = false
        guard let client else {
            isLoading = false
            return
        }
        do {
            files = try await client.listDriveFiles(connectionId: connectionId)
        } catch let apiErr as APIError {
            switch apiErr {
            case .server(401, let msg):
                self.error = msg
                self.isAuthError = true
            case .http(401):
                self.error = "Google Drive authorization expired. Please reconnect."
                self.isAuthError = true
            default:
                self.error = apiErr.localizedDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func connect(file: DriveFile) async {
        guard let client else { return }
        connectingFileIds.insert(file.id)
        do {
            _ = try await client.connectDocument(driveFileId: file.id, title: file.name)
            connectingFileIds.remove(file.id)
            connectedFileIds.insert(file.id)
        } catch {
            connectingFileIds.remove(file.id)
            self.error = error.localizedDescription
        }
    }
}
