import SwiftUI

struct NativeSourceFilesView: View {
    @Environment(VaultModel.self) private var model
    let repository: VaultValue
    @State private var files: [String] = []
    @State private var search = ""
    @State private var error: String?
    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            if files.isEmpty {
                Text("Sync this repository to load its files.").foregroundStyle(.secondary)
            }
            ForEach(
                files.filter { search.isEmpty || $0.localizedCaseInsensitiveContains(search) },
                id: \.self
            ) { path in
                NavigationLink(path) {
                    NativeSourceDocumentView(repository: repository, path: path)
                }
            }
        }.navigationTitle(repository.title).searchable(text: $search, prompt: "Find source file")
            .task {
                do {
                    let value = try await model.nativeRequest(
                        "api/external-sources/{id}/files", scope: .init(), record: repository
                    )
                    files = value["files"].array.map(\.string)
                } catch { self.error = error.localizedDescription }
            }
    }
}

private struct NativeSourceDocumentView: View {
    @Environment(VaultModel.self) private var model
    let repository: VaultValue
    let path: String
    @State private var value: VaultValue = .null
    @State private var error: String?
    var body: some View {
        ScrollView {
            if let error {
                ErrorNotice(message: error)
            }
            Text(.init(value["content"].string)).textSelection(.enabled).frame(
                maxWidth: .infinity, alignment: .leading
            ).padding()
        }.navigationTitle((path as NSString).lastPathComponent).navigationBarTitleDisplayMode(
            .inline
        ).task {
            do {
                var record = repository
                record.set("filePath", .string(path))
                value = try await model.nativeRequest(
                    "api/external-sources/{id}/file?path={filePath}", scope: .init(), record: record
                )
            } catch { self.error = error.localizedDescription }
        }
    }
}
