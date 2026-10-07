import SwiftUI
import VisionKit

private struct NativeImportPreview: Identifiable {
    let url: URL
    var id: String {
        url.absoluteString
    }
}

struct UploadView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let draft: UploadDraft
    @State private var entity = ""
    @State private var folder = ""
    @State private var metadata: [UUID: NativeImportMetadata] = [:]
    @State private var receipts: [UUID: NativeUploadReceipt] = [:]
    @State private var failures: [UUID: String] = [:]
    @State private var analysisErrors: [UUID: String] = [:]
    @State private var analyzing = Set<UUID>()
    @State private var analysisWorkers: [UUID: Task<VaultValue, Error>] = [:]
    @State private var analyzed = Set<UUID>()
    @State private var uploading = false
    @State private var currentName = ""
    @State private var parseDocuments = false
    @State private var organize = false
    @State private var initialized = false
    @State private var keeping: UUID?
    @State private var excluded = Set<UUID>()
    @State private var preview: NativeImportPreview?
    @State private var previewFolder: URL?
    private var activeDraft: UploadDraft {
        if let current = model.draft, current.id == draft.id {
            return current
        }; return draft
    }

    private var allDrafts: [UploadDraft] {
        [activeDraft] + activeDraft.additional
    }

    private var drafts: [UploadDraft] {
        allDrafts.filter { !excluded.contains($0.id) }
    }

    private var finished: Bool {
        !drafts.isEmpty && drafts.allSatisfy { receipts[$0.id]?.complete == true }
    }

    private var taxImport: Bool {
        activeDraft.destination != nil
    }

    private var canUpload: Bool {
        !drafts.isEmpty && !uploading && !finished && analyzing.isEmpty && !entity.isEmpty && (organize || !folder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var uploadTitle: String {
        failures.isEmpty ? (drafts.count == 1 ? "Upload document" : "Upload documents") : "Retry remaining steps"
    }

    private var savedCount: Int {
        receipts.count
    }

    private var parsedCount: Int {
        receipts.values.filter(\.parsed).count
    }

    var body: some View {
        NavigationStack {
            Form {
                VaultMetricGrid(metrics: [.init(title: "Selected", value: String(drafts.count), symbol: "doc.on.doc"), .init(title: "Saved", value: String(savedCount), symbol: "checkmark.circle"), .init(title: "Parsed", value: String(parsedCount), symbol: "sparkles")], color: .indigo).vaultStandaloneRow().accessibilityIdentifier("uploadMetrics")
                if finished {
                    Section {
                        Label(drafts.count == 1 ? "Document uploaded" : "Documents uploaded", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.headline)
                        Text(model.demo ? "Saved only in this demo session." : "Saved on your DocVault server.").foregroundStyle(.secondary)
                        if receipts.values.contains(where: \.keptUnparsed) {
                            Text("Some documents were explicitly kept without confirmed parsed data. You can parse them from document details later.").font(.footnote)
                        }
                    }
                } else {
                    Section("Destination") {
                        Picker("Entity", selection: $entity) {
                            if entity.isEmpty {
                                Text("Choose an entity").tag("")
                            }
                            ForEach(model.entities) { Text($0.name).tag($0.id) }
                        }.accessibilityIdentifier("uploadEntity")
                        Toggle("Organize by document type", isOn: $organize).accessibilityIdentifier("uploadOrganize")
                        if !organize {
                            TextField("Folder", text: $folder).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("uploadFolder")
                            Text("Choose a folder relative to this entity. New folders are created automatically.").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Text("Each document's reviewed type, category and year determine its folder. Final locations are shown below.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }.disabled(!receipts.isEmpty)
                    Section("Extraction") {
                        if taxImport {
                            Label("Tax documents use AI extraction", systemImage: "sparkles").font(.callout)
                        } else {
                            Toggle("Extract data with AI", isOn: $parseDocuments).accessibilityIdentifier("uploadParse")
                        }
                        Text("Analysis suggests names and extracts fields through your server's configured provider. Your edits stay intact. Failed extraction stays visible after a document is saved.").font(.footnote).foregroundStyle(.secondary)
                    }.disabled(!receipts.isEmpty)
                }
                ForEach(Array(drafts.enumerated()), id: \.element.id) { index, item in
                    Section(drafts.count == 1 ? "Document" : "Document \(index + 1) of \(drafts.count)") {
                        if let receipt = receipts[item.id] {
                            Label(item.name, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                            Text(receipt.path).textSelection(.enabled).accessibilityIdentifier(index == 0 ? "uploadedPath" : "uploadedPath-\(index)")
                            Label(receipt.parsed ? "Parsed data saved" : receipt.keptUnparsed ? "Kept without confirmed parsed data" : receipt.requiresParsing ? "Saved; parsing still needs confirmation" : "Saved without parsing", systemImage: receipt.parsed ? "sparkles" : "doc").font(.callout).accessibilityIdentifier("uploadParseStatus-\(index)")
                            if !receipt.complete {
                                Button("Keep document without parsed data…") { keeping = item.id }.accessibilityIdentifier("uploadKeepUnparsed-\(index)")
                            }
                        } else {
                            TextField("Filename", text: filenameBinding(item)).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier(index == 0 ? "uploadFilename" : "uploadFilename-\(index)")
                            LabeledContent("Original filename", value: item.name)
                            LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: item.size, countStyle: .file))
                            Button("Preview original", systemImage: "eye") { preparePreview(item) }.accessibilityIdentifier("uploadPreview-\(index)")
                            if parseDocuments || organize {
                                importFields(item, index: index)
                            }
                            if let location = try? location(item) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("Final location").font(.caption).foregroundStyle(.secondary)
                                    Text(location.folder + "/" + location.name).font(.callout).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                                }.accessibilityIdentifier("uploadLocation-\(index)")
                            }
                            if parseDocuments {
                                if analyzing.contains(item.id) {
                                    ProgressView("Analyzing document…")
                                    Button("Cancel analysis") { analysisWorkers[item.id]?.cancel() }.accessibilityIdentifier("uploadCancelAnalysis-\(index)")
                                } else if NativeDocumentImport.supportedAnalysis(item.name) {
                                    Button(analyzed.contains(item.id) ? "Analyze again" : "Analyze document", systemImage: "sparkles") { Task { await analyze(item) } }.accessibilityIdentifier("uploadAnalyze-\(index)")
                                } else {
                                    Text("Naming analysis supports PDF and common image formats. Other files retain your classification; parsing is attempted after upload.").font(.footnote).foregroundStyle(.secondary)
                                }
                                if let error = analysisErrors[item.id] {
                                    ErrorNotice(message: error).accessibilityIdentifier("uploadAnalysisError-\(index)")
                                }
                            }
                            Button("Remove from this batch", role: .destructive) { excluded.insert(item.id) }.disabled(analyzing.contains(item.id)).accessibilityIdentifier("uploadRemove-\(index)")
                        }
                        if let values = metadata[item.id]?.reviewedParsedData {
                            NavigationLink("Review extracted fields") { List { NativeValueSections(value: values) }.navigationTitle("Extracted fields") }.accessibilityIdentifier("uploadExtracted-\(index)")
                        }
                        if let message = failures[item.id] {
                            ErrorNotice(message: message).accessibilityIdentifier("uploadFailure-\(index)")
                        }
                    }
                }
                if !activeDraft.importErrors.isEmpty {
                    Section("Files that could not be imported") { ForEach(activeDraft.importErrors, id: \.self) { Text($0).foregroundStyle(.red) } }
                }
                if !excluded.isEmpty {
                    Section("Removed from this batch") {
                        ForEach(allDrafts.filter { excluded.contains($0.id) }) { item in Button("Restore " + item.name) { excluded.remove(item.id) } }
                        Text("Original files stay intact. The protected temporary copies are removed when this review closes.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if !finished {
                    Section {
                        Button(uploading ? "Saving \(currentName)…" : failures.isEmpty ? "Upload documents" : "Retry remaining steps") { submit() }.disabled(!canUpload).accessibilityIdentifier("uploadDocumentsInline")
                        if uploading {
                            ProgressView(value: Double(receipts.values.filter(\.complete).count), total: Double(drafts.count))
                        }
                        Text("Existing filenames get a numbered suffix. Retries reuse confirmed saved paths and only repeat incomplete steps.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }.disabled(uploading).scrollDismissesKeyboard(.interactively)
                .navigationTitle(finished ? "Uploaded" : drafts.isEmpty ? "No documents selected" : drafts.count == 1 ? "Add document" : "Add \(drafts.count) documents").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(finished ? "Done" : receipts.isEmpty ? "Cancel" : "Close") { dismiss() }.disabled(uploading || !analyzing.isEmpty) }
                    ToolbarItem(placement: .primaryAction) {
                        if !finished {
                            Button(uploading ? "Saving…" : uploadTitle) { submit() }.disabled(!canUpload).accessibilityIdentifier("uploadDocuments")
                        }
                    }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("uploadKeyboardDone") }
                }
        }.interactiveDismissDisabled(uploading || !analyzing.isEmpty)
            .sheet(item: $preview, onDismiss: removePreview) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
            .onDisappear { removePreview() }
            .task(id: drafts.map(\.id)) {
                initialize(); if parseDocuments {
                    await analyzePending()
                }
            }
            .onChange(of: entity) {
                _, _ in if receipts.isEmpty {
                    updateFolder()
                }
            }
            .onChange(of: parseDocuments) {
                _, enabled in if enabled {
                    Task { await analyzePending() }
                }
            }
            .confirmationDialog("Keep the saved document without parsed data?", isPresented: Binding(get: { keeping != nil }, set: {
                if !$0 {
                    keeping = nil
                }
            }), titleVisibility: .visible) {
                Button("Keep unparsed document") {
                    if let keeping {
                        receipts[keeping]?.keptUnparsed = true; failures.removeValue(forKey: keeping)
                    }; keeping = nil
                }.accessibilityIdentifier("uploadConfirmKeepUnparsed")
                Button("Retry parsing", role: .cancel) { keeping = nil }
            } message: { Text("The original stays on your server. This acknowledges the incomplete extraction; it does not create parsed amounts or remove the file.") }
    }

    private func importFields(_ item: UploadDraft, index: Int) -> some View {
        DisclosureGroup("Classification & naming") {
            Picker("Document type", selection: field(item, \.type, key: "type")) { ForEach(NativeDocumentImport.types, id: \.0) { type, label in Text(label).tag(type) } }.accessibilityIdentifier("uploadType-\(index)")
            if metadata[item.id]?.type == "receipt" {
                Picker("Expense category", selection: field(item, \.category, key: "category")) { ForEach(NativeDocumentImport.categories, id: \.0) { category, label in Text(label).tag(category) } }.accessibilityIdentifier("uploadCategory-\(index)")
            }
            TextField("Source / vendor", text: field(item, \.source, key: "source")).accessibilityIdentifier("uploadSource-\(index)")
            TextField("Description", text: field(item, \.description, key: "description")).accessibilityIdentifier("uploadDescription-\(index)")
            TextField("Document year", text: field(item, \.year, key: "year")).keyboardType(.numberPad).accessibilityIdentifier("uploadYear-\(index)")
            TextField("Month (optional)", text: field(item, \.month, key: "month")).keyboardType(.numberPad).accessibilityIdentifier("uploadMonth-\(index)")
            TextField("Day (optional)", text: field(item, \.day, key: "day")).keyboardType(.numberPad).accessibilityIdentifier("uploadDay-\(index)")
            Toggle("Use a standard filename", isOn: Binding(get: { value(item).standardName }, set: { var next = value(item); next.standardName = $0; next.edited.insert("filename"); metadata[item.id] = next })).accessibilityIdentifier("uploadStandardName-\(index)")
        }.accessibilityIdentifier("uploadClassification-\(index)")
    }

    private func value(_ item: UploadDraft) -> NativeImportMetadata {
        metadata[item.id] ?? .init(name: item.name, folder: folder, year: Calendar.current.component(.year, from: Date()), month: Calendar.current.component(.month, from: Date()), standardName: false)
    }

    private func preparePreview(_ item: UploadDraft) {
        do {
            removePreview()
            if let fileURL = item.fileURL {
                preview = .init(url: fileURL)
            } else {
                let root = UploadDraft.stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                previewFolder = root
                let url = root.appendingPathComponent((item.name as NSString).lastPathComponent)
                try item.data.write(to: url, options: [.atomic, .completeFileProtection]); preview = .init(url: url)
            }
        } catch { failures[item.id] = error.localizedDescription; removePreview() }
    }

    private func removePreview() {
        if let previewFolder {
            try? FileManager.default.removeItem(at: previewFolder)
        }; previewFolder = nil
    }

    private func field(_ item: UploadDraft, _ keyPath: WritableKeyPath<NativeImportMetadata, String>, key: String) -> Binding<String> {
        Binding(get: { value(item)[keyPath: keyPath] }, set: { var next = value(item); next[keyPath: keyPath] = $0; next.edited.insert(key); metadata[item.id] = next })
    }

    private func filenameBinding(_ item: UploadDraft) -> Binding<String> {
        Binding(get: { (try? NativeDocumentImport.filename(value(item), original: item.name)) ?? value(item).customName }, set: { var next = value(item); next.customName = $0; next.standardName = false; next.edited.insert("filename"); metadata[item.id] = next })
    }

    private func location(_ item: UploadDraft) throws -> (folder: String, name: String) {
        let values = value(item), name = try NativeDocumentImport.filename(values, original: item.name)
        return (organize ? try NativeDocumentImport.directory(type: values.type, category: values.category, year: values.validYear(), filename: name) : folder.trimmingCharacters(in: .whitespacesAndNewlines), name)
    }

    private func initialize() {
        if !initialized {
            initialized = true
            entity = draft.destination?.entity ?? model.entities.first?.id ?? ""
            if let target = draft.destination, !model.entities.contains(where: { $0.id == target.entity }) {
                entity = ""
            }
            parseDocuments = taxImport; organize = draft.destination?.organizeByType ?? false; updateFolder()
        }
        let selectedYear = folder.split(separator: "/").first.flatMap { Int($0) } ?? Calendar.current.component(.year, from: Date())
        for item in drafts where metadata[item.id] == nil {
            metadata[item.id] = .init(name: item.name, folder: folder, year: selectedYear, month: Calendar.current.component(.month, from: Date()), standardName: taxImport)
        }
    }

    private func updateFolder() {
        guard let selected = model.entities.first(where: { $0.id == entity }) else { folder = ""; return }
        folder = NativeTaxWorkspace.uploadFolder(destination: draft.destination, entity: selected, currentYear: Calendar.current.component(.year, from: Date()))
    }

    private func analyzePending() async {
        for item in drafts where !analyzed.contains(item.id) && receipts[item.id] == nil && NativeDocumentImport.supportedAnalysis(item.name) {
            await analyze(item)
        }
    }

    private func analyze(_ item: UploadDraft) async {
        guard !analyzing.contains(item.id), !uploading, receipts[item.id] == nil else { return }
        analyzing.insert(item.id); analysisErrors.removeValue(forKey: item.id)
        defer {
            analyzing.remove(item.id); analysisWorkers.removeValue(forKey: item.id); if !Task.isCancelled {
                analyzed.insert(item.id)
            }
        }
        do {
            let year = try value(item).validYear()
            let worker = Task { try await model.analyzeImport(item, year: year) }; analysisWorkers[item.id] = worker
            let result = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
            guard !worker.isCancelled else { throw CancellationError() }
            guard !Task.isCancelled else { return }; var next = value(item); try next.apply(result); metadata[item.id] = next
        } catch {
            if !Task.isCancelled {
                analysisErrors[item.id] = error is CancellationError || (error as? URLError)?.code == .cancelled ? "Analysis cancelled. You can analyze again or continue with your own classification." : error.localizedDescription
            }
        }
    }

    private func submit() {
        guard canUpload else { return }; uploading = true
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        Task {
            defer { uploading = false }
            for item in drafts where receipts[item.id]?.complete != true {
                failures.removeValue(forKey: item.id)
                do {
                    let values = value(item); _ = try values.validYear(); _ = try values.validMonth(); _ = try values.validDay()
                    let target = try location(item); currentName = target.name
                    let outcome = await NativeImportPipeline.perform(existing: receipts[item.id], entity: entity, parse: parseDocuments, extracted: values.reviewedParsedData, upload: { try await model.upload(item, entity: entity, folder: target.folder, name: target.name) }, persist: { savedEntity, path, extracted in
                        var reviewed = value(item)
                        if extracted == nil {
                            reviewed.parsedData = try await model.extractImportedDocument(entity: savedEntity, path: path, year: reviewed.validYear()); metadata[item.id] = reviewed
                        }
                        guard let data = reviewed.reviewedParsedData else { throw VaultError.server("No extracted fields are available.") }
                        try await model.saveImportedParse(entity: savedEntity, path: path, parsed: data)
                    })
                    receipts[item.id] = outcome.receipt; failures[item.id] = outcome.error
                    if !model.connected {
                        break
                    }
                } catch { failures[item.id] = error.localizedDescription }
            }
        }
    }
}

struct DocumentScanner: UIViewControllerRepresentable {
    let finished: (Result<Data, Error>) -> Void
    let cancel: () -> Void
    func makeCoordinator() -> Coordinator {
        Coordinator(finished: finished, cancel: cancel)
    }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_: VNDocumentCameraViewController, context _: Context) {}
    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let finished: (Result<Data, Error>) -> Void
        let cancel: () -> Void
        init(finished: @escaping (Result<Data, Error>) -> Void, cancel: @escaping () -> Void) {
            self.finished = finished
            self.cancel = cancel
        }

        func documentCameraViewController(
            _: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
        ) {
            guard scan.pageCount > 0 else {
                cancel()
                return
            }
            let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
            let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
                for index in 0 ..< scan.pageCount {
                    context.beginPage()
                    let image = scan.imageOfPage(at: index)
                    let scale = min(
                        bounds.width / image.size.width, bounds.height / image.size.height
                    )
                    let size = CGSize(
                        width: image.size.width * scale, height: image.size.height * scale
                    )
                    image.draw(
                        in: CGRect(
                            x: (bounds.width - size.width) / 2,
                            y: (bounds.height - size.height) / 2, width: size.width,
                            height: size.height
                        )
                    )
                }
            }
            finished(.success(data))
        }

        func documentCameraViewControllerDidCancel(_: VNDocumentCameraViewController) {
            cancel()
        }

        func documentCameraViewController(
            _: VNDocumentCameraViewController, didFailWithError error: Error
        ) {
            finished(.failure(error))
        }
    }
}
