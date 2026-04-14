import Foundation

enum APIError: LocalizedError {
    case http(Int)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .http(let code): return "Request failed (\(code))"
        case .server(_, let msg): return msg
        }
    }
}

final class SSEClient {
    struct ChatRequest: Encodable {
        let message: String
        let history: [HistoryMessage]
    }

    struct HistoryMessage: Encodable {
        let role: String
        let content: String
    }

    struct DeltaEvent: Decodable {
        let delta: String?
        let sources: [ChatSource]?
        let error: String?
    }

    static func streamChat(
        serverURL: URL,
        token: String,
        message: String,
        history: [HistoryMessage],
        isPreview: Bool = false
    ) -> AsyncThrowingStream<DeltaEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                let path = isPreview ? "chat/preview" : "chat"
                let url = serverURL.appendingPathComponent(path)
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                let body = ChatRequest(message: message, history: history)
                request.httpBody = try? JSONEncoder().encode(body)

                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let httpResponse = response as! HTTPURLResponse

                    guard httpResponse.statusCode == 200 else {
                        continuation.finish(throwing: APIError.http(httpResponse.statusCode))
                        return
                    }

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst(6))

                        if payload == "[DONE]" {
                            continuation.finish()
                            return
                        }

                        if let data = payload.data(using: .utf8),
                           let event = try? JSONDecoder().decode(DeltaEvent.self, from: data) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}
