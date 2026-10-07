import SwiftUI

struct NativePDFFormView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let file: VaultFile
    let entity: String
    let saved: (UploadDraft) -> Void
    @State private var pdf = Data()
    @State private var decoded: VaultValue = .null
    @State private var values: [String: String] = [:]
    @State private var flatten = false
    @State private var error: String?
    @State private var loading = true
    @State private var filled: URL?
    @State private var showingPreview = false
    var body: some View {
        NavigationStack {
            Form {
                if loading {
                    ProgressView("Reading form…")
                }
                if let error {
                    ErrorNotice(message: error)
                }
                if decoded["fillable"] == .bool(false) {
                    Text("This PDF has no fillable fields.")
                }
                ForEach(decoded["fields"].array, id: \.self) { field in
                    let name = field["name"].string
                    let label = field["label"].string.isEmpty ? name : field["label"].string
                    let binding = Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
                    if field["type"].string == "checkbox" {
                        Toggle(
                            label,
                            isOn: Binding(
                                get: { binding.wrappedValue == "true" },
                                set: { binding.wrappedValue = $0 ? "true" : "false" }
                            )
                        )
                    } else if !field["options"].array.isEmpty {
                        Picker(label, selection: binding) {
                            Text("None").tag("")
                            ForEach(field["options"].array, id: \.self) {
                                Text($0.string).tag($0.string)
                            }
                        }
                    } else {
                        TextField(label, text: binding).accessibilityIdentifier("pdfField-\(name)")
                    }
                }
                if decoded["fillable"].boolean {
                    Toggle("Flatten completed form", isOn: $flatten)
                    Button("Fill and preview") { Task { await fill() } }.disabled(loading)
                        .accessibilityIdentifier("fillPDF")
                    if let filled {
                        ShareLink("Share filled PDF", item: filled)
                        Button("Save to vault") {
                            do {
                                try saved(.init(
                                    data: Data(contentsOf: filled),
                                    name: (file.name as NSString).deletingPathExtension
                                        + "_filled.pdf", contentType: "application/pdf"
                                ))
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }.accessibilityIdentifier("saveFilledPDF")
                    }
                }
            }.navigationTitle("Fill PDF").toolbar { Button("Done") { dismiss() } }
                .task { await decode() }
                .sheet(isPresented: $showingPreview) {
                    if let filled {
                        DocumentPreviewSheet(url: filled).privacyProtected()
                    }
                }
                .onDisappear {
                    if let filled {
                        VaultModel.removePreview(filled)
                    }
                }
        }
    }

    private func decode() async {
        defer { loading = false }
        do {
            if model.demo {
                decoded = .object(["fillable": .bool(false)])
                return
            }
            guard let api = model.api else { throw VaultError.signedOut }
            pdf = try await api.document(file, entity: entity)
            decoded = try await api.uploadBytes(
                VaultRequest("api/forms/decode?entity={entity}", scope: .init(entity: entity)),
                data: pdf
            )
            for field in decoded["fields"].array {
                values[field["name"].string] =
                    field["type"].string == "checkbox"
                        ? ((field["suggested"].isEmpty ? field["value"] : field["suggested"]).boolean
                            ? "true" : "false")
                        : (field["suggested"].isEmpty ? field["value"] : field["suggested"]).string
            }
        } catch {
            model.handle(error)
            self.error = error.localizedDescription
        }
    }

    private func fill() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            var fields: [String: VaultValue] = [:]
            for field in decoded["fields"].array {
                let key = field["name"].string
                fields[key] =
                    field["type"].string == "checkbox"
                        ? .bool(values[key] == "true") : .string(values[key] ?? "")
            }
            filled = try await model.nativeDownload(
                "api/forms/fill", scope: .init(), record: .null, method: "POST",
                body: .object([
                    "pdfBase64": .string(pdf.base64EncodedString()), "values": .object(fields),
                    "flatten": .bool(flatten),
                ]), suffix: "pdf"
            )
            showingPreview = true
        } catch {
            model.handle(error)
            self.error = error.localizedDescription
        }
    }
}
