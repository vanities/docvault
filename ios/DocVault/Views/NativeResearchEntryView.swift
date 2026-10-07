import Charts
import SwiftUI

struct NativeResearchEntryView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let record: VaultValue
    let resource: NativeResource
    let scope: VaultScope
    let changed: () -> Void
    @State private var detail: VaultValue = .null
    @State private var error: String?
    @State private var busy = false
    @State private var editor: NativeEditor?
    @State private var preview: URL?
    @State private var deleting = false
    @State private var generation = UUID()
    private var domain: ResearchDomain {
        ResearchDomain.resource(resource) ?? .finance
    }

    private var value: VaultValue {
        detail.isEmpty ? record : detail
    }

    private var row: ResearchRecord {
        .init(id: record["id"].string, value: value)
    }

    private var allowed: Bool {
        NativeResearch.belongs(value, to: domain)
    }

    private var metrics: [VaultMetric] {
        let pages = NativeResearch.count(value["pageCount"]).map { String($0) } ?? "Unavailable"
        let duration = NativeFinance.number(value["durationSec"]).map { $0.formatted(.number.precision(.fractionLength(0))) + " sec" } ?? "Unavailable"
        return [
            .init(title: "Pages", value: pages, symbol: "doc.on.doc"),
            .init(title: "Saved claims", value: String(value["intelligence"]["claims"].array.count), symbol: "text.quote"),
            .init(title: "Summary bullets", value: String(value["intelligence"]["summary"].array.count), symbol: "list.bullet"),
            .init(title: "Duration", value: duration, symbol: "waveform"),
        ]
    }

    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            if !allowed {
                ContentUnavailableView("Source unavailable in this inbox", systemImage: "books.vertical")
            } else {
                VaultHero(title: row.title, subtitle: [domain.title, row.media, row.status].joined(separator: " · "), symbol: "doc.text.magnifyingglass", color: .indigo, eyebrow: "SAVED SOURCE").vaultStandaloneRow()
                VaultMetricGrid(metrics: metrics).vaultStandaloneRow()
                Section("Read & review") {
                    if row.hasText {
                        NavigationLink { NativeSourceTextView(title: row.title, text: value["text"].string) } label: { Label("Read source text", systemImage: "text.alignleft") }.accessibilityIdentifier("readResearchText")
                    }
                    if let url = NativeResearch.sourceURL(value["sourceUrl"]) {
                        Link("Open original source", destination: url)
                    }
                    Button("Open saved source file", systemImage: "doc.richtext") { Task { await openFile() } }.accessibilityIdentifier("researchOpenFile").disabled(busy)
                    if !value["notes"].string.isEmpty {
                        Text(value["notes"].string).textSelection(.enabled)
                    }
                    ForEach(["publisher", "author", "reportDate", "uploadedAt"], id: \.self) { key in
                        if !value[key].isEmpty {
                            LabeledContent(VaultValue.label(key), value: value[key].string)
                        }
                    }
                    if !value["tickers"].array.isEmpty {
                        Text("Tickers · " + value["tickers"].array.map(\.string).joined(separator: ", "))
                    }
                    if !value["tags"].array.isEmpty {
                        Text(value["tags"].array.map { "#" + $0.string }.joined(separator: " · ")).foregroundStyle(.secondary)
                    }
                }
                intelligence("Saved summary", values: value["intelligence"]["summary"].array)
                intelligence("Saved claims", values: value["intelligence"]["claims"].array)
                if !value["tickers"].array.isEmpty {
                    Section("Mentioned tickers") {
                        NativeResearchQuotesView(symbols: value["tickers"].array.map(\.string))
                        NavigationLink("Explore research tickers") { NativeTickerView() }
                    }
                }
                Section("Manage source") {
                    Button("Edit metadata", systemImage: "pencil") {
                        guard let collection = resource.collections.first else { return }
                        editor = .init(action: .init(id: "edit", title: "Edit source metadata", path: collection.updatePath, method: collection.updateMethod, fields: collection.fields), record: value, resource: resource, collection: collection, editing: true)
                    }.accessibilityIdentifier("editRecord").disabled(detail.isEmpty || busy)
                    if row.media == "PDF" {
                        Button("Extract text again") { Task { await run("re-extract") } }.accessibilityIdentifier("researchExtract").disabled(busy)
                    }
                    if ["Audio", "Video"].contains(row.media) {
                        Button("Transcribe again") { Task { await run("re-transcribe") } }.accessibilityIdentifier("researchTranscribe").disabled(busy || row.processing)
                    }
                    if row.hasText {
                        Button("Analyze research") { Task { await run("intelligence") } }.accessibilityIdentifier("researchAnalyze").disabled(busy)
                    }
                    if busy || row.processing {
                        ProgressView(row.processing ? "Transcription in progress…" : "Working…")
                    }
                    if row.needsAttention {
                        Text([value["extractError"].string, value["transcribeError"].string].filter { !$0.isEmpty }.joined(separator: "\n")).foregroundStyle(.orange).textSelection(.enabled)
                    }
                    Button("Delete source", role: .destructive) { deleting = true }.accessibilityIdentifier("deleteRecord").disabled(busy)
                }
                Section("Saved record") { NativeValueSections(value: value, excluded: ["text", "intelligence"]) }
            }
        }.vaultDashboard().accessibilityIdentifier("nativeResearchSource").navigationTitle("Research source").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
            .task(id: row.processing) {
                guard row.processing else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    await load()
                }
            }
            .sheet(item: $editor) { item in
                NativeEditorView(editor: item, scope: scope, context: .null) { changed(); Task { await load() } }.privacyProtected()
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
            .confirmationDialog("Delete this source and its saved file?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Delete source", role: .destructive) { Task { await remove() } }.accessibilityIdentifier("confirmDeleteRecord")
            }
            .onDisappear { generation = UUID(); clearPreview() }
    }

    @ViewBuilder private func intelligence(_ title: String, values: [VaultValue]) -> some View {
        if !values.isEmpty {
            Section(title) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(item["text"].string).font(.body).textSelection(.enabled)
                        let labels = [item["stance"].string] + item["tickers"].array.map(\.string) + item["topics"].array.map(\.string)
                        if labels.contains(where: { !$0.isEmpty }) {
                            Text(labels.filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption.weight(.semibold)).foregroundStyle(.indigo)
                        }
                        let provenance = item["provenance"]
                        if !provenance["quote"].string.isEmpty {
                            Text(provenance["quote"].string).font(.callout).fixedSize(horizontal: false, vertical: true).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 12)).accessibilityIdentifier("researchQuotedText")
                            Text(NativeResearch.quoteMatches(provenance, text: value["text"].string) ? "Quote matches the saved text at its recorded character range." : "The recorded quote could not be verified against the current saved text.").font(.caption).foregroundStyle(.secondary)
                        }
                        if let start = NativeResearch.count(provenance["lineStart"]), let end = NativeResearch.count(provenance["lineEnd"]) {
                            Text("Recorded lines \(start)–\(end)").font(.caption).foregroundStyle(.secondary)
                        }
                        if let url = NativeResearch.sourceURL(provenance["sourceUrl"]) {
                            Link("Cited source", destination: url).font(.caption)
                        }
                    }.padding(.vertical, 6)
                }
            }
        }
    }

    private func load() async {
        let id = UUID(); generation = id
        do {
            let next = try await model.nativeRequest("api/research/{id}", scope: scope, record: record)["entry"]
            guard generation == id, !Task.isCancelled else { return }
            guard !next.isEmpty, next["id"] == record["id"], NativeResearch.belongs(next, to: domain) else { throw VaultError.server("This source is unavailable in the selected inbox.") }
            detail = next; error = nil
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func run(_ action: String) async {
        busy = true; error = nil; defer { busy = false }
        do { _ = try await model.nativeRequest("api/research/{id}/" + action, scope: scope, record: record, method: "POST"); changed(); await load() }
        catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func openFile() async {
        busy = true; error = nil; defer { busy = false }
        do {
            let url = try await model.nativeDownload("api/research/{id}/file", scope: scope, record: record, method: "GET", body: nil, suffix: NativeResearch.sourceSuffix(value))
            guard !Task.isCancelled else { VaultModel.removePreview(url); return }
            guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) > 0 else {
                VaultModel.removePreview(url)
                throw VaultError.server("The saved source file is empty. Re-import the original document to recover it.")
            }
            clearPreview(); preview = url
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func remove() async {
        busy = true; error = nil; defer { busy = false }
        do { _ = try await model.nativeRequest("api/research/{id}", scope: scope, record: record, method: "DELETE"); changed(); dismiss() }
        catch { self.error = error.localizedDescription }
    }

    private func clearPreview() {
        if let preview {
            VaultModel.removePreview(preview)
        }; preview = nil
    }
}

private struct NativeResearchQuotesView: View {
    @Environment(VaultModel.self) private var model
    let symbols: [String]
    @State private var quotes: [VaultValue] = []
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if loading {
                ProgressView("Loading ticker quotes…")
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(quotes.enumerated()), id: \.offset) { _, quote in
                Text(quote["symbol"].string).font(.headline)
                if !quote["error"].isEmpty {
                    Text(quote["error"].string).font(.caption).foregroundStyle(.secondary)
                }
                VaultMetricGrid(metrics: [
                    .init(title: "Quoted price", value: NativeFinance.number(quote["price"]).map { $0.formatted(.number.precision(.fractionLength(2))) + " " + quote["currency"].string } ?? "Unavailable", symbol: "dollarsign.circle"),
                    .init(title: "1 year", value: NativeFinance.number(quote["oneYearChangePct"]).map { $0.formatted(.number.precision(.fractionLength(2))) + "%" } ?? "Unavailable", symbol: "chart.line.uptrend.xyaxis"),
                ])
                if !quote["sparklineCloses"].array.isEmpty {
                    Chart(Array(quote["sparklineCloses"].array.enumerated()), id: \.offset) { index, value in
                        if let close = NativeFinance.number(value) {
                            LineMark(x: .value("Weekly sample", index), y: .value("Close", close)).foregroundStyle(Color.indigo.gradient)
                        }
                    }.frame(height: 100).chartXAxis(.hidden).accessibilityLabel(quote["symbol"].string + " weekly close samples")
                    Text("Weekly close samples; individual dates are not supplied.").font(.caption).foregroundStyle(.secondary)
                }
                if let lo = NativeFinance.number(quote["fiftyTwoWeekLow"]), let hi = NativeFinance.number(quote["fiftyTwoWeekHigh"]) {
                    Text("52-week range · " + lo.formatted() + " – " + hi.formatted() + " " + quote["currency"].string).font(.caption).foregroundStyle(.secondary)
                }
            }
        }.task(id: symbols) {
            loading = true; error = nil; defer { loading = false }
            do {
                var values: [VaultValue] = []
                let distinct = Array(Set(symbols.filter { !$0.isEmpty })).sorted()
                for start in stride(from: 0, to: distinct.count, by: 100) {
                    let batch = distinct[start ..< min(start + 100, distinct.count)].joined(separator: ",")
                    let response = try await model.nativeRequest("api/quant/tickers/prices?symbols={symbols}", scope: .init(), record: .object(["symbols": .string(batch)]))
                    guard !Task.isCancelled else { return }; values += response["quotes"].array
                }
                quotes = values
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}
