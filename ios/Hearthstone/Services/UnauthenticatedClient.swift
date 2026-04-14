import Foundation

/// A deliberately narrow client for calls that happen before a session exists.
/// It has only a `serverURL` (no token), so it can't be misused for authenticated calls.
final class UnauthenticatedClient {
    let serverURL: URL
    private let decoder: JSONDecoder = JSONDecoder()

    init(serverURL: URL) {
        self.serverURL = serverURL
    }

    struct RedeemResult: Decodable {
        let token: String
        let role: String
        let person: Person?
        let household: Household?
        let guest: GuestInfo?
        let householdName: String?

        struct GuestInfo: Decodable {
            let id: String
            let name: String
            let householdId: String

            enum CodingKeys: String, CodingKey {
                case id, name
                case householdId = "household_id"
            }
        }

        enum CodingKeys: String, CodingKey {
            case token, role, person, household, guest
            case householdName = "household_name"
        }
    }

    func redeemPin(_ pin: String) async throws -> RedeemResult {
        let url = serverURL.appendingPathComponent("auth/pin/redeem")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["pin": pin]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: req)
        let http = response as! HTTPURLResponse
        guard (200...299).contains(http.statusCode) else {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data) {
                throw APIError.server(http.statusCode, err.message)
            }
            throw APIError.http(http.statusCode)
        }
        return try decoder.decode(RedeemResult.self, from: data)
    }
}

private struct ServerErrorBody: Decodable { let message: String }
