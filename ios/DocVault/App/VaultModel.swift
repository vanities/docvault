import LocalAuthentication
import Observation
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@Observable @MainActor
final class VaultModel {
    var api: VaultAPI?
    var entities: [VaultEntity] = []
    var connected = false
    var restoring = false
    var connecting = false
    var demo = false
    var error: String?
    var draft: UploadDraft? {
        didSet {
            if oldValue?.id != draft?.id {
                oldValue?.removeStagedFiles()
            }
        }
    }

    var importingFiles = false
    var lockEnabled: Bool
    var unlocked: Bool
    var unlocking = false
    var lockError: String?
    var revision = 0
    var nativeDemo = NativeDemoStore()
    /// Session-only worksheet overrides. Never written to UserDefaults or shared between servers.
    var worksheetInputs: [String: [String: String]] = [:]
    var blurNumbers = false {
        didSet { defaults.set(blurNumbers, forKey: "blurNumbers") }
    }

    var webDataStore = WKWebsiteDataStore.nonPersistent()
    private var demoFiles: [String: [VaultFile]] = [:]
    private let defaults: UserDefaults
    private let sessions = SessionStore()
    var savedAddress: String {
        defaults.string(forKey: "serverURL") ?? ""
    }

    var serverLabel: String {
        demo ? "Demo vault" : api?.address.url.host() ?? "DocVault"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        blurNumbers = defaults.bool(forKey: "blurNumbers")
        let locked = defaults.bool(forKey: "appLock")
        lockEnabled = locked
        unlocked = !locked
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            enterDemo()
        }
        try? FileManager.default.removeItem(at: Self.previewRoot)
        try? FileManager.default.removeItem(at: UploadDraft.stagingRoot)
    }

    func restore() async {
        guard !demo, !savedAddress.isEmpty else { return }
        restoring = true
        defer { restoring = false }
        do {
            let address = try ServerAddress(savedAddress)
            let client = try VaultAPI(address: address, token: sessions.read(for: address))
            let status = try await client.status()
            guard status.ok else {
                throw VaultError.server(status.error ?? "Your server is unavailable.")
            }
            guard !status.authRequired || status.authenticated else { throw VaultError.signedOut }
            let entities = try await client.entities()
            api = client
            self.entities = entities
            connected = true
        } catch { self.error = error.localizedDescription }
    }

    func connect(address: String, username: String, password: String) async {
        guard !connecting else { return }
        connecting = true
        error = nil
        defer { connecting = false }
        do {
            let client = try VaultAPI(address: ServerAddress(address))
            let status = try await client.status()
            guard status.ok else {
                throw VaultError.server(status.error ?? "The server data directory is unavailable.")
            }
            if status.authRequired {
                try await client.login(username: username, password: password)
            }
            let entities = try await client.entities()
            if let token = client.token {
                try sessions.write(token, for: client.address)
            }
            defaults.set(client.address.url.absoluteString, forKey: "serverURL")
            api = client
            self.entities = entities
            demo = false
            worksheetInputs = [:]
            connected = true
            webDataStore = .nonPersistent()
        } catch { self.error = error.localizedDescription }
    }

    func enterDemo() {
        worksheetInputs = [:]
        demo = true
        connected = true
        api = nil
        entities = DemoVault.entities
        nativeDemo = NativeDemoStore()
        demoFiles = Dictionary(
            uniqueKeysWithValues: entities.map { ($0.id, DemoVault.files(entity: $0.id)) }
        )
        error = nil
    }

    func disconnect() async {
        let client = api
        // Clear local access even when the server is offline; report revocation failure.
        if let address = client?.address {
            do { try sessions.delete(for: address) } catch {
                self.error = error.localizedDescription
                return
            }
        }
        api = nil
        connected = false
        demo = false
        entities = []
        demoFiles = [:]
        nativeDemo = NativeDemoStore()
        draft = nil
        worksheetInputs = [:]
        webDataStore = .nonPersistent()
        revision += 1
        try? FileManager.default.removeItem(at: Self.previewRoot)
        do { try await client?.logout() } catch {
            self.error =
                "Signed out on this device. The server could not revoke the session: \(error.localizedDescription)"
        }
    }

    func files(entity: String) async throws -> [VaultFile] {
        if demo {
            return demoFiles[entity] ?? []
        }
        guard let api else { throw VaultError.signedOut }
        do { return try await api.files(entity: entity) } catch {
            handle(error)
            throw error
        }
    }

    func search(_ text: String) async throws -> [VaultFile] {
        if demo {
            return demoFiles.values.flatMap(\.self).filter {
                "\($0.name) \($0.path) \($0.entityName ?? "")".localizedCaseInsensitiveContains(
                    text
                )
            }
        }
        guard let api else { throw VaultError.signedOut }
        do { return try await api.search(text) } catch {
            handle(error)
            throw error
        }
    }

    func refreshEntities() async {
        if demo {
            do {
                let response = try nativeDemo.request(VaultRequest("api/entities", scope: .init()), method: "GET", body: nil)
                entities = try JSONDecoder().decode(EntityResponse.self, from: JSONEncoder().encode(response)).entities
                revision += 1
            } catch { self.error = error.localizedDescription }
            return
        }
        guard let api else { return }
        do {
            entities = try await api.entities()
            revision += 1
        } catch {
            handle(error)
            self.error = error.localizedDescription
        }
    }

    func demoTaxSummary(year: String) -> VaultValue {
        .object(["year": .string(year), "summary": .object(Dictionary(uniqueKeysWithValues: entities.filter(\.isTax).map { entity in
            let documents = (demoFiles[entity.id] ?? []).filter { $0.isTracked && $0.path.hasPrefix(year + "/") }.map { file in VaultValue.object(["name": .string(file.name), "path": .string(file.path), "type": .string(file.type), "parsedData": file.parsedData ?? .null]) }
            return (entity.id, VaultValue.object(["entity": .object(["id": .string(entity.id), "name": .string(entity.name)]), "documents": .array(documents)]))
        }))])
    }

    func preview(_ file: VaultFile, entity: String) async throws -> URL {
        if !demo {
            return try await nativeDownload("api/file/{entity}/{filePath}", scope: .init(entity: entity), record: .object(["filePath": .string(file.path)]), method: "GET", body: nil, suffix: (file.name as NSString).pathExtension)
        }
        let data = DemoVault.pdf(title: file.name)
        try Task.checkCancellation()
        let folder = Self.previewRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        let url = folder.appendingPathComponent((file.name as NSString).lastPathComponent)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    static var previewRoot: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(
            "DocVaultPreviews", isDirectory: true
        )
    }

    static func removePreview(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    func importFile(_ url: URL) {
        importFiles([url])
    }

    func importFiles(_ urls: [URL], destination: VaultUploadDestination? = nil) {
        guard !importingFiles, !urls.isEmpty else { return }
        importingFiles = true
        let client = api
        let wasDemo = demo
        Task {
            defer { importingFiles = false }
            let imported = await Task.detached {
                var drafts: [UploadDraft] = []
                var errors: [String] = []
                for url in urls {
                    do { drafts.append(try UploadDraft.stage(url)) }
                    catch { errors.append("\(url.lastPathComponent): \(error.localizedDescription)") }
                }
                return (drafts, errors)
            }.value
            guard connected, api === client, demo == wasDemo else {
                for staged in imported.0 {
                    staged.removeStagedFiles()
                }
                return
            }
            if var current = draft {
                current.additional.append(contentsOf: imported.0)
                current.importErrors.append(contentsOf: imported.1)
                draft = current
            } else if var first = imported.0.first {
                first.additional = Array(imported.0.dropFirst())
                first.importErrors = imported.1
                first.destination = destination
                draft = first
            } else {
                error = imported.1.joined(separator: "\n")
            }
        }
    }

    func upload(_ draft: UploadDraft, entity: String, folder: String, name: String) async throws
        -> String
    {
        try VaultAPI.validateUpload(size: draft.size, folder: folder, name: name)
        let path: String
        if demo {
            var finalName = name
            let stem = (name as NSString).deletingPathExtension
            let ext = (name as NSString).pathExtension
            var counter = 2
            while (demoFiles[entity] ?? []).contains(where: { $0.path == "\(folder)/\(finalName)" }) {
                finalName = "\(stem)_\(counter)" + (ext.isEmpty ? "" : ".\(ext)")
                counter += 1
            }
            path = "\(folder)/\(finalName)"
            demoFiles[entity, default: []].insert(
                .init(
                    name: finalName, path: path, size: draft.size,
                    lastModified: Date().timeIntervalSince1970 * 1000, type: draft.contentType,
                    tags: [], notes: "", entity: entity,
                    entityName: entities.first(where: { $0.id == entity })?.name
                ), at: 0
            )
        } else {
            guard let api else { throw VaultError.signedOut }
            do {
                if let fileURL = draft.fileURL {
                    path = try await api.upload(fileURL: fileURL, entity: entity, folder: folder, name: name, contentType: draft.contentType)
                } else {
                    path = try await api.upload(data: draft.data, entity: entity, folder: folder, name: name, contentType: draft.contentType)
                }
                guard self.api === api else { throw CancellationError() }
            } catch {
                if self.api === api {
                    handle(error)
                }
                throw error
            }
        }
        revision += 1
        return path
    }

    func analyzeImport(_ draft: UploadDraft, year: Int) async throws -> VaultValue {
        guard NativeDocumentImport.supportedAnalysis(draft.name) else { throw VaultError.server("Naming analysis supports PDF, PNG, JPG, GIF and WebP files. You can upload this file with your own classification.") }
        guard draft.size > 0, draft.size <= VaultAPI.maxImportBytes else { throw VaultError.server("Naming analysis supports files up to 512 MB. The document upload limit remains 2 GB.") }
        if demo {
            return NativeDocumentImport.demoAnalysis(name: draft.name, year: year)
        }
        guard let api else { throw VaultError.signedOut }
        do {
            let request = try NativeDocumentImport.analysisRequest(name: draft.name, year: year)
            let result: VaultValue = if let fileURL = draft.fileURL {
                try await api.uploadFile(request, fileURL: fileURL, contentType: draft.contentType)
            } else {
                try await api.uploadBytes(request, data: draft.data)
            }
            guard self.api === api else { throw CancellationError() }
            return result
        } catch {
            if self.api === api {
                handle(error)
            }; throw error
        }
    }

    func extractImportedDocument(entity: String, path: String, year: Int) async throws -> VaultValue {
        if demo {
            return try NativeDocumentImport.extracted(NativeDocumentImport.demoAnalysis(name: (path as NSString).lastPathComponent, year: year)["parsedData"])
        }
        let result = try await nativeRequest("api/parse/{entity}/{filePath}", scope: .init(entity: entity), record: .object(["filePath": .string(path)]), method: "POST")
        try NativeProviderSettings.requireSaved(result)
        return try NativeDocumentImport.extracted(result["parsedData"])
    }

    func saveImportedParse(entity: String, path: String, parsed: VaultValue) async throws {
        var parsed = try NativeDocumentImport.extracted(parsed)
        if demo {
            guard let index = demoFiles[entity]?.firstIndex(where: { $0.path == path }) else { throw VaultError.server("The uploaded demo document no longer exists.") }
            parsed.set("parsed", .bool(true)); parsed.set("parsedAt", .string(Date.now.ISO8601Format()))
            demoFiles[entity]?[index].parsedData = parsed
        } else {
            let result = try await nativeRequest("api/save-parsed", scope: .init(), method: "POST", body: .object(["entity": .string(entity), "filePath": .string(path), "parsedData": parsed]))
            try NativeProviderSettings.requireSaved(result)
        }
        revision += 1
    }

    func saveMetadata(file: VaultFile, entity: String, notes: String? = nil, tags: [String]? = nil, tracked: Bool? = nil) async throws {
        _ = try NativeDocumentOrganization.metadataBody(file: file, entity: entity, notes: notes, tags: tags, tracked: tracked)
        if demo {
            guard let index = demoFiles[entity]?.firstIndex(where: { $0.path == file.path }) else { throw VaultError.server("This document is no longer available.") }
            if let notes {
                demoFiles[entity]?[index].notes = notes
            }
            if let tags {
                demoFiles[entity]?[index].tags = tags
            }
            if let tracked {
                demoFiles[entity]?[index].tracked = tracked
            }
        } else {
            guard let api else { throw VaultError.signedOut }
            do {
                try await api.saveMetadata(file: file, entity: entity, notes: notes, tags: tags, tracked: tracked)
                guard self.api === api else { throw CancellationError() }
            } catch {
                if self.api === api {
                    handle(error)
                }
                throw error
            }
        }
        revision += 1
    }

    func moveDocument(_ file: VaultFile, entity: String, toEntity: String, folder: String) async throws {
        try VaultAPI.validateUpload(size: 1, folder: folder, name: file.name)
        let destination = "\(folder)/\(file.name)"
        guard entities.contains(where: { $0.id == toEntity }) else { throw VaultError.server("Choose a destination entity.") }
        if entity == toEntity, file.path == destination {
            return
        }
        if demo {
            guard !(demoFiles[toEntity] ?? []).contains(where: { $0.path == destination }) else { throw VaultError.server("Destination already exists.") }
            guard let index = demoFiles[entity]?.firstIndex(where: { $0.path == file.path }) else { throw VaultError.server("This document is no longer available.") }
            let original = demoFiles[entity]!.remove(at: index)
            var moved = VaultFile(name: original.name, path: destination, size: original.size, lastModified: Date().timeIntervalSince1970 * 1000, type: original.type, tags: original.tags, notes: original.notes, entity: toEntity, entityName: entities.first { $0.id == toEntity }?.name)
            moved.parsedData = original.parsedData
            moved.tracked = original.tracked
            demoFiles[toEntity, default: []].append(moved)
        } else {
            let result = try await nativeRequest("api/move-between", scope: .init(), method: "POST", body: .object([
                "fromEntity": .string(entity), "fromPath": .string(file.path),
                "toEntity": .string(toEntity), "toPath": .string(destination),
            ]))
            try NativeProviderSettings.requireSaved(result)
        }
        revision += 1
    }

    func moveOrganizedDocument(_ plan: NativeDocumentOrganizationPlan, notify: Bool = true) async throws {
        guard plan.movesFile else { return }
        guard entities.contains(where: { $0.id == plan.destination.entity }) else { throw VaultError.server("Choose an available destination entity.") }
        let client = api, wasDemo = demo
        let sources = try await files(entity: plan.source.entity)
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        guard let original = sources.first(where: { $0.path == plan.source.path }) else { throw VaultError.server("The original document is no longer at this path. Check the destination before trying another move.") }
        guard original.size == plan.sourceSize, original.lastModified == plan.sourceModified else { throw VaultError.server("This document changed on disk. Reload before moving it.") }
        if demo {
            guard !(demoFiles[plan.destination.entity] ?? []).contains(where: { $0.path == plan.destination.path }) else { throw VaultError.server("Destination already exists.") }
            let moved = VaultFile(name: (plan.destination.path as NSString).lastPathComponent, path: plan.destination.path, size: original.size, lastModified: Date.now.timeIntervalSince1970 * 1000, type: original.type, tags: original.tags, notes: original.notes, entity: plan.destination.entity, entityName: entities.first { $0.id == plan.destination.entity }?.name, parsedData: original.parsedData, tracked: original.tracked)
            demoFiles[plan.source.entity]?.removeAll { $0.path == plan.source.path }
            demoFiles[plan.destination.entity, default: []].append(moved)
        } else {
            let response = try await nativeRequest(plan.mutationPath, scope: .init(), method: "POST", body: plan.mutationBody)
            try NativeProviderSettings.requireSaved(response)
            if plan.renamesFile, response["newPath"].string != plan.destination.path {
                throw VaultError.server("The server returned a different rename destination. Reload the document before continuing.")
            }
        }
        if notify {
            revision += 1
        }
    }

    func classifyOrganizedDocument(_ plan: NativeDocumentOrganizationPlan) async throws {
        let client = api, wasDemo = demo
        let files = try await files(entity: plan.destination.entity)
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        guard let current = files.first(where: { $0.path == plan.destination.path }) else { throw VaultError.server("The moved document is no longer at the confirmed destination.") }
        if let parsed = try NativeDocumentOrganization.classified(plan, current: current.parsedData ?? .null) {
            try await saveImportedParse(entity: plan.destination.entity, path: plan.destination.path, parsed: parsed)
        }
    }

    func deleteDocument(_ file: VaultFile, entity: String) async throws {
        if demo {
            demoFiles[entity]?.removeAll { $0.path == file.path }
        } else {
            let result = try await nativeRequest("api/file/{entity}/{filePath}", scope: .init(entity: entity), record: .object(["filePath": .string(file.path)]), method: "DELETE")
            try NativeProviderSettings.requireSaved(result)
        }
        revision += 1
    }

    func addDocumentTags(_ file: VaultFile, entity: String, tags: [String]) async throws {
        let fresh = try await files(entity: entity)
        guard let current = fresh.first(where: { $0.path == file.path }) else { throw VaultError.server("This document is no longer available.") }
        let merged = Array(Set((current.tags ?? []) + tags)).sorted()
        if demo {
            try await saveMetadata(file: current, entity: entity, notes: current.notes ?? "", tags: merged)
        } else {
            let result = try await nativeRequest("api/metadata", scope: .init(), method: "PUT", body: .object([
                "entity": .string(entity), "filePath": .string(file.path), "tags": .array(merged.map(VaultValue.string)),
            ]))
            try NativeProviderSettings.requireSaved(result)
            revision += 1
        }
    }

    func handle(_ error: Error) {
        if error as? VaultError == .signedOut {
            connected = false
            entities = []
            api = nil
            draft = nil
            worksheetInputs = [:]
            webDataStore = .nonPersistent()
            self.error = error.localizedDescription
        }
    }

    func setLock(_ enabled: Bool) async {
        if enabled {
            guard await authenticate() else { return }
        }
        lockEnabled = enabled
        unlocked = true
        defaults.set(enabled, forKey: "appLock")
    }

    func unlock() async {
        guard !unlocking else { return }
        unlocking = true
        defer { unlocking = false }
        unlocked = await authenticate()
    }

    private func authenticate() async -> Bool {
        let context = LAContext()
        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication, localizedReason: "Unlock your DocVault documents"
            )
            lockError = nil
            return success
        } catch {
            lockError = error.localizedDescription
            return false
        }
    }
}
