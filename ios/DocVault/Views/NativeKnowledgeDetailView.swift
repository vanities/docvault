import Charts
import SwiftUI

struct NativeKnowledgeDetailView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let kind: KnowledgeKind
    let record: VaultValue
    let changed: () -> Void
    @State private var detail: VaultValue = .null
    @State private var error: String?
    @State private var busy = false
    @State private var loading = false
    @State private var deleting = false
    @State private var emailing = false
    @State private var notice: String?
    @State private var preview: URL?
    @State private var generation = UUID()
    @State private var waitingForAudio = false
    private var value: VaultValue {
        detail.isEmpty ? record : detail
    }

    private var done: Bool {
        value["status"].string == "done"
    }

    private var color: Color {
        kind == .news ? .orange : .indigo
    }

    var body: some View {
        List {
            VaultHero(title: kind == .news && !value["title"].isEmpty ? value["title"].string : kind.recordTitle(value), subtitle: [kind.date(value), value["status"].string.capitalized, value["theme"].string].filter { !$0.isEmpty }.joined(separator: " · "), symbol: kind == .news ? "newspaper.fill" : "sparkle.magnifyingglass", color: color, eyebrow: kind == .news ? "SAVED EDITION" : "RESEARCH REPORT").vaultStandaloneRow()
            if loading {
                ProgressView("Refreshing record…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if let notice {
                Text(notice).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("knowledgeNotice")
            }
            if value["status"].string == "running" {
                Section("Progress") { ProgressView("The server is generating this " + (kind == .news ? "edition" : "report") + "…"); Text("You can leave this screen. The job continues on your server and appears in history.").font(.caption).foregroundStyle(.secondary) }
            }
            if !value["error"].isEmpty {
                Section("Job error") { Text(value["error"].string).textSelection(.enabled).foregroundStyle(.orange) }
            }
            if done, !detail.isEmpty {
                VaultMetricGrid(metrics: metrics, color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("knowledgeDetailMetrics")
                if kind == .news, !value["imagePath"].isEmpty {
                    NativeNewsImage(record: record).vaultStandaloneRow()
                }
                Section("Read & export") {
                    if !kind.body(value).isEmpty {
                        NavigationLink { NativeKnowledgeReader(title: kind == .news ? value["title"].string : "Research report", text: kind.body(value), color: color) } label: { Label("Read " + (kind == .news ? "edition" : "report"), systemImage: "book") }.accessibilityIdentifier("readKnowledgeReport")
                        NavigationLink("Read plain text") { NativeSourceTextView(title: "Saved text", text: kind.body(value)) }
                    } else {
                        Text("No report text was saved.").foregroundStyle(.secondary)
                    }
                    Button(kind == .news ? "Open newspaper & share HTML" : "Export cited report as HTML", systemImage: "square.and.arrow.up") { Task { await export() } }.accessibilityIdentifier("knowledgeExport").disabled(busy)
                }
                if kind == .research {
                    Section("Cited sources") {
                        ForEach(Array(value["sources"].array.enumerated()), id: \.offset) { index, source in
                            if let url = NativeResearch.sourceURL(source["url"]) {
                                Link("[\(index + 1)] " + (source["title"].string.isEmpty ? url.host() ?? "Source" : source["title"].string), destination: url).accessibilityIdentifier("researchCitation-\(index)")
                            } else {
                                Text("[\(index + 1)] " + (source["title"].string.isEmpty ? "Unavailable source URL" : source["title"].string)).foregroundStyle(.secondary)
                            }
                        }
                        if value["sources"].array.isEmpty {
                            Text("No sources were saved.").foregroundStyle(.secondary)
                        }
                    }
                    if !value["attachments"].array.isEmpty {
                        Section("Submitted images") { ForEach(Array(value["attachments"].array.enumerated()), id: \.offset) { index, attachment in NativeResearchAttachment(value: attachment, index: index) } }
                    }
                } else {
                    newsSections
                }
            }
            if !value["generatedBy"].isEmpty || !value["usage"].isEmpty {
                Section("Generation record") {
                    NativeValueSections(value: value["generatedBy"])
                    if let input = NativeResearch.count(value["usage"]["inputTokens"]) {
                        LabeledContent("Input tokens", value: String(input))
                    }
                    if let output = NativeResearch.count(value["usage"]["outputTokens"]) {
                        LabeledContent("Output tokens", value: String(output))
                    }
                }
            }
            if busy {
                ProgressView("Working…")
            }
            Section("Manage saved record") {
                Button("Delete " + (kind == .news ? "edition" : "report"), role: .destructive) { deleting = true }.disabled(busy || detail.isEmpty).accessibilityIdentifier("deleteKnowledgeRecord")
            }
        }.vaultDashboard(color: color).tint(color).navigationTitle(kind == .news ? "Edition" : "Research report").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
            .task(id: value["status"].string == "running") {
                guard value["status"].string == "running" else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }; await load()
                }
            }
            .task(id: waitingForAudio) {
                guard waitingForAudio else { return }
                for _ in 0 ..< 60 {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    await load()
                    if !detail["audioPath"].isEmpty {
                        waitingForAudio = false; notice = "A saved narration is now available."; return
                    }
                }
                waitingForAudio = false; notice = "Narration was requested. Refresh later to check for a saved audio file."
            }
            .sheet(isPresented: Binding(get: { preview != nil }, set: {
                if !$0 {
                    clearPreview()
                }
            })) {
                if let preview {
                    DocumentPreviewSheet(url: preview).privacyProtected()
                }
            }
            .confirmationDialog("Delete this saved record?", isPresented: $deleting, titleVisibility: .visible) { Button("Delete", role: .destructive) { Task { await remove() } }.accessibilityIdentifier("confirmDeleteKnowledgeRecord") }
            .onDisappear { generation = UUID(); clearPreview() }
    }

    private var metrics: [VaultMetric] {
        if kind == .research {
            return [
                .init(title: "Cited sources", value: String(value["sources"].array.count), symbol: "link"),
                .init(title: "Recorded searches", value: NativeResearch.count(value["searchCount"]).map(String.init) ?? "Unavailable", symbol: "magnifyingglass"),
                .init(title: "Search limit", value: NativeResearch.count(value["maxSearches"]).map(String.init) ?? "Unavailable", symbol: "slider.horizontal.3"),
                .init(title: "Attachments", value: String(value["attachments"].array.count), symbol: "photo.on.rectangle"),
            ]
        }
        return [
            .init(title: "Digest items", value: NativeResearch.count(value["digestMeta"]["itemCount"]).map(String.init) ?? "Unavailable", symbol: "text.book.closed"),
            .init(title: "Source labels", value: String(value["digestMeta"]["sources"].array.count), symbol: "link"),
            .init(title: "Recorded warnings", value: String(value["digestMeta"]["sourceWarnings"].array.count), symbol: "exclamationmark.triangle"),
            .init(title: "Pulled titles", value: String(value["digestMeta"]["pulled"].array.count), symbol: "list.bullet"),
        ]
    }

    @ViewBuilder private var newsSections: some View {
        if !value["weather"].isEmpty {
            Section("Weather") { NativeNewsWeather(value: value["weather"]) }
        }
        if !value["sun"].isEmpty {
            Section("Sun & daylight") {
                ForEach(["date", "sunrise", "sunset", "daylight", "delta"], id: \.self) {
                    key in if !value["sun"][key].isEmpty {
                        LabeledContent(VaultValue.label(key), value: value["sun"][key].string)
                    }
                }
                Text("Times and daylight are saved in the server’s configured format.").font(.caption).foregroundStyle(.secondary)
            }
        }
        if !value["weekAhead"].isEmpty {
            Section("Week ahead · " + value["weekAhead"]["start"].string + " – " + value["weekAhead"]["end"].string) {
                ForEach(Array(value["weekAhead"]["items"].array.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item["emoji"].string + " " + item["title"].string).font(.headline); Text(item["date"].string + (item["endDate"].isEmpty ? "" : " – " + item["endDate"].string) + " · " + item["kind"].string).font(.caption).foregroundStyle(.secondary); if item["overdue"].boolean {
                            Text("Overdue").font(.caption).foregroundStyle(.orange)
                        }
                    }
                }
                if value["weekAhead"]["items"].array.isEmpty {
                    Text("No items were saved for this window.").foregroundStyle(.secondary)
                }
            }
        }
        Section("Source ledger") {
            if !value["digestMeta"]["sinceISO"].isEmpty {
                LabeledContent("Digest since", value: value["digestMeta"]["sinceISO"].string)
            }
            Text(value["digestMeta"]["sources"].array.map(\.string).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            ForEach(Array(value["digestMeta"]["pulled"].array.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 5) {
                    if let url = NativeResearch.sourceURL(item["url"]) {
                        Link(item["title"].string, destination: url)
                    } else {
                        Text(item["title"].string).textSelection(.enabled)
                    }; Text(item["source"].string).font(.caption).foregroundStyle(.secondary)
                }
            }
            ForEach(Array(value["digestMeta"]["sourceWarnings"].array.enumerated()), id: \.offset) { _, warning in Label(warning["source"].string + ": " + warning["message"].string, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled) }
            if value["digestMeta"]["sourceWarnings"].array.isEmpty {
                Text("No warnings recorded. This does not verify that every collector succeeded.").font(.caption).foregroundStyle(.secondary)
            }
        }
        Section("Narration & email") {
            if !value["audioPath"].isEmpty {
                NativeNewsAudioView(record: value).id(value["audioPath"].string)
            } else {
                Text("No saved narration is available.").foregroundStyle(.secondary)
            }
            Button(value["audioPath"].isEmpty ? "Generate narration" : "Regenerate narration", systemImage: "waveform") { Task { await narrate() } }.accessibilityIdentifier("newsNarrate").disabled(busy || waitingForAudio)
            if waitingForAudio {
                ProgressView("Waiting for saved narration…")
            }
            Button("Email edition", systemImage: "envelope") { emailing = true }.accessibilityIdentifier("newsEmail").disabled(busy)
                .confirmationDialog("Email this edition to the address configured on your server?", isPresented: $emailing, titleVisibility: .visible) {
                    Button("Send edition") { Task { await email() } }.accessibilityIdentifier("confirmEmailEdition")
                    Button("Cancel", role: .cancel) {}
                }
        }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; defer {
            if generation == id {
                loading = false
            }
        }
        do { let next = try await model.nativeRequest(kind.path + "/{id}", scope: .init(), record: record); guard generation == id, !Task.isCancelled else { return }; guard next["id"] == record["id"] else { throw VaultError.server("The saved record is unavailable.") }; detail = next; error = nil }
        catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func export() async {
        busy = true; error = nil; defer { busy = false }
        do { let url = try await model.nativeDownload(kind.path + "/{id}/" + (kind == .news ? "edition.html" : "report.html"), scope: .init(), record: record, method: "GET", body: nil, suffix: "html"); guard !Task.isCancelled else { VaultModel.removePreview(url); return }; clearPreview(); preview = url }
        catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func remove() async {
        busy = true; defer { busy = false }
        do { _ = try await model.nativeRequest(kind.path + "/{id}", scope: .init(), record: record, method: "DELETE"); changed(); dismiss() }
        catch { self.error = error.localizedDescription }
    }

    private func narrate() async {
        busy = true; error = nil; defer { busy = false }
        do { let result = try await model.nativeRequest(kind.path + "/{id}/narrate", scope: .init(), record: record, method: "POST"); guard result["started"].boolean else { throw VaultError.server("The server did not acknowledge a narration request.") }; waitingForAudio = value["audioPath"].isEmpty; notice = "Narration requested. The server has not confirmed completion." }
        catch { self.error = error.localizedDescription }
    }

    private func email() async {
        busy = true; error = nil; defer { busy = false }
        do { _ = try await model.nativeRequest(kind.path + "/{id}/email", scope: .init(), record: record, method: "POST"); notice = "The server accepted the email request. Delivery has not been verified." }
        catch { self.error = error.localizedDescription }
    }

    private func clearPreview() {
        if let preview {
            VaultModel.removePreview(preview)
        }; preview = nil
    }
}

private struct NativeKnowledgeReader: View {
    let title: String
    let text: String
    let color: Color
    @State private var formatted = true
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("Reading", selection: $formatted) { Text("Formatted").tag(true); Text("Plain text").tag(false) }.pickerStyle(.segmented).accessibilityIdentifier("knowledgeReportReading")
                if formatted {
                    NativeRichText(text: text)
                } else {
                    Text(text).font(.system(.body, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                ShareLink(item: text) { Label("Share report text", systemImage: "square.and.arrow.up") }
            }.padding(24).frame(maxWidth: 920).frame(maxWidth: .infinity, alignment: .center)
        }.vaultDashboard(color: color).navigationTitle(title.isEmpty ? "Saved report" : title).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("knowledgeReportReader")
    }
}

private struct NativeResearchAttachment: View {
    let value: VaultValue
    let index: Int
    var body: some View {
        let parts = value["dataUrl"].string.split(separator: ",", maxSplits: 1)
        if parts.count == 2, let data = Data(base64Encoded: String(parts[1])), let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 360).accessibilityLabel("Submitted research image \(index + 1)")
        } else {
            Text("Submitted image \(index + 1) could not be displayed.").foregroundStyle(.secondary)
        }
    }
}

private struct NativeNewsWeather: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let value: VaultValue
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(value["label"].string).font(.headline)
            let units = value["units"].string
            if ["F", "C"].contains(units) {
                Text("Saved forecast · °" + units).font(.caption).foregroundStyle(.secondary)
                Chart(Array(value["days"].array.enumerated()), id: \.offset) { _, day in
                    if NativeQuant.date(day["date"].string) != nil {
                        let date = day["date"].string
                        if let hi = NativeFinance.number(day["hi"]) {
                            LineMark(x: .value("Day", date), y: .value("Temperature (°" + units + ")", hi), series: .value("Range", "High")).foregroundStyle(by: .value("Temperature", "High")); PointMark(x: .value("Day", date), y: .value("Temperature", hi)).foregroundStyle(by: .value("Temperature", "High"))
                        }
                        if let lo = NativeFinance.number(day["lo"]) {
                            LineMark(x: .value("Day", date), y: .value("Temperature (°" + units + ")", lo), series: .value("Range", "Low")).foregroundStyle(by: .value("Temperature", "Low")); PointMark(x: .value("Day", date), y: .value("Temperature", lo)).foregroundStyle(by: .value("Temperature", "Low"))
                        }
                    }
                }.chartForegroundStyleScale(["High": Color.orange, "Low": Color.teal])
                    .chartXAxis { AxisMarks { axis in AxisGridLine(); AxisValueLabel {
                        if let day = axis.as(String.self) {
                            if textSize.isAccessibilitySize {
                                VStack(spacing: 0) { Text(String(day.dropFirst(5).prefix(2))); Text(String(day.suffix(2))) }.font(.caption2).fixedSize()
                            } else {
                                Text(String(day.suffix(5))).font(.caption2)
                            }
                        }
                    } } }
                    .chartYAxis { AxisMarks(values: .automatic(desiredCount: textSize.isAccessibilitySize ? 3 : 5)) { AxisGridLine(); AxisValueLabel() } }
                    .frame(height: textSize.isAccessibilitySize ? 290 : 210).accessibilityIdentifier("newsWeatherChart")
            }
            ForEach(Array(value["days"].array.enumerated()), id: \.offset) { _, day in
                VStack(alignment: .leading, spacing: 4) { Text(day["date"].string + " · " + day["emoji"].string + " " + day["label"].string).font(.subheadline.weight(.semibold)); Text("High " + temperature(day["hi"], units) + " · Low " + temperature(day["lo"], units) + (NativeFinance.number(day["precipPct"]).map { " · Rain " + $0.formatted(.number.precision(.fractionLength(0))) + "%" } ?? "")).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func temperature(_ number: VaultValue, _ units: String) -> String {
        NativeFinance.number(number).map { $0.formatted(.number.precision(.fractionLength(0 ... 1))) + (["F", "C"].contains(units) ? " °" + units : " (unit unavailable)") } ?? "Unavailable"
    }
}

private struct NativeNewsImage: View {
    @Environment(VaultModel.self) private var model
    let record: VaultValue
    @State private var image: UIImage?
    @State private var error: String?
    var body: some View {
        VStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 20)).accessibilityLabel("Saved edition illustration")
            } else if let error {
                Text(error).font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView("Loading illustration…")
            }
        }
        .task { do { let url = try await model.nativeDownload("api/daily-news/{id}/image.png", scope: .init(), record: record, method: "GET", body: nil, suffix: "png"); defer { VaultModel.removePreview(url) }; guard !Task.isCancelled, let loaded = UIImage(contentsOfFile: url.path) else { throw VaultError.server("The saved illustration could not be displayed.") }; image = loaded } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        } }
    }
}
