import Foundation
import UniformTypeIdentifiers

/// Never forward a session or upload body through an HTTP redirect.
final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _: URLSession, task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest _: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

@MainActor
final class VaultAPI {
    nonisolated static let maxUploadBytes: Int64 = 2 * 1024 * 1024 * 1024
    nonisolated static let maxImportBytes: Int64 = 512 * 1024 * 1024
    let address: ServerAddress
    private(set) var token: String?
    private let session: URLSession
    init(address: ServerAddress, token: String? = nil, session: URLSession? = nil) {
        self.address = address
        self.token = token
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false
            config.urlCache = nil
            config.timeoutIntervalForRequest = 60
            self.session = URLSession(
                configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil
            )
        }
    }

    func status() async throws -> ServerStatus {
        try await json(["api", "status"])
    }

    func updateToken(_ token: String) {
        self.token = token
    }

    var webSessionCookie: HTTPCookie? {
        guard let token, let host = address.url.host() else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: "docvault_session", .value: token, .domain: host, .path: "/",
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
        ]
        // Foundation treats the presence of Secure as true, even when its
        // value is "FALSE". Omit it entirely for permitted local HTTP servers.
        if address.url.scheme == "https" {
            properties[.secure] = "TRUE"
        }
        return HTTPCookie(properties: properties)
    }

    func login(username: String, password: String) async throws {
        let body = try JSONEncoder().encode(["username": username, "password": password])
        let (_, response) = try await send(
            ["api", "login"], method: "POST", body: body, contentType: "application/json"
        )
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { fields, item in
            if let key = item.key as? String, let value = item.value as? String {
                fields[key] = value
            }
        }
        token =
            HTTPCookie.cookies(withResponseHeaderFields: fields, for: address.url)
                .first(where: { $0.name == "docvault_session" })?.value
        let status = try await status()
        guard status.ok else {
            throw VaultError.server(status.error ?? "The server data directory is unavailable.")
        }
        guard !status.authRequired || status.authenticated && token != nil else {
            throw VaultError.missingSession
        }
    }

    func logout() async throws {
        let _: EmptyResponse = try await json(["api", "logout"], method: "POST")
        token = nil
    }

    func entities() async throws -> [VaultEntity] {
        let response: EntityResponse = try await json(["api", "entities"])
        return response.entities
    }

    func files(entity: String) async throws -> [VaultFile] {
        let response: FileResponse = try await json(["api", "files-all", entity])
        return response.files.map {
            var file = $0
            file.entity = entity
            return file
        }
    }

    func search(_ text: String) async throws -> [VaultFile] {
        let response: FileResponse = try await json(
            ["api", "search"], query: [.init(name: "q", value: text)]
        )
        return response.files
    }

    func document(_ file: VaultFile, entity: String) async throws -> Data {
        try await send(
            ["api", "file", entity]
                + file.path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        ).0
    }

    func upload(data: Data, entity: String, folder: String, name: String, contentType: String)
        async throws -> String
    {
        try Self.validateUpload(data: data, folder: folder, name: name)
        let response: UploadResponse = try await json(
            ["api", "upload"], method: "POST",
            query: [
                .init(name: "entity", value: entity), .init(name: "path", value: folder),
                .init(name: "filename", value: name),
            ], body: data, contentType: contentType
        )
        guard response.ok else { throw VaultError.invalidResponse }
        return response.path
    }

    static func validateUpload(data: Data, folder: String, name: String) throws {
        try validateUpload(size: Int64(data.count), folder: folder, name: name)
    }

    static func validateUpload(size: Int64, folder: String, name: String) throws {
        guard size > 0 else { throw VaultError.emptyUpload }
        guard size <= maxUploadBytes else { throw VaultError.uploadTooLarge }
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
              !folder.hasPrefix("/"), !folder.contains("\\"),
              folder.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({
                  !$0.isEmpty && $0 != "." && $0 != ".."
              })
        else { throw VaultError.invalidPath }
    }

    func upload(fileURL: URL, entity: String, folder: String, name: String, contentType: String) async throws -> String {
        let size = Int64(try fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        try Self.validateUpload(size: size, folder: folder, name: name)
        var request = try URLRequest(url: address.endpoint(["api", "upload"], query: [
            .init(name: "entity", value: entity), .init(name: "path", value: folder), .init(name: "filename", value: name),
        ]))
        request.httpMethod = "POST"
        request.timeoutInterval = 3600
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(size), forHTTPHeaderField: "Content-Length")
        if let token {
            request.setValue("docvault_session=\(token)", forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await session.upload(for: request, fromFile: fileURL)
        let http = try Self.validateResponse(response, data: data, path: ["api", "upload"])
        guard (200 ... 299).contains(http.statusCode) else { throw VaultError.invalidResponse }
        let uploaded = try JSONDecoder().decode(UploadResponse.self, from: data)
        guard uploaded.ok else { throw VaultError.invalidResponse }
        return uploaded.path
    }

    func saveMetadata(file: VaultFile, entity: String, notes: String? = nil, tags: [String]? = nil, tracked: Bool? = nil) async throws {
        let body = try JSONEncoder().encode(NativeDocumentOrganization.metadataBody(file: file, entity: entity, notes: notes, tags: tags, tracked: tracked))
        let response: EmptyResponse = try await json(
            ["api", "metadata"], method: "PUT", body: body, contentType: "application/json"
        )
        guard response.ok else { throw VaultError.invalidResponse }
    }

    private func json<T: Decodable>(
        _ path: [String], method: String = "GET", query: [URLQueryItem] = [],
        body: Data? = nil, contentType: String? = nil
    ) async throws -> T {
        let (data, _) = try await send(
            path, method: method, query: query, body: body, contentType: contentType
        )
        return try JSONDecoder().decode(T.self, from: data)
    }

    func request(_ request: VaultRequest, method: String = "GET", body: VaultValue? = nil)
        async throws -> VaultValue
    {
        let encoded = try body.map { try JSONEncoder().encode($0) }
        let (data, _) = try await send(
            request.path, method: method,
            query: request.query.sorted { $0.key < $1.key }.map {
                URLQueryItem(name: $0.key, value: $0.value)
            },
            body: encoded, contentType: encoded == nil ? nil : "application/json"
        )
        return try Self.decodeData(data)
    }

    /// Batch document parsing returns NDJSON progress followed by its final result.
    static func decodeData(_ data: Data) throws -> VaultValue {
        if data.isEmpty {
            return .object([:])
        }
        if let result = try? JSONDecoder().decode(VaultValue.self, from: data) {
            return result
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw VaultError.invalidResponse
        }
        let lines = text.split(separator: "\n").filter {
            !$0.trimmingCharacters(in: .whitespaces).isEmpty
        }
        guard lines.count > 1 else { throw VaultError.invalidResponse }
        let events = try lines.map {
            try JSONDecoder().decode(VaultValue.self, from: Data($0.utf8))
        }
        return .object(["events": .array(events), "result": events.last ?? .null])
    }

    func bytes(_ request: VaultRequest, method: String = "GET", body: VaultValue? = nil)
        async throws -> Data
    {
        try await send(
            request.path, method: method,
            query: request.query.map { URLQueryItem(name: $0.key, value: $0.value) },
            body: body.map { try JSONEncoder().encode($0) },
            contentType: body == nil ? nil : "application/json"
        ).0
    }

    func download(_ request: VaultRequest, method: String, body: VaultValue?, fallback: String)
        async throws -> (Data, String)
    {
        let (data, response) = try await send(
            request.path, method: method,
            query: request.query.map { URLQueryItem(name: $0.key, value: $0.value) },
            body: body.map { try JSONEncoder().encode($0) },
            contentType: body == nil ? nil : "application/json"
        )
        return (data, Self.downloadFilename(response, fallback: fallback))
    }

    /// URLSession downloads directly to disk; the owned result moves into a protected folder.
    func downloadFile(_ request: VaultRequest, method: String, body: VaultValue?, fallback: String, folder: URL) async throws -> URL {
        var req = try URLRequest(url: address.endpoint(request.path, query: request.query.map { .init(name: $0.key, value: $0.value) }))
        req.httpMethod = method
        req.httpBody = try body.map { try JSONEncoder().encode($0) }
        req.timeoutInterval = 3600
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            req.setValue("docvault_session=\(token)", forHTTPHeaderField: "Cookie")
        }
        let (temporary, response) = try await session.download(for: req)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse else { throw VaultError.invalidResponse }
        if !(200 ... 299).contains(http.statusCode) {
            let handle = try FileHandle(forReadingFrom: temporary)
            defer { try? handle.close() }
            _ = try Self.validateResponse(response, data: handle.read(upToCount: 65536) ?? Data(), path: request.path)
        }
        try Task.checkCancellation()
        let destination = folder.appendingPathComponent(Self.downloadFilename(http, fallback: fallback))
        try FileManager.default.moveItem(at: temporary, to: destination)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
        return destination
    }

    private static func downloadFilename(_ response: HTTPURLResponse, fallback: String) -> String {
        var filename = "DocVault.\(fallback)"
        if let disposition = response.value(forHTTPHeaderField: "Content-Disposition"),
           let marker = disposition.range(of: "filename=", options: .caseInsensitive)
        {
            let candidate = String(disposition[marker.upperBound...]).split(separator: ";").first?
                .trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) ?? ""
            let safe = (candidate as NSString).lastPathComponent
            if !safe.isEmpty, ![".", ".."].contains(safe) {
                filename = safe
            }
        } else if let mime = response.value(forHTTPHeaderField: "Content-Type")?.split(
            separator: ";"
        ).first, let suffix = UTType(mimeType: String(mime))?.preferredFilenameExtension,
                     mime != "application/octet-stream"
        {
            filename = "DocVault.\(suffix)"
        }
        return filename
    }

    func uploadBytes(_ request: VaultRequest, data: Data, method: String = "POST") async throws
        -> VaultValue
    {
        let result = try await send(
            request.path, method: method,
            query: request.query.map { URLQueryItem(name: $0.key, value: $0.value) }, body: data,
            contentType: "application/octet-stream"
        ).0
        return try JSONDecoder().decode(VaultValue.self, from: result)
    }

    /// Domain imports retain their endpoint/query contract while streaming the body from disk.
    func uploadFile(_ request: VaultRequest, fileURL: URL, method: String = "POST", contentType: String = "application/octet-stream") async throws -> VaultValue {
        let size = Int64(try fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        guard size > 0 else { throw VaultError.emptyUpload }
        guard size <= Self.maxImportBytes else { throw VaultError.server("This import supports files up to 512 MB.") }
        var req = try URLRequest(url: address.endpoint(request.path, query: request.query.map { .init(name: $0.key, value: $0.value) }))
        req.httpMethod = method
        req.timeoutInterval = 3600
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.setValue(String(size), forHTTPHeaderField: "Content-Length")
        if let token {
            req.setValue("docvault_session=\(token)", forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await session.upload(for: req, fromFile: fileURL)
        _ = try Self.validateResponse(response, data: data, path: request.path)
        return try Self.decodeData(data)
    }

    func restoreBackup(fileURL: URL, password: String) async throws -> VaultValue {
        let worker = Task.detached { try BackupMultipart.stage(fileURL: fileURL, password: password) }
        let payload = try await withTaskCancellationHandler {
            try await worker.value
        } onCancel: { worker.cancel() }
        defer { payload.remove() }
        try Task.checkCancellation()
        return try await uploadFile(VaultRequest("api/restore", scope: .init()), fileURL: payload.url, contentType: payload.contentType)
    }

    func transcribe(_ data: Data) async throws -> String {
        let boundary = "DocVault-\(UUID().uuidString)"
        var body = Data(
            "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"Voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n"
                .utf8
        )
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let result = try await send(
            ["api", "transcribe"], method: "POST", body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        ).0
        return try JSONDecoder().decode(VaultValue.self, from: result)["text"].string
    }

    func restoreBackup(data: Data, password: String) async throws -> VaultValue {
        let boundary = "DocVault-\(UUID().uuidString)"
        var body = Data(
            "--\(boundary)\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\n\(password)\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"backup.enc\"\r\nContent-Type: application/octet-stream\r\n\r\n"
                .utf8
        )
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let result = try await send(
            ["api", "restore"], method: "POST", body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        ).0
        return try JSONDecoder().decode(VaultValue.self, from: result)
    }

    func stream(
        _ request: VaultRequest, method: String = "POST", body: VaultValue? = nil,
        onEvent: @MainActor (VaultValue) -> Void
    )
        async throws
    {
        var req = try URLRequest(
            url: address.endpoint(
                request.path,
                query: request.query.map { URLQueryItem(name: $0.key, value: $0.value) }
            )
        )
        req.httpMethod = method
        req.httpBody = try body.map { try JSONEncoder().encode($0) }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            req.setValue("docvault_session=\(token)", forHTTPHeaderField: "Cookie")
        }
        let (bytes, response) = try await session.bytes(for: req)
        guard let http = response as? HTTPURLResponse else { throw VaultError.invalidResponse }
        if http.statusCode == 401 {
            throw VaultError.signedOut
        }
        guard (200 ... 299).contains(http.statusCode) else {
            var message = Data()
            for try await byte in bytes {
                message.append(byte)
                if message.count > 65536 {
                    break
                }
            }
            let value = try? JSONDecoder().decode(VaultValue.self, from: message)
            throw VaultError.server(
                value?["error"].string ?? "Chat request failed (HTTP \(http.statusCode))."
            )
        }
        var eventLines: [String] = []
        var completed = false
        func receiveLine(_ line: String) throws {
            if line.isEmpty {
                if !eventLines.isEmpty {
                    let data = Data(eventLines.joined(separator: "\n").utf8)
                    let event = try JSONDecoder().decode(VaultValue.self, from: data)
                    completed = completed || ["done", "error", "assistant_error"].contains(event["type"].string)
                    onEvent(event)
                    eventLines.removeAll()
                }
            } else if line.hasPrefix("data:") {
                eventLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
            }
        }
        // AsyncBytes.lines discards blank separators on some OS versions. SSE
        // needs those blank lines to delimit events, so preserve the framing.
        var lineBytes: [UInt8] = []
        for try await byte in bytes {
            try Task.checkCancellation()
            if byte == 10 {
                if lineBytes.last == 13 {
                    lineBytes.removeLast()
                }
                guard let line = String(bytes: lineBytes, encoding: .utf8) else {
                    throw VaultError.invalidResponse
                }
                try receiveLine(line)
                lineBytes.removeAll(keepingCapacity: true)
            } else {
                lineBytes.append(byte)
                guard lineBytes.count <= 16 * 1024 * 1024 else { throw VaultError.invalidResponse }
            }
        }
        if !lineBytes.isEmpty {
            guard let line = String(bytes: lineBytes, encoding: .utf8) else { throw VaultError.invalidResponse }
            try receiveLine(line)
        }
        try receiveLine("")
        guard completed else {
            throw VaultError.server("The server closed the stream before completion. Retry the request.")
        }
    }

    func send(
        _ path: [String], method: String = "GET", query: [URLQueryItem] = [],
        body: Data? = nil, contentType: String? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = try URLRequest(url: address.endpoint(path, query: query))
        request.httpMethod = method
        request.httpBody = body
        if path.prefix(2) == ["api", "suggest-filename"] || path.prefix(2) == ["api", "parse"] || path.prefix(2) == ["api", "parse-all"] {
            request.timeoutInterval = 3600
        }
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("docvault_session=\(token)", forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await session.data(for: request)
        return (data, try Self.validateResponse(response, data: data, path: path))
    }

    private static func validateResponse(_ response: URLResponse, data: Data, path: [String]) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw VaultError.invalidResponse }
        if http.statusCode == 401, path != ["api", "login"] {
            throw VaultError.signedOut
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(VaultValue.self, from: data)
            let error: String? = if case let .string(message) = envelope?["error"], !message.isEmpty {
                message
            } else {
                nil
            }
            throw VaultError.server(
                error
                    ?? "Server request failed (HTTP \(http.statusCode)). Check the server URL and connection."
            )
        }
        return http
    }
}
