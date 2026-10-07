import Foundation

struct NativeMacroEvent: Decodable, Hashable, Identifiable, Sendable {
    let date: String
    let label: String
    let type: String
    let url: String
    let time: String?
    var id: String {
        date + "-" + type
    }
}

struct NativeMacroSchedule: Decodable, Sendable {
    let verifiedAt: String
    let coverage: [String: String]
    let events: [NativeMacroEvent]

    static func load(bundle: Bundle = .main) throws -> NativeMacroSchedule {
        guard let url = bundle.url(forResource: "macro-release-calendar", withExtension: "json") else {
            throw VaultError.server("The published release schedule is missing from the app.")
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }

    static func today(_ now: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }

    static func daysAway(_ event: NativeMacroEvent, now: Date) -> Int? {
        guard let day = NativeQuant.date(event.date), let today = NativeQuant.date(today(now)) else { return nil }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.dateComponents([.day], from: today, to: day).day
    }

    func upcoming(now: Date, type: String = "All") -> [NativeMacroEvent] {
        let today = Self.today(now)
        return events.filter { $0.date >= today && NativeQuant.date($0.date) != nil && (type == "All" || $0.type == type.lowercased()) }.sorted { $0.id < $1.id }
    }
}
