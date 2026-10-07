import Foundation

struct HealthStat: Identifiable {
    var id: String {
        title
    }

    let title: String
    let value: String
}

enum NativeHealth {
    private static let dayFormat = Date.ISO8601FormatStyle().year().month().day().dateSeparator(.dash)
    private static let instantFormat = Date.ISO8601FormatStyle()
    private static let fractionalInstantFormat = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    static func illnessKey(_ period: VaultValue) -> String {
        period["startDate"].string + "-" + period["endDate"].string
    }

    static func number(_ value: VaultValue) -> Double? {
        guard case let .number(number) = value, number.isFinite else { return nil }
        return number
    }

    static func display(_ value: VaultValue, unit: String = "", multiplier: Double = 1) -> String {
        guard let value = number(value), (value * multiplier).isFinite else { return "Unavailable" }
        let text = (value * multiplier).formatted(.number.precision(.fractionLength(0 ... 2)))
        return unit.isEmpty ? text : text + " " + unit
    }

    static func date(_ row: VaultValue) -> Date? {
        for key in ["effectiveAt", "start", "date", "weekStart", "startDate", "onsetDate", "recordedDate", "authoredOn"] {
            let text = row[key].string
            if text.count > 10 {
                if let date = try? fractionalInstantFormat.parse(text) {
                    return date
                }
                if let date = try? instantFormat.parse(text) {
                    return date
                }
            }
            if text.count == 10, let date = try? dayFormat.parse(text), dayFormat.format(date) == text {
                return date
            }
        }
        return nil
    }

    /// Preserve distinct same-day readings and split lines at missing observations.
    static func line(_ key: String, title: String, rows: [VaultValue], multiplier: Double = 1) -> QuantLine {
        makeLine(key, title: title, observations: datedRows(rows), multiplier: multiplier)
    }

    private struct DatedReading {
        let index: Int
        let row: VaultValue
        let date: Date?
    }

    private static func datedRows(_ rows: [VaultValue], ascending: Bool = true) -> [DatedReading] {
        rows.enumerated().map { DatedReading(index: $0.offset, row: $0.element, date: date($0.element)) }.sorted {
            let a = $0.date ?? .distantPast, b = $1.date ?? .distantPast
            return a == b ? $0.index < $1.index : ascending ? a < b : a > b
        }
    }

    private static func makeLine(_ key: String, title: String, observations: [DatedReading], multiplier: Double = 1) -> QuantLine {
        var segment = 0
        var points: [QuantPoint] = []
        for item in observations {
            guard let date = item.date, let value = number(item.row.at(key)), (value * multiplier).isFinite else {
                segment += 1; continue
            }
            points.append(.init(id: item.index, date: date, value: value * multiplier, segment: segment))
        }
        return .init(id: key + "-" + title, title: title, points: points)
    }

    static func panels(_ data: VaultValue, segment: String) -> [QuantPanel] {
        var panels: [QuantPanel] = []
        func panel(_ id: String, _ title: String, _ unit: String, _ rows: [DatedReading], _ fields: [(String, String)], multiplier: Double = 1) {
            panels.append(.init(id: id, title: title, unit: unit, lines: fields.map { makeLine($0.0, title: $0.1, observations: rows, multiplier: multiplier) }))
        }
        // Parse and sort once for every series sharing this history.
        let daily = datedRows(data["daily"].array)
        switch segment {
        case "activity":
            panel("steps", "Daily steps", "steps", daily, [("steps", "Steps"), ("steps7dAvg", "7-day average")])
            panel("energy", "Active energy", "kcal", daily, [("activeEnergy", "Active energy"), ("activeEnergy7dAvg", "7-day average")])
            panel("exercise", "Exercise", "min", daily, [("exerciseMinutes", "Exercise"), ("exerciseMinutes7dAvg", "7-day average")])
            panel("distance", "Walking and running distance", data["distanceUnit"].string, daily, [("distance", "Distance")])
            panel("stand", "Stand time", "hours", daily, [("standHours", "Stand")])
            panel("flights", "Flights climbed", "flights", daily, [("flightsClimbed", "Flights")])
            panel("recovery", "Recovery score", "/100", datedRows(data["recoveryScores"].array), [("score", "Recovery")])
        case "heart":
            panel("resting", "Resting heart rate", "bpm", daily, [("restingHR", "Resting")])
            panel("hrv", "Heart rate variability", "ms", daily, [("hrv", "HRV")])
            panel("heart", "Heart rate range", "bpm", daily, [("minHR", "Minimum"), ("avgHR", "Average"), ("maxHR", "Maximum")])
            panel("walking", "Walking heart rate", "bpm", daily, [("walkingHR", "Walking")])
            panel("recovery", "One-minute heart rate recovery", "bpm", daily, [("hrRecovery1min", "Recovery")])
        case "sleep":
            panel("duration", "Sleep duration", "hours", daily, [("asleepMinutes", "Asleep"), ("inBedMinutes", "In bed")], multiplier: 1 / 60)
            panel("stages", "Sleep stages", "hours", daily, [("deepMinutes", "Deep"), ("remMinutes", "REM"), ("coreMinutes", "Core"), ("awakeMinutes", "Awake")], multiplier: 1 / 60)
            panel("respiratory", "Sleeping respiratory rate", "breaths/min", daily, [("respiratoryRate", "Respiratory rate")])
            panel("temperature", "Wrist temperature deviation", "°C", daily, [("wristTempDeviationC", "Deviation")])
            panel("quality", "Sleep quality score", "/100", datedRows(data["qualityScores"].array), [("score", "Sleep quality")])
        case "workouts":
            let weekly = datedRows(data["weekly"].array)
            panel("count", "Weekly workouts", "workouts", weekly, [("count", "Count")])
            panel("duration", "Weekly workout time", "min", weekly, [("totalDurationMinutes", "Duration")])
        case "body":
            panel("weight", "Weight", "lb", datedRows(data["weightHistory"].array), [("lb", "Weight")])
            panel("height", "Height", "in", datedRows(data["heightHistory"].array), [("inches", "Height")])
        default: break
        }
        return panels
    }

    static func stats(_ data: VaultValue, segment: String) -> [HealthStat] {
        let h = data["headline"]
        var fields: [(String, String, String, Double)] = []
        switch segment {
        case "activity": fields = [("avgDailySteps90d", "90-day average steps", "steps/day", 1), ("totalSteps", "Total steps", "steps", 1), ("totalActiveEnergy", "Active energy", "kcal", 1), ("totalExerciseMinutes", "Exercise", "min", 1), ("totalDistance", "Distance", data["distanceUnit"].string, 1), ("ringCompletionPct", "Ring completion", "%", 1)]
        case "heart": fields = [("latestRestingHR", "Latest resting heart rate", "bpm", 1), ("avgRestingHR90d", "90-day resting heart rate", "bpm", 1), ("latestHRV", "Latest HRV", "ms", 1), ("avgHRV90d", "90-day HRV", "ms", 1)]
        case "sleep": fields = [("avgSleepHours90d", "90-day average sleep", "hours", 1), ("avgSleepHoursAll", "All-time average sleep", "hours", 1), ("nightsWith5Plus", "Nights with 5+ hours", "nights", 1), ("nightsWith7Plus", "Nights with 7+ hours", "nights", 1)]
        case "workouts": fields = [("totalWorkouts", "Total workouts", "workouts", 1), ("thisWeekCount", "This week", "workouts", 1), ("thisWeekMinutes", "This week duration", "min", 1), ("currentStreakDays", "Current streak", "days", 1), ("longestStreakDays", "Longest streak", "days", 1)]
        case "body": fields = [("currentLb", "Latest weight", "lb", 1), ("currentKg", "Latest weight (metric)", "kg", 1), ("changeSincePrev.lb", "Since previous reading", "lb", 1), ("change30d", "30-day change", "lb", 2.2046226218), ("change1y", "One-year change", "lb", 2.2046226218)]
        default: break
        }
        return fields.map { .init(title: $0.1, value: display(h.at($0.0), unit: $0.2, multiplier: $0.3)) }
    }

    static func workoutType(_ value: String) -> String {
        VaultValue.label(value.replacingOccurrences(of: "HKWorkoutActivityType", with: ""))
    }

    static func rows(_ data: VaultValue, segment: String) -> [VaultValue] {
        let key = segment == "body" ? "weightHistory" : segment == "workouts" ? "recent" : "daily"
        return datedRows(data[key].array, ascending: false).map(\.row)
    }

    static func unit(_ unit: String, loinc: String = "") -> String {
        switch unit.lowercased() {
        case "[degf]", "degf": "°F"
        case "[degc]", "degc": "°C"
        case "[lb_av]", "lb_av": "lb"
        case "[in_i]", "in_i": "in"
        case "mm[hg]": "mmHg"
        case "/min": loinc == "9279-1" ? "breaths/min" : "bpm"
        default: unit
        }
    }

    static func labValue(_ row: VaultValue) -> String {
        let components = row["components"].array
        let systolic = components.first { $0["loinc"].string == "8480-6" || $0["name"].string.localizedCaseInsensitiveContains("systolic") }
        let diastolic = components.first { $0["loinc"].string == "8462-4" || $0["name"].string.localizedCaseInsensitiveContains("diastolic") }
        if let systolic, let diastolic, let s = number(systolic["value"]), let d = number(diastolic["value"]) {
            return "\(s.formatted())/\(d.formatted()) " + unit(systolic["unit"].string, loinc: systolic["loinc"].string)
        }
        if number(row["value"]) != nil {
            return display(row["value"], unit: unit(row["unit"].string, loinc: row["loinc"].string))
        }
        return row["valueString"].string.isEmpty ? "Unavailable" : row["valueString"].string
    }

    static func reference(_ row: VaultValue) -> String {
        if !row["refText"].string.isEmpty {
            return row["refText"].string
        }
        let low = number(row["refLow"]), high = number(row["refHigh"])
        let range: String
        if let low, let high {
            range = "\(low.formatted())–\(high.formatted())"
        } else if let low {
            range = "≥ \(low.formatted())"
        } else if let high {
            range = "≤ \(high.formatted())"
        } else {
            return "Reference unavailable"
        }
        return range + " " + unit(row["unit"].string, loinc: row["loinc"].string)
    }

    /// Group by raw units, including components, so incompatible readings never share an axis.
    static func clinicalPanels(_ rows: [VaultValue]) -> [QuantPanel] {
        var grouped: [String: [VaultValue]] = [:]
        for row in rows {
            let values = row["components"].array.isEmpty ? [row] : row["components"].array.map { component in
                var result = component
                result.set("date", row["date"]); result.set("effectiveAt", row["effectiveAt"])
                return result
            }
            for value in values {
                let key = value["unit"].string
                grouped[key, default: []].append(value)
            }
        }
        return grouped.keys.sorted().map { rawUnit in
            let rows = grouped[rawUnit] ?? []
            let names = Set(rows.map { $0["name"].string }).sorted()
            var lines = names.map { name in
                line("value", title: name, rows: rows.filter { $0["name"].string == name })
            }
            for (key, title) in [("refLow", "Reference lower"), ("refHigh", "Reference upper")] {
                let reference = line(key, title: title, rows: rows)
                if !reference.points.isEmpty {
                    lines.append(reference)
                }
            }
            return QuantPanel(id: rawUnit, title: "Observation trend", unit: unit(rawUnit, loinc: rows.first?["loinc"].string ?? ""), lines: lines)
        }
    }

    static func searchText(_ value: VaultValue) -> String {
        switch value {
        case let .object(values): values.values.map(searchText).joined(separator: " ")
        case let .array(values): values.map(searchText).joined(separator: " ")
        default: value.string
        }
    }

    static func clinicalRows(_ data: VaultValue, kind: String, search: String, filter: String) -> [VaultValue] {
        let rows = data[kind].array
        return rows.filter { row in
            let matches = search.isEmpty || searchText(row).localizedCaseInsensitiveContains(search)
            let flag = kind == "labsByTest" ? row["latestFlag"].string : row["derivedFlag"].string
            let status = row["clinicalStatus"].string.isEmpty ? row["status"].string : row["clinicalStatus"].string
            return matches && (filter == "All" || (filter == "Out of range" && ["high", "low"].contains(flag)) || (filter == "Active" && status.lowercased() == "active") || (filter == "Procedures / other" && ["procedure", "unknown", ""].contains(row["category"].string)) || (filter == "Chronic / other" && ["chronic", "unknown", ""].contains(row["category"].string)))
        }.sorted { a, b in
            let aRow = kind == "labsByTest" ? a["latest"] : a
            let bRow = kind == "labsByTest" ? b["latest"] : b
            return (date(aRow) ?? NativeQuant.date(aRow["onsetDate"].string) ?? NativeQuant.date(aRow["recordedDate"].string) ?? .distantPast) > (date(bRow) ?? NativeQuant.date(bRow["onsetDate"].string) ?? NativeQuant.date(bRow["recordedDate"].string) ?? .distantPast)
        }
    }
}
