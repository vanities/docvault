import Foundation

/// Editable invented records. These demonstrate local interactions, not provider outcomes.
@MainActor enum NativeResearchDemo {
    static let sourceText = "# Acme saved source\n\nA fictional observation 🧪 supports a careful comparison.\n\n| Signal | Observation |\n| --- | --- |\n| DEMO | Invented example |\n\n- Read the source.\n- Verify its context."
    static let reportText = "# A closer look at fictional signals\n\n## Findings\n\nThis is a fabricated report for exploring the native reader. [Acme source](https://example.com/research) provides an invented observation.\n\n| Signal | Context |\n| --- | --- |\n| DEMO | Saved observation |\n| SAMPLE | Limited evidence |\n\n1. Read the cited source.\n2. Check its context.\n\n## Limitations\n\nDemo jobs do not use live providers."
    static let newsText = "# The Acme morning edition\n\n## The lead\n\nA fictional science fair opens this week. [Acme Gazette](https://example.com/news) is the saved source.\n\n| Desk | Items |\n| --- | --- |\n| Local | 2 |\n| Tech | 1 |\n\n## Around the desks\n\n- A demo library opens its new reading room.\n- A fabricated workshop explores native interfaces.\n\nAll material is invented."
    static func source(_ domain: ResearchDomain, id: String? = nil, text: String = sourceText) -> VaultValue {
        let identifier = id ?? "demo" + domain.rawValue
        let quote = "A fictional observation 🧪 supports a careful comparison."
        let range = (text as NSString).range(of: quote)
        let provenance = VaultValue.object(["quote": .string(quote), "charStart": .number(range.location == NSNotFound ? -1 : Double(range.location)), "charEnd": .number(range.location == NSNotFound ? -1 : Double(range.location + range.length)), "lineStart": .number(3), "lineEnd": .number(3), "sourceUrl": .string("https://example.com/" + domain.rawValue)])
        return .object(["id": .string(identifier), "domain": .string(domain.rawValue), "title": .string("Acme " + domain.title + " source"), "filename": .string(identifier + ".txt"), "mediaType": .string("text/plain"), "uploadedAt": .string("2026-10-01T12:00:00Z"), "reportDate": .string("2026-10-01"), "text": .string(text), "publisher": .string("Acme Research"), "author": .string("Demo Author"), "sourceUrl": .string("https://example.com/" + domain.rawValue), "tags": .array([.string("synthetic")]), "tickers": .array([.string("DEMO")]), "linkedPersonIds": .array([]), "notes": .string("Invented source for exploring research."), "intelligence": .object(["summary": .array([.object(["text": .string("A saved fictional comparison."), "provenance": provenance])]), "claims": .array([.object(["id": .string("democlaim"), "text": .string("The observation has limited supporting context."), "stance": .string("watch"), "tickers": .array([.string("DEMO")]), "topics": .array([.string("comparison")]), "provenance": provenance])])])])
    }

    static func job(_ kind: KnowledgeKind, id: String, question: String = "Compare fictional signals") -> VaultValue {
        var row = VaultValue.object(["id": .string(id), "status": .string("done"), "createdAt": .string("2026-10-01T12:00:00Z"), "completedAt": .string("2026-10-01T12:01:00Z"), "usage": .object(["inputTokens": .number(120), "outputTokens": .number(240)]), "generatedBy": .object(["model": .string("Local demo"), "backend": .string("Fabricated result"), "billing": .string("simulation")])])
        if kind == .research {
            row.set("question", .string(question)); row.set("maxSearches", .number(18)); row.set("searchCount", .number(3)); row.set("sourceCount", .number(1)); row.set("report", .string(reportText)); row.set("sources", .array([.object(["title": .string("Acme Research Source"), "url": .string("https://example.com/research")])]))
        } else {
            row.set("title", .string("The Acme morning edition")); row.set("editionType", .string("daily")); row.set("editionDate", .string("2026-10-01")); row.set("theme", .string("brew")); row.set("body", .string(newsText)); row.set("itemCount", .number(3)); row.set("audioPath", .string("demo.wav"))
            row.set("digestMeta", .object(["sinceISO": .string("2026-09-29T12:00:00Z"), "itemCount": .number(3), "sources": .array([.string("Acme Gazette")]), "pulled": .array([.object(["title": .string("Fictional science fair opens"), "source": .string("Acme Gazette"), "url": .string("https://example.com/news")])]), "sourceWarnings": .array([.object(["source": .string("Acme Wire"), "message": .string("Synthetic source unavailable; edition is partial.")])])]))
            let days: [VaultValue] = (0 ..< 3).map { index in
                let date = "2026-10-0\(index + 1)"
                let high = Double(72 - index * 2)
                let low = Double(50 - index)
                return .object(["date": .string(date), "hi": .number(high), "lo": .number(low), "emoji": .string("☀️"), "label": .string("Clear"), "precipPct": .number(Double(index * 10))])
            }
            row.set("weather", .object(["label": .string("Demo City"), "units": .string("F"), "days": .array(days)]))
            row.set("sun", .object(["date": .string("2026-10-01"), "sunrise": .string("7:00 AM"), "sunset": .string("6:45 PM"), "daylight": .string("11h 45m"), "delta": .string("-2m")]))
            row.set("weekAhead", .object(["start": .string("2026-10-01"), "end": .string("2026-10-07"), "items": .array([.object(["date": .string("2026-10-03"), "title": .string("Acme science fair"), "kind": .string("event"), "emoji": .string("🔬")])])]))
        }
        return row
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue]) throws -> VaultValue? {
        guard request.path.count >= 2 else { return nil }
        let name = request.path[1]
        guard ["research", "deep-research", "daily-news"].contains(name) else { return nil }
        let key = "api/" + name
        let kind: KnowledgeKind = name == "deep-research" ? .research : .news
        let listKey = name == "research" ? "entries" : kind.listKey
        var rows = stores[key]?[listKey].array ?? (name == "research" ? ResearchDomain.allCases.map { source($0) } : [job(kind, id: name == "deep-research" ? "demoreport" : "demoedition")])
        func save() {
            stores[key] = .object([listKey: .array(rows)])
        }
        defer { save() }
        if request.path.count == 2 {
            let filtered = name == "research" && request.query["domain"] != nil ? rows.filter { $0["domain"].string == request.query["domain"] } : rows
            return .object([listKey: .array(filtered)])
        }
        let action = request.path[2]
        if name == "daily-news", action == "themes" {
            return .object(["cycle": .object(["id": .string("cycle"), "label": .string("Cycle — a different style each day")]), "themes": .array([.object(["id": .string("brew"), "label": .string("Morning Brew")]), .object(["id": .string("broadsheet"), "label": .string("Broadsheet")])])])
        }
        if name == "daily-news", action == "sample-themes", method == "POST" {
            let samples = ["brew", "broadsheet"].map { theme -> VaultValue in var sample = job(.news, id: UUID().uuidString); sample.set("theme", .string(theme)); sample.set("sample", .bool(true)); return sample }
            rows = samples + rows; return .object(["ids": .array(samples.map { $0["id"] }), "count": .number(Double(samples.count)), "status": .string("running")])
        }
        if method == "POST", request.path.count == 3, ["text", "youtube", "upload", "video", "run"].contains(action) {
            let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            var row: VaultValue
            if name == "research" {
                let domain = ResearchDomain(rawValue: body?["domain"].string ?? request.query["domain"] ?? "finance") ?? .finance
                row = source(domain, id: id, text: action == "text" ? body?["text"].string ?? "" : "Demo import simulated. No provider or extraction was used.")
                for (field, value) in body?.object ?? [:] where field != "domain" {
                    row.set(field, value)
                }
                if action == "upload" || action == "video" {
                    row.set("filename", .string(request.query["filename"] ?? "Demo source")); row.set("mediaType", body?["mediaType"] ?? .string("application/pdf")); row.set("intelligence", .null)
                }
            } else {
                row = job(kind, id: id, question: body?["question"].string.isEmpty == false ? body?["question"].string ?? "" : "Identify the submitted image")
                row.set("status", .string("running")); row.set("demoPoll", .number(0)); row.set("attachments", body?["attachments"] ?? .array([])); row.set("maxSearches", body?["maxSearches"] ?? .number(18)); if kind == .news {
                    row.set("editionType", body?["editionType"] ?? .string("daily"))
                }
            }
            rows.insert(row, at: 0)
            return name == "research" ? .object(["entry": row]) : .object(["id": .string(id), "status": .string("running")])
        }
        guard let index = rows.firstIndex(where: { $0["id"].string == action }) else { throw VaultError.server("Demo record unavailable.") }
        if request.path.count == 3 {
            if method == "DELETE" {
                rows.remove(at: index); return .object(["ok": .bool(true)])
            }
            if method == "PATCH" {
                for (key, value) in body?.object ?? [:] {
                    rows[index].set(key, value)
                }
            }
            if name != "research", rows[index]["status"].string == "running" {
                let polls = rows[index]["demoPoll"].number ?? 0
                rows[index].set("demoPoll", .number(polls + 1))
                if polls >= 1 {
                    let failed = rows[index]["question"].string.contains("synthetic failure"); rows[index].set("status", .string(failed ? "error" : "done")); if failed {
                        rows[index].set("error", .string("Synthetic research provider failure"))
                    }
                }
            }
            return name == "research" ? .object(["entry": rows[index]]) : rows[index]
        }
        if name == "research", method == "POST" {
            if request.path[3] == "intelligence" {
                rows[index].set("intelligence", source(.finance)["intelligence"])
            } else {
                rows[index].set("text", .string("Synthetic transcription or extraction. No provider was used.")); rows[index].set("transcribeStatus", .string("done")); rows[index].set("extractError", .null); rows[index].set("transcribeError", .null)
            }
            return .object(["entry": rows[index], "ok": .bool(true)])
        }
        if name == "daily-news", method == "POST", request.path[3] == "narrate" {
            rows[index].set("audioPath", .string("demo.wav")); return .object(["started": .bool(true)])
        }
        if name == "daily-news", method == "POST", request.path[3] == "email" {
            throw VaultError.server("Email is unavailable in demo mode. Connect your server to send an edition.")
        }
        return nil
    }

    static func download(_ request: VaultRequest, suffix: String, stores: inout [String: VaultValue]) throws -> Data? {
        guard request.path.count == 4, ["research", "deep-research", "daily-news"].contains(request.path[1]) else { return nil }
        let path = request.path.prefix(3).joined(separator: "/")
        let response = try self.request(VaultRequest(path, scope: .init()), method: "GET", body: nil, stores: &stores) ?? .null
        let row = request.path[1] == "research" ? response["entry"] : response
        if suffix == "txt" {
            return Data(row["text"].string.utf8)
        }
        if suffix == "html" {
            let text = row[request.path[1] == "deep-research" ? "report" : "body"].string.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
            return Data("<!doctype html><html><meta name=viewport content='width=device-width'><title>Acme demo report</title><body style='font:18px system-ui;max-width:850px;margin:40px auto;padding:24px'><h1>Acme demo report</h1><p>Fabricated HTML export; the live server supplies the complete styled report.</p><pre style='white-space:pre-wrap'>\(text)</pre></body></html>".utf8)
        }
        if suffix == "wav" {
            return silentWAV()
        }
        if suffix == "pdf" {
            return DemoVault.pdf(title: row.title)
        }
        throw VaultError.server("This simulated import has no saved media file. Connect your server to open real source files.")
    }

    static func silentWAV() -> Data {
        let samples = 24000 * 4
        var data = Data()
        func word(_ value: some FixedWidthInteger) {
            var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
        }
        data.append(Data("RIFF".utf8)); word(UInt32(36 + samples * 2)); data.append(Data("WAVEfmt ".utf8)); word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(24000)); word(UInt32(48000)); word(UInt16(2)); word(UInt16(16)); data.append(Data("data".utf8)); word(UInt32(samples * 2)); data.append(Data(count: samples * 2)); return data
    }
}
