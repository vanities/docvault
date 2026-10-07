import SwiftUI

struct NativeMacroCalendarView: View {
    @Environment(VaultModel.self) private var model
    @State private var schedule: NativeMacroSchedule?
    @State private var scheduleError: String?
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var type = "All"
    @State private var limit = 10
    @State private var now = Date()
    private var upcoming: [NativeMacroEvent] {
        schedule?.upcoming(now: now, type: type) ?? []
    }

    var body: some View {
        List {
            Section {
                Text("Macro release calendar").font(.title2.bold())
                Text("Scheduled FOMC, CPI and employment releases, paired with the latest released result.").font(.footnote).foregroundStyle(.secondary)
                Picker("Release", selection: $type) { ForEach(["All", "FOMC", "CPI", "NFP"], id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("macroReleaseType")
                Button("Refresh released results") { Task { await load() } }.disabled(loading)
                if loading {
                    ProgressView("Loading latest results…")
                }
                if let error {
                    ErrorNotice(message: error)
                }
                if let scheduleError {
                    ErrorNotice(message: scheduleError)
                }
                if data["stale"].boolean {
                    Label("Released results are cached and stale", systemImage: "clock.badge.exclamationmark")
                }
                if !data["fetchError"].isEmpty {
                    Text(data["fetchError"].string).foregroundStyle(.orange)
                }
            }
            Section("Upcoming published dates") {
                ForEach(Array(upcoming.prefix(limit))) { event in
                    NavigationLink { NativeMacroReleaseDetail(event: event, result: data[event.type]) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(event.label).font(.headline)
                            Text(event.date + (event.time.map { " · " + $0 } ?? ""))
                            if let days = NativeMacroSchedule.daysAway(event, now: now) {
                                Text(days == 0 ? "Today" : days == 1 ? "Tomorrow" : "In \(days) days").font(.caption).foregroundStyle(.secondary)
                            }
                            let result = data[event.type]
                            Text(result["display"].isEmpty ? "Last released result unavailable" : "Last released: " + result["display"].string + " · as of " + result["asOf"].string)
                                .font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }.accessibilityIdentifier("macroEvent-" + event.id)
                }
                if upcoming.count > limit {
                    Button("Show more published dates") { limit += 10 }
                }
                if upcoming.isEmpty {
                    Text("No upcoming dates in the included schedule. Check the agency calendars below.").foregroundStyle(.secondary)
                }
            }
            Section("Latest released results") {
                ForEach(["fomc", "cpi", "nfp"], id: \.self) { key in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(key.uppercased()).font(.headline)
                        NativeMacroPrint(result: data[key])
                    }
                }
            }
            Section("Agency calendars") {
                Link("Federal Reserve meeting calendar", destination: URL(string: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")!)
                Link("BLS release calendar", destination: URL(string: "https://www.bls.gov/schedule/")!)
                if let schedule {
                    Text("Published dates checked " + schedule.verifiedAt).font(.caption).foregroundStyle(.secondary)
                    Text("BLS coverage through \(schedule.coverage["cpi"] ?? "Unavailable"); FOMC coverage through \(schedule.coverage["fomc"] ?? "Unavailable"). Dates are scheduled and subject to change.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let resource = NativeCatalog.features.first(where: { $0.id == "quant" })?.resources.first(where: { $0.id == "quant-macro-calendar" }) {
                NavigationLink("Source data and refresh actions") { NativeResourceView(resource: resource, scope: .init()) }
            }
        }.task {
            do { schedule = try NativeMacroSchedule.load() }
            catch { scheduleError = error.localizedDescription }
            await load()
        }.refreshable { await load() }.onChange(of: type) { limit = 10 }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil; now = Date()
        defer { loading = false }
        do {
            let result = try await model.nativeRequest("api/quant/macro/calendar", scope: .init())
            guard !Task.isCancelled else { return }
            if !result["error"].isEmpty {
                throw VaultError.server(result["error"].string)
            }
            data = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeMacroPrint: View {
    let result: VaultValue
    var body: some View {
        if result["display"].isEmpty {
            Text("Unavailable").foregroundStyle(.secondary)
        } else {
            Text(result["display"].string).font(.title3.bold())
            Text("As of " + result["asOf"].string).font(.caption).foregroundStyle(.secondary)
            if !result["note"].isEmpty {
                Text(result["note"].string).font(.caption)
            }
        }
    }
}

struct NativeMacroReleaseDetail: View {
    let event: NativeMacroEvent
    let result: VaultValue
    var body: some View {
        List {
            Section("Scheduled release") {
                Text(event.label).font(.headline)
                Text(event.date)
                if let time = event.time {
                    Text(time)
                }
                Text("Scheduled date; subject to change.").font(.caption).foregroundStyle(.secondary)
                if let url = NativePolitics.sourceURL(.string(event.url)) {
                    Link("Open official calendar", destination: url).accessibilityIdentifier("macroOfficialCalendar")
                }
            }
            Section("Last released result") {
                NativeMacroPrint(result: result)
                Text("This is the previous released observation, not a forecast for the scheduled event.").font(.caption).foregroundStyle(.secondary)
            }
            let id = event.type == "fomc" ? "quant-macro-fed-policy" : event.type == "cpi" ? "quant-macro-inflation" : "quant-macro-jobs"
            if let resource = NativeCatalog.features.first(where: { $0.id == "quant" })?.resources.first(where: { $0.id == id }) {
                NavigationLink("Explore observations") { NativeQuantView(resource: resource).navigationTitle(resource.title) }
            }
        }.navigationTitle(event.type.uppercased()).navigationBarTitleDisplayMode(.inline)
    }
}
