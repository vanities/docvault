import SwiftUI

private struct ProviderEditorSnapshot: Identifiable {
    let group: NativeSettingsGroup
    let settings: VaultValue
    var id: String { group.id }
}

private struct ProviderCredentialSnapshot {
    let credential: NativeCredential
    let settings: VaultValue
}

struct NativeProviderSettingsView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var data: VaultValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var generation = UUID()
    @State private var editor: ProviderEditorSnapshot?
    @State private var testSettings: VaultValue = .null
    @State private var people: [VaultValue] = []
    @State private var clearing: ProviderCredentialSnapshot?
    @State private var confirmClear = false
    @State private var confirmTest = false
    @State private var busy = false
    @State private var feedback: String?
    private let color = Color.indigo
    private var credentials: [NativeCredential] {
        NativeProviderSettings.credentials(resource)
    }

    var body: some View {
        List {
            VaultHero(title: resource.title, subtitle: "Review saved preferences and configure each service with focused native editors.", symbol: resource.id == "email" ? "envelope.badge" : "slider.horizontal.3", color: color, eyebrow: "MANAGE / SETTINGS").vaultStandaloneRow()
            if loading {
                ProgressView("Loading saved preferences…")
            }
            if busy {
                ProgressView("Waiting for the server…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if let feedback {
                Text(feedback).font(.callout).accessibilityIdentifier("providerSettingsFeedback")
            }
            if !data.isEmpty {
                VaultMetricGrid(metrics: [
                    .init(title: "Configured credentials", value: String(credentials.filter { $0.state(data) == "Configured" }.count), symbol: "key"),
                    .init(title: "Preference groups", value: String(NativeProviderSettings.groups(resource).count), symbol: "slider.horizontal.3"),
                ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("providerSettingsMetrics")
                if !credentials.isEmpty {
                    VaultAmountChart(title: "Credential configuration", subtitle: "Reported configuration flags describe saved settings, not provider availability.", amounts: ["Configured", "Not configured", "Unreported"].compactMap { status in
                        let count = credentials.filter { $0.state(data) == status }.count
                        return count == 0 ? nil : .init(label: status, amount: Double(count))
                    }, color: color, identifier: "providerCredentialChart", cardPrefix: "providerCard-", unit: .number("credentials")).vaultStandaloneRow()
                    ForEach(credentials) { credential in
                        VStack(alignment: .leading, spacing: 14) {
                            Label(credential.title, systemImage: "key.horizontal").font(.headline)
                            LabeledContent("Saved state", value: credential.state(data))
                            if credential.id == "anthropicKey", !data["keySource"].string.isEmpty {
                                LabeledContent("Source", value: data["keySource"].string == "env" ? "Server environment" : "Saved settings")
                            }
                            if credential.id == "anthropicAuthToken", !data["authSource"].string.isEmpty {
                                LabeledContent("Source", value: data["authSource"].string == "env" ? "Server environment" : "Saved settings")
                            }
                            Text("Saved secrets are never populated in the editor. Leaving its field empty preserves the credential.").font(.caption).foregroundStyle(.secondary)
                            Button("Replace credential", systemImage: "square.and.pencil") {
                                edit(.init(id: credential.id, title: credential.title, note: "Enter a new credential to replace the saved value. An empty field leaves it unchanged.", fields: resource.editFields.filter { $0.id == credential.id }))
                            }.accessibilityIdentifier("providerReplace-" + credential.id).disabled(loading || busy)
                            Button("Remove saved credential…", role: .destructive) { clearing = .init(credential: credential, settings: data); confirmClear = true }.disabled(loading || busy || credential.state(data) != "Configured").accessibilityIdentifier("providerRemove-" + credential.id)
                        }.buttonStyle(.borderless).frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("providerCredential-" + credential.id)
                    }
                }
                ForEach(NativeProviderSettings.groups(resource)) { group in
                    VStack(alignment: .leading, spacing: 14) {
                        Label(group.title, systemImage: "slider.horizontal.3").font(.headline)
                        Text(group.note).font(.caption).foregroundStyle(.secondary)
                        ForEach(group.fields) { field in
                            LabeledContent(field.id == "dailyNews.narration.personId" ? "Narrator" : field.label) { Text(display(field)).multilineTextAlignment(.trailing).textSelection(.enabled) }
                        }
                        Button("Edit " + group.title.lowercased(), systemImage: "square.and.pencil") { edit(group) }.disabled(loading || busy).accessibilityIdentifier("providerEdit-" + group.id)
                    }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("providerGroup-" + group.id)
                }
                if resource.id == "ai" {
                    Section("Server Codex session") {
                        LabeledContent("Saved sign-in status", value: data["hasCodexAuth"].isEmpty ? "Unreported" : data["hasCodexAuth"].boolean ? "Signed in" : "Signed out")
                        NavigationLink("Manage Codex sign-in") { NativeCodexLoginView() }
                    }
                }
                if resource.id == "email" {
                    Section("Review sending") {
                        NavigationLink { NativeEmailLogView() } label: { Label("Sent-mail attempts", systemImage: "envelope.open") }
                        Button("Send a test message…", systemImage: "paperplane") { testSettings = data["email"]; confirmTest = true }.disabled(loading || busy).accessibilityIdentifier("providerTestEmail")
                        Text("A test uses the configured default recipient and no CC. Provider acceptance is separate from inbox delivery.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeProviderSettings")
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(item: $editor) { snapshot in NativeProviderEditor(group: snapshot.group, original: snapshot.settings) { model.revision += 1 }.privacyProtected() }
            .confirmationDialog("Remove this saved credential?", isPresented: $confirmClear, titleVisibility: .visible, presenting: clearing) { snapshot in
                Button("Remove " + snapshot.credential.title, role: .destructive) { Task { await clear(snapshot) } }.accessibilityIdentifier("providerConfirmRemove")
                Button("Cancel", role: .cancel) { clearing = nil }
            } message: { _ in Text("This removes the value stored by DocVault. A credential supplied by the server environment may remain configured.") }
            .confirmationDialog("Send a test email?", isPresented: $confirmTest, titleVisibility: .visible, presenting: testSettings) { settings in
                Button("Send test message") { Task { await testEmail(settings) } }.accessibilityIdentifier("providerConfirmTestEmail")
                Button("Cancel", role: .cancel) {}
            } message: { settings in Text("Recipient: " + (settings["toEmail"].string.isEmpty ? "No default recipient is saved" : settings["toEmail"].string) + ". No CC is used.") }
    }

    private func display(_ field: NativeField) -> String {
        let value = data.at(field.id)
        if value.isEmpty || value.string.isEmpty {
            return "Server default"
        }
        if field.id == "dailyNews.narration.personId" {
            return people.first { $0["id"] == value }?["name"].string ?? "Saved person"
        }
        return value.string
    }

    private func edit(_ group: NativeSettingsGroup) {
        editor = ProviderEditorSnapshot(group: group, settings: data)
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let fresh = try await model.nativeRequest("api/settings", scope: .init())
            guard generation == id, !Task.isCancelled else { return }; data = fresh
            if resource.id == "ai" {
                let fetchedPeople = try? await model.nativeRequest("api/health/people", scope: .init())
                guard generation == id, !Task.isCancelled else { return }; people = fetchedPeople?["people"].array ?? []
            }
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func clear(_ snapshot: ProviderCredentialSnapshot) async {
        let credential = snapshot.credential
        busy = true; error = nil; feedback = nil
        defer { busy = false; clearing = nil }
        do {
            let fresh = try await model.nativeRequest("api/settings", scope: .init())
            guard snapshot.settings.at(credential.flag) == fresh.at(credential.flag), snapshot.settings.at(credential.hint) == fresh.at(credential.hint) else { throw VaultError.server("The saved credential status changed. Reload before removing it.") }
            let response = try await model.nativeRequest("api/settings", scope: .init(), method: "POST", body: credential.clearBody)
            try NativeProviderSettings.requireSaved(response)
            feedback = "The server saved the removal request. Review the refreshed configuration; environment credentials can remain available."
            model.revision += 1
        } catch { self.error = error.localizedDescription }
    }

    private func testEmail(_ settings: VaultValue) async {
        busy = true; error = nil; feedback = nil
        defer { busy = false }
        do {
            let fresh = try await model.nativeRequest("api/settings", scope: .init())
            guard fresh["email"] == settings else { throw VaultError.server("Sending settings changed. Reload and review the recipient before sending.") }
            let result = try await model.nativeRequest("api/email/test", scope: .init(), method: "POST")
            guard result["ok"].boolean else { throw VaultError.server(result["error"].string.isEmpty ? "The test request did not succeed." : result["error"].string) }
            feedback = model.demo ? "A demo attempt was recorded. No email was sent." : "The provider accepted the test message. Check the recipient's inbox to verify delivery."
            model.revision += 1
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeProviderEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let group: NativeSettingsGroup
    let original: VaultValue
    let changed: () -> Void
    @State private var values: [String: String]
    @State private var people: [VaultValue] = []
    @State private var modelLists: [String: VaultValue] = [:]
    @State private var themeChoices: [NativeProviderChoice] = []
    @State private var choicesLoading = false
    @State private var choicesErrors: [String: String] = [:]
    @State private var choicesGeneration = UUID()
    @State private var saving = false
    @State private var error: String?
    @State private var discard = false
    private var initial: [String: String] {
        NativeProviderSettings.initial(group.fields, original)
    }

    private var dirty: Bool {
        values != initial
    }

    private var providers: [String] {
        let ids = Set(group.fields.map(\.id))
        if NativeProviderSettings.modelPaths.contains(where: { ids.contains($0 + ".model") }) {
            return ["anthropic", "openai"]
        }
        return ["anthropic", "openai"].filter { provider in
            provider == "anthropic" ? ids.contains("claudeModel") : ids.contains("chat.codexModel") || ids.contains("dailyNews.imageModel")
        }
    }

    init(group: NativeSettingsGroup, original: VaultValue, changed: @escaping () -> Void) {
        self.group = group; self.original = original; self.changed = changed
        _values = State(initialValue: NativeProviderSettings.initial(group.fields, original))
    }

    var body: some View {
        NavigationStack {
            Form {
                Text(group.note).font(.callout).foregroundStyle(.secondary)
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("providerEditorError")
                }
                if !providers.isEmpty {
                    Section("Available models") {
                        ForEach(providers, id: \.self) { provider in
                            LabeledContent(provider == "anthropic" ? "Anthropic" : "OpenAI", value: modelLists[provider].map { NativeProviderSettings.modelSource($0) } ?? "Not loaded")
                            if let issue = choicesErrors[provider] {
                                Text(issue).font(.caption).foregroundStyle(.orange)
                            }
                        }
                        Text("Listed models may come from a live provider, server cache or fallback. You can also enter a custom model. Listing a model does not verify a completed task.").font(.caption).foregroundStyle(.secondary)
                        Button("Refresh model lists", systemImage: "arrow.clockwise") { Task { await loadChoices(refresh: true) } }.disabled(choicesLoading).accessibilityIdentifier("providerRefreshModels")
                    }.accessibilityIdentifier("providerModelCatalog")
                }
                if choicesLoading {
                    ProgressView("Loading choices…")
                }
                if let issue = choicesErrors["themes"] {
                    Text(issue).font(.caption).foregroundStyle(.orange)
                }
                if let issue = choicesErrors["people"] {
                    Text(issue).font(.caption).foregroundStyle(.orange)
                }
                ForEach(group.fields) { field in input(field) }
                ForEach(NativeProviderSettings.modelPaths.filter { path in group.fields.contains { $0.id == path + ".provider" } }, id: \.self) { path in
                    Button("Use server default model") { for component in NativeProviderSettings.modelComponents {
                        values[path + "." + component] = ""
                    } }.accessibilityIdentifier("providerDefaultModel-" + path)
                }
                Button("Revert draft") { values = initial; error = nil }.disabled(!dirty || saving).accessibilityIdentifier("providerEditorRevert")
                if saving {
                    ProgressView("Saving preferences…")
                }
            }.disabled(saving).scrollDismissesKeyboard(.interactively).accessibilityIdentifier("nativeProviderEditor")
                .navigationTitle(group.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("providerEditorCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving || !dirty).accessibilityIdentifier("providerEditorSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("providerEditorKeyboardDone") }
                }
                .interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard these changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() }.accessibilityIdentifier("providerEditorDiscard"); Button("Keep editing", role: .cancel) {} }
                .task { await loadChoices() }
        }
    }

    @ViewBuilder private func input(_ field: NativeField) -> some View {
        let binding = Binding(get: { values[field.id] ?? "" }, set: { values[field.id] = $0 })
        switch field.kind {
        case .boolean:
            Toggle(field.label, isOn: Binding(get: { binding.wrappedValue == "true" }, set: { binding.wrappedValue = $0 ? "true" : "false" })).accessibilityIdentifier("providerField-" + field.id)
        case let .choices(options):
            let effortProvider = NativeProviderSettings.modelPaths.first(where: { field.id == $0 + ".effort" }).map { values[$0 + ".provider"] ?? "" } ?? (field.id == "chat.claudeEffort" ? "anthropic" : field.id == "chat.codexEffort" ? "openai" : "")
            let choices = field.id.hasSuffix(".effort") || field.id.hasSuffix("Effort") ? NativeProviderSettings.efforts(effortProvider) : options
            Picker(field.label, selection: binding) {
                if binding.wrappedValue.isEmpty || field.id.hasSuffix("Effort") || field.id.hasSuffix(".effort") || field.id.hasSuffix(".provider") {
                    Text("Server default").tag("")
                }
                if !binding.wrappedValue.isEmpty, !choices.contains(binding.wrappedValue) {
                    Text("Saved: " + binding.wrappedValue).tag(binding.wrappedValue)
                }
                ForEach(choices, id: \.self) { Text($0).tag($0) }
            }.accessibilityIdentifier("providerField-" + field.id)
        case .reference("people"):
            Picker("Narrator", selection: binding) {
                Text("Off").tag("")
                if !binding.wrappedValue.isEmpty, !people.contains(where: { $0["id"].string == binding.wrappedValue }) {
                    Text("Saved person · " + binding.wrappedValue).tag(binding.wrappedValue)
                }
                ForEach(people, id: \.self) { person in Text(person["name"].string).tag(person["id"].string) }
            }.accessibilityIdentifier("providerField-" + field.id)
        case .secret:
            VStack(alignment: .leading, spacing: 7) {
                Text(field.label).font(.caption).foregroundStyle(.secondary)
                SecureField("New credential", text: binding).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("providerField-" + field.id)
            }
        default:
            VStack(alignment: .leading, spacing: 7) {
                Text(field.label).font(.caption).foregroundStyle(.secondary)
                TextField(field.label, text: binding).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(field.kind == .number || field.kind == .integer ? .numbersAndPunctuation : .default).accessibilityIdentifier("providerField-" + field.id)
                if field.id == "dailyNews.theme", !themeChoices.isEmpty {
                    Menu("Choose a news theme") {
                        Button("Server default") { binding.wrappedValue = "" }
                        ForEach(themeChoices) { choice in Button(choice.title) { binding.wrappedValue = choice.id }.accessibilityIdentifier("providerThemeChoice-" + choice.id) }
                    }.accessibilityIdentifier("providerThemeChoices")
                }
                if let provider = listedProvider(field.id) {
                    let options = NativeProviderSettings.modelOptions(modelLists[provider] ?? .null, images: field.id == "dailyNews.imageModel")
                    if !options.isEmpty {
                        Menu("Choose a listed model") {
                            ForEach(options, id: \.self) { option in Button(option) { binding.wrappedValue = option }.accessibilityIdentifier("providerModelChoice-" + option) }
                        }.accessibilityIdentifier("providerModelChoices-" + field.id)
                    }
                }
            }
        }
    }

    private func listedProvider(_ field: String) -> String? {
        if field == "claudeModel" {
            return "anthropic"
        }
        if field == "chat.codexModel" || field == "dailyNews.imageModel" {
            return "openai"
        }
        guard let path = NativeProviderSettings.modelPaths.first(where: { field == $0 + ".model" }) else { return nil }
        let provider = values[path + ".provider"] ?? ""
        return ["anthropic", "openai"].contains(provider) ? provider : nil
    }

    private func loadChoices(refresh: Bool = false) async {
        let generation = UUID(); choicesGeneration = generation; choicesLoading = true
        defer {
            if choicesGeneration == generation {
                choicesLoading = false
            }
        }
        for provider in providers {
            do {
                let list = try await model.nativeRequest("api/models?provider=" + provider + (refresh ? "&refresh=1" : ""), scope: .init())
                guard choicesGeneration == generation, !Task.isCancelled else { return }
                modelLists[provider] = list; choicesErrors[provider] = nil
            } catch {
                guard choicesGeneration == generation, !Task.isCancelled else { return }; choicesErrors[provider] = error.localizedDescription
            }
        }
        if group.fields.contains(where: { $0.id == "dailyNews.theme" }) {
            do {
                let list = try await model.nativeRequest("api/daily-news/themes", scope: .init())
                guard choicesGeneration == generation, !Task.isCancelled else { return }; themeChoices = NativeProviderSettings.themes(list); choicesErrors["themes"] = nil
            } catch {
                guard choicesGeneration == generation, !Task.isCancelled else { return }; choicesErrors["themes"] = error.localizedDescription
            }
        }
        if group.fields.contains(where: {
            if case .reference("people") = $0.kind {
                return true
            }; return false
        }) {
            do {
                let fresh = try await model.nativeRequest("api/health/people", scope: .init())
                guard choicesGeneration == generation, !Task.isCancelled else { return }; people = fresh["people"].array; choicesErrors["people"] = nil
            } catch {
                guard choicesGeneration == generation, !Task.isCancelled else { return }; choicesErrors["people"] = error.localizedDescription
            }
        }
    }

    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        do {
            let fresh = try await model.nativeRequest("api/settings", scope: .init())
            let patch = try NativeProviderSettings.patch(fields: group.fields, values: values, original: original, current: fresh)
            guard !patch.isEmpty else { dismiss(); return }
            let response = try await model.nativeRequest("api/settings", scope: .init(), method: "POST", body: patch)
            try NativeProviderSettings.requireSaved(response)
            changed(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
