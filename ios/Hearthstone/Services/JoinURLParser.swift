import Foundation

struct JoinPayload: Equatable {
    let serverURL: URL
    let pin: String
}

extension JoinPayload: Identifiable {
    var id: String { "\(serverURL.absoluteString)|\(pin)" }
}

enum JoinURLParser {
    /// Parses either:
    ///   https://<host>/join/<pin>
    ///   hearthstone://join?server=<url-encoded>&pin=<pin>
    static func parse(_ string: String) -> JoinPayload? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else { return nil }

        if components.scheme == "hearthstone", components.host == "join" {
            let items = components.queryItems ?? []
            guard let serverStr = items.first(where: { $0.name == "server" })?.value,
                  let pin = items.first(where: { $0.name == "pin" })?.value,
                  let serverURL = URL(string: serverStr),
                  pin.count == 6, pin.allSatisfy(\.isNumber) else {
                return nil
            }
            return JoinPayload(serverURL: serverURL, pin: pin)
        }

        if components.scheme == "https" || components.scheme == "http" {
            let parts = components.path.split(separator: "/")
            guard parts.count == 2, parts[0] == "join" else { return nil }
            let pin = String(parts[1])
            guard pin.count == 6, pin.allSatisfy(\.isNumber),
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
