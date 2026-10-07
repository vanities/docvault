import SwiftUI
import VisionKit

struct VaultLibraryView: View {
    @Environment(VaultModel.self) private var model
    @State private var importing = false
    @State private var scanning = false
    @State private var scannedDraft: UploadDraft?
    private let columns = [GridItem(.adaptive(minimum: 260), spacing: 16)]
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VaultHero(title: model.demo ? "A little peace of mind." : "Everything in its place.",
                              subtitle: model.demo ? "Explore invented records. Nothing here connects to your server." : "Browse your entities, find a record, or add something new.",
                              symbol: "folder.badge.person.crop", eyebrow: "YOUR DOCUMENTS")
                    if let error = model.error {
                        ErrorNotice(message: error)
                    }
                    if model.entities.isEmpty {
                        ContentUnavailableView(
                            "No entities yet", systemImage: "folder",
                            description: Text(
                                "Create an entity in Workspace → Server Settings to start organizing your documents."
                            )
                        )
                    } else {
                        LazyVGrid(columns: columns, spacing: 16) {
                            ForEach(model.entities) { entity in
                                NavigationLink {
                                    EntityDocumentsView(entity: entity)
                                } label: {
                                    VStack(alignment: .leading, spacing: 16) {
                                        HStack {
                                            Image(
                                                systemName: entity.isTax
                                                    ? "building.2.crop.circle.fill"
                                                    : "folder.circle.fill"
                                            )
                                            .font(.system(size: 36)).foregroundStyle(entity.tint)
                                            Spacer()
                                            Image(systemName: "chevron.right").font(
                                                .footnote.bold()
                                            ).foregroundStyle(.tertiary)
                                        }
                                        Text(entity.name).font(.title3.bold()).foregroundStyle(
                                            .primary
                                        )
                                        Text(
                                            entity.description
                                                ?? (entity.isTax
                                                    ? "Tax documents and financial records"
                                                    : "Files and important records")
                                        )
                                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        Text(entity.isTax ? "BY YEAR & FOLDER" : "ALL RECORDS")
                                            .font(.caption2.weight(.semibold)).foregroundStyle(
                                                entity.tint
                                            )
                                    }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: entity.tint)
                                }.buttonStyle(.plain).accessibilityIdentifier("entity-\(entity.id)")
                            }
                        }
                    }
                    HStack(spacing: 12) {
                        Image(systemName: "lock.shield").font(.title2).foregroundStyle(.indigo)
                        Text(
                            "Your server stores your documents. This app keeps previews only while you view them."
                        )
                        .font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(20).frame(maxWidth: 1100).frame(maxWidth: .infinity)
            }
            .vaultDashboard()
            .navigationTitle("Documents")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if model.demo {
                            Button("Add sample document", systemImage: "doc.badge.plus") {
                                model.draft = .init(
                                    data: DemoVault.pdf(title: "Sample document"),
                                    name: "Sample.pdf", contentType: "application/pdf"
                                )
                            }
                            Button("Add sample documents", systemImage: "doc.on.doc.badge.plus") {
                                var first = UploadDraft(data: DemoVault.pdf(title: "Sample document 1"), name: "Sample One.pdf", contentType: "application/pdf")
                                first.additional = [.init(data: DemoVault.pdf(title: "Sample document 2"), name: "Sample Two.pdf", contentType: "application/pdf")]
                                model.draft = first
                            }
                        }
                        Button("Import from Files", systemImage: "folder.badge.plus") {
                            importing = true
                        }
                        if VNDocumentCameraViewController.isSupported {
                            Button("Scan a document", systemImage: "doc.viewfinder") {
                                scanning = true
                            }
                        }
                    } label: {
                        Image(systemName: "plus").accessibilityLabel("Add document")
                    }
                    .disabled(model.entities.isEmpty || model.importingFiles)
                    if model.importingFiles {
                        ProgressView("Preparing imports…")
                    }
                }
            }
            .refreshable { await model.refreshEntities() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
                switch result {
                case let .success(urls): model.importFiles(urls)
                case let .failure(error): model.error = error.localizedDescription
                }
            }
            .sheet(
                isPresented: $scanning,
                onDismiss: {
                    if let draft = scannedDraft {
                        model.draft = draft
                        scannedDraft = nil
                    }
                }
            ) {
                DocumentScanner { result in
                    switch result {
                    case let .success(data):
                        let date = Date().formatted(
                            .iso8601.year().month().day().dateSeparator(.dash)
                        )
                        scannedDraft = .init(
                            data: data, name: "Scan_\(date).pdf", contentType: "application/pdf"
                        )
                    case let .failure(error): model.error = error.localizedDescription
                    }
                    scanning = false
                } cancel: {
                    scanning = false
                }
                .privacyProtected()
            }
        }
    }
}

extension VaultEntity {
    var tint: Color {
        switch color {
        case "green", "teal", "emerald": .teal
        case "orange", "amber", "yellow": .orange
        case "red", "rose", "pink": .pink
        case "purple", "violet": .purple
        default: .indigo
        }
    }
}

struct EntityDocumentsView: View {
    @Environment(VaultModel.self) private var model
    let entity: VaultEntity
    var folder = ""
    @State private var files: [VaultFile] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?
    @State private var selecting = false
    @State private var selectedPaths: Set<String> = []
    @State private var batch: DocumentBatch?
    private var scopedFiles: [VaultFile] {
        files.filter { folder.isEmpty || $0.path.hasPrefix(folder + "/") }
            .sorted { $0.lastModified > $1.lastModified }
    }

    private var folders: [String] {
        Array(
            Set(
                scopedFiles.compactMap { file in
                    let relative =
                        folder.isEmpty ? file.path : String(file.path.dropFirst(folder.count + 1))
                    let parts = relative.split(separator: "/")
                    return parts.count > 1 ? String(parts[0]) : nil
                }
            )
        ).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private var visibleFiles: [VaultFile] {
        if !query.isEmpty {
            return scopedFiles.filter {
                "\($0.name) \($0.path) \(($0.tags ?? []).joined(separator: " "))"
                    .localizedCaseInsensitiveContains(query)
            }
        }
        if selecting {
            return scopedFiles
        }
        let direct = scopedFiles.filter { $0.folder == folder }
        return direct.isEmpty ? Array(scopedFiles.prefix(8)) : direct
    }

    var body: some View {
        List {
            if let error {
                Section {
                    ErrorNotice(message: error)
                    Button("Try again") { Task { await load() } }
                }
            }
            if loading, files.isEmpty {
                ProgressView("Loading documents…")
            }
            if !loading, error == nil, scopedFiles.isEmpty {
                ContentUnavailableView(
                    "No documents yet", systemImage: "doc",
                    description: Text("Import or scan a document from the Documents tab.")
                )
            }
            if !selecting, query.isEmpty, !folders.isEmpty {
                Section("Folders") {
                    ForEach(folders, id: \.self) { name in
                        NavigationLink {
                            EntityDocumentsView(
                                entity: entity, folder: folder.isEmpty ? name : "\(folder)/\(name)"
                            )
                        } label: {
                            Label(name, systemImage: "folder.fill").foregroundStyle(entity.tint)
                        }
                    }
                }
            }
            Section(
                query.isEmpty
                    ? (scopedFiles.contains(where: { $0.folder == folder })
                        ? "Documents" : "Recent documents") : "Results"
            ) {
                ForEach(visibleFiles) { file in
                    if selecting {
                        Button {
                            if selectedPaths.contains(file.path) {
                                selectedPaths.remove(file.path)
                            } else {
                                selectedPaths.insert(file.path)
                            }
                        } label: {
                            HStack {
                                Image(systemName: selectedPaths.contains(file.path) ? "checkmark.circle.fill" : "circle").foregroundStyle(.indigo)
                                FileRow(file: file)
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityLabel(file.name)
                            .accessibilityValue(selectedPaths.contains(file.path) ? "Selected" : "Not selected")
                    } else {
                        NavigationLink { DocumentDetailView(file: file, entity: entity.id) } label: { FileRow(file: file) }
                    }
                }
                if !query.isEmpty, visibleFiles.isEmpty, !loading {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
        .navigationTitle(folder.isEmpty ? entity.name : (folder as NSString).lastPathComponent)
        .searchable(text: $query, prompt: "Search this folder")
        .refreshable { await load() }
        .task(id: model.revision) { await load() }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if selecting {
                    Menu {
                        Button("Select all visible") { selectedPaths.formUnion(visibleFiles.map(\.path)) }
                        Button("Clear selection") { selectedPaths = [] }
                        Divider()
                        ForEach(DocumentBatchOperation.allCases) { operation in
                            Button(operation.title, role: operation == .delete ? .destructive : nil) {
                                batch = .init(files: scopedFiles.filter { selectedPaths.contains($0.path) }, entity: entity.id, operation: operation)
                            }.disabled(selectedPaths.isEmpty)
                        }
                    } label: { Text("\(selectedPaths.count) selected") }.accessibilityIdentifier("documentBatchMenu")
                    Button("Done") { selecting = false; selectedPaths = [] }.accessibilityIdentifier("finishDocumentSelection")
                } else {
                    Button("Select") { selecting = true }.disabled(scopedFiles.isEmpty).accessibilityIdentifier("selectDocuments")
                }
            }
        }
        .sheet(item: $batch, onDismiss: { selectedPaths = []; Task { await load() } }) { selection in
            BulkDocumentView(batch: selection).privacyProtected()
        }
    }

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            files = try await model.files(entity: entity.id)
            selectedPaths.formIntersection(files.map(\.path))
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct FileRow: View {
    let file: VaultFile
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: file.symbol).font(.title2).foregroundStyle(.indigo)
                .frame(width: 40, height: 46).background(
                    .indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 10)
                )
            VStack(alignment: .leading, spacing: 4) {
                Text(file.name).font(.subheadline.weight(.medium)).lineLimit(2)
                if !file.isTracked {
                    Label("Excluded from totals", systemImage: "eye.slash").font(.caption).foregroundStyle(.secondary)
                }
                Text(
                    [file.entityName, file.folder].compactMap(\.self).filter { !$0.isEmpty }.joined(
                        separator: " · "
                    )
                )
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(file.modifiedDate, format: .dateTime.month(.abbreviated).day().year())
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }.padding(.vertical, 4)
    }
}
