import Foundation

enum ResearchDomain: String, CaseIterable, Sendable {
    case finance, health, politics, tech, local
    var title: String {
        switch self {
        case .finance: "Finance"
        case .health: "Health"
        case .politics: "Politics"
        case .tech: "Tech"
        case .local: "Local"
        }
    }

    static func resource(_ resource: NativeResource) -> Self? {
        guard ["quant-research", "research-quant", "research-health", "research-politics", "research-tech", "research-local"].contains(resource.id) else { return nil }
        let query = URLComponents(string: "https://native.invalid/" + resource.path)?.queryItems
        guard let raw = query?.first(where: { $0.name == "domain" })?.value else { return nil }
        return .init(rawValue: raw)
    }
}

struct ResearchRecord: Identifiable, Sendable {
    let id: String
    let value: VaultValue
    var title: String {
        [value["title"].string, value["filename"].string, "Untitled source"].first { !$0.isEmpty } ?? "Untitled source"
    }

    var day: String {
        value["reportDate"].string.isEmpty ? String(value["uploadedAt"].string.prefix(10)) : value["reportDate"].string
    }

    var media: String {
        let mime = value["mediaType"].string
        if mime == "application/pdf" {
            return "PDF"
        }
        if mime == "text/plain" {
            return "Text"
        }
        if mime.hasPrefix("audio/") {
            return "Audio"
        }
        if mime.hasPrefix("video/") {
            return "Video"
        }
        return "Other"
    }

    var hasText: Bool {
        !value["text"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var processing: Bool {
        ["pending", "running"].contains(value["transcribeStatus"].string)
    }

    var needsAttention: Bool {
        !value["extractError"].string.isEmpty || !value["transcribeError"].string.isEmpty || value["transcribeStatus"].string == "error"
    }

    var status: String {
        needsAttention ? "Needs attention" : processing ? "Processing" : hasText ? "Text available" : "No saved text"
    }
}

struct NativeResearch: Sendable {
    let data: VaultValue
    let domain: ResearchDomain
    var entries: [ResearchRecord] {
        data["entries"].array.enumerated().compactMap { index, row in
            guard belongs(row, to: domain) else { return nil }
            return ResearchRecord(id: "\(index):" + row["id"].string, value: row)
        }.sorted { $0.day == $1.day ? $0.value["uploadedAt"].string > $1.value["uploadedAt"].string : $0.day > $1.day }
    }

    var claims: Int {
        entries.reduce(0) { $0 + $1.value["intelligence"]["claims"].array.count }
    }

    var summaries: Int {
        entries.reduce(0) { $0 + $1.value["intelligence"]["summary"].array.count }
    }

    func filtered(search: String = "", media: String = "All", status: String = "All", publisher: String? = nil) -> [ResearchRecord] {
        entries.filter { row in
            (media == "All" || row.media == media)
                && (status == "All" || row.status == status)
                && (publisher == nil || row.value["publisher"].string == publisher)
                && (search.isEmpty || [row.title, row.value["author"].string, row.value["publisher"].string,
                                       row.value["notes"].string, row.value["tags"].array.map(\.string).joined(separator: " "),
                                       row.value["tickers"].array.map(\.string).joined(separator: " ")]
                        .joined(separator: " ").localizedCaseInsensitiveContains(search))
        }
    }

    var publishers: [TaxYearAmount] {
        counts(entries.map { $0.value["publisher"].string.isEmpty ? "Unspecified publisher" : $0.value["publisher"].string })
    }

    var mediaCounts: [TaxYearAmount] {
        counts(entries.map(\.media))
    }

    var monthly: [TaxYearAmount] {
        Dictionary(grouping: entries.filter { NativeQuant.date($0.day) != nil }, by: { String($0.day.prefix(7)) })
            .sorted { $0.key < $1.key }.map { .init(label: NativeBusiness.monthTitle($0.key), amount: Double($0.value.count)) }
    }

    var stances: [TaxYearAmount] {
        counts(entries.flatMap { $0.value["intelligence"]["claims"].array.map { $0["stance"].string.isEmpty ? "Unspecified" : $0["stance"].string.capitalized } })
    }

    private func counts(_ labels: [String]) -> [TaxYearAmount] {
        Dictionary(grouping: labels, by: { $0 }).map { .init(label: $0.key, amount: Double($0.value.count)) }.sorted { $0.label < $1.label }
    }

    static func belongs(_ row: VaultValue, to domain: ResearchDomain) -> Bool {
        let raw = row["domain"].string
        return raw == domain.rawValue || (raw.isEmpty && domain == .finance)
    }

    private func belongs(_ row: VaultValue, to domain: ResearchDomain) -> Bool {
        Self.belongs(row, to: domain)
    }

    static func count(_ value: VaultValue) -> Int? {
        guard let n = NativeFinance.number(value), n >= 0, n.rounded(.down) == n, n < Double(Int.max) else { return nil }
        return Int(n)
    }

    static func sourceURL(_ value: VaultValue) -> URL? {
        guard let url = URL(string: value.string), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host() != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    static func quoteMatches(_ provenance: VaultValue, text: String) -> Bool {
        guard let start = count(provenance["charStart"]), let end = count(provenance["charEnd"]), end >= start,
              end <= (text as NSString).length, !provenance["quote"].string.isEmpty else { return false }
        return (text as NSString).substring(with: NSRange(location: start, length: end - start)) == provenance["quote"].string
    }

    static func sourceSuffix(_ row: VaultValue) -> String {
        switch row["mediaType"].string {
        case "application/pdf": "pdf"
        case "text/plain": "txt"
        case "audio/wav": "wav"
        case "audio/mp4": "m4a"
        case "audio/mpeg": "mp3"
        case "video/quicktime": "mov"
        case "video/x-matroska": "mkv"
        case "video/webm", "audio/webm": "webm"
        default: "mp4"
        }
    }

    static func importMime(filename: String, current: String, media: Bool) -> String? {
        let suffix = (filename as NSString).pathExtension.lowercased()
        if !media {
            return suffix == "pdf" || current == "application/pdf" ? "application/pdf" : nil
        }
        let supported = ["mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "weba": "audio/webm", "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime", "mkv": "video/x-matroska", "webm": "video/webm"]
        if let mime = supported[suffix] {
            return mime
        }
        return supported.values.contains(current) ? current : nil
    }
}

enum KnowledgeKind: String, Sendable {
    case research, news
    var path: String {
        self == .research ? "api/deep-research" : "api/daily-news"
    }

    var listKey: String {
        self == .research ? "runs" : "editions"
    }

    var title: String {
        self == .research ? "Research reports" : "Newsstand"
    }

    func recordTitle(_ row: VaultValue) -> String {
        if self == .research {
            return row["question"].string.isEmpty ? "Research report" : row["question"].string
        }
        if row["sample"].boolean {
            return "Theme sample · " + row["theme"].string
        }
        if !row["title"].string.isEmpty {
            return row["title"].string
        }
        return row["editionType"].string == "weekly" ? "Weekly deep-dive" : "Daily edition"
    }

    func date(_ row: VaultValue) -> String {
        self == .news ? row["editionDate"].string : String(row["createdAt"].string.prefix(10))
    }

    func body(_ row: VaultValue) -> String {
        row[self == .research ? "report" : "body"].string
    }

    func itemCount(_ row: VaultValue) -> Int? {
        NativeResearch.count(self == .research ? row["sourceCount"] : row["itemCount"])
    }

    func statuses(_ rows: [VaultValue]) -> [TaxYearAmount] {
        Dictionary(grouping: rows, by: { $0["status"].string.isEmpty ? "Unknown" : $0["status"].string.capitalized })
            .map { .init(label: $0.key, amount: Double($0.value.count)) }.sorted { $0.label < $1.label }
    }

    func monthly(_ rows: [VaultValue]) -> [TaxYearAmount] {
        Dictionary(grouping: rows.filter { NativeQuant.date(date($0)) != nil }, by: { String(date($0).prefix(7)) })
            .sorted { $0.key < $1.key }.map { .init(label: NativeBusiness.monthTitle($0.key), amount: Double($0.value.count)) }
    }

    func knownItems(_ rows: [VaultValue]) -> Double? {
        NativeBusiness.sum(rows.filter { $0["status"].string == "done" && !$0["sample"].boolean }.map { itemCount($0).map(Double.init) })
    }
}
