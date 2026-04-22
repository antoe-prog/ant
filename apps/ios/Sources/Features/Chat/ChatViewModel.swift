import Foundation

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

private struct ChatRequestBody: Encodable {
    let user_id: String
    let session_id: String
    let message: String
    let temperature: Double
    let model: String?
}

private struct ChatResponseBody: Decodable {
    let provider: String
    let model: String
    let answer: String
    let requestId: String

    enum CodingKeys: String, CodingKey {
        case provider, model, answer
        case requestId = "request_id"
    }
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isLoading = false

    /// 설정 화면과 묶을 때 갱신 (기본은 게이트웨이 `GET /v1/models` 첫 항목과 맞춤).
    var chatModel: String = "gpt-4o-mini"
    var chatTemperature: Double = 0.4

    /// 히스토리 화면과 공유할 때 주입. 없으면 채팅만 동작.
    weak var historyStore: HistoryStore?

    private let sessionId = UUID().uuidString

    /// Simulator: `http://127.0.0.1:8000` — device: Mac LAN IP. Override with env `GATEWAY_BASE_URL`.
    private static var gatewayBaseURL: String {
        ProcessInfo.processInfo.environment["GATEWAY_BASE_URL"] ?? "http://127.0.0.1:8000"
    }

    func send(_ text: String) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        messages.append(ChatMessage(role: "user", text: text))
        isLoading = true
        defer { isLoading = false }

        guard let url = URL(string: "\(Self.gatewayBaseURL)/v1/chat") else {
            messages.append(ChatMessage(role: "assistant", text: "Invalid gateway URL."))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60

        let body = ChatRequestBody(
            user_id: "ios-local",
            session_id: sessionId,
            message: text,
            temperature: chatTemperature,
            model: chatModel.isEmpty ? nil : chatModel
        )

        do {
            request.httpBody = try JSONEncoder().encode(body)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                messages.append(ChatMessage(role: "assistant", text: "No HTTP response."))
                return
            }
            guard (200 ... 299).contains(http.statusCode) else {
                let snippet = String(data: data, encoding: .utf8) ?? ""
                messages.append(ChatMessage(role: "assistant", text: "HTTP \(http.statusCode): \(snippet.prefix(200))"))
                return
            }
            let decoded = try JSONDecoder().decode(ChatResponseBody.self, from: data)
            messages.append(ChatMessage(role: "assistant", text: decoded.answer))
            let preview = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let title = preview.count > 120 ? String(preview.prefix(120)) + "…" : preview
            historyStore?.upsert(title: title)
        } catch {
            messages.append(ChatMessage(role: "assistant", text: "Request failed: \(error.localizedDescription)"))
        }
    }
}
