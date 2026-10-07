import Foundation

enum NativeProviderDemo {
    static var settings: VaultValue {
        .object([
            "hasAnthropicKey": .bool(true), "keySource": .string("settings"), "hasAnthropicAuthToken": .bool(false), "hasOpenaiKey": .bool(true), "hasCodexAuth": .bool(false),
            "claudeModel": .string("demo-parser"), "openaiBaseUrl": .string("https://api.example.com/v1"),
            "chat": .object(["mode": .string("api"), "backend": .string("codex"), "apiModel": .object(["provider": .string("openai"), "model": .string("demo-chat"), "effort": .string("high")])]),
            "deepResearch": .object(["mode": .string("agent"), "agentBackend": .string("codex")]),
            "dailyNews": .object(["mode": .string("api"), "model": .object(["provider": .string("openai"), "model": .string("demo-news")]), "title": .string("Acme Morning News"), "theme": .string("brew"), "headlineImage": .bool(false)]),
            "email": .object(["provider": .string("resend"), "enabled": .bool(false), "hasResendApiKey": .bool(true), "fromEmail": .string("sender@example.com"), "fromName": .string("Acme Demo"), "toEmail": .string("reader@example.com"), "cc": .object(["news": .string("news@example.com"), "client": .string("billing@example.com")])]),
            "transcribeUrl": .string("https://voice.example.com"), "transcribeModel": .string("demo-transcription"), "hasTranscribeApiKey": .bool(false), "ttsUrl": .string("https://voice.example.com"), "ttsLanguage": .string("en"), "hasTtsApiKey": .bool(true),
            "hasGeoapifyKey": .bool(false), "hasFredKey": .bool(true), "hasCongressKey": .bool(false),
            "weather": .object(["enabled": .bool(false), "latitude": .number(0), "longitude": .number(0), "label": .string("Invented location"), "timezone": .string("UTC"), "units": .string("F")]),
            "calendar": .object(["showMoon": .bool(true), "showSunTimes": .bool(true), "showOverdue": .bool(false)]),
        ])
    }

    static var mail: [VaultValue] {
        [
            attempt("demo-news", at: "2026-10-07T08:00:00Z", purpose: "news", ok: true, subject: "Acme morning edition", elapsed: 230),
            attempt("demo-invoice", at: "2026-10-06T16:00:00.123Z", purpose: "client", ok: true, subject: "Acme invoice review", elapsed: 410, attachment: true),
            attempt("demo-failure", at: "2026-10-06T09:00:00Z", purpose: "news", ok: false, subject: "Acme morning edition", elapsed: 800),
            attempt("demo-test", at: "2026-10-05T10:00:00Z", purpose: "test", ok: true, subject: "DocVault demo test", elapsed: 180),
        ]
    }

    private static func attempt(_ id: String, at: String, purpose: String, ok: Bool, subject: String, elapsed: Double, attachment: Bool = false) -> VaultValue {
        .object([
            "id": .string(id), "at": .string(at), "purpose": .string(purpose), "from": .string("Acme Demo <sender@example.com>"), "to": .array([.string("reader@example.com")]), "cc": purpose == "test" ? .array([]) : .array([.string(purpose == "news" ? "news@example.com" : "billing@example.com")]), "subject": .string(subject), "ok": .bool(ok), "elapsedMs": .number(elapsed), "providerId": ok ? .string("demo-provider-" + id) : .null, "error": ok ? .null : .string("Invented provider rate-limit failure. No email was sent."), "ref": .string(purpose == "client" ? "invoice:acme-demo" : "demo-edition"), "attachments": attachment ? .array([.object(["filename": .string("Acme_Invoice_Demo.pdf"), "bytes": .number(1234)])]) : .array([]),
        ])
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue]) -> VaultValue? {
        let path = request.path.joined(separator: "/")
        if path == "api/models", method == "GET", ["anthropic", "openai"].contains(request.query["provider"] ?? "") {
            let openai = request.query["provider"] == "openai"
            return .object(["models": .array((openai ? ["demo-chat", "demo-news", "demo-codex"] : ["demo-parser", "demo-claude"]).map(VaultValue.string)), "imageModels": .array(openai ? [.string("demo-image")] : []), "source": .string("fallback")])
        }
        if path == "api/email/log", method == "GET" {
            let rows = (stores[path] ?? .object(["entries": .array(mail)]))["entries"].array
            let limit = min(500, max(1, Int(request.query["limit"] ?? "100") ?? 100))
            return .object(["entries": .array(Array(NativeMail.filtered(rows, purpose: request.query["purpose"] ?? "").prefix(limit)))])
        }
        if path == "api/email/test", method == "POST" {
            let row = attempt("demo-" + UUID().uuidString, at: Date.now.ISO8601Format(), purpose: "test", ok: true, subject: "DocVault demo test", elapsed: 0)
            let log = stores["api/email/log"] ?? .object(["entries": .array(mail)])
            stores["api/email/log"] = .object(["entries": .array(Array(([row] + log["entries"].array).prefix(500)))])
            return .object(["ok": .bool(true), "id": .string("demo-only"), "demo": .bool(true)])
        }
        guard path == "api/settings" else { return nil }
        if method == "GET" {
            let value = stores[path] ?? settings
            stores[path] = value
            return value
        }
        guard method == "POST" else { return nil }
        var patch = body ?? .object([:])
        var fresh = stores[path] ?? settings
        for credential in NativeProviderSettings.credentials {
            if patch.at(credential.clear).boolean || (!credential.clearIsBoolean && patch.at(credential.clear) == .string("")) {
                fresh.set(credential.flag, .bool(false)); fresh.set(credential.hint, .null)
            } else if !patch.at(credential.id).string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                fresh.set(credential.flag, .bool(true)); fresh.set(credential.hint, .string("demo"))
            }
            // Demo settings retain only status flags, never the submitted secrets.
            patch.set(credential.id, .null)
            patch.set(credential.clear, .null)
        }
        fresh = merge(fresh, patch)
        stores[path] = fresh
        return .object(["ok": .bool(true)])
    }

    private static func merge(_ original: VaultValue, _ patch: VaultValue, path: String = "") -> VaultValue {
        var result = original
        for (key, value) in patch.object {
            let fullKey = path.isEmpty ? key : path + "." + key
            if case .object = value, !NativeProviderSettings.modelPaths.contains(fullKey) {
                result.set(key, merge(original[key], value, path: fullKey))
            } else if value != .null {
                result.set(key, value)
            } else {
                result.remove(key)
            }
        }
        return result
    }
}
