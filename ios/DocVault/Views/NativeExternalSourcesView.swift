import SwiftUI

struct NativeExternalSourcesView: View {
    @Environment(VaultModel.self) private var model
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = true
    @State private var query = ""
    @State private var searching = false
    @State private var adding = false
    @State private var token = false
    @State private var generation = UUID()
    @State private var selectedRepo: VaultValue?
    private let color = Color.cyan
    private var repos: [VaultValue] {
        data["repos"].array
    }

    private var matching: [VaultValue] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return repos.filter { needle.isEmpty || ($0["name"].string + " " + $0["url"].string).localizedCaseInsensitiveContains(needle) }
    }

    var body: some View {
        List {
            VaultHero(title: "Your source library", subtitle: "Browse synced repositories, open Markdown pages and follow their links. Source files remain read-only.", symbol: "books.vertical", color: color, eyebrow: "MANAGE / EXTERNAL SOURCES").vaultStandaloneRow()
            if loading {
                ProgressView("Loading repositories…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                VaultMetricGrid(metrics: [
                    .init(title: "Repositories", value: String(repos.count), symbol: "point.3.connected.trianglepath.dotted"),
                    .init(title: "Saved syncs", value: String(repos.filter { !$0["lastSyncedAt"].string.isEmpty }.count), symbol: "clock.arrow.circlepath"),
                    .init(title: "Sync errors", value: String(repos.filter { !$0["lastError"].string.isEmpty }.count), symbol: "exclamationmark.triangle"),
                    .init(title: "Known indexed files", value: NativeFinance.totals(repos.map { NativeOperations.number($0["fileCount"]) }).net.map { NativeBusiness.number($0) } ?? "Unavailable", symbol: "doc.on.doc"),
                ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("sourcesMetrics")
                VaultAmountChart(title: "Repository status", subtitle: "Latest saved sync state. A past sync does not prove the repository is current.", amounts: NativeOperations.groups(repos, key: NativeAdministration.sourceOutcome), color: color, identifier: "sourcesStatusChart", cardPrefix: "adminCard-", unit: .number("repositories")).vaultStandaloneRow()
                VaultAmountChart(title: "Indexed Markdown files", subtitle: "Last recorded file counts. Unrecorded counts are excluded; browse a source to read its current local index.", amounts: repos.compactMap { row in NativeOperations.number(row["fileCount"]).map { .init(label: row["name"].string, amount: $0) } }, color: color, identifier: "sourcesFileChart", cardPrefix: "adminCard-", unit: .number("files")).vaultStandaloneRow()
                Section("Repositories") {
                    ForEach(matching, id: \.self) { repo in
                        Button { selectedRepo = repo } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 9) {
                                    Label(repo["name"].string, systemImage: "point.3.connected.trianglepath.dotted").font(.headline)
                                    Text(NativeAdministration.sourceOutcome(repo)).font(.subheadline).foregroundStyle(repo["lastError"].string.isEmpty ? color : .orange)
                                    Text("Last synced · " + NativeOperations.timestamp(repo["lastSyncedAt"])).font(.caption).foregroundStyle(.secondary)
                                    if !repo["lastError"].string.isEmpty {
                                        Text(repo["lastError"].string).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 5)
                        }.accessibilityIdentifier("source-" + repo["id"].string)
                    }
                    if repos.isEmpty {
                        ContentUnavailableView("No repositories yet", systemImage: "books.vertical", description: Text("Add an HTTPS repository, sync it and browse its Markdown pages."))
                    } else if matching.isEmpty {
                        ContentUnavailableView("No matching repositories", systemImage: "magnifyingglass", description: Text("Try another name or URL."))
                    }
                    Button("Add a repository", systemImage: "plus.circle") { adding = true }.accessibilityIdentifier("sourcesAdd")
                }
                Section("GitHub access") {
                    LabeledContent("Token", value: data["tokenConfigured"].boolean ? "Configured" : "Not configured")
                    Button("Manage GitHub token", systemImage: "key") { token = true }.accessibilityIdentifier("sourcesToken")
                    Text("The token is stored on the server and is never returned to the app.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }.vaultDashboard(color: color).tint(color).searchable(text: $query, isPresented: $searching, prompt: "Find a repository").accessibilityIdentifier("nativeExternalSources")
            .onSubmit(of: .search) {
                searching = false
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add a repository").accessibilityIdentifier("sourcesAddToolbar").disabled(loading || data.isEmpty) } }
            .sheet(isPresented: $adding) { NativeSourceSetupView(token: false, configured: false).privacyProtected() }
            .sheet(isPresented: $token) { NativeSourceSetupView(token: true, configured: data["tokenConfigured"].boolean).privacyProtected() }
            .navigationDestination(item: $selectedRepo) { repo in
                NativeSourceBrowserView(repo: repo, removed: { selectedRepo = nil })
            }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do { let next = try await model.nativeRequest("api/external-sources", scope: .init()); guard generation == id, !Task.isCancelled else { return }; data = next }
        catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeSourceSetupView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let token: Bool
    let configured: Bool
    @State private var name = ""
    @State private var url = ""
    @State private var branch = ""
    @State private var secret = ""
    @State private var error: String?
    @State private var saving = false
    @State private var discard = false
    @State private var clearing = false
    @FocusState private var focused: String?
    private var dirty: Bool {
        !name.isEmpty || !url.isEmpty || !branch.isEmpty || !secret.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("sourceSetupError")
                }
                if token {
                    Section("GitHub token") {
                        LabeledContent("Saved token", value: configured ? "Configured" : "Not configured")
                        SecureField("New token", text: $secret).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals: "token").accessibilityIdentifier("sourceTokenInput")
                        Text("Enter a replacement token. The saved value is never shown here.").font(.caption).foregroundStyle(.secondary)
                        if configured {
                            Button("Remove saved token", role: .destructive) { clearing = true }.accessibilityIdentifier("sourceTokenRemove")
                        }
                    }
                } else {
                    Section("Repository") {
                        VStack(alignment: .leading) { Text("HTTPS URL").font(.caption).foregroundStyle(.secondary); TextField("https://example.com/owner/repository.git", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals: "url").accessibilityIdentifier("sourceURLInput") }
                        LabeledContent("Name") { TextField("Optional display name", text: $name).focused($focused, equals: "name").accessibilityIdentifier("sourceNameInput") }
                        LabeledContent("Branch") { TextField("Repository default", text: $branch).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals: "branch").accessibilityIdentifier("sourceBranchInput") }
                        Text("Adding stores the connection. Sync it afterwards to clone its Markdown files.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.disabled(saving).vaultDashboard(color: .cyan).navigationTitle(token ? "GitHub access" : "Add repository").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("sourceSetupCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { Task { await save(clear: false) } }.disabled(saving || (token ? secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : NativeAdministration.repositoryURL(url) == nil)).accessibilityIdentifier("sourceSetupSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { focused = nil }.accessibilityIdentifier("sourceSetupKeyboardDone") }
                }.interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard unsaved changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() }; Button("Keep editing", role: .cancel) {} }
                .alert("Remove GitHub access?", isPresented: $clearing) { Button("Remove token", role: .destructive) { Task { await save(clear: true) } }.accessibilityIdentifier("confirmSourceTokenRemove"); Button("Cancel", role: .cancel) {} } message: { Text("Future private repository syncs will need a new token.") }
        }
    }

    private func save(clear: Bool) async {
        saving = true; error = nil; defer { saving = false }
        do {
            if token {
                let response = try await model.nativeRequest("api/external-sources/token", scope: .init(), method: "PUT", body: .object(["token": .string(clear ? "" : secret.trimmingCharacters(in: .whitespacesAndNewlines))]))
                guard response["tokenConfigured"] == .bool(!clear) else { throw VaultError.server("The server did not confirm the token change.") }
                secret = ""
            } else {
                guard let normalized = NativeAdministration.repositoryURL(url) else { throw VaultError.server("Enter an HTTPS repository URL.") }
                _ = try await model.nativeRequest("api/external-sources", scope: .init(), method: "POST", body: .object(["url": .string(normalized), "name": .string(name), "branch": .string(branch)]))
            }
            model.revision += 1; dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeSourceBrowserView: View {
    @Environment(VaultModel.self) private var model
    let repo: VaultValue
    let removed: () -> Void
    @State private var files: [String] = []
    @State private var folder = ""
    @State private var query = ""
    @State private var searching = false
    @State private var error: String?
    @State private var loading = true
    @State private var settings = false
    @State private var sourceRemoved = false
    @State private var current: VaultValue = .null
    @State private var generation = UUID()
    private var source: VaultValue {
        current.isEmpty ? repo : current
    }

    private var visible: (folders: [NativeSourceFolder], files: [String]) {
        NativeSourceFiles.browse(files, folder: folder, query: query)
    }

    var body: some View {
        List {
            VaultHero(title: source["name"].string, subtitle: "Read-only Markdown library · " + String(files.count) + " indexed pages", symbol: "folder", color: .cyan, eyebrow: "SOURCE LIBRARY").vaultStandaloneRow()
            if loading {
                ProgressView("Loading file index…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !source["lastError"].string.isEmpty {
                ErrorNotice(message: "Last sync failed: " + source["lastError"].string)
            }
            if !loading, error == nil {
                Section {
                    ScrollView(.horizontal) {
                        HStack {
                            Button("Root") { folder = ""; query = "" }.accessibilityIdentifier("sourceRoot")
                            ForEach(Array(folder.split(separator: "/").enumerated()), id: \.offset) { index, name in
                                Image(systemName: "chevron.right").font(.caption2).accessibilityHidden(true)
                                Button(String(name)) { folder = folder.split(separator: "/").prefix(index + 1).joined(separator: "/"); query = "" }
                            }
                        }.buttonStyle(.borderless).padding(.vertical, 5)
                    }.accessibilityIdentifier("sourceBreadcrumbs")
                    if !query.isEmpty {
                        Text("Searching all folders in this source.").font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(visible.folders) { item in
                        Button { folder = item.path } label: { HStack { Label(item.name, systemImage: "folder.fill"); Spacer(); Text(String(item.count) + " pages").font(.caption).foregroundStyle(.secondary); Image(systemName: "chevron.right").font(.caption) } }.accessibilityIdentifier("sourceFolder-" + item.path)
                    }
                    ForEach(visible.files, id: \.self) { path in
                        NavigationLink { NativeSourceReaderView(repo: source, files: files, initialPath: path) } label: { VStack(alignment: .leading, spacing: 6) { Label(NativeSourceFiles.basename(path), systemImage: "doc.text").fixedSize(horizontal: false, vertical: true); Text(path).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) } }.accessibilityIdentifier("sourceFile-" + path)
                    }
                    if visible.folders.isEmpty, visible.files.isEmpty {
                        ContentUnavailableView(files.isEmpty ? "No indexed pages" : "No matching files", systemImage: "doc.text.magnifyingglass", description: Text(files.isEmpty ? "Sync this source to index its Markdown files." : "Try another search or return to the root folder."))
                    }
                }
            }
        }.vaultDashboard(color: .cyan).tint(.cyan).navigationTitle(source["name"].string).navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, isPresented: $searching, prompt: "Find a Markdown file").accessibilityIdentifier("nativeSourceBrowser")
            .onSubmit(of: .search) {
                searching = false
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { settings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Manage repository").accessibilityIdentifier("sourceManage") } }
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(isPresented: $settings, onDismiss: {
                if sourceRemoved {
                    removed()
                }
            }) { NativeSourceManagementView(repo: source, removed: { sourceRemoved = true }).privacyProtected() }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            async let index = model.nativeRequest("api/external-sources/{id}/files", scope: .init(), record: repo)
            async let list = model.nativeRequest("api/external-sources", scope: .init())
            let (result, all) = try await (index, list)
            guard generation == id, !Task.isCancelled else { return }
            files = result["files"].array.compactMap {
                if case let .string(path) = $0, NativeSourceFiles.safePath(path) {
                    return path
                }; return nil
            }
            current = all["repos"].array.first { $0["id"] == repo["id"] } ?? repo
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeSourceManagementView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let repo: VaultValue
    let removed: () -> Void
    @State private var value: VaultValue
    @State private var busy = false
    @State private var error: String?
    @State private var syncing = false
    @State private var deleting = false
    init(repo: VaultValue, removed: @escaping () -> Void) {
        self.repo = repo; self.removed = removed; _value = State(initialValue: repo)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("sourceManagementError")
                }
                Section("Repository") {
                    LabeledContent("Name", value: value["name"].string)
                    LabeledContent("Branch", value: value["branch"].string.isEmpty ? "Repository default" : value["branch"].string)
                    Text(value["url"].string).font(.caption).textSelection(.enabled)
                    LabeledContent("Latest saved status", value: NativeAdministration.sourceOutcome(value))
                    LabeledContent("Last synced", value: NativeOperations.timestamp(value["lastSyncedAt"]))
                    LabeledContent("Indexed files", value: NativeOperations.number(value["fileCount"]).map { NativeBusiness.number($0) } ?? "Unavailable")
                    if !value["commit"].string.isEmpty {
                        LabeledContent("Saved commit", value: value["commit"].string)
                    }
                    if !value["lastError"].string.isEmpty {
                        ErrorNotice(message: value["lastError"].string)
                    }
                }
                Section {
                    Button(busy ? "Working…" : "Sync repository", systemImage: "arrow.triangle.2.circlepath") { syncing = true }.accessibilityIdentifier("sourceSync")
                    Button("Remove repository", systemImage: "trash", role: .destructive) { deleting = true }.accessibilityIdentifier("sourceRemove")
                    Text("Sync updates the server's clone. Brain and Skills are separate stores. Removing a source also removes its cloned files.").font(.caption).foregroundStyle(.secondary)
                }
            }.disabled(busy).vaultDashboard(color: .cyan).navigationTitle("Manage repository").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(busy).accessibilityIdentifier("sourceManagementDone") } }.interactiveDismissDisabled(busy)
                .alert("Sync this repository?", isPresented: $syncing) { Button("Sync") { Task { await act(remove: false) } }.accessibilityIdentifier("confirmSourceSync"); Button("Cancel", role: .cancel) {} } message: { Text("The server will clone or update this source from its remote repository.") }
                .alert("Remove this repository?", isPresented: $deleting) { Button("Remove repository", role: .destructive) { Task { await act(remove: true) } }.accessibilityIdentifier("confirmSourceRemove"); Button("Cancel", role: .cancel) {} } message: { Text("This removes the connection and its cloned files. The remote repository is unchanged.") }
        }
    }

    private func act(remove: Bool) async {
        busy = true; error = nil; defer { busy = false }
        do {
            let result = try await model.nativeRequest(remove ? "api/external-sources/{id}" : "api/external-sources/{id}/sync", scope: .init(), record: value, method: remove ? "DELETE" : "POST")
            model.revision += 1
            if remove {
                dismiss(); removed()
            } else {
                value = result; if !result["lastError"].string.isEmpty {
                    error = "Sync failed. The server retained its diagnostic."
                }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeSourceReaderView: View {
    @Environment(VaultModel.self) private var model
    let repo: VaultValue
    let files: [String]
    @State private var path: String
    @State private var history: [String] = []
    @State private var data: VaultValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var linkError: String?
    @State private var formatted = true
    @State private var generation = UUID()
    init(repo: VaultValue, files: [String], initialPath: String) {
        self.repo = repo; self.files = files; _path = State(initialValue: initialPath)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label("Read-only source", systemImage: "lock.doc").font(.caption).foregroundStyle(.cyan)
                Text(path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                if loading {
                    ProgressView("Loading page…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !data.isEmpty {
                    if data["truncated"].boolean {
                        ErrorNotice(message: "The server returned a shortened preview of this large file. This is not the complete source.")
                    }
                    Picker("Reading", selection: $formatted) { Text("Formatted").tag(true); Text("Plain text").tag(false) }.pickerStyle(.segmented).accessibilityIdentifier("sourceReading")
                    if formatted {
                        NativeRichText(text: NativeSourceFiles.linkifyWiki(data["content"].string), openLink: openLink, selectable: false).accessibilityIdentifier("sourceFormattedContent")
                    } else {
                        Text(data["content"].string).font(.system(.body, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("sourcePlainContent")
                    }
                    ShareLink(item: data["content"].string) { Label("Share returned text", systemImage: "square.and.arrow.up") }
                }
            }.padding(24).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity)
        }.vaultDashboard(color: .cyan).navigationTitle(NativeSourceFiles.basename(path)).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeSourceReader")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button {
                if let previous = history.popLast() {
                    path = previous
                }
            } label: { Image(systemName: "arrow.uturn.backward") }.accessibilityLabel("Previous page").accessibilityIdentifier("sourcePreviousPage").disabled(history.isEmpty) } }
            .task(id: path) { await load() }
            .alert("Page link", isPresented: Binding(get: { linkError != nil }, set: {
                if !$0 {
                    linkError = nil
                }
            })) { Button("OK") { linkError = nil } } message: { Text(linkError ?? "") }
    }

    private func openLink(_ url: URL) -> OpenURLAction.Result {
        if NativeResearch.sourceURL(.string(url.absoluteString)) != nil {
            return .systemAction
        }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let wiki = url.scheme == "docvault-source" && url.host == "wiki"
        guard wiki || (url.scheme == nil && url.host == nil) else { return .discarded }
        let target = wiki ? components?.queryItems?.first { $0.name == "target" }?.value ?? "" : url.relativeString
        guard let next = NativeSourceFiles.resolve(target, current: path, files: files, wiki: wiki) else { linkError = "This page is missing or its name matches more than one file in this repository."; return .handled }
        if next != path {
            history.append(path); path = next
        }
        return .handled
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil; data = .null
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            var record = repo; record.set("sourcePath", .string(path))
            let result = try await model.nativeRequest("api/external-sources/{id}/file?path={sourcePath}", scope: .init(), record: record)
            guard generation == id, !Task.isCancelled else { return }
            guard case .string = result["content"] else { throw VaultError.server("The server did not return source text.") }; data = result
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
