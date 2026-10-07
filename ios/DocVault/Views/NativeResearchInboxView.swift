import SwiftUI

struct NativeResearchInboxView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var section = "Overview"
    @State private var media = "All"
    @State private var status = "All"
    @State private var publisher: String?
    @State private var choosingFilters = false
    @State private var editor: NativeEditor?
    @State private var importing: String?
    @State private var generation = UUID()
    private var domain: ResearchDomain {
        ResearchDomain.resource(resource) ?? .finance
    }

    private var report: NativeResearch {
        .init(data: data, domain: domain)
    }

    private var color: Color {
        domain == .local ? .pink : domain == .health ? .teal : .indigo
    }

    private var rows: [ResearchRecord] {
        report.filtered(search: search, media: media, status: status, publisher: publisher)
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: domain.title + " research, connected", subtitle: "Read saved sources, inspect their claims and build your research library.", symbol: "books.vertical.fill", color: color, eyebrow: domain.title.uppercased() + " / RESEARCH").vaultStandaloneRow().id("researchTop")
                if loading {
                    ProgressView("Loading saved sources…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !data.isEmpty {
                    if section == "Overview" {
                        VaultMetricGrid(metrics: [
                            .init(title: "Saved sources", value: String(report.entries.count), symbol: "doc.on.doc"),
                            .init(title: "Text available", value: String(report.entries.filter(\.hasText).count), symbol: "text.alignleft"),
                            .init(title: "Saved claims", value: String(report.claims), symbol: "text.quote"),
                            .init(title: "Processing", value: String(report.entries.filter(\.processing).count), symbol: "arrow.triangle.2.circlepath"),
                            .init(title: "Needs attention", value: String(report.entries.filter(\.needsAttention).count), symbol: "exclamationmark.triangle"),
                            .init(title: "Summary bullets", value: String(report.summaries), symbol: "list.bullet"),
                        ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("researchMetrics")
                        Text("Counts describe saved \(domain.title.lowercased()) records and extracted claims. They do not establish source reliability or that collection succeeded.").font(.caption).foregroundStyle(.secondary)
                        chart("Saved sources by month", report.monthly, "researchMonthlyChart", chronological: true)
                        chart("Sources by publisher", report.publishers, "researchPublisherChart")
                        chart("Source formats", report.mediaCounts, "researchMediaChart")
                        chart("Saved claim stances", report.stances, "researchStanceChart", suffix: "claims")
                        Button("Browse sources", systemImage: "books.vertical") { section = "Sources" }.accessibilityIdentifier("researchBrowseSources")
                    } else {
                        Button { choosingFilters = true } label: { Label("Filters · " + media + " · " + status, systemImage: "line.3.horizontal.decrease") }
                            .accessibilityIdentifier("researchFilters")
                        Text("\(rows.count) matching sources · " + domain.title + " inbox").font(.caption).foregroundStyle(.secondary)
                        if let publisher {
                            Text("Publisher · " + (publisher.isEmpty ? "Unspecified publisher" : publisher)).font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(rows) { row in
                            NavigationLink {
                                NativeResearchEntryView(record: row.value, resource: resource, scope: scope) { model.revision += 1 }
                            } label: { ResearchSourceCard(row: row, color: color) }.vaultStandaloneRow()
                                .accessibilityIdentifier("researchSource-" + row.value["id"].string)
                        }
                        if rows.isEmpty {
                            ContentUnavailableView("No matching sources", systemImage: "books.vertical", description: Text(report.entries.isEmpty ? "Import a document, transcript or article into this inbox." : "Change the format, state or search filters."))
                        }
                    }
                    Section("Add to " + domain.title) {
                        ForEach(resource.actions) { action in
                            Button(action.title, systemImage: action.id == "text" ? "text.badge.plus" : action.id == "youtube" ? "play.rectangle" : action.id == "pdf" ? "doc.badge.plus" : "waveform") {
                                if action.response == "upload" {
                                    importing = action.id
                                } else {
                                    editor = .init(action: action, record: .null, resource: resource)
                                }
                            }.accessibilityIdentifier("action-" + action.id)
                        }
                    }
                }
            }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeResearch-" + domain.rawValue)
                .searchable(text: $search, prompt: "Find a title, author, ticker or tag")
                .onChange(of: search) {
                    _, value in if !value.isEmpty {
                        section = "Sources"
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Overview") { section = "Overview" }
                            Button("Sources") { section = "Sources" }
                        } label: { Image(systemName: "books.vertical.circle") }.accessibilityLabel("Review, " + section).accessibilityIdentifier("researchReviewSection")
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("researchTop", anchor: .top) }
                .task(id: model.revision) { await load() }
                .task(id: report.entries.contains(where: \.processing)) {
                    guard report.entries.contains(where: \.processing) else { return }
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }
                        guard !Task.isCancelled else { return }
                        await load()
                    }
                }
                .refreshable { await load() }
                .sheet(item: $editor) { item in NativeEditorView(editor: item, scope: scope, context: data) { model.revision += 1 }.privacyProtected() }
                .sheet(isPresented: $choosingFilters) { NativeResearchFiltersView(media: $media, status: $status, publisher: $publisher, search: $search, publishers: Array(Set(report.entries.map { $0.value["publisher"].string })).sorted()).privacyProtected() }
                .sheet(isPresented: Binding(get: { importing != nil }, set: {
                    if !$0 {
                        importing = nil
                    }
                })) {
                    NativeResearchFileImportView(domain: domain, media: importing == "video") { model.revision += 1 }.privacyProtected()
                }
        }
    }

    private func chart(_ title: String, _ amounts: [TaxYearAmount], _ id: String, chronological: Bool = false, suffix: String = "sources") -> some View {
        VaultAmountChart(title: title, subtitle: domain.title + " inbox · saved observations", amounts: amounts, color: color, identifier: id, cardPrefix: "researchCard-", unit: .number(suffix), preserveOrder: chronological).vaultStandaloneRow()
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let value = try await model.nativeRequest(resource.path, scope: scope)
            guard generation == id, !Task.isCancelled else { return }
            data = value
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct NativeResearchFiltersView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var media: String
    @Binding var status: String
    @Binding var publisher: String?
    @Binding var search: String
    let publishers: [String]
    var body: some View {
        NavigationStack {
            Form {
                Section("Format") {
                    ForEach(["All", "PDF", "Text", "Audio", "Video", "Other"], id: \.self) { choice in
                        Button { media = choice } label: { HStack {
                            Text(choice == "All" ? "All formats" : choice); Spacer(); if media == choice {
                                Image(systemName: "checkmark").foregroundStyle(.indigo)
                            }
                        } }.foregroundStyle(.primary).accessibilityIdentifier("researchMedia-" + choice).accessibilityValue(media == choice ? "Selected" : "")
                    }
                }
                Section("Processing state") {
                    Picker("Text state", selection: $status) { ForEach(["All", "Text available", "Processing", "Needs attention", "No saved text"], id: \.self) { Text($0).tag($0) } }.pickerStyle(.navigationLink)
                }
                Section("Publisher") {
                    Picker("Publisher", selection: $publisher) {
                        Text("All publishers").tag(String?.none)
                        ForEach(publishers, id: \.self) { name in Text(name.isEmpty ? "Unspecified publisher" : name).tag(Optional(name)) }
                    }.pickerStyle(.navigationLink)
                }
                Button("Clear filters") { media = "All"; status = "All"; publisher = nil; search = "" }.accessibilityIdentifier("clearResearchFilters")
            }.navigationTitle("Research filters").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("closeResearchFilters") } }
        }
    }
}

private struct ResearchSourceCard: View {
    let row: ResearchRecord
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Label(row.media, systemImage: row.media == "PDF" ? "doc.richtext" : row.media == "Text" ? "text.alignleft" : "waveform"); Spacer(); Text(row.status) }
                .font(.caption.weight(.semibold)).foregroundStyle(row.needsAttention ? .orange : color)
            Text(row.title).font(.system(.title3, design: .rounded, weight: .bold)).lineLimit(3)
            Text([row.value["publisher"].string, row.value["author"].string, row.day].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            let labels = row.value["tickers"].array.map(\.string) + row.value["tags"].array.map { "#" + $0.string }
            if !labels.isEmpty {
                Text(labels.joined(separator: " · ")).font(.caption.weight(.medium)).foregroundStyle(color)
            }
            if row.hasText {
                Text(row.value["text"].string).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color)
    }
}
