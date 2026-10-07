@testable import DocVault
import Foundation
import Testing

@Suite("Server addresses") struct ServerAddressTests {
    @Test func normalizesAndPreservesReverseProxyPath() throws {
        let address = try ServerAddress("  https://vault.example.com/docvault/  ")
        #expect(address.url.absoluteString == "https://vault.example.com/docvault")
        #expect(
            try address.endpoint(["api", "entities"]).absoluteString
                == "https://vault.example.com/docvault/api/entities"
        )
    }

    @Test(arguments: [
        "http://nas.local:3005", "http://localhost:3005", "http://192.168.1.20:3005",
        "http://100.100.1.2:3005", "http://[::1]:3005",
    ])
    func acceptsLocalServers(text: String) throws {
        _ = try ServerAddress(text)
    }

    @Test(arguments: [
        "vault.example.com", "ftp://vault.example.com", "https://admin:secret@vault.example.com",
        "https://vault.example.com?token=secret", "https://vault.example.com#portfolio",
        "https://vault.example.com/a/../b", "https://vault.example.com/%2e%2e",
    ])
    func rejectsInvalidAddresses(text: String) {
        #expect(throws: VaultError.invalidAddress) { try ServerAddress(text) }
    }

    @Test func requiresTLSForRemoteServers() {
        #expect(throws: VaultError.httpsRequired) { try ServerAddress("http://vault.example.com") }
        #expect(throws: VaultError.httpsRequired) { try ServerAddress("http://8.8.8.8") }
    }

    @Test func encodesEveryFilePathComponent() throws {
        let address = try ServerAddress("https://vault.example.com")
        let url = try address.endpoint(["api", "file", "acme", "2026 taxes", "A #1 + 50%.pdf"])
        #expect(
            url.absoluteString
                == "https://vault.example.com/api/file/acme/2026%20taxes/A%20%231%20%2B%2050%25.pdf"
        )
        #expect(throws: VaultError.invalidPath) { try address.endpoint(["api", "file", ".."]) }
        #expect(throws: VaultError.invalidPath) { try address.endpoint(["api", "file", "a/b"]) }
    }
}

struct Reply: Sendable {
    let status: Int
    let headers: [String: String]
    let body: Data
}

final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    private static let mutex = NSLock()
    private nonisolated(unsafe) static var replies: [Reply] = []
    private nonisolated(unsafe) static var requests: [URLRequest] = []
    static func reset(_ replies: [Reply]) {
        mutex.withLock {
            self.replies = replies
            requests = []
        }
    }

    static var recorded: [URLRequest] {
        mutex.withLock { requests }
    }

    override class func canInit(with _: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        var captured = request
        if captured.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var body = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 {
                    break
                }
                body.append(contentsOf: buffer.prefix(count))
            }
            captured.httpBody = body
        }
        let reply = Self.mutex.withLock {
            Self.requests.append(captured)
            return Self.replies.isEmpty
                ? Reply(status: 500, headers: [:], body: Data()) : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: reply.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite("DocVault API", .serialized) @MainActor struct VaultAPITests {
    @Test func webCookieSupportsLocalHTTPAndRequiresSecureForHTTPS() throws {
        for address in ["http://127.0.0.1:3005", "https://vault.example.com"] {
            let api = try VaultAPI(address: ServerAddress(address), token: "synthetic-session")
            let cookie = try #require(api.webSessionCookie)
            #expect(cookie.isSecure == address.hasPrefix("https://"))
            #expect(cookie.isHTTPOnly)
            #expect(cookie.value == "synthetic-session")
            #expect(cookie.path == "/")
        }
    }

    func client(_ replies: [Reply], token: String? = nil) throws -> VaultAPI {
        MockURLProtocol.reset(replies)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        config.httpShouldSetCookies = false
        return try VaultAPI(
            address: ServerAddress("https://vault.example.com/docvault"), token: token,
            session: URLSession(configuration: config)
        )
    }

    func json(_ text: String, status: Int = 200, headers: [String: String] = [:]) -> Reply {
        .init(status: status, headers: headers, body: Data(text.utf8))
    }

    @Test func signsInAndUsesSessionWithoutRetainingPassword() async throws {
        let api = try client([
            json(
                #"{"ok":true}"#,
                headers: [
                    "Set-Cookie":
                        "docvault_session=synthetic-session; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
                ]
            ),
            json(#"{"ok":true,"authRequired":true,"authenticated":true}"#),
            json(#"{"entities":[{"id":"acme","name":"Acme LLC","color":"blue","type":"tax"}]}"#),
        ])
        try await api.login(username: "admin", password: "fake-password")
        let entities = try await api.entities()
        #expect(entities.first?.name == "Acme LLC")
        #expect(api.token == "synthetic-session")
        #expect(
            MockURLProtocol.recorded.map { $0.url!.path } == [
                "/docvault/api/login", "/docvault/api/status", "/docvault/api/entities",
            ]
        )
        #expect(
            MockURLProtocol.recorded.last?.value(forHTTPHeaderField: "Cookie")
                == "docvault_session=synthetic-session"
        )
        #expect(MockURLProtocol.recorded.last?.httpBody == nil)
    }

    @Test func refusesLoginWithoutSessionCookie() async throws {
        let api = try client([
            json(#"{"ok":true}"#), json(#"{"ok":true,"authRequired":true,"authenticated":false}"#),
        ])
        await #expect(throws: VaultError.missingSession) {
            try await api.login(username: "admin", password: "fake")
        }
    }

    @Test func failedLoginReportsCredentials() async throws {
        let api = try client([json(#"{"error":"Invalid credentials"}"#, status: 401)])
        await #expect(throws: VaultError.server("Invalid credentials")) {
            try await api.login(username: "admin", password: "fake")
        }
    }

    @Test func serverErrorEnvelopesMayContainBooleansAndStructuredMetadata() async throws {
        let api = try client([
            json(#"{"ok":false,"error":"Synthetic custom job not found","details":{"job":"acme"}}"#, status: 400),
            json(#"{"ok":false,"error":42}"#, status: 500),
        ])
        await #expect(throws: VaultError.server("Synthetic custom job not found")) {
            try await api.request(VaultRequest("api/jobs/acme/run", scope: .init()), method: "POST")
        }
        await #expect(throws: VaultError.server("Server request failed (HTTP 500). Check the server URL and connection.")) {
            try await api.request(VaultRequest("api/jobs/acme/run", scope: .init()), method: "POST")
        }
    }

    @Test func expiresProtectedRequestsOn401() async throws {
        let api = try client([json(#"{"error":"Unauthorized"}"#, status: 401)], token: "expired")
        await #expect(throws: VaultError.signedOut) { try await api.entities() }
    }

    @Test func uploadsRawBytesAndUsesReturnedCollisionPath() async throws {
        let api = try client([json(#"{"ok":true,"path":"2026 taxes/Inbox/Receipt_2.pdf"}"#)])
        let bytes = Data("%PDF-synthetic".utf8)
        let path = try await api.upload(
            data: bytes, entity: "acme", folder: "2026 taxes/Inbox", name: "Receipt.pdf",
            contentType: "application/pdf"
        )
        #expect(path == "2026 taxes/Inbox/Receipt_2.pdf")
        let request = try #require(MockURLProtocol.recorded.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/pdf")
        let requestURL = try #require(request.url)
        let query = try #require(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(query.first(where: { $0.name == "path" })?.value == "2026 taxes/Inbox")
        // URLSession transports bodies through a stream when using URLProtocol.
        if let body = request.httpBody {
            #expect(body == bytes)
        } else {
            let stream = try #require(request.httpBodyStream)
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 128)
            let count = stream.read(&buffer, maxLength: buffer.count)
            #expect(Data(buffer.prefix(count)) == bytes)
        }
    }

    @Test(arguments: ["../private", "/absolute", "2026//inbox", "2026/../inbox", "2026\\inbox", ""])
    func rejectsUnsafeUploadFolders(folder: String) {
        #expect(throws: VaultError.invalidPath) {
            try VaultAPI.validateUpload(data: Data([1]), folder: folder, name: "Sample.pdf")
        }
    }

    @Test func rejectsEmptyUploads() {
        #expect(throws: VaultError.emptyUpload) {
            try VaultAPI.validateUpload(data: Data(), folder: "inbox", name: "Sample.pdf")
        }
    }

    @Test func namingAnalysisSendsRawBytesWithEncodedFilenameAndSelectedYear() async throws {
        let api = try client([json(#"{"ok":true,"suggestion":{"source":"Acme","documentType":"receipt","year":2024},"parsedData":{"amount":0}}"#)])
        let name = "Acme #1 + 50% & scan.pdf"
        let bytes = Data("Invented document bytes".utf8)
        let result = try await api.uploadBytes(NativeDocumentImport.analysisRequest(name: name, year: 2024), data: bytes)
        #expect(result["parsedData"]["amount"] == .number(0))
        let sent = try #require(MockURLProtocol.recorded.first)
        #expect(sent.httpMethod == "POST" && sent.httpBody == bytes && sent.timeoutInterval == 3600)
        let url = try #require(sent.url), query = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(url.path == "/docvault/api/suggest-filename" && query.first { $0.name == "filename" }?.value == name && query.first { $0.name == "year" }?.value == "2024")
    }

    @Test func decodesFilesWithOptionalMetadataAndMillisecondDates() async throws {
        let api = try client([
            json(
                #"{"files":[{"name":"Sample.pdf","path":"2026/Sample.pdf","size":1024,"lastModified":1767225600000,"type":"application/pdf","isDirectory":false,"parsedData":{"vendor":"Acme Bank"}}]}"#
            ),
        ])
        let file = try #require(try await api.files(entity: "acme").first)
        #expect(file.id == "acme/2026/Sample.pdf")
        #expect(file.modifiedDate.timeIntervalSince1970 == 1_767_225_600)
        #expect(file.folder == "2026")
    }

    @Test func metadataMatchesExistingEndpoint() async throws {
        let api = try client([json(#"{"ok":true}"#)])
        let file = DemoVault.files(entity: "personal")[0]
        try await api.saveMetadata(
            file: file, entity: "personal", notes: "Synthetic note", tags: ["Reviewed"]
        )
        #expect(MockURLProtocol.recorded.first?.httpMethod == "PUT")
        #expect(MockURLProtocol.recorded.first?.url?.path == "/docvault/api/metadata")
    }

    @Test func trackingUsesAnExplicitPartialMetadataSaveAndDecodesExclusions() async throws {
        let api = try client([json(#"{"files":[{"name":"Sample.pdf","path":"2024/Sample.pdf","size":1234,"lastModified":0,"type":"application/pdf","tracked":false,"notes":"Invented note","tags":["Reviewed"]}]}"#), json(#"{"ok":true}"#)])
        let file = try #require(try await api.files(entity: "acme").first)
        #expect(!file.isTracked)
        try await api.saveMetadata(file: file, entity: "acme", tracked: true)
        let request = try #require(MockURLProtocol.recorded.last)
        let body = try JSONDecoder().decode(VaultValue.self, from: #require(request.httpBody))
        #expect(request.httpMethod == "PUT" && request.url?.path == "/docvault/api/metadata")
        #expect(body.object.keys.sorted() == ["entity", "filePath", "tracked"])
        #expect(body["tracked"] == .bool(true))
    }

    @Test func metadataRequiresServerConfirmationBeforeReportingSuccess() async throws {
        let api = try client([json(#"{"ok":false}"#)])
        let file = VaultFile(name: "Sample.pdf", path: "Sample.pdf", size: 1234, lastModified: 0, type: "application/pdf")
        await #expect(throws: VaultError.invalidResponse) { try await api.saveMetadata(file: file, entity: "acme", tracked: false) }
    }
}

@Suite("Native vault", .serialized) @MainActor struct VaultModelTests {
    @Test func demoReportDraftsScopePreviewAndSimulatedDeliveryUseTheSameStore() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultDemoReportTest"))); model.enterDemo()
        let initial = try await model.timesheetReportReview(end: "2026-10-07")
        #expect(initial.preview.rows.count == 6)
        var draft = NativeReportDraft(initial.config); draft.clientIds = ["acme-client"]; draft.projectIds = ["acme-project"]
        _ = try await model.saveTimesheetReport(original: initial.config, draft: draft)
        let scoped = try await model.timesheetReportReview(end: "2026-10-07")
        #expect(scoped.preview.rows.count == 5 && scoped.preview.totalAmount == 300)
        let sent = try await model.sendTimesheetReport(scoped)
        #expect(sent["demo"] == .bool(true) && sent["weekEnd"].string == "2026-10-07")
        let accepted = try await model.timesheetReportReview(end: "2026-10-07")
        #expect(accepted.alreadySent)
        draft.to = ""
        let saved = try await model.saveTimesheetReport(original: accepted.config, draft: draft)
        #expect(saved["lastSentWeek"].string == "2026-10-07")
        let noRecipient = try await model.timesheetReportReview(end: "2026-10-07")
        await #expect(throws: VaultError.self) { try await model.sendTimesheetReport(noRecipient) }
        #expect(try await model.timesheetReportReview(end: "2026-10-07").config["lastSentWeek"].string == "2026-10-07")
    }

    @Test func demoOrganizationRetainsTrackingAndMetadataAcrossRenameMoveAndClassification() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultOrganizationTest")))
        model.enterDemo()
        let original = try #require(try await model.files(entity: "personal").first { $0.name == "Equipment_Receipt.pdf" })
        try await model.saveMetadata(file: original, entity: "personal", notes: "Invented preserved note", tags: ["Reviewed"])
        try await model.saveMetadata(file: original, entity: "personal", tracked: false)
        let excluded = try #require(try await model.files(entity: "personal").first { $0.path == original.path })
        #expect(!excluded.isTracked && excluded.notes == "Invented preserved note" && excluded.tags == ["Reviewed"])
        #expect(!model.demoTaxSummary(year: "2026")["summary"]["personal"]["documents"].array.contains { $0["path"].string == excluded.path })
        var metadata = NativeDocumentOrganization.metadata(excluded, fallbackYear: 2026)
        metadata.customName = "Acme_Reviewed_Receipt.pdf"
        let renamed = try NativeDocumentOrganization.plan(file: excluded, entity: "personal", target: "personal", metadata: metadata, organize: false)
        try await model.moveOrganizedDocument(renamed)
        let renamedFile = try #require(try await model.files(entity: "personal").first { $0.path == renamed.destination.path })
        metadata = NativeDocumentOrganization.metadata(renamedFile, fallbackYear: 2026); metadata.category = "medical"; metadata.year = "2025"
        let moved = try NativeDocumentOrganization.plan(file: renamedFile, entity: "personal", target: "acme", metadata: metadata, organize: true)
        try await model.moveOrganizedDocument(moved); try await model.classifyOrganizedDocument(moved)
        let result = try #require(try await model.files(entity: "acme").first { $0.path == moved.destination.path })
        #expect(!result.isTracked && result.notes == "Invented preserved note" && result.tags == ["Reviewed"])
        #expect(result.parsedData?["amount"] == original.parsedData?["amount"] && result.parsedData?["category"].string == "medical")
        try await model.saveMetadata(file: result, entity: "acme", tracked: true)
        #expect(model.demoTaxSummary(year: "2025")["summary"]["acme"]["documents"].array.contains { $0["path"].string == result.path })
        await #expect(throws: (any Error).self) { try await model.moveOrganizedDocument(moved) }
        #expect(model.api == nil)
        await model.disconnect()
    }

    @Test func documentBatchesPreserveMetadataAndRejectMoveCollisions() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultBulkTest")))
        model.enterDemo()
        let original = try #require(try await model.files(entity: "personal").first)
        try await model.saveMetadata(file: original, entity: "personal", notes: "Synthetic reviewed note", tags: ["Reviewed"])
        try await model.addDocumentTags(original, entity: "personal", tags: ["Reviewed", "Tax"])
        let duplicatePath = try await model.upload(.init(data: Data([1]), name: original.name, contentType: original.type), entity: "personal", folder: "duplicate", name: original.name)
        let duplicate = try #require(try await model.files(entity: "personal").first(where: { $0.path == duplicatePath }))
        try await model.moveDocument(original, entity: "personal", toEntity: "acme", folder: "inbox")
        let destination = try #require(try await model.files(entity: "acme").first(where: { $0.path == "inbox/\(original.name)" }))
        #expect(destination.tags == ["Reviewed", "Tax"])
        #expect(destination.notes == "Synthetic reviewed note")
        await #expect(throws: (any Error).self) { try await model.moveDocument(duplicate, entity: "personal", toEntity: "acme", folder: "inbox") }
        let remaining = try await model.files(entity: "personal")
        #expect(remaining.contains(where: { $0.path == duplicatePath }))
        try await model.deleteDocument(destination, entity: "acme")
        let deleted = try await model.files(entity: "acme")
        #expect(!deleted.contains(where: { $0.path == destination.path }))
    }

    @Test func uploadMimeChangesKeepTheReviewedTaxDestination() throws {
        var draft = UploadDraft(data: Data("Invented scan".utf8), name: "Acme_Scan.dat", contentType: "application/octet-stream")
        draft.destination = try NativeTaxWorkspace.destination(entity: "acme", year: "2024", folder: "expenses/business")
        let corrected = draft.withContentType("application/pdf")
        #expect(corrected.destination == draft.destination)
        #expect(corrected.data == draft.data && corrected.contentType == "application/pdf")
    }

    @Test func uploadedDemoFilesAppearInTheirSelectedTaxYearWithoutInventedParsedTotals() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultDemoTaxUploadTest")))
        model.enterDemo()
        let draft = UploadDraft(data: DemoVault.pdf(title: "Invented imported receipt"), name: "Acme_Imported_Receipt.pdf", contentType: "application/pdf")
        let path = try await model.upload(draft, entity: "acme", folder: "2024/expenses/business", name: draft.name)
        let report = try await model.nativeRequest("api/tax-summary/2024", scope: .init())
        #expect(report["summary"]["acme"]["documents"].array.contains { $0["path"].string == path && $0["parsedData"] == .null })
        let statistics = try await model.nativeRequest("api/analytics/quick-stats/acme/2024", scope: .init())
        #expect(statistics["documentCount"].number == 1 && statistics["expenses"]["totalExpenses"].number == 0)
        #expect(!model.demoTaxSummary(year: "2026")["summary"]["acme"]["documents"].array.contains { $0["path"].string == path })
    }

    @Test func demoExtractedDataUsesTheConfirmedCollisionPathOnly() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultDemoImportParseTest"))); model.enterDemo()
        let draft = UploadDraft(data: DemoVault.pdf(title: "Invented receipt"), name: "Acme_Receipt.pdf", contentType: "application/pdf")
        let first = try await model.upload(draft, entity: "acme", folder: "2024/expenses/business", name: draft.name)
        let second = try await model.upload(draft, entity: "acme", folder: "2024/expenses/business", name: draft.name)
        var metadata = NativeImportMetadata(name: draft.name, folder: "2024/expenses/business", year: 2024, month: 3, standardName: true)
        try metadata.apply(try await model.analyzeImport(draft, year: 2024)); metadata.category = "medical"
        try await model.saveImportedParse(entity: "acme", path: second, parsed: try #require(metadata.reviewedParsedData))
        let files = try await model.files(entity: "acme")
        #expect(first != second && second.hasSuffix("_2.pdf"))
        #expect(files.first { $0.path == first }?.parsedData == nil)
        #expect(files.first { $0.path == second }?.parsedData?["category"].string == "medical")
        #expect(files.first { $0.path == second }?.parsedData?["amount"] == .number(1234.56))
    }

    @Test func emptyExtractedDataNeverMarksADemoUploadParsed() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultDemoImportEmptyTest"))); model.enterDemo()
        let draft = UploadDraft(data: DemoVault.pdf(title: "Invented empty analysis"), name: "Acme.pdf", contentType: "application/pdf")
        let path = try await model.upload(draft, entity: "acme", folder: "2024/inbox", name: draft.name)
        await #expect(throws: VaultError.self) { try await model.saveImportedParse(entity: "acme", path: path, parsed: .object(["parsed": .bool(true)])) }
        #expect(try await model.files(entity: "acme").first { $0.path == path }?.parsedData == nil)
    }

    @Test func stagedLargeDocumentsStayOnDiskAndCleanupPreservesTheOriginal() async throws {
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultStagedImportTest")))
        model.enterDemo()
        let original = FileManager.default.temporaryDirectory.appendingPathComponent("Synthetic-\(UUID()).bin")
        defer { try? FileManager.default.removeItem(at: original) }
        try Data("Synthetic large upload".utf8).write(to: original)
        let handle = try FileHandle(forWritingTo: original)
        try handle.truncate(atOffset: 101 * 1024 * 1024)
        try handle.close()
        let staged = try await Task.detached { try UploadDraft.stage(original) }.value
        let stagedURL = try #require(staged.fileURL)
        #expect(staged.data.isEmpty)
        #expect(staged.size == 101 * 1024 * 1024)
        // The simulator ignores Data Protection metadata. A device run checks
        // the protection class; simulator runs still verify ownership/cleanup.
        #if !targetEnvironment(simulator)
            let protection = try FileManager.default.attributesOfItem(atPath: stagedURL.path)[.protectionKey] as? String
            #expect(protection == FileProtectionType.complete.rawValue)
        #endif
        try VaultAPI.validateUpload(size: VaultAPI.maxUploadBytes, folder: "inbox", name: "Synthetic.bin")
        #expect(throws: VaultError.uploadTooLarge) { try VaultAPI.validateUpload(size: VaultAPI.maxUploadBytes + 1, folder: "inbox", name: "Synthetic.bin") }
        model.draft = staged
        model.importFiles([original])
        let deadline = Date().addingTimeInterval(3)
        while model.importingFiles, Date() < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        let queuedURL = try #require(model.draft?.additional.first?.fileURL)
        #expect(model.draft?.id == staged.id)
        #expect(FileManager.default.fileExists(atPath: stagedURL.path))
        #expect(FileManager.default.fileExists(atPath: queuedURL.path))
        await model.disconnect()
        #expect(!FileManager.default.fileExists(atPath: stagedURL.path))
        #expect(!FileManager.default.fileExists(atPath: queuedURL.path))
        #expect(FileManager.default.fileExists(atPath: original.path))
    }

    @Test func demoDoesNotReplaceSavedServerAndSupportsDocuments() async throws {
        let suite = "DocVaultTests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("https://vault.example.com", forKey: "serverURL")
        let model = VaultModel(defaults: defaults)
        model.enterDemo()
        #expect(model.api == nil)
        #expect(model.savedAddress == "https://vault.example.com")
        let matches = try await model.search("Statement")
        let file = try #require(matches.first)
        let preview = try await model.preview(file, entity: "personal")
        #expect(try Data(contentsOf: preview).starts(with: Data("%PDF".utf8)))
        VaultModel.removePreview(preview)
        #expect(!FileManager.default.fileExists(atPath: preview.path))
        try await model.saveMetadata(
            file: file, entity: "personal", notes: "Demo note", tags: ["Reviewed"]
        )
        #expect(
            try await model.files(entity: "personal").first(where: { $0.path == file.path })?.notes
                == "Demo note"
        )
        let draft = UploadDraft(
            data: Data("demo".utf8), name: "Sample.txt", contentType: "text/plain"
        )
        #expect(
            try await model.upload(
                draft, entity: "personal", folder: "2026/inbox", name: "Sample.txt"
            )
                == "2026/inbox/Sample.txt"
        )
        #expect(
            try await model.upload(
                draft, entity: "personal", folder: "2026/inbox", name: "Sample.txt"
            )
                == "2026/inbox/Sample_2.txt"
        )
        await model.disconnect()
        #expect(!model.connected)
        #expect(model.savedAddress == "https://vault.example.com")
    }

    @Test func expiredSessionClearsPrivateState() throws {
        let model = try VaultModel(defaults: #require(UserDefaults(suiteName: "DocVaultExpiredSessionTest")))
        model.enterDemo()
        model.draft = .init(data: Data([1]), name: "Sample.txt", contentType: "text/plain")
        model.worksheetInputs = ["synthetic-worksheet": ["gross": "1234.56"]]
        model.handle(VaultError.signedOut)
        #expect(!model.connected)
        #expect(model.entities.isEmpty)
        #expect(model.draft == nil)
        #expect(model.worksheetInputs.isEmpty)
    }
}
