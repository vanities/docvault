import SwiftUI
import UniformTypeIdentifiers

private struct ResearchImportFile: Identifiable {
    let id = UUID()
    let draft: UploadDraft
    var uploaded = false
    var error: String?
    var attention: String?
}

struct NativeResearchFileImportView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let domain: ResearchDomain
    let media: Bool
    let changed: () -> Void
    @State private var files: [ResearchImportFile] = []
    @State private var picker = false
    @State private var busy = false
    @State private var preparing = false
    @State private var current: UUID?
    @State private var errors: [String] = []
    @State private var task: Task<Void, Never>?
    private var contentTypes: [UTType] {
        media ? [.audio, .movie] + ["mkv", "webm", "weba"].compactMap { UTType(filenameExtension: $0) } : [.pdf]
    }

    var body: some View {
        NavigationStack {
            List {
                VaultHero(title: media ? "Bring your conversations into research" : "Build a library of saved sources", subtitle: "Import into " + domain.title + ". Each file has its own result; successful uploads are kept when another file fails.", symbol: media ? "waveform" : "doc.badge.plus", color: .indigo, eyebrow: "RESEARCH / IMPORT").vaultStandaloneRow()
                Text(media ? "MP3, M4A, WAV, MP4, MOV, MKV or WebM · up to 512 MB per file. Transcription may continue on the server after upload." : "PDF documents · up to 512 MB per file. An extraction error keeps the saved source so you can retry extraction later.").font(.caption).foregroundStyle(.secondary)
                Button("Choose files", systemImage: "folder") { picker = true }.accessibilityIdentifier("chooseResearchFiles").disabled(busy || preparing)
                if preparing {
                    ProgressView("Preparing protected copies…")
                }
                ForEach(Array(errors.enumerated()), id: \.offset) { _, error in ErrorNotice(message: error) }
                ForEach(files) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.draft.name).font(.headline)
                        Text(ByteCountFormatter.string(fromByteCount: item.draft.size, countStyle: .file)).font(.caption).foregroundStyle(.secondary)
                        if current == item.id {
                            ProgressView("Uploading…")
                        } else if item.uploaded {
                            Label(item.attention == nil ? "Saved to " + domain.title : "Saved · needs attention", systemImage: item.attention == nil ? "checkmark.circle.fill" : "exclamationmark.triangle").foregroundStyle(item.attention == nil ? .green : .orange)
                        } else if let error = item.error {
                            ErrorNotice(message: error)
                        } else {
                            Text("Ready to upload").font(.caption).foregroundStyle(.secondary)
                        }
                        if let attention = item.attention {
                            Text(attention).font(.caption).foregroundStyle(.orange)
                        }
                        if !item.uploaded {
                            Button("Remove file", role: .destructive) { item.draft.removeStagedFiles(); files.removeAll { $0.id == item.id } }.disabled(busy)
                        }
                    }.padding(.vertical, 6)
                }
                if files.contains(where: { !$0.uploaded }) {
                    Button(files.contains(where: { $0.error != nil }) ? "Retry unfinished uploads" : "Import files", systemImage: "square.and.arrow.up") { task = Task { await upload() } }.accessibilityIdentifier("submitResearchFiles").disabled(busy || preparing)
                }
                if files.contains(where: \.uploaded) {
                    Text("\(files.filter(\.uploaded).count) saved · \(files.filter { !$0.uploaded }.count) unfinished").accessibilityIdentifier("researchImportResults")
                }
            }.vaultDashboard().navigationTitle(media ? "Import media" : "Import PDFs").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(busy || preparing) } }
                .interactiveDismissDisabled(busy || preparing)
                .fileImporter(isPresented: $picker, allowedContentTypes: contentTypes, allowsMultipleSelection: true) { result in
                    switch result {
                    case let .success(urls): task = Task { await prepare(urls) }
                    case let .failure(error): errors.append(error.localizedDescription)
                    }
                }
                .onDisappear { task?.cancel(); for file in files {
                    file.draft.removeStagedFiles()
                }; files = [] }
        }
    }

    private func prepare(_ urls: [URL]) async {
        preparing = true; defer { preparing = false }
        for url in urls {
            guard !Task.isCancelled else { return }
            do {
                var draft = try await UploadDraft.stageAsync(url, maximumSize: VaultAPI.maxImportBytes)
                guard !Task.isCancelled else { draft.removeStagedFiles(); return }
                guard let mime = NativeResearch.importMime(filename: draft.name, current: draft.contentType, media: media) else { draft.removeStagedFiles(); throw VaultError.server("Unsupported file format: " + url.lastPathComponent) }
                draft = draft.withContentType(mime)
                files.append(.init(draft: draft))
            } catch {
                if !Task.isCancelled {
                    errors.append(url.lastPathComponent + ": " + error.localizedDescription)
                }
            }
        }
    }

    private func upload() async {
        busy = true; defer { current = nil; busy = false }
        for index in files.indices {
            guard !Task.isCancelled else { return }
            guard !files[index].uploaded else { continue }
            current = files[index].id; files[index].error = nil
            let draft = files[index].draft
            do {
                guard let fileURL = draft.fileURL else { throw VaultError.server("The staged file is unavailable.") }
                let value = try await model.nativeUpload("api/research/" + (media ? "video" : "upload") + "?filename={filename}&domain=" + domain.rawValue, scope: .init(), record: .object(["filename": .string(draft.name)]), fileURL: fileURL, method: "POST", contentType: draft.contentType)
                guard !Task.isCancelled else { return }
                guard !value["entry"]["id"].isEmpty else { throw VaultError.server("The server did not acknowledge a saved source. Refresh the inbox before retrying this upload.") }
                files[index].uploaded = true
                let entry = value["entry"]
                files[index].attention = [entry["extractError"].string, entry["transcribeError"].string].first { !$0.isEmpty }
                changed()
            } catch {
                if !Task.isCancelled {
                    files[index].error = error.localizedDescription
                }
            }
        }
    }
}
