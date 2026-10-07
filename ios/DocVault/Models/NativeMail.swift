import Foundation

enum NativeMailOutcome: String, CaseIterable, Hashable, Sendable {
    case accepted = "Accepted", failed = "Failed", unreported = "Unreported"
    static func of(_ row: VaultValue) -> Self {
        guard case let .bool(ok) = row["ok"] else { return .unreported }
        return ok ? .accepted : .failed
    }
}

struct NativeMailDay: Identifiable, Sendable {
    let date: Date
    let outcome: NativeMailOutcome
    let count: Int
    var id: String {
        String(date.timeIntervalSince1970) + outcome.rawValue
    }
}

enum NativeMail {
    static func instant(_ row: VaultValue) -> Date? {
        let text = row["at"].string
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text) {
            return date
        }
        return try? Date.ISO8601FormatStyle().parse(text)
    }

    static func purpose(_ row: VaultValue) -> String {
        switch row["purpose"].string {
        case "news": "Newsstand"
        case "client": "Client"
        case "test": "Test"
        default: row["purpose"].string.isEmpty ? "Unreported" : row["purpose"].string
        }
    }

    static func nonnegative(_ value: VaultValue) -> Double? {
        guard case let .number(number) = value, number.isFinite, number >= 0 else { return nil }
        return number
    }

    static func filtered(_ rows: [VaultValue], query: String = "", purpose: String = "", outcome: String = "", days: Int = 0, now: Date = .now, calendar: Calendar = .current) -> [VaultValue] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let start = calendar.date(byAdding: .day, value: -(max(1, days) - 1), to: calendar.startOfDay(for: now)) ?? now
        return rows.filter { row in
            (purpose.isEmpty || row["purpose"].string == purpose)
                && (outcome.isEmpty || NativeMailOutcome.of(row).rawValue == outcome)
                && (needle.isEmpty || row.stringSearch.localizedCaseInsensitiveContains(needle))
                && (days == 0 || instant(row).map { $0 >= start && $0 <= now } == true)
        }.sorted { lhs, rhs in
            let left = instant(lhs) ?? .distantPast, right = instant(rhs) ?? .distantPast
            return left == right ? lhs["id"].string < rhs["id"].string : left > right
        }
    }

    static func daily(_ rows: [VaultValue], calendar: Calendar = .current) -> [NativeMailDay] {
        var counts: [Date: [NativeMailOutcome: Int]] = [:]
        for row in rows {
            guard let date = instant(row) else { continue }
            let day = calendar.startOfDay(for: date)
            counts[day, default: [:]][NativeMailOutcome.of(row), default: 0] += 1
        }
        return counts.keys.sorted().flatMap { date in NativeMailOutcome.allCases.compactMap { outcome in counts[date]?[outcome].map { .init(date: date, outcome: outcome, count: $0) } } }
    }

    static func medianLatency(_ rows: [VaultValue]) -> Double? {
        let values = rows.compactMap { nonnegative($0["elapsedMs"]) }.sorted()
        guard !values.isEmpty else { return nil }
        let middle = values.count / 2
        return values.count.isMultiple(of: 2) ? values[middle - 1] / 2 + values[middle] / 2 : values[middle]
    }

    static func description(_ row: VaultValue) -> String {
        var lines = [row["subject"].string, "Outcome: " + NativeMailOutcome.of(row).rawValue, "Attempt: " + row["at"].string, "Purpose: " + purpose(row), "From: " + row["from"].string, "To: " + row["to"].array.map(\.string).joined(separator: ", "), "CC: " + row["cc"].array.map(\.string).joined(separator: ", ")]
        for (key, title) in [("providerId", "Provider message ID"), ("ref", "Context"), ("error", "Error")] where !row[key].string.isEmpty {
            lines.append(title + ": " + row[key].string)
        }
        if let latency = nonnegative(row["elapsedMs"]) {
            lines.append("Request duration: \(latency) ms")
        }
        for item in row["attachments"].array {
            lines.append("Attachment: " + item["filename"].string + " · " + (nonnegative(item["bytes"]).map { "\($0) bytes" } ?? "Unreported size"))
        }
        lines.append("Provider acceptance does not verify inbox delivery. This log stores metadata, not message bodies or attachment bytes.")
        return lines.joined(separator: "\n")
    }
}
