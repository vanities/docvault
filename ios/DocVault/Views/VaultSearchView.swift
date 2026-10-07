import SwiftUI

struct VaultSearchView: View {
    @Environment(VaultModel.self) private var model
    @State private var query = ""
    @State private var files: [VaultFile] = []
    @State private var loading = false
    @State private var error: String?
    @State private var completedQuery = ""
    var body: some View {
        NavigationStack {
            List {
                if let error {
                    ErrorNotice(message: error)
                }
                if loading {
                    ProgressView("Searching your vault…")
                }
                if query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
                    ContentUnavailableView(
                        "Find a record", systemImage: "magnifyingglass",
                        description: Text(
                            "Search filenames, folders, and parsed information across all your entities. Enter at least two characters."
                        )
                    )
                } else if !loading, files.isEmpty, error == nil {
                    ContentUnavailableView.search(text: query)
                }
                ForEach(files) { file in
                    if let entity = file.entity {
                        NavigationLink {
                            DocumentDetailView(file: file, entity: entity)
                        } label: {
                            FileRow(file: file)
                        }
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search all documents")
            .task(id: query + ":" + String(model.revision)) { await search() }
        }
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if term != completedQuery {
            files = []
        }
        error = nil
        loading = term.count >= 2
        guard loading else { return }
        do {
            try await Task.sleep(for: .milliseconds(300))
            let results = try await model.search(term)
            try Task.checkCancellation()
            files = results
            completedQuery = term
            loading = false
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
                loading = false
            }
        }
    }
}
