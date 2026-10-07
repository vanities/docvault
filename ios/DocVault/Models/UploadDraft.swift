import Foundation
import UniformTypeIdentifiers

struct UploadDraft: Identifiable, Sendable {
    let id = UUID()
    let data: Data
    var name: String
    let contentType: String
    let fileURL: URL?
    let size: Int64
    var additional: [UploadDraft] = []
    var importErrors: [String] = []
    var destination: VaultUploadDestination?

    init(data: Data, name: String, contentType: String) {
        self.data = data
        self.name = name
        self.contentType = contentType
        fileURL = nil
        size = Int64(data.count)
    }

    private init(fileURL: URL, name: String, contentType: String, size: Int64) {
        data = Data()
        self.fileURL = fileURL
        self.name = name
        self.contentType = contentType
        self.size = size
    }

    func withContentType(_ mime: String) -> UploadDraft {
        var result: UploadDraft = if let fileURL {
            .init(fileURL: fileURL, name: name, contentType: mime, size: size)
        } else {
            .init(data: data, name: name, contentType: mime)
        }
        result.destination = destination
        return result
    }

    static var stagingRoot: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("DocVaultImports", isDirectory: true)
    }

    /// Copy a provider-owned file while its security scope is open. No document-sized Data allocation.
    static func stage(_ url: URL, maximumSize: Int64 = VaultAPI.maxUploadBytes) throws -> UploadDraft {
        try Task.checkCancellation()
        let access = url.startAccessingSecurityScopedResource()
        defer {
            if access {
                url.stopAccessingSecurityScopedResource()
            }
        }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey, .isRegularFileKey])
        guard values.isRegularFile == true else { throw VaultError.server("Choose a regular file.") }
        let size = Int64(values.fileSize ?? 0)
        guard size > 0 else { throw VaultError.emptyUpload }
        guard size <= maximumSize else { throw VaultError.server("Choose a file up to \(ByteCountFormatter.string(fromByteCount: maximumSize, countStyle: .binary)).") }
        let folder = stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let staged = folder.appendingPathComponent(url.lastPathComponent)
        do {
            try FileManager.default.copyItem(at: url, to: staged)
            try Task.checkCancellation()
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: staged.path)
            let copiedSize = Int64(try staged.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            guard copiedSize > 0, copiedSize <= maximumSize else { throw VaultError.uploadTooLarge }
            return .init(fileURL: staged, name: url.lastPathComponent, contentType: values.contentType?.preferredMIMEType ?? "application/octet-stream", size: copiedSize)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }

    static func stageAsync(_ url: URL, maximumSize: Int64) async throws -> UploadDraft {
        let worker = Task.detached { try stage(url, maximumSize: maximumSize) }
        let draft = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
        do {
            try Task.checkCancellation()
            return draft
        } catch {
            draft.removeStagedFiles()
            throw error
        }
    }

    func removeStagedFiles() {
        if let fileURL, fileURL.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL == Self.stagingRoot.standardizedFileURL {
            try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
        for draft in additional {
            draft.removeStagedFiles()
        }
    }
}
