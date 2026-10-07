import Charts
import SwiftUI

struct NativeTimesheetAnalytics: View {
    @Environment(VaultModel.self) private var model
    @State private var data: VaultValue = .null
    @State private var from = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
    @State private var to = Date()
    @State private var client = ""
    @State private var error: String?
    private func ymd(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }

    private var entries: [VaultValue] {
        data["entries"].array.filter { row in
            guard row["date"].string >= ymd(from), row["date"].string <= ymd(to) else {
                return false
            }
            if client.isEmpty {
                return true
            }
            return data["projects"].array.first { $0["id"] == row["projectId"] }?["clientId"].string
                == client
        }
    }

    private var daily: [(String, Double)] {
        Dictionary(grouping: entries, by: { $0["date"].string }).map {
            ($0.key, $0.value.reduce(0) { $0 + ($1["durationMinutes"].number ?? 0) } / 60)
        }.sorted { $0.0 < $1.0 }
    }

    private var billableTotals: [(String, Double)] {
        let grouped = Dictionary(grouping: entries.filter { $0["billable"].boolean }) { row in
            let project = data["projects"].array.first { $0["id"] == row["projectId"] }
            let owner = data["clients"].array.first { $0["id"] == project?["clientId"] }
            let currency = owner?["currency"].string ?? ""
            return currency.isEmpty ? "USD" : currency
        }
        return grouped.map { ($0.key, $0.value.reduce(0) { $0 + ($1["amount"].number ?? 0) }) }
            .sorted { $0.0 < $1.0 }
    }

    var body: some View {
        List {
            VaultHero(title: "Time and earnings", subtitle: "Explore recorded hours and billable amounts for the clients and dates you select.", symbol: "clock.arrow.circlepath", color: .cyan, eyebrow: "TIMESHEET / ANALYTICS").vaultStandaloneRow()
            Section("Window") {
                DatePicker("From", selection: $from, displayedComponents: .date)
                DatePicker("To", selection: $to, displayedComponents: .date)
                Picker("Client", selection: $client) {
                    Text("All clients").tag("")
                    ForEach(data["clients"].array, id: \.self) {
                        Text($0.title).tag($0["id"].string)
                    }
                }
            }
            Section("Summary") {
                VaultMetricGrid(metrics: [
                    .init(title: "Hours", value: (entries.reduce(0) { $0 + ($1["durationMinutes"].number ?? 0) } / 60).formatted(.number.precision(.fractionLength(0 ... 2))), symbol: "clock"),
                    .init(title: "Entries", value: String(entries.count), symbol: "list.bullet.rectangle"),
                ] + billableTotals.map { currency, amount in
                    .init(title: "Billable amount (\(currency))", value: amount.formatted(.currency(code: currency)), symbol: "creditcard")
                }, color: .cyan).vaultStandaloneRow()
                if !model.blurNumbers {
                    Chart(daily, id: \.0) { day, hours in
                        BarMark(x: .value("Date", day), y: .value("Hours", hours)).foregroundStyle(Color.cyan.gradient).cornerRadius(5)
                    }.frame(height: 220)
                }
            }
            Section("By project") {
                ForEach(data["projects"].array, id: \.self) { project in
                    let rows = entries.filter { $0["projectId"] == project["id"] }
                    if !rows.isEmpty {
                        LabeledContent(
                            project.title,
                            value: model.blurNumbers
                                ? "••••"
                                : String(
                                    format: "%.2f hours",
                                    rows.reduce(0) { $0 + ($1["durationMinutes"].number ?? 0) } / 60
                                )
                        )
                    }
                }
            }
            if let error {
                ErrorNotice(message: error)
            }
        }.vaultDashboard(color: .cyan).tint(.cyan).task {
            do { data = try await model.nativeRequest("api/timesheet", scope: .init()) } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
