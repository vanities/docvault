import Foundation

enum NativeOperations {
    static func outcome(_ status: VaultValue) -> String {
        if status["running"].boolean {
            return "Running"
        }
        if status["lastOutcome"].string == "partial" {
            return "Some items failed"
        }
        if !status["lastError"].string.isEmpty || status["lastOutcome"].string == "error" {
            return "Failed"
        }
        if !status["lastWarning"].string.isEmpty || status["lastOutcome"].string == "warning" {
            return "Completed with warnings"
        }
        return status["lastSuccessAt"].string.isEmpty ? "Not run yet" : "Succeeded"
    }

    static func attention(_ status: VaultValue) -> Bool {
        !status["lastError"].string.isEmpty || !status["lastWarning"].string.isEmpty || ["partial", "error", "warning"].contains(status["lastOutcome"].string)
    }

    static func runOutcome(_ run: VaultValue) -> String {
        switch run["outcome"].string {
        case "success": "Succeeded"
        case "warning": "Completed with warnings"
        case "partial": "Some items failed"
        case "error": "Failed"
        default: "Outcome not recorded"
        }
    }

    static func timestamp(_ value: VaultValue) -> String {
        guard !value.string.isEmpty else { return "Not recorded" }
        guard let date = instant(value) else { return value.string }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func instant(_ value: VaultValue) -> Date? {
        guard NativeQuant.date(String(value.string.prefix(10))) != nil else { return nil }
        return NativeHealth.date(.object(["date": value]))
    }

    static func number(_ value: VaultValue) -> Double? {
        guard case let .number(number) = value, number.isFinite, number >= 0 else { return nil }
        return number
    }

    static func duration(_ value: VaultValue) -> String {
        number(value).map { ($0 / 1000).formatted(.number.precision(.fractionLength(1))) + " s" } ?? "Unavailable"
    }

    static func groups(_ rows: [VaultValue], key: (VaultValue) -> String) -> [TaxYearAmount] {
        Dictionary(grouping: rows, by: key).map { .init(label: $0.key, amount: Double($0.value.count)) }.sorted { $0.label < $1.label }
    }

    static func historyPath(_ job: NativeJob) -> String {
        "api/jobs/{id}/runs?kind=" + (job.builtIn ? "built-in" : "custom")
    }

    static func validateManifest(_ value: VaultValue) -> String? {
        let id = value["id"].string
        if id.range(of: "^[a-z0-9][a-z0-9-]{1,80}$", options: .regularExpression) == nil {
            return "Use a lowercase job ID with 2–81 letters, numbers or hyphens."
        }
        if value["label"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter a job name."
        }
        let schedule = value["schedule"].string
        if !["hourly", "daily"].contains(schedule), schedule.range(of: "^every [1-9][0-9]*h$", options: .regularExpression) == nil {
            return "Use hourly, daily or every Nh for the schedule."
        }
        let script = value["script"].string
        if script.contains("..") || script.range(of: "^scripts/[a-zA-Z0-9._/-]+\\.local\\.(js|ts|sh)$", options: .regularExpression) == nil {
            return "Scripts must be under scripts/ and end in .local.js, .local.ts or .local.sh."
        }
        return nil
    }

    static func manifest(_ value: VaultValue) -> VaultValue {
        .object(Dictionary(uniqueKeysWithValues: ["id", "label", "kind", "schedule", "script", "enabled", "tags"].map { ($0, value[$0]) }))
    }

    static func logLine(_ value: VaultValue) -> String {
        "[\(value["ts"].string)] \(value["level"].string.uppercased()) \(value["namespace"].string): \(value["message"].string)"
    }
}

struct NativeJob: Identifiable, Hashable {
    let value: VaultValue
    let status: VaultValue
    let builtIn: Bool
    var id: String {
        (builtIn ? "built-in:" : "custom:") + value["id"].string
    }

    var title: String {
        value["label"].string
    }
}

struct NativeJobs {
    let value: VaultValue
    var jobs: [NativeJob] {
        value["builtInJobs"].array.map { .init(value: $0, status: $0["status"], builtIn: true) } + value["customJobs"].array.filter { $0["status"].string == "valid" }.map { .init(value: $0["manifest"], status: value["customJobStatuses"][$0["manifest"]["id"].string], builtIn: false) }
    }

    var invalid: [VaultValue] {
        value["customJobs"].array.filter { $0["status"].string != "valid" }
    }

    var running: Int {
        jobs.filter { $0.status["running"].boolean }.count
    }

    var attention: Int {
        jobs.filter { NativeOperations.attention($0.status) }.count + invalid.count
    }

    var outcomes: [TaxYearAmount] {
        NativeOperations.groups(jobs.map(\.status), key: NativeOperations.outcome) + (invalid.isEmpty ? [] : [.init(label: "Invalid manifest", amount: Double(invalid.count))])
    }

    func filtered(_ search: String, issues: Bool) -> [NativeJob] {
        jobs.filter { (!issues || NativeOperations.attention($0.status)) && (search.isEmpty || ($0.value.stringSearch + " " + $0.status.stringSearch).localizedCaseInsensitiveContains(search)) }
    }
}

struct NativeUsage {
    let value: VaultValue
    var entries: [VaultValue] {
        value["entries"].array
    }

    var summary: VaultValue {
        value["summary"]
    }

    var unpriced: Int {
        entries.filter { NativeOperations.number($0["cost"]["total"]) == nil }.count
    }

    var pricedSubtotal: Double? {
        let values = entries.compactMap { NativeOperations.number($0["cost"]["total"]) }
        return values.isEmpty ? (entries.isEmpty ? 0 : nil) : values.reduce(0, +)
    }

    func summaryGroups(_ key: String) -> [TaxYearAmount] {
        summary[key].object.compactMap { name, value in NativeOperations.number(value["calls"]).map { .init(label: name, amount: $0) } }.sorted { $0.label < $1.label }
    }

    var dailyCosts: [TaxYearAmount] {
        var sums: [String: Double] = [:]
        for entry in entries {
            guard let date = NativeOperations.instant(entry["ts"]), let cost = NativeOperations.number(entry["cost"]["total"]) else { continue }
            let day = NativeQuant.day(date)
            sums[day, default: 0] += cost
        }
        return sums.keys.sorted().map { .init(label: $0, amount: sums[$0] ?? 0) }
    }

    var medianLatency: Double? {
        let values = entries.compactMap { NativeOperations.number($0["latencyMs"]) }.sorted()
        guard !values.isEmpty else { return nil }
        let mid = values.count / 2
        return values.count.isMultiple(of: 2) ? (values[mid - 1] + values[mid]) / 2 : values[mid]
    }
}
