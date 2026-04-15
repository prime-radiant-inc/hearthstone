import Foundation

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var sessions: [HouseSession] = []
    @Published var activeSessionId: String?

    var activeSession: HouseSession? {
        guard let id = activeSessionId else { return nil }
        return sessions.first { $0.id == id }
    }

    var activeToken: String? {
        guard let id = activeSessionId else { return nil }
        return KeychainService.shared.read(key: "hst_\(id)")
    }

    private let metadataURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("sessions.json")
    }()

    private init() {
        load()
    }

    private func load() {
        guard let data = try? Data(contentsOf: metadataURL) else { return }
        guard let decoded = try? JSONDecoder().decode(StoredState.self, from: data) else { return }
        sessions = decoded.sessions
        activeSessionId = decoded.activeSessionId ?? decoded.sessions.first?.id
    }

    private func persist() {
        let state = StoredState(sessions: sessions, activeSessionId: activeSessionId)
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: metadataURL, options: .atomic)
    }

    private struct StoredState: Codable {
        let sessions: [HouseSession]
        let activeSessionId: String?
    }

    func add(session: HouseSession, token: String) {
        let wasEmpty = sessions.isEmpty
        sessions.removeAll { $0.householdId == session.householdId && $0.role == session.role }
        sessions.append(session)
        sessions.sort { $0.addedAt < $1.addedAt }
        KeychainService.shared.save(key: "hst_\(session.id)", value: token)
        if wasEmpty || activeSessionId == nil {
            activeSessionId = session.id
        }
        persist()
    }

    func remove(id: String) {
        sessions.removeAll { $0.id == id }
        KeychainService.shared.delete(key: "hst_\(id)")
        if activeSessionId == id {
            activeSessionId = sessions.first?.id
        }
        persist()
    }

    func removeAll() {
        for session in sessions {
            KeychainService.shared.delete(key: "hst_\(session.id)")
        }
        sessions = []
        activeSessionId = nil
        persist()
    }

    func switchTo(id: String) {
        guard sessions.contains(where: { $0.id == id }) else { return }
        activeSessionId = id
        persist()
    }

    func hasSession(forServerHost host: String) -> Bool {
        sessions.contains { $0.serverURL.host == host }
    }

    func updateSession(id: String, personName: String) {
        guard let idx = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[idx].personName = personName
        persist()
    }
}
