import SwiftUI

enum DocumentBatchOperation: String, CaseIterable, Identifiable {
    case move, tags, parse, download, delete
    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .move: "Move documents"
        case .tags: "Add tags"
        case .parse: "Parse documents"
        case .download: "Download ZIP"
        case .delete: "Delete documents"
        }
    }
}

struct DocumentBatch: Identifiable {
    let id = UUID()
    let files: [VaultFile]
    let entity: String
    let operation: DocumentBatchOperation
}

struct BulkDocumentView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let batch: DocumentBatch
    @State private var entity = ""
    @State private var folder = "inbox"
    @State private var tags = ""
    @State private var working = false
    @State private var successes: Set<String> = []
    @State private var failures: [String: String] = [:]
    @State private var error: String?
    @State private var preview: URL?
    @State private var confirmDelete = false
    private var complete: Bool {
        successes.count == batch.files.count
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(batch.files.count) documents selected")
                    if model.demo, batch.operation == .download {
                        Text("Demo downloads contain an invented sample archive.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if batch.operation == .move {
                        Picker("Destination entity", selection: $entity) {
                            ForEach(model.entities) { Text($0.name).tag($0.id) }
                        }
                        TextField("Destination folder", text: $folder)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("bulkDestination")
                        Text("Documents keep their filenames. Existing destination files are preserved; conflicts appear below.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if batch.operation == .tags {
                        TextField("Tags, separated by commas", text: $tags).accessibilityIdentifier("bulkTags")
                        Text("These tags are added to each document’s existing tags.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if batch.operation == .parse {
                        Text(model.demo ? "Parsing is simulated in the demo." : "Uses your server’s configured parsing provider. Each file is processed separately.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if complete {
                        Label("All documents processed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                    if working {
                        ProgressView(value: Double(successes.count), total: Double(batch.files.count))
                    }
                    if let error {
                        ErrorNotice(message: error)
                    }
                }
                Section("Documents") {
                    ForEach(batch.files) { file in
                        VStack(alignment: .leading, spacing: 6) {
                            Label(file.name, systemImage: successes.contains(file.path) ? "checkmark.circle.fill" : file.symbol)
                                .foregroundStyle(successes.contains(file.path) ? .green : .primary)
                            if let failure = failures[file.path] {
                                ErrorNotice(message: failure)
                            }
                        }
                    }
                }
                if let preview {
                    Section("Archive") {
                        ShareLink(item: preview) { Label("Share or save ZIP", systemImage: "square.and.arrow.up") }
                    }
                }
            }.disabled(working)
                .navigationTitle(batch.operation.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }.disabled(working).accessibilityIdentifier("closeDocumentBatch")
                    }
                    ToolbarItem(placement: .primaryAction) {
                        if !complete {
                            Button(failures.isEmpty ? "Run" : "Retry remaining") {
                                if batch.operation == .delete {
                                    confirmDelete = true
                                } else {
                                    run()
                                }
                            }.disabled(working).accessibilityIdentifier("runDocumentBatch")
                        }
                    }
                }
                .confirmationDialog("Delete \(batch.files.count - successes.count) documents?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete documents", role: .destructive) { run() }.accessibilityIdentifier("confirmBulkDelete")
                } message: { Text("This permanently deletes the selected documents from your server.") }
        }.interactiveDismissDisabled(working)
            .onAppear { entity = batch.entity }
            .onDisappear {
                if let preview {
                    VaultModel.removePreview(preview)
                }
            }
    }

    private func run() {
        guard !working else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        working = true
        error = nil
        Task {
            defer { working = false }
            if batch.operation == .download {
                do {
                    preview = try await model.nativeDownload("api/download/files", scope: .init(), record: .null, method: "POST", body: .object([
                        "entity": .string(batch.entity), "paths": .array(batch.files.map { .string($0.path) }),
                    ]), suffix: "zip")
                    successes = Set(batch.files.map(\.path))
                } catch { self.error = error.localizedDescription }
                return
            }
            for file in batch.files where !successes.contains(file.path) {
                failures.removeValue(forKey: file.path)
                do {
                    switch batch.operation {
                    case .move:
                        try await model.moveDocument(file, entity: batch.entity, toEntity: entity, folder: folder.trimmingCharacters(in: .whitespacesAndNewlines))
                    case .tags:
                        let values = tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                        guard !values.isEmpty else { throw VaultError.server("Enter at least one tag.") }
                        try await model.addDocumentTags(file, entity: batch.entity, tags: values)
                    case .parse:
                        if !model.demo {
                            _ = try await model.nativeRequest("api/parse/{entity}/{filePath}", scope: .init(entity: batch.entity), record: .object(["filePath": .string(file.path)]), method: "POST")
                        }
                    case .delete: try await model.deleteDocument(file, entity: batch.entity)
                    case .download: break
                    }
                    successes.insert(file.path)
                } catch {
                    failures[file.path] = error.localizedDescription
                    if !model.connected {
                        break
                    }
                }
            }
        }
    }
}
