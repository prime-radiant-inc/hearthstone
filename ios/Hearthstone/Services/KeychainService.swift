import Foundation
import Security

final class KeychainService {
    static let shared = KeychainService()
    private init() {}

    private let ownerTokenKey = "hearthstone_owner_jwt"
    private let guestTokenKey = "hearthstone_guest_hss"

    var ownerToken: String? {
        get { read(key: ownerTokenKey) }
        set {
            if let value = newValue { save(key: ownerTokenKey, value: value) }
            else { delete(key: ownerTokenKey) }
        }
    }

    var guestToken: String? {
        get { read(key: guestTokenKey) }
        set {
            if let value = newValue { save(key: guestTokenKey, value: value) }
            else { delete(key: guestTokenKey) }
        }
    }

    private func save(key: String, value: String) {
        let data = Data(value.utf8)
        delete(key: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    func clearAll() {
        ownerToken = nil
        guestToken = nil
    }
}
