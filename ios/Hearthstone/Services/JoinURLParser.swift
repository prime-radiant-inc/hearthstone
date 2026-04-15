import Foundation

struct JoinPayload: Equatable {
    let serverURL: URL
    let pin: String
}

extension JoinPayload: Identifiable {
    var id: String { "\(serverURL.absoluteString)|\(pin)" }
}

enum JoinURLParser {
    /// Crockford base32 alphabet: 10 digits + 22 letters (no I, L, O, U).
    /// Must match `PIN_ALPHABET` in backend/src/services/pins.ts.
    private static let pinAlphabet: Set<Character> = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let pinLength = 6

    /// Normalize to uppercase and verify against the PIN alphabet.
    /// Returns the normalized PIN, or nil if it's not a valid shape.
    private static func normalizePin(_ raw: String) -> String? {
        let upper = raw.uppercased()
        guard upper.count == pinLength,
              upper.allSatisfy({ pinAlphabet.contains($0) }) else {
            return nil
        }
        return upper
    }

    /// Parses either:
    ///   https://<host>/join/<pin>
    ///   hearthstone://join?server=<url-encoded>&pin=<pin>
    static func parse(_ string: String) -> JoinPayload? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else { return nil }

        if components.scheme == "hearthstone", components.host == "join" {
            let items = components.queryItems ?? []
            guard let serverStr = items.first(where: { $0.name == "server" })?.value,
                  let rawPin = items.first(where: { $0.name == "pin" })?.value,
                  let serverURL = URL(string: serverStr),
                  let pin = normalizePin(rawPin) else {
                return nil
            }
            return JoinPayload(serverURL: serverURL, pin: pin)
        }

        if components.scheme == "https" || components.scheme == "http" {
            let parts = components.path.split(separator: "/")
            guard parts.count == 2, parts[0] == "join" else { return nil }
            guard let pin = normalizePin(String(parts[1])),
                  let host = components.host else { return nil }
            var root = URLComponents()
            root.scheme = components.scheme
            root.host = host
            root.port = components.port
            guard let serverURL = root.url else { return nil }
            return JoinPayload(serverURL: serverURL, pin: pin)
        }

        return nil
    }
}
