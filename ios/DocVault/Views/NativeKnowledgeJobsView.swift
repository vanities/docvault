import SwiftUI
import UniformTypeIdentifiers

struct NativeKnowledgeJobsView: View {
    @Environment(VaultModel.self) private var model
    let kind: KnowledgeKind
    @State private var rows: [VaultValue] = []
    @State private var loaded = false
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var state = "All"
    @State private var type = "All"
    @State private var section = "Overview"
    @State private var composing = false
    @State private var created: VaultValue?
    @State private var openCreated = false
    @State private var generation = UUID()
    private var color: Color {
        kind == .news ? .orange : .indigo
    }

    private var filtered: [VaultValue] {
        rows.filter { (state == "All" || $0["status"].string == state.lowercased()) && (type == "All" || (type == "Samples" ? $0["sample"].boolean : !$0["sample"].boolean && $0["editionType"].string == type.lowercased())) && (search.isEmpty || [kind.recordTitle($0), kind.date($0), $0["title"].string, $0["theme"].string].joined(separator: " ").localizedCaseInsensitiveContains(search)) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: kind == .news ? "Your daily reading, beautifully collected" : "Follow a question all the way to its sources", subtitle: kind == .news ? "Read editions, review the source ledger and listen to saved narration." : "Start a research job, track its progress and read the cited report.", symbol: kind == .news ? "newspaper.fill" : "sparkle.magnifyingglass", color: color, eyebrow: kind == .news ? "KNOWLEDGE / NEWSSTAND" : "KNOWLEDGE / DEEP RESEARCH").vaultStandaloneRow().id("knowledgeTop")
                Button(kind == .news ? "Generate an edition" : "Start research", systemImage: "plus.circle.fill") { composing = true }.accessibilityIdentifier("knowledgeCreate")
                if loading {
                    ProgressView("Loading history…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if loaded {
                    if section == "Overview" {
                        VaultMetricGrid(metrics: [
                            .init(title: "Saved", value: String(rows.count), symbol: "books.vertical"),
                            .init(title: "Completed", value: String(rows.filter { $0["status"].string == "done" }.count), symbol: "checkmark.circle"),
                            .init(title: "Running", value: String(rows.filter { $0["status"].string == "running" }.count), symbol: "arrow.triangle.2.circlepath"),
                            .init(title: "Failed", value: String(rows.filter { $0["status"].string == "error" }.count), symbol: "exclamationmark.triangle"),
                            .init(title: kind == .news ? "Saved digest items" : "Cited sources", value: kind.knownItems(rows).map { $0.formatted(.number.precision(.fractionLength(0))) } ?? "Unavailable", symbol: "link"),
                            .init(title: kind == .news ? "Theme samples" : "Recorded searches", value: kind == .news ? String(rows.filter { $0["sample"].boolean }.count) : NativeBusiness.sum(rows.filter { $0["status"].string == "done" }.map { NativeResearch.count($0["searchCount"]).map(Double.init) }).map { $0.formatted(.number.precision(.fractionLength(0))) } ?? "Unavailable", symbol: kind == .news ? "paintpalette" : "magnifyingglass"),
                        ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("knowledgeMetrics")
                        Text("Totals describe saved records. News item totals exclude theme samples; saved source counts do not establish collection health or accuracy.").font(.caption).foregroundStyle(.secondary)
                        VaultAmountChart(title: "Activity by month", subtitle: "Saved " + kind.title.lowercased(), amounts: kind.monthly(rows), color: color, identifier: "knowledgeMonthlyChart", cardPrefix: "knowledgeCard-", unit: .number("records"), preserveOrder: true).vaultStandaloneRow()
                        VaultAmountChart(title: "Job states", subtitle: "Current saved states", amounts: kind.statuses(rows), color: color, identifier: "knowledgeStatusChart", cardPrefix: "knowledgeCard-", unit: .number("records")).vaultStandaloneRow()
                        Button("Browse history", systemImage: "clock") { section = "History" }.accessibilityIdentifier("knowledgeBrowseHistory")
                    } else {
                        Menu {
                            Picker("State", selection: $state) { ForEach(["All", "Done", "Running", "Error"], id: \.self) { Text($0) } }
                            if kind == .news {
                                Picker("Edition", selection: $type) { ForEach(["All", "Daily", "Weekly", "Samples"], id: \.self) { Text($0) } }
                            }
                            Button("Clear filters") { search = ""; state = "All"; type = "All" }
                        } label: { Label("Filters · " + state + (kind == .news ? " · " + type : ""), systemImage: "line.3.horizontal.decrease") }.accessibilityIdentifier("knowledgeFilters")
                        Text("\(filtered.count) matching records").font(.caption).foregroundStyle(.secondary)
                        ForEach(Array(filtered.enumerated()), id: \.offset) { _, row in
                            NavigationLink { NativeKnowledgeDetailView(kind: kind, record: row) { model.revision += 1 } } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(kind.recordTitle(row)).font(.system(.title3, design: .rounded, weight: .bold)).lineLimit(3)
                                    Text(kind.date(row) + " · " + row["status"].string.capitalized).font(.caption.weight(.semibold)).foregroundStyle(row["status"].string == "error" ? .orange : color)
                                    if kind == .news, !row["theme"].isEmpty {
                                        Text(row["theme"].string).font(.caption).foregroundStyle(.secondary)
                                    }
                                    if let count = kind.itemCount(row) {
                                        Text("\(count) " + (kind == .news ? "saved digest items" : "cited sources")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    if !row["error"].isEmpty {
                                        Text(row["error"].string).font(.caption).foregroundStyle(.orange).lineLimit(2)
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color)
                            }.vaultStandaloneRow().accessibilityIdentifier("knowledgeRecord-" + row["id"].string)
                        }
                        if filtered.isEmpty {
                            ContentUnavailableView("No matching history", systemImage: "books.vertical", description: Text(rows.isEmpty ? "Start a job to create your first saved record." : "Adjust your search or filters."))
                        }
                    }
                }
            }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeKnowledge-" + kind.rawValue)
                .searchable(text: $search, prompt: kind == .news ? "Find an edition or theme" : "Find a question")
                .onChange(of: search) {
                    _, value in if !value.isEmpty {
                        section = "History"
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("knowledgeTop", anchor: .top) }
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Menu { Button("Overview") { section = "Overview" }; Button("History") { section = "History" } } label: { Image(systemName: "books.vertical.circle") }.accessibilityLabel("Review, " + section).accessibilityIdentifier("knowledgeReviewSection") } }
                .task(id: model.revision) { await load() }.refreshable { await load() }
                .task(id: rows.contains { $0["status"].string == "running" }) {
                    guard rows.contains(where: { $0["status"].string == "running" }) else { return }
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }; await load()
                    }
                }
                .sheet(isPresented: $composing, onDismiss: {
                    if created != nil {
                        openCreated = true
                    }
                }) {
                    NativeKnowledgeComposer(kind: kind) { row in created = row; model.revision += 1 }.privacyProtected()
                }
                .navigationDestination(isPresented: $openCreated) {
                    if let created {
                        NativeKnowledgeDetailView(kind: kind, record: created) { model.revision += 1 }
                    }
                }
                .onChange(of: openCreated) {
                    _, value in if !value {
                        created = nil
                    }
                }
        }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do { let value = try await model.nativeRequest(kind.path, scope: .init()); guard generation == id, !Task.isCancelled else { return }; rows = value[kind.listKey].array; loaded = true }
        catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeKnowledgeComposer: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let kind: KnowledgeKind
    let created: (VaultValue?) -> Void
    @State private var question = ""
    @State private var searches = 18
    @State private var type = "daily"
    @State private var attachments: [VaultValue] = []
    @State private var filenames: [String] = []
    @State private var picker = false
    @State private var preparing = false
    @State private var busy = false
    @State private var error: String?
    @State private var themes: [VaultValue] = []
    @State private var task: Task<Void, Never>?
    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error)
                }
                if kind == .research {
                    Section("Research question") {
                        TextEditor(text: $question).frame(minHeight: 130).accessibilityIdentifier("researchQuestion")
                        Text("Ask a question or attach an image. An image alone starts an identification and research task.").font(.caption).foregroundStyle(.secondary)
                        Stepper("Maximum searches · \(searches)", value: $searches, in: 1 ... 30).accessibilityIdentifier("researchSearchLimit")
                    }
                    Section("Image attachments") {
                        Button("Attach images", systemImage: "photo.badge.plus") { picker = true }.accessibilityIdentifier("researchAttachImages").disabled(busy || preparing || attachments.count >= 8)
                        Text("PNG, JPEG, GIF or WebP · up to 8 images, 10 MB each").font(.caption).foregroundStyle(.secondary)
                        ForEach(Array(filenames.enumerated()), id: \.offset) { index, filename in
                            HStack { Text(filename); Spacer(); Button("Remove", systemImage: "xmark.circle") { attachments.remove(at: index); filenames.remove(at: index) }.labelStyle(.iconOnly).accessibilityLabel("Remove " + filename).disabled(busy || preparing) }
                        }
                        if preparing {
                            ProgressView("Preparing attachments…")
                        }
                    }
                } else {
                    Section("Edition") {
                        Picker("Edition type", selection: $type) { Text("Daily edition").tag("daily"); Text("Weekly deep-dive").tag("weekly") }.accessibilityIdentifier("newsEditionType")
                        Text("Generation runs on your server and uses its configured sources and providers. Manual generation does not automatically email the edition.").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Theme samples") {
                        Text("Queue one sample per theme to compare the newspaper styles. Samples stay separate from regular edition totals.").font(.caption).foregroundStyle(.secondary)
                        ForEach(Array(themes.enumerated()), id: \.offset) { _, theme in Text(theme["label"].string.isEmpty ? theme["id"].string : theme["label"].string) }
                        Button("Generate theme samples") { task = Task { await start(samples: true) } }.accessibilityIdentifier("newsThemeSamples").disabled(busy)
                    }
                }
                if busy {
                    ProgressView("Starting server job…")
                }
                Button(kind == .research ? "Start research" : "Generate edition") { task = Task { await start() } }.accessibilityIdentifier("knowledgeSubmit").disabled(busy || preparing || (kind == .research && question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty))
            }.navigationTitle(kind == .research ? "New research" : "New edition").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(busy || preparing) }; ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("nativeFormKeyboardDone") } }
                .interactiveDismissDisabled(busy || preparing)
                .fileImporter(isPresented: $picker, allowedContentTypes: [.png, .jpeg, .gif, .webP], allowsMultipleSelection: true) { result in
                    switch result { case let .success(urls): task = Task { await prepare(urls) }; case let .failure(error): self.error = error.localizedDescription }
                }
                .task {
                    if kind == .news {
                        do { themes = try await model.nativeRequest("api/daily-news/themes", scope: .init())["themes"].array } catch { self.error = error.localizedDescription }
                    }
                }
                .onDisappear { task?.cancel(); attachments = []; filenames = [] }
        }
    }

    private func prepare(_ urls: [URL]) async {
        preparing = true; error = nil; defer { preparing = false }
        for url in urls {
            guard !Task.isCancelled else { return }
            guard attachments.count < 8 else { error = "Up to eight images can be attached."; return }
            do {
                let draft = try await UploadDraft.stageAsync(url, maximumSize: 10 * 1024 * 1024)
                defer { draft.removeStagedFiles() }
                guard !Task.isCancelled, let file = draft.fileURL else { return }
                guard ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(draft.contentType) else { throw VaultError.server("Use PNG, JPEG, GIF or WebP images.") }
                let bytes = try Data(contentsOf: file)
                attachments.append(.object(["mimeType": .string(draft.contentType), "dataUrl": .string("data:" + draft.contentType + ";base64," + bytes.base64EncodedString())])); filenames.append(draft.name)
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func start(samples: Bool = false) async {
        busy = true; error = nil; defer { busy = false }
        do {
            let body: VaultValue = kind == .research ? .object(["question": .string(question), "maxSearches": .number(Double(searches)), "attachments": .array(attachments)]) : .object(["editionType": .string(type)])
            let value = try await model.nativeRequest(kind.path + (samples ? "/sample-themes" : "/run"), scope: .init(), method: "POST", body: body)
            guard !Task.isCancelled else { return }
            if samples {
                guard !value["ids"].array.isEmpty else { throw VaultError.server("No theme jobs were acknowledged.") }; created(nil)
            } else {
                guard !value["id"].isEmpty else { throw VaultError.server("No job was acknowledged. Refresh history before retrying.") }; created(value)
            }
            dismiss()
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
