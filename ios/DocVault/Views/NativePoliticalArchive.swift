import SwiftUI

struct NativePoliticalArchive: View {
    @Environment(VaultModel.self) private var model
    let kind: String
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var search = ""
    @State private var chamber = "all"
    @State private var direction = "all"
    @State private var optionsOnly = false
    var rows: [VaultValue] {
        data[kind].array.filter { row in
            (search.isEmpty || row.stringSearch.localizedCaseInsensitiveContains(search))
                && (chamber == "all" || row["chamber"].string == chamber)
                && (kind != "trades" || direction == "all" || row["category"].string == direction)
                && (!optionsOnly || !row["option"].isEmpty)
        }
    }

    var title: String {
        switch kind { case "trades": "Disclosed trades"; case "filings": "Filing archive"; case "bills": "Bills"; default: "Executive actions" }
    }

    var body: some View {
        List {
            if ["trades", "filings"].contains(kind) {
                Section("Filters") {
                    Picker("Chamber", selection: $chamber) { Text("All").tag("all"); Text("House").tag("house"); Text("Senate").tag("senate"); Text("Executive").tag("executive") }
                        .accessibilityIdentifier("politicalArchiveChamber")
                    if kind == "trades" {
                        Picker("Direction", selection: $direction) { Text("All").tag("all"); Text("Buys").tag("buy"); Text("Sells").tag("sell") }
                        Toggle("Options only", isOn: $optionsOnly).accessibilityIdentifier("politicalArchiveOptions")
                    }
                }
            }
            if loading {
                ProgressView("Loading archive…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            Section("\(rows.count) matching records") {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    if kind == "trades" {
                        NativePoliticalTradeRow(trade: row, simulation: false)
                    } else if kind == "filings" {
                        NavigationLink { NativeFilingDetail(filing: row) } label: {
                            VStack(alignment: .leading) {
                                Text(row["filerName"].string).font(.headline)
                                Text("\(row["docId"].string) · \(row["filingDate"].string) · \(row["tradeCount"].string) trades").font(.caption)
                            }
                        }.accessibilityIdentifier("politicalFiling-" + row["docId"].string)
                    } else if kind == "bills" {
                        NavigationLink {
                            NativePoliticalBillDetail(vote: .object(["externalId": row["externalId"], "label": row["title"]]))
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(row["title"].string).font(.headline)
                                Text("\(row["officialId"].string) · \(row["status"].string) · \(row["latestActionDate"].string)").font(.caption)
                            }
                        }.accessibilityIdentifier("politicalBill-" + row["externalId"].string)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(row["title"].string).font(.headline)
                            Text(kind == "bills" ? "\(row["officialId"].string) · \(row["status"].string) · \(row["latestActionDate"].string)" : "\(row["type"].string) · \(row["issuedDate"].string)").font(.caption)
                            if let url = NativePolitics.sourceURL(row["url"]) {
                                Link("Official source", destination: url)
                            }
                        }
                    }
                }
                if rows.isEmpty, !loading {
                    Text("No matching records.").foregroundStyle(.secondary)
                }
            }
            if kind == "trades" {
                Text("Up to 2,000 recent cached trades. Amounts are disclosed ranges.").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle(title).searchable(text: $search, prompt: "Find a record")
            .task { await load() }.refreshable { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do {
            let path = kind == "trades" ? "api/politics/trades?limit=2000" : kind == "filings" ? "api/politics/filings?limit=5000" : "api/politics/feed"
            let result = try await model.nativeRequest(path, scope: .init())
            guard !Task.isCancelled else { return }
            data = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
        loading = false
    }
}

struct NativeFilingDetail: View {
    @Environment(VaultModel.self) private var model
    let filing: VaultValue
    @State private var data: VaultValue = .null
    @State private var text: String?
    @State private var error: String?
    @State private var preview: FilingPreview?
    @State private var busy = false
    @State private var operation: Task<Void, Never>?
    var path: String {
        "api/politics/filings/{source}/{docId}"
    }

    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            Section("Filing") {
                NativeValueSections(value: data["filing"].isEmpty ? filing : data["filing"])
                if filing["hasPdf"].boolean {
                    Button("Preview archived PDF") { download(pdf: true) }.accessibilityIdentifier("previewPoliticalFiling")
                }
                Button("Read extracted text") { download(pdf: false) }.accessibilityIdentifier("readPoliticalFilingText")
                if let url = NativePolitics.sourceURL(filing["filingUrl"]) {
                    Link("Original disclosure", destination: url)
                }
                if busy {
                    ProgressView("Loading source…")
                }
            }
            if let text {
                Section("Extracted text") { Text(text).textSelection(.enabled).accessibilityIdentifier("politicalFilingText") }
            }
            Section("Linked trades") { ForEach(data["trades"].array, id: \.self) { NativePoliticalTradeRow(trade: $0, simulation: false) } }
        }.navigationTitle(filing["docId"].string).disabled(busy)
            .task {
                do { data = try await model.nativeRequest(path, scope: .init(), record: filing) }
                catch {
                    if !Task.isCancelled {
                        self.error = error.localizedDescription
                    }
                }
            }
            .sheet(item: $preview) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
            .onChange(of: preview?.url) {
                old, new in if old != new, let old {
                    VaultModel.removePreview(old)
                }
            }
            .onDisappear {
                operation?.cancel(); if let preview {
                    VaultModel.removePreview(preview.url)
                }
            }
    }

    private func download(pdf: Bool) {
        busy = true; error = nil
        operation = Task {
            defer { busy = false }
            do {
                let url = try await model.nativeDownload(path + (pdf ? "/pdf" : "/text"), scope: .init(), record: filing, method: "GET", body: nil, suffix: pdf ? "pdf" : "txt")
                guard !Task.isCancelled else { VaultModel.removePreview(url); return }
                if pdf {
                    preview = .init(url: url)
                } else {
                    defer { VaultModel.removePreview(url) }; text = try String(contentsOf: url, encoding: .utf8)
                }
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

struct NativePoliticalFeed: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var data: VaultValue = .null
    @State private var error: String?
    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            if !data.isEmpty {
                Section("Collection") {
                    LabeledContent("Status", value: data["ok"].boolean ? "Cached activity available" : "No collection yet")
                    LabeledContent("Bills", value: String(data["bills"].array.count))
                    LabeledContent("Executive actions", value: String(data["executiveActions"].array.count))
                    LabeledContent("Trades", value: String(data["trades"]["trades"].array.count))
                    LabeledContent("Checked", value: data["checkedAt"].string)
                }
            }
            Section("Browse activity") {
                NavigationLink("Research radar") { NativePoliticalResearchView() }
                NavigationLink("Bills") { NativePoliticalArchive(kind: "bills") }
                NavigationLink("Executive actions") { NativePoliticalArchive(kind: "executiveActions") }
                NavigationLink("Disclosed trades") { NativePoliticalArchive(kind: "trades") }
                NavigationLink("Filing archive") { NativePoliticalArchive(kind: "filings") }
            }
            NavigationLink("Feed data and collection status") { NativeResourceView(resource: resource, scope: .init()) }
        }.task {
            do {
                let value = try await model.nativeRequest(resource.path, scope: .init())
                guard !Task.isCancelled else { return }
                data = value
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

private struct FilingPreview: Identifiable {
    let url: URL
    var id: String {
        url.absoluteString
    }
}
