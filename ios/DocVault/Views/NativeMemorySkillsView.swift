import SwiftUI

struct NativeBrainView: View {
    @Environment(VaultModel.self) private var model
    @State private var value: VaultValue = .null
    @State private var error: String?
    @State private var loading = true
    @State private var editing = false
    @State private var appending = false
    @State private var clearing = false
    @State private var busy = false
    @State private var generation = UUID()
    @State private var formatted = true
    private let color = Color.purple
    private var stats: NativeMarkdownStats {
        .init(value["content"].string)
    }

    var body: some View {
        List {
            VaultHero(title: "Your assistant's memory", subtitle: "Keep the facts, preferences and decisions you want available in every conversation.", symbol: "brain", color: color, eyebrow: "MANAGE / BRAIN").vaultStandaloneRow()
            if loading {
                ProgressView("Loading memory…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !value.isEmpty {
                VaultMetricGrid(metrics: [
                    .init(title: "Words", value: String(stats.words), symbol: "text.word.spacing"),
                    .init(title: "Saved bytes", value: NativeOperations.number(value["bytes"]).map { NativeBusiness.number($0) } ?? "Unavailable", symbol: "doc"),
                    .init(title: "Headings", value: String(stats.headings), symbol: "textformat.size"),
                    .init(title: "Lines", value: String(stats.lines), symbol: "text.alignleft"),
                ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("brainMetrics")
                LabeledContent("Last saved", value: NativeOperations.timestamp(value["updatedAt"]))
                if !stats.sections.isEmpty {
                    VaultAmountChart(title: "Memory by section", subtitle: "Whitespace-separated words, including Markdown. This describes saved text, not assistant performance.", amounts: stats.sections, color: color, identifier: "brainSectionChart", cardPrefix: "adminCard-", unit: .number("words")).vaultStandaloneRow()
                }
                Section("Saved memory") {
                    if value["content"].string.isEmpty {
                        ContentUnavailableView("No memory yet", systemImage: "brain", description: Text("Write your preferences or append a note to start."))
                    } else {
                        Picker("Reading", selection: $formatted) { Text("Formatted").tag(true); Text("Plain text").tag(false) }.pickerStyle(.segmented).accessibilityIdentifier("brainReading")
                        if formatted {
                            NativeRichText(text: value["content"].string).padding(4).accessibilityIdentifier("brainSavedContent")
                        } else {
                            Text(value["content"].string).font(.system(.body, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("brainSavedContent")
                        }
                        ShareLink(item: value["content"].string) { Label("Share saved memory", systemImage: "square.and.arrow.up") }
                    }
                }
                Section {
                    Button("Edit memory", systemImage: "pencil") { editing = true }.accessibilityIdentifier("brainEdit")
                    Button("Append a note", systemImage: "text.badge.plus") { appending = true }.accessibilityIdentifier("brainAppend")
                    Button("Clear memory", systemImage: "trash", role: .destructive) { clearing = true }.disabled(value["content"].string.isEmpty || busy).accessibilityIdentifier("brainClear")
                }.disabled(busy)
            }
        }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeBrain")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Menu { Button("Edit memory") { editing = true }; Button("Append a note") { appending = true } } label: { Image(systemName: "pencil") }.accessibilityLabel("Memory actions").accessibilityIdentifier("brainActions").disabled(loading || value.isEmpty || busy) } }
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(isPresented: $editing) { NativeInstructionEditor(kind: .brain, original: value).privacyProtected() }
            .sheet(isPresented: $appending) { NativeInstructionEditor(kind: .append, original: .object([:])).privacyProtected() }
            .alert("Clear the brain?", isPresented: $clearing) {
                Button("Clear memory", role: .destructive) { Task { await clear() } }.accessibilityIdentifier("confirmBrainClear")
                Button("Cancel", role: .cancel) {}
            } message: { Text("This permanently removes the memory used in every chat. It cannot be undone.") }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let next = try await model.nativeRequest("api/brain", scope: .init())
            guard !Task.isCancelled, generation == id else { return }; value = next
        } catch {
            if !Task.isCancelled, generation == id {
                self.error = error.localizedDescription
            }
        }
    }

    private func clear() async {
        busy = true; error = nil; defer { busy = false }
        do {
            let fresh = try await model.nativeRequest("api/brain", scope: .init())
            guard fresh["content"] == value["content"] else { throw VaultError.server("Memory changed on the server. Reload before clearing it.") }
            value = try await model.nativeRequest("api/brain", scope: .init(), method: "DELETE"); model.revision += 1
        } catch { self.error = error.localizedDescription }
    }
}

enum NativeInstructionKind { case brain, append, skill }

struct NativeInstructionEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let kind: NativeInstructionKind
    let original: VaultValue
    let isNew: Bool
    @State private var name: String
    @State private var description: String
    @State private var content: String
    @State private var tag = ""
    @State private var saving = false
    @State private var error: String?
    @State private var discard = false
    @State private var formatted = false
    @FocusState private var focused: String?

    init(kind: NativeInstructionKind, original: VaultValue, isNew: Bool = false) {
        self.kind = kind; self.original = original; self.isNew = isNew
        _name = State(initialValue: original["name"].string)
        _description = State(initialValue: original["description"].string)
        _content = State(initialValue: original[kind == .brain ? "content" : "instructions"].string)
    }

    private var title: String {
        kind == .brain ? "Edit memory" : kind == .append ? "Append a note" : isNew ? "New skill" : "Edit skill"
    }

    private var dirty: Bool {
        content != original[kind == .brain ? "content" : "instructions"].string || description != original["description"].string || name != original["name"].string || !tag.isEmpty
    }

    private var canSave: Bool {
        if kind == .brain {
            return dirty
        }
        if kind == .append {
            return !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return dirty && NativeAdministration.skillError(name: name.trimmingCharacters(in: .whitespacesAndNewlines), description: description, instructions: content) == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("instructionError")
                }
                if kind == .skill {
                    Section("Skill") {
                        LabeledContent("Name") { TextField("document-review", text: $name).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(!isNew).focused($focused, equals: "name").accessibilityIdentifier("instructionName") }
                        Text(isNew ? "1–64 lowercase letters, digits or hyphens. Start with a letter or digit." : "Mention $" + name + " in chat.").font(.caption).foregroundStyle(.secondary)
                        VStack(alignment: .leading) { Text("Description").font(.caption).foregroundStyle(.secondary); TextField("When should the assistant use this skill?", text: $description, axis: .vertical).focused($focused, equals: "description").accessibilityIdentifier("instructionDescription") }
                    }
                }
                if kind == .append {
                    Section("Optional tag") { TextField("preference, decision, context…", text: $tag).focused($focused, equals: "tag").accessibilityIdentifier("instructionTag") }
                }
                Section(kind == .brain ? "Memory" : kind == .append ? "Note" : "Instructions") {
                    Picker("Reading style", selection: $formatted) { Text("Write").tag(false); Text("Preview").tag(true) }.pickerStyle(.segmented).accessibilityIdentifier("instructionReading")
                    if formatted {
                        NativeRichText(text: content).frame(minHeight: 260, alignment: .topLeading).accessibilityIdentifier("instructionPreview")
                    } else {
                        TextEditor(text: $content).font(.system(.body, design: .monospaced)).frame(minHeight: 300).focused($focused, equals: "content").accessibilityIdentifier("instructionContent").accessibilityLabel(kind == .brain ? "Memory" : "Instructions")
                    }
                    Text("\(content.utf8.count) bytes · \(NativeMarkdownStats(content).words) words").font(.caption).foregroundStyle(.secondary)
                }
                Section { Text(dirty ? "Unsaved changes" : "All changes saved").font(.caption).foregroundStyle(.secondary) }
                if kind != .append {
                    Button("Revert edits", systemImage: "arrow.uturn.backward") { name = original["name"].string; description = original["description"].string; content = original[kind == .brain ? "content" : "instructions"].string; error = nil }.disabled(!dirty).accessibilityIdentifier("instructionRevert")
                }
            }.disabled(saving).vaultDashboard(color: .purple).navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("instructionCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { Task { await save() } }.disabled(!canSave || saving).accessibilityIdentifier("instructionSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { focused = nil }.accessibilityIdentifier("instructionKeyboardDone") }
                }
                .interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard unsaved changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() }.accessibilityIdentifier("instructionDiscard"); Button("Keep editing", role: .cancel) {} }
        }
    }

    private func save() async {
        saving = true; error = nil; defer { saving = false }
        do {
            if kind == .brain {
                let fresh = try await model.nativeRequest("api/brain", scope: .init())
                guard fresh["content"] == original["content"] else { throw VaultError.server("Memory changed on the server. Your draft is kept; reload before replacing it.") }
                _ = try await model.nativeRequest("api/brain", scope: .init(), method: "PUT", body: .object(["content": .string(content)]))
            } else if kind == .append {
                _ = try await model.nativeRequest("api/brain/append", scope: .init(), method: "POST", body: .object(["text": .string(content), "tag": .string(tag)]))
            } else {
                let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
                if let message = NativeAdministration.skillError(name: clean, description: description, instructions: content) {
                    throw VaultError.server(message)
                }
                let record: VaultValue = .object(["name": .string(clean)])
                if isNew {
                    let list = try await model.nativeRequest("api/skills", scope: .init())
                    guard !list["skills"].array.contains(where: { $0["name"].string == clean }) else { throw VaultError.server("A skill named \(clean) already exists. Your draft is kept.") }
                } else {
                    let fresh = try await model.nativeRequest("api/skills/{name}", scope: .init(), record: record)
                    guard fresh["description"] == original["description"], fresh["instructions"] == original["instructions"] else { throw VaultError.server("This skill changed on the server. Your draft is kept; reload before replacing it.") }
                }
                _ = try await model.nativeRequest("api/skills/{name}", scope: .init(), record: record, method: "PUT", body: .object(["description": .string(description), "instructions": .string(content)]))
            }
            model.revision += 1; dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeSkillsView: View {
    @Environment(VaultModel.self) private var model
    @State private var rows: [VaultValue] = []
    @State private var query = ""
    @State private var recent = false
    @State private var creating = false
    @State private var loading = true
    @State private var error: String?
    @State private var generation = UUID()
    private var filtered: [VaultValue] {
        NativeAdministration.skills(rows, query: query, recent: recent)
    }

    var body: some View {
        List {
            VaultHero(title: "Reusable instructions", subtitle: "Browse your skill library, read the full instructions and mention a skill by its $name in chat.", symbol: "graduationcap", color: .purple, eyebrow: "MANAGE / SKILLS").vaultStandaloneRow()
            if loading {
                ProgressView("Loading skills…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !loading, error == nil {
                VaultMetricGrid(metrics: [
                    .init(title: "Skills", value: String(rows.count), symbol: "graduationcap"),
                    .init(title: "Known saved bytes", value: NativeFinance.totals(rows.map { NativeOperations.number($0["bytes"]) }).net.map { NativeBusiness.number($0) } ?? "Unavailable", symbol: "doc"),
                ], color: .purple).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("skillsMetrics")
                VaultAmountChart(title: "Instruction file sizes", subtitle: "Saved SKILL.md bytes, including frontmatter. File size does not indicate effectiveness.", amounts: rows.compactMap { row in NativeOperations.number(row["bytes"]).map { .init(label: row["name"].string, amount: $0) } }, color: .purple, identifier: "skillsSizeChart", cardPrefix: "adminCard-", unit: .number("bytes")).vaultStandaloneRow()
                Section("Skill library") {
                    Picker("Sort", selection: $recent) { Text("Name").tag(false); Text("Recently updated").tag(true) }.accessibilityIdentifier("skillsSort")
                    ForEach(filtered, id: \.self) { row in
                        NavigationLink { NativeSkillDetailView(summary: row) } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                Text("$" + row["name"].string).font(.headline).foregroundStyle(.purple).fixedSize(horizontal: false, vertical: true)
                                Text(row["description"].string.isEmpty ? "No description" : row["description"].string).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                                Text(NativeOperations.timestamp(row["updatedAt"])).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 5)
                        }.accessibilityIdentifier("skill-" + row["name"].string)
                    }
                    if filtered.isEmpty {
                        ContentUnavailableView(rows.isEmpty ? "No skills yet" : "No matching skills", systemImage: "graduationcap", description: Text(rows.isEmpty ? "Create instructions for a workflow you repeat." : "Try another name or description."))
                    }
                    Button("New skill", systemImage: "plus.circle") { creating = true }.accessibilityIdentifier("skillsCreate")
                }
            }
        }.vaultDashboard(color: .purple).tint(.purple).searchable(text: $query, prompt: "Find a skill or description").accessibilityIdentifier("nativeSkills")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel("New skill").accessibilityIdentifier("skillsCreateToolbar").disabled(loading || error != nil) } }
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(isPresented: $creating) { NativeInstructionEditor(kind: .skill, original: .object([:]), isNew: true).privacyProtected() }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do { let next = try await model.nativeRequest("api/skills", scope: .init()); guard generation == id, !Task.isCancelled else { return }; rows = next["skills"].array }
        catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeSkillDetailView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let summary: VaultValue
    @State private var value: VaultValue = .null
    @State private var error: String?
    @State private var loading = true
    @State private var editing = false
    @State private var deleting = false
    @State private var busy = false
    @State private var formatted = true

    var body: some View {
        List {
            if loading {
                ProgressView("Loading instructions…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !value.isEmpty {
                VaultHero(title: "$" + value["name"].string, subtitle: value["description"].string, symbol: "graduationcap", color: .purple, eyebrow: "YOUR SKILL").vaultStandaloneRow()
                LabeledContent("Last saved", value: NativeOperations.timestamp(value["updatedAt"]))
                LabeledContent("Instruction words", value: String(NativeMarkdownStats(value["instructions"].string).words))
                Section("Instructions") {
                    Picker("Reading", selection: $formatted) { Text("Formatted").tag(true); Text("Plain text").tag(false) }.pickerStyle(.segmented).accessibilityIdentifier("skillReading")
                    if formatted {
                        NativeRichText(text: value["instructions"].string).accessibilityIdentifier("skillInstructions")
                    } else {
                        Text(value["instructions"].string).font(.system(.body, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("skillInstructions")
                    }
                }
                Section {
                    ShareLink(item: "$" + value["name"].string) { Label("Share mention", systemImage: "text.bubble") }
                    ShareLink(item: value["instructions"].string) { Label("Share instructions", systemImage: "square.and.arrow.up") }
                    Button("Edit skill", systemImage: "pencil") { editing = true }.accessibilityIdentifier("skillEdit")
                    Button("Delete skill", systemImage: "trash", role: .destructive) { deleting = true }.disabled(busy).accessibilityIdentifier("skillDelete")
                }
            }
        }.vaultDashboard(color: .purple).tint(.purple).navigationTitle(summary["name"].string).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeSkillDetail")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { editing = true } label: { Image(systemName: "pencil") }.accessibilityLabel("Edit skill").accessibilityIdentifier("skillEditToolbar").disabled(loading || value.isEmpty || busy) } }
            .task(id: model.revision) { await load() }
            .sheet(isPresented: $editing) { NativeInstructionEditor(kind: .skill, original: value).privacyProtected() }
            .alert("Delete this skill?", isPresented: $deleting) { Button("Delete skill", role: .destructive) { Task { await remove() } }.accessibilityIdentifier("confirmSkillDelete"); Button("Cancel", role: .cancel) {} } message: { Text("The skill and its supporting files are permanently removed. This cannot be undone.") }
    }

    private func load() async {
        loading = true; error = nil; defer { loading = false }
        do { let next = try await model.nativeRequest("api/skills/{name}", scope: .init(), record: summary); guard !Task.isCancelled else { return }; value = next }
        catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func remove() async {
        busy = true; error = nil; defer { busy = false }
        do {
            let fresh = try await model.nativeRequest("api/skills/{name}", scope: .init(), record: summary)
            guard fresh["description"] == value["description"], fresh["instructions"] == value["instructions"] else { throw VaultError.server("This skill changed on the server. Reload before deleting it.") }
            _ = try await model.nativeRequest("api/skills/{name}", scope: .init(), record: summary, method: "DELETE"); model.revision += 1; dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
