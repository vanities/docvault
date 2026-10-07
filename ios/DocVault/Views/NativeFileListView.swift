import SwiftUI

struct NativeFileListView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var files: [VaultFile] = []
    @State private var search = ""
    @State private var error: String?
    @State private var selecting = false
    @State private var selectedPaths: Set<String> = []
    @State private var batch: DocumentBatch?
    private var visibleFiles: [VaultFile] {
        files.filter { search.isEmpty || "\($0.name) \($0.path) \(($0.tags ?? []).joined(separator: " "))".localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            if files.isEmpty {
                ContentUnavailableView("No documents", systemImage: "folder")
            }
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
                    NavigationLink { DocumentDetailView(file: file, entity: scope.entity) } label: { FileRow(file: file) }
                }
            }
        }.searchable(text: $search).task(id: model.revision) { await load() }.refreshable { await load() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if selecting {
                        Menu {
                            Button("Select all visible") { selectedPaths.formUnion(visibleFiles.map(\.path)) }
                            Button("Clear selection") { selectedPaths = [] }
                            Divider()
                            ForEach(DocumentBatchOperation.allCases) { operation in
                                Button(operation.title, role: operation == .delete ? .destructive : nil) {
                                    batch = .init(files: files.filter { selectedPaths.contains($0.path) }, entity: scope.entity, operation: operation)
                                }.disabled(selectedPaths.isEmpty)
                            }
                        } label: { Text("\(selectedPaths.count) selected") }.accessibilityIdentifier("documentBatchMenu")
                        Button("Done") { selecting = false; selectedPaths = [] }.accessibilityIdentifier("finishDocumentSelection")
                    } else {
                        Button("Select") { selecting = true }.disabled(files.isEmpty).accessibilityIdentifier("selectDocuments")
                    }
                }
            }
            .sheet(item: $batch, onDismiss: { selectedPaths = []; Task { await load() } }) { selection in
                BulkDocumentView(batch: selection).privacyProtected()
            }
    }

    private func load() async {
        error = nil
        do {
            if model.demo {
                files = try await model.files(entity: scope.entity)
            } else {
                let data = try await model.nativeRequest(resource.path, scope: scope)
                files = try JSONDecoder().decode([VaultFile].self, from: JSONEncoder().encode(data["files"]))
            }
            selectedPaths.formIntersection(files.map(\.path))
        } catch { self.error = error.localizedDescription }
    }
}
