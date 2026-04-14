import Foundation

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var sessions: [HouseSession] = []
    @Published var activeSessionId: String?

    static let legacyDefaultServer = URL(string: "https://hearthstone-mhat.fly.dev")!

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
        migrateFromLegacyIfNeeded()
    }

    private func migrateFromLegacyIfNeeded() {
        guard sessions.isEmpty else { return }

        if let ownerToken = KeychainService.shared.read(key: "hearthstone_owner_jwt") {
            let session = HouseSession(
                id: UUID().uuidString,
                serverURL: Self.legacyDefaultServer,
                householdId: "migrated-owner",
                householdName: "My House",
                role: .owner,
                addedAt: Date()
            )
            add(session: session, token: ownerToken)
            KeychainService.shared.delete(key: "hearthstone_owner_jwt")

            let migratedSession = sessions.first(where: { $0.role == .owner && $0.householdId == "migrated-owner" })
            Task {
                guard let me = try? await migratedSession?.apiClient()?.getMe() else { return }
                if let household = me.household {
                    if let idx = sessions.firstIndex(where: { $0.role == .owner && $0.householdId == "migrated-owner" }) {
                        let old = sessions[idx]
                        let updated = HouseSession(
                            id: old.id,
                            serverURL: old.serverURL,
                            householdId: household.id,
                            householdName: household.name,
                            role: .owner,
                            addedAt: old.addedAt
                        )
                        sessions[idx] = updated
                        persist()
                    }
                }
            }
        }

        if let guestToken = KeychainService.shared.read(key: "hearthstone_guest_hss") {
            let householdName = UserDefaults.standard.string(forKey: "guestHouseholdName") ?? "Guest House"
            let session = HouseSession(
                id: UUID().uuidString,
                serverURL: Self.legacyDefaultServer,
                householdId: "migrated-guest",
                householdName: householdName,
                role: .guest,
                addedAt: Date()
            )
            add(session: session, token: guestToken)
            KeychainService.shared.delete(key: "hearthstone_guest_hss")
            UserDefaults.standard.removeObject(forKey: "guestHouseholdName")
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: metadataURL) else { return }

        // Try the new shape first.
        if let decoded = try? JSONDecoder().decode(StoredState.self, from: data) {
            sessions = decoded.sessions
            activeSessionId = decoded.activeSessionId ?? decoded.sessions.first?.id
            return
        }

        // Fall back: decode sessions as dictionaries and fill in serverURL for any missing ones.
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawSessions = raw["sessions"] as? [[String: Any]] else {
            return
        }

        var migrated: [HouseSession] = []
        for dict in rawSessions {
            var d = dict
            if d["serverURL"] == nil {
                d["serverURL"] = Self.legacyDefaultServer.absoluteString
            }
            if let fixedData = try? JSONSerialization.data(withJSONObject: d),
               let session = try? JSONDecoder().decode(HouseSession.self, from: fixedData) {
                migrated.append(session)
            }
        }
        sessions = migrated
        activeSessionId = raw["activeSessionId"] as? String ?? migrated.first?.id
        persist()  // re-save in new format
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
