import SwiftUI

struct NativeCalendarView: View {
    @Environment(VaultModel.self) private var model
    @State private var month = Calendar.current.startOfDay(for: Date())
    @State private var selected = Calendar.current.startOfDay(for: Date())
    @State private var occurrences: [VaultValue] = []
    @State private var almanac: [String: VaultValue] = [:]
    @State private var display: VaultValue = .object([:])
    @State private var weather: [String: VaultValue] = [:]
    @State private var overlayError: String?
    @State private var savingDisplay = false
    @State private var error: String?
    @State private var loading = false
    @State private var loadID = UUID()
    private let calendar = Calendar.current
    private func ymd(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private var monthStart: Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: month))!
    }

    private var days: [Date?] {
        let offset =
            (calendar.component(.weekday, from: monthStart) - calendar.firstWeekday + 7) % 7
        return Array(repeating: nil, count: offset)
            + calendar.range(of: .day, in: .month, for: monthStart)!.map {
                calendar.date(byAdding: .day, value: $0 - 1, to: monthStart)
            }
    }

    private func onDay(_ date: Date) -> [VaultValue] {
        let day = ymd(date)
        return occurrences.filter {
            $0["date"].string <= day
                && ($0["endDate"].string.isEmpty ? $0["date"].string : $0["endDate"].string) >= day
        }
    }

    private let layers = [
        ("showMoon", "Moon phases & eclipses"), ("showSeasons", "Seasons"),
        ("showAstrology", "Zodiac & Mercury"), ("showMeteors", "Meteor showers"),
        ("showHolidays", "US holidays"), ("showDst", "Daylight saving"),
        ("showSunTimes", "Sunrise & sunset"), ("showWeather", "Weather"),
    ]

    private func enabled(_ key: String) -> Bool {
        display[key] != .bool(false)
    }

    private func marks(_ date: Date) -> [VaultValue] {
        (almanac[ymd(date)]?["marks"].array ?? []).filter { enabled($0["layer"].string) }
    }

    private func dayLabel(_ date: Date) -> String {
        ([date.formatted(date: .complete, time: .omitted)] + marks(date).map { $0["label"].string }).joined(separator: ", ")
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Button("Previous month", systemImage: "chevron.left") { changeMonth(-1) }
                        .labelStyle(.iconOnly)
                    Spacer()
                    Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
                    Spacer()
                    Button("Next month", systemImage: "chevron.right") { changeMonth(1) }
                        .labelStyle(.iconOnly)
                }.buttonStyle(.borderless)
                HStack {
                    ForEach(0 ..< 7, id: \.self) { index in
                        let weekday = (calendar.firstWeekday - 1 + index) % 7
                        Text(calendar.shortWeekdaySymbols[weekday]).font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("calendarWeekday-\(weekday)")
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7)) {
                    ForEach(Array(days.enumerated()), id: \.offset) { _, date in
                        if let date {
                            Button {
                                selected = date
                            } label: {
                                VStack(spacing: 4) {
                                    Text(String(calendar.component(.day, from: date)))
                                    Text(marks(date).prefix(2).map { $0["emoji"].string }.joined())
                                        .font(.caption2).frame(height: 14)
                                    if enabled("showWeather"), let forecast = weather[ymd(date)] {
                                        Text(forecast["emoji"].string).font(.caption2)
                                    }
                                    Circle().fill(onDay(date).isEmpty ? .clear : .indigo).frame(
                                        width: 5, height: 5
                                    )
                                }.frame(maxWidth: .infinity).padding(.vertical, 7).background(
                                    calendar.isDate(date, inSameDayAs: selected)
                                        ? Color.indigo.opacity(0.15) : .clear,
                                    in: RoundedRectangle(cornerRadius: 8)
                                )
                            }.buttonStyle(.borderless).accessibilityLabel(
                                dayLabel(date)
                            ).accessibilityIdentifier("calendarDay-\(ymd(date))")
                        } else {
                            Color.clear.frame(height: 42)
                        }
                    }
                }
                Button("Today") {
                    month = Date()
                    selected = calendar.startOfDay(for: Date())
                    Task { await load() }
                }
            }
            Section(selected.formatted(date: .complete, time: .omitted)) {
                if onDay(selected).isEmpty {
                    Text("No events today.").foregroundStyle(.secondary)
                }
                ForEach(onDay(selected), id: \.self) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Label(
                            item.title,
                            systemImage: item["kind"].string == "birthday"
                                ? "birthday.cake"
                                : item["completed"].boolean ? "checkmark.circle.fill" : "calendar"
                        )
                        Text(item["recurrenceLabel"].string).font(.caption).foregroundStyle(
                            .secondary
                        )
                        if !item["notes"].string.isEmpty {
                            Text(item["notes"].string).font(.callout)
                        }
                        if item["completable"].boolean {
                            Button(item["completed"].boolean ? "Reopen task" : "Complete task") {
                                Task { await complete(item) }
                            }
                        }
                    }
                }
            }
            if let day = almanac[ymd(selected)] {
                Section("Almanac") {
                    ForEach(marks(selected), id: \.self) { mark in
                        Text("\(mark["emoji"].string) \(mark["label"].string)")
                    }
                    if enabled("showMoon") {
                        let moon = day["moon"]
                        LabeledContent("\(moon["emoji"].string) \(moon["name"].string)", value: (moon["illumination"].number ?? 0).formatted(.percent.precision(.fractionLength(0))))
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("calendarMoon")
                    }
                    if enabled("showAstrology") {
                        let astrology = day["astrology"]
                        LabeledContent("Sun sign", value: "\(astrology["sunSign"]["emoji"].string) \(astrology["sunSign"]["name"].string)")
                        LabeledContent("Moon sign", value: "\(astrology["moonSign"]["emoji"].string) \(astrology["moonSign"]["name"].string)")
                        Text(astrology["mercuryRetrograde"].boolean ? "☿ Mercury retrograde" : "☿ Mercury direct")
                    }
                    if enabled("showSunTimes") {
                        let sun = day["sun"]
                        if sun.isEmpty {
                            Text("Set a weather location in Server Settings for sun times.").font(.footnote).foregroundStyle(.secondary)
                        } else if sun["polar"].boolean {
                            Text("The sun does not rise or set at this location today.")
                        } else {
                            LabeledContent("Sunrise", value: sun["sunrise"].string)
                            LabeledContent("Sunset", value: sun["sunset"].string)
                            LabeledContent("Daylight", value: "\(sun["daylight"].string) (\(sun["change"].string))")
                            Text([sun["location"].string, sun["timeZone"].string].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if enabled("showWeather"), let forecast = weather[ymd(selected)] {
                        LabeledContent("\(forecast["emoji"].string) Weather", value: "\(forecast["hi"].string)° / \(forecast["lo"].string)°")
                    }
                }
            }
            if let overlayError {
                ErrorNotice(message: overlayError)
            }
            if loading {
                ProgressView("Loading calendar…")
            }
            if let error {
                ErrorNotice(message: error)
            }
        }.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(layers, id: \.0) { key, title in
                        Toggle(title, isOn: Binding(get: { enabled(key) }, set: { value in
                            Task { await saveDisplay(key, value) }
                        }))
                    }
                } label: { Label("Calendar layers", systemImage: "line.3.horizontal.decrease") }
                    .disabled(savingDisplay).accessibilityIdentifier("calendarLayers")
            }
        }.task { await load() }.refreshable { await load() }.accessibilityIdentifier(
            "nativeCalendar"
        )
    }

    private func changeMonth(_ offset: Int) {
        month = calendar.date(byAdding: .month, value: offset, to: monthStart)!
        selected = month
        Task { await load() }
    }

    private func load() async {
        let requestID = UUID()
        loadID = requestID
        let start = monthStart
        let end = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: start)!
        loading = true
        error = nil
        overlayError = nil
        occurrences = []
        almanac = [:]
        weather = [:]
        defer {
            if loadID == requestID {
                loading = false
            }
        }
        do {
            let scope = VaultScope(start: ymd(start), end: ymd(end))
            let result = try await model.nativeRequest(
                "api/calendar/occurrences?start={start}&end={end}&includeCompleted=true",
                scope: scope
            )
            guard loadID == requestID else { return }
            occurrences = result["occurrences"].array
        } catch {
            if loadID == requestID {
                self.error = error.localizedDescription
            }
        }
        do {
            guard loadID == requestID else { return }
            let result = try await model.nativeRequest("api/calendar/almanac?start={start}&end={end}&timeZone={timeZone}", scope: .init(start: ymd(start), end: ymd(end)), record: .object(["timeZone": .string(TimeZone.current.identifier)]))
            guard loadID == requestID else { return }
            almanac = Dictionary(result["days"].array.map { ($0["date"].string, $0) }, uniquingKeysWith: { _, new in new })
            display = result["display"]
            if enabled("showWeather") {
                let forecast = try await model.nativeRequest("api/weather/forecast", scope: .init())
                guard loadID == requestID else { return }
                weather = Dictionary(forecast["forecast"]["days"].array.map { ($0["date"].string, $0) }, uniquingKeysWith: { _, new in new })
            }
        } catch {
            if loadID == requestID {
                overlayError = "Calendar overlays: \(error.localizedDescription)"
            }
        }
    }

    private func saveDisplay(_ key: String, _ value: Bool) async {
        savingDisplay = true
        defer { savingDisplay = false }
        do {
            _ = try await model.nativeRequest("api/settings", scope: .init(), method: "POST", body: .object(["calendar": .object([key: .bool(value)])]))
            display.set(key, .bool(value))
            if key == "showWeather", value {
                await load()
            }
        } catch { overlayError = error.localizedDescription }
    }

    private func complete(_ item: VaultValue) async {
        do {
            _ = try await model.nativeRequest(
                "api/calendar/events/{id}/\(item["completed"].boolean ? "uncomplete" : "complete")",
                scope: .init(), record: .object(["id": item["eventId"]]), method: "POST",
                body: .object(["occurrenceDate": item["date"]])
            )
            await load()
        } catch { self.error = error.localizedDescription }
    }
}
