import SwiftUI

struct NativeCodexLoginView: View {
    @Environment(VaultModel.self) private var model
    @State private var lines: [String] = []
    @State private var task: Task<Void, Never>?
    @State private var error: String?
    @State private var complete = false
    private var links: [URL] {
        lines.flatMap {
            $0.split(whereSeparator: \.isWhitespace).compactMap { URL(string: String($0)) }
        }.filter { $0.scheme == "https" }
    }

    var body: some View {
        List {
            Text(
                "Sign your server's Codex backend into your account using its device authorization flow."
            ).foregroundStyle(.secondary)
            if let error {
                ErrorNotice(message: error)
            }
            if complete {
                Label("Server sign-in completed", systemImage: "checkmark.circle.fill")
            }
            ForEach(links, id: \.self) { Link("Open device authorization", destination: $0) }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, text in
                Text(text).textSelection(.enabled)
            }
            if task != nil {
                ProgressView("Waiting for authorization…")
                Button("Cancel") { task?.cancel() }
            } else {
                Button("Start server sign-in") { start() }
            }
        }.onDisappear { task?.cancel() }
    }

    private func start() {
        lines = []
        error = nil
        complete = false
        task = Task { @MainActor in
            defer { task = nil }
            do {
                guard !model.demo else {
                    lines = ["Connect your server to authorize its Codex backend."]
                    return
                }
                guard let api = model.api else { throw VaultError.signedOut }
                try await api.stream(VaultRequest("api/codex/login", scope: .init()), method: "GET") { event in
                    switch event["type"].string {
                    case "line": lines.append(event["text"].string)
                    case "done":
                        complete = event["ok"].boolean
                        if !complete {
                            error = "Server sign-in did not complete. Start again to retry."
                        }
                    case "error": error = event["message"].string
                    default: break
                    }
                }
            } catch {
                if !Task.isCancelled {
                    model.handle(error)
                    self.error = error.localizedDescription
                }
            }
        }
    }
}
