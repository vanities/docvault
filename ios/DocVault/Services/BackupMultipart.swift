import Foundation

/// The multipart envelope, including the password, is owned, protected and removed after the request.
struct BackupMultipart: Sendable {
    let url: URL
    let contentType: String

    static func stage(fileURL: URL, password: String) throws -> BackupMultipart {
        guard password.count >= 4 else { throw VaultError.server("Enter a backup password of at least four characters.") }
        try Task.checkCancellation()
        let boundary = "DocVault-\(UUID().uuidString)"
        let prefix = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\n\(password)\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"backup.enc\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8)
        let suffix = Data("\r\n--\(boundary)--\r\n".utf8)
        let size = Int64(try fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        guard size > 0 else { throw VaultError.emptyUpload }
        guard size + Int64(prefix.count + suffix.count) <= VaultAPI.maxImportBytes else { throw VaultError.server("The backup and upload envelope must fit within 512 MB.") }
        let folder = UploadDraft.stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let url = folder.appendingPathComponent("restore.multipart")
        do {
            try prefix.write(to: url, options: .completeFileProtection)
            let source = try FileHandle(forReadingFrom: fileURL)
            defer { try? source.close() }
            let target = try FileHandle(forWritingTo: url)
            defer { try? target.close() }
            try target.seekToEnd()
            var copied: Int64 = 0
            while let chunk = try source.read(upToCount: 1024 * 1024), !chunk.isEmpty {
                try Task.checkCancellation()
                copied += Int64(chunk.count)
                guard copied + Int64(prefix.count + suffix.count) <= VaultAPI.maxImportBytes else { throw VaultError.server("The backup exceeds the 512 MB upload limit.") }
                try target.write(contentsOf: chunk)
            }
            guard copied == size else { throw VaultError.server("The backup changed while preparing the upload. Choose it again.") }
            try target.write(contentsOf: suffix)
            try Task.checkCancellation()
            return .init(url: url, contentType: "multipart/form-data; boundary=\(boundary)")
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }

    func remove() {
        guard url.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL == UploadDraft.stagingRoot.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}
