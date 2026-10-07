import Foundation

struct NativeCredential: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let flag: String
    let hint: String
    let clear: String
    let clearIsBoolean: Bool

    func state(_ settings: VaultValue) -> String {
        guard case let .bool(configured) = settings.at(flag) else { return "Unreported" }
        return configured ? "Configured" : "Not configured"
    }

    var clearBody: VaultValue {
        var body: VaultValue = .object([:])
        body.set(clear, clearIsBoolean ? .bool(true) : .string(""))
        return body
    }
}

struct NativeSettingsGroup: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let note: String
    let fields: [NativeField]
}

struct NativeProviderChoice: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
}

enum NativeProviderSettings {
    static let resourceIDs: Set<String> = ["ai", "email", "voice", "location", "quant-settings"]
    static let modelPaths = ["modelRouting.parsing", "chat.apiModel", "deepResearch.model", "dailyNews.model"]
    static let modelComponents = ["provider", "model", "effort"]

    static func efforts(_ provider: String) -> [String] {
        provider == "anthropic" ? ["low", "medium", "high", "xhigh", "max"] : provider == "openai" ? ["minimal", "low", "medium", "high", "xhigh"] : []
    }

    static func modelOptions(_ value: VaultValue, images: Bool = false) -> [String] {
        var seen = Set<String>()
        return value[images ? "imageModels" : "models"].array.compactMap { item in
            guard case let .string(raw) = item else { return nil }
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return !id.isEmpty && seen.insert(id).inserted ? id : nil
        }
    }

    static func modelSource(_ value: VaultValue) -> String {
        switch value["source"].string {
        case "live": "Live provider list"
        case "cache": "Saved server cache"
        case "fallback": "Server fallback list"
        default: "Unreported source"
        }
    }

    static func themes(_ value: VaultValue) -> [NativeProviderChoice] {
        var seen = Set<String>()
        return ([value["cycle"]] + value["themes"].array).compactMap { item in
            let id = item["id"].string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, seen.insert(id).inserted else { return nil }
            return .init(id: id, title: item["label"].string.isEmpty ? id : item["label"].string)
        }
    }

    static func requireSaved(_ response: VaultValue) throws {
        guard response["ok"] == .bool(true) else { throw VaultError.server(response["error"].string.isEmpty ? "The server did not confirm that the preferences were saved." : response["error"].string) }
    }

    static let credentials: [NativeCredential] = [
        .init(id: "anthropicKey", title: "Anthropic API key", flag: "hasAnthropicKey", hint: "keyHint", clear: "clearAnthropicKey", clearIsBoolean: true),
        .init(id: "anthropicAuthToken", title: "Anthropic auth token", flag: "hasAnthropicAuthToken", hint: "authHint", clear: "clearAnthropicAuthToken", clearIsBoolean: true),
        .init(id: "openaiApiKey", title: "OpenAI API key", flag: "hasOpenaiKey", hint: "openaiKeyHint", clear: "clearOpenaiApiKey", clearIsBoolean: true),
        .init(id: "email.resendApiKey", title: "Resend API key", flag: "email.hasResendApiKey", hint: "email.resendApiKeyHint", clear: "email.clearResendApiKey", clearIsBoolean: true),
        .init(id: "transcribeApiKey", title: "Transcription API key", flag: "hasTranscribeApiKey", hint: "transcribeApiKeyHint", clear: "clearTranscribeApiKey", clearIsBoolean: true),
        .init(id: "ttsApiKey", title: "Speech API key", flag: "hasTtsApiKey", hint: "ttsApiKeyHint", clear: "clearTtsApiKey", clearIsBoolean: true),
        .init(id: "geoapifyApiKey", title: "Geoapify API key", flag: "hasGeoapifyKey", hint: "geoapifyKeyHint", clear: "geoapifyApiKey", clearIsBoolean: false),
        .init(id: "fredApiKey", title: "FRED API key", flag: "hasFredKey", hint: "fredKeyHint", clear: "fredApiKey", clearIsBoolean: false),
        .init(id: "congressApiKey", title: "Congress API key", flag: "hasCongressKey", hint: "congressKeyHint", clear: "congressApiKey", clearIsBoolean: false),
    ]

    static func credentials(_ resource: NativeResource) -> [NativeCredential] {
        credentials.filter { credential in resource.editFields.contains { $0.id == credential.id } }
    }

    static func groups(_ resource: NativeResource) -> [NativeSettingsGroup] {
        let definitions: [(String, String, String, [String])] = [
            ("endpoint", "API endpoint", "An empty URL uses the provider's default endpoint.", ["openaiBaseUrl"]),
            ("parsing", "Document parsing", "A blank provider, model and effort restore server model routing. Claude model also applies to the Claude chat agent.", ["claudeModel"] + modelComponents.map { "modelRouting.parsing." + $0 }),
            ("chat", "Chat engine", "Choose agent or direct API mode. Agent settings remain saved when using API mode.", resource.editFields.filter { $0.id.hasPrefix("chat.") }.map(\.id)),
            ("research", "Deep Research engine", "A blank API model uses server defaults. Changing this does not start research.", resource.editFields.filter { $0.id.hasPrefix("deepResearch.") }.map(\.id)),
            ("news-engine", "News engine", "These settings apply when an edition is generated.", ["dailyNews.mode", "dailyNews.agentBackend"] + modelComponents.map { "dailyNews.model." + $0 }),
            ("news-design", "News appearance", "Masthead, theme and image preferences for future editions.", ["dailyNews.title", "dailyNews.theme", "dailyNews.headlineImage", "dailyNews.imageModel"]),
            ("narration", "News narration", "An empty narrator turns narration off. Voice samples are managed in Health.", resource.editFields.filter { $0.id.hasPrefix("dailyNews.narration.") }.map(\.id)),
            ("email", "Sending preferences", "News and client CC lists stay separate. Test messages never use CC.", resource.editFields.filter { $0.id.hasPrefix("email.") && $0.kind != .secret }.map(\.id)),
            ("transcription", "Transcription service", "The saved server URL and model are used for audio transcription.", ["transcribeUrl", "transcribeModel"]),
            ("speech", "Speech service", "The server creates speech and narration using this service.", ["ttsUrl", "ttsLanguage"]),
            ("weather", "Weather location", "Coordinates and timezone apply to the forecast and daylight information.", resource.editFields.filter { $0.id.hasPrefix("weather.") }.map(\.id)),
            ("calendar", "Calendar layers", "Unrecorded layers use the server defaults; overdue items are opt-in.", resource.editFields.filter { $0.id.hasPrefix("calendar.") }.map(\.id)),
        ]
        var used = Set<String>()
        var result: [NativeSettingsGroup] = []
        for (id, title, note, ids) in definitions {
            let fields = resource.editFields.filter { ids.contains($0.id) && $0.kind != .secret && !used.contains($0.id) }
            guard !fields.isEmpty else { continue }
            used.formUnion(fields.map(\.id))
            result.append(.init(id: id, title: title, note: note, fields: fields))
        }
        let remainder = resource.editFields.filter { $0.kind != .secret && !used.contains($0.id) }
        if !remainder.isEmpty {
            result.append(.init(id: "other", title: "Other preferences", note: "Additional server preferences.", fields: remainder))
        }
        return result
    }

    static func initial(_ fields: [NativeField], _ original: VaultValue) -> [String: String] {
        Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.kind == .secret ? "" : NativeForm.display(original.at($0.id), field: $0)) })
    }

    static func patch(fields: [NativeField], values: [String: String], original: VaultValue, current: VaultValue) throws -> VaultValue {
        var result: VaultValue = .object([:])
        var changed = Set<String>()
        for field in fields {
            let text = values[field.id] ?? ""
            if text == initial([field], original)[field.id] {
                continue
            }
            changed.insert(field.id)
            if field.kind == .secret {
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                if let credential = credentials.first(where: { $0.id == field.id }),
                   original.at(credential.flag) != current.at(credential.flag) || original.at(credential.hint) != current.at(credential.hint)
                {
                    throw VaultError.server("This credential's saved status changed. Reload before replacing it.")
                }
            } else if original.at(field.id) != current.at(field.id) {
                throw VaultError.server("\(field.label) changed on the server. Reload before saving.")
            }
            if modelPaths.contains(where: { path in modelComponents.contains { field.id == path + "." + $0 } }) {
                continue
            }
            if let value = try NativeForm.value(field: field, text: text) {
                try validate(field.id, value)
                result.set(field.id, value)
            } else if !original.at(field.id).isEmpty {
                switch field.kind {
                case .number, .integer:
                    guard ["dailyNews.narration.exaggeration", "dailyNews.narration.cfgWeight"].contains(field.id) else {
                        throw VaultError.server("Enter a value for \(field.label); this server setting cannot be cleared.")
                    }
                    result.set(field.id, .null)
                default:
                    if case .choices = field.kind, !["chat.claudeEffort", "chat.codexEffort"].contains(field.id) {
                        throw VaultError.server("Choose a value for \(field.label).")
                    }
                    result.set(field.id, .string(""))
                }
            }
        }
        for path in modelPaths where modelComponents.contains(where: { changed.contains(path + "." + $0) }) {
            guard original.at(path) == current.at(path) else { throw VaultError.server("The saved model changed. Reload before saving.") }
            let provider = (values[path + ".provider"] ?? original.at(path + ".provider").string).trimmingCharacters(in: .whitespacesAndNewlines)
            let model = (values[path + ".model"] ?? original.at(path + ".model").string).trimmingCharacters(in: .whitespacesAndNewlines)
            let effort = (values[path + ".effort"] ?? original.at(path + ".effort").string).trimmingCharacters(in: .whitespacesAndNewlines)
            if provider.isEmpty, model.isEmpty {
                guard effort.isEmpty else { throw VaultError.server("Choose an API provider and model before setting effort, or clear all three to use server defaults.") }
                result.set(path, .null)
            } else {
                guard ["anthropic", "openai"].contains(provider), !model.isEmpty else { throw VaultError.server("Choose an API provider and enter its model, or clear both to use server defaults.") }
                guard effort.isEmpty || efforts(provider).contains(effort) else { throw VaultError.server("Choose a supported effort for \(provider), or clear it to use the model default.") }
                var reference: [String: VaultValue] = ["provider": .string(provider), "model": .string(model)]
                if !effort.isEmpty {
                    reference["effort"] = .string(effort)
                }
                result.set(path, .object(reference))
            }
        }
        return result
    }

    private static func validate(_ key: String, _ value: VaultValue) throws {
        let ranges: [String: ClosedRange<Double>] = ["weather.latitude": -90 ... 90, "weather.longitude": -180 ... 180, "dailyNews.narration.defaultSpeed": 0.5 ... 3, "dailyNews.narration.exaggeration": 0.25 ... 2, "dailyNews.narration.cfgWeight": 0 ... 1]
        if let range = ranges[key], let number = value.number, !range.contains(number) {
            throw VaultError.server("\(VaultValue.label(key.split(separator: ".").last.map(String.init) ?? key)) must be between \(range.lowerBound) and \(range.upperBound).")
        }
        if key == "weather.timezone", TimeZone(identifier: value.string) == nil {
            throw VaultError.server("Enter a valid IANA timezone, such as UTC.")
        }
        if ["openaiBaseUrl", "transcribeUrl", "ttsUrl"].contains(key), !value.string.isEmpty {
            guard let url = URLComponents(string: value.string), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host?.isEmpty == false, url.user == nil, url.password == nil else { throw VaultError.server("Use an HTTP or HTTPS service URL without embedded credentials.") }
        }
    }
}
