import SwiftUI

struct NativeHealthSyncView: View {
    @Environment(VaultModel.self) private var model
    let scope: VaultScope
    @State private var value: VaultValue = .null
    @State private var error: String?
    @State private var file: URL?
    @State private var copied = false
    var body: some View {
        List {
            Text(
                "Use an iOS Shortcut to send daily Health metrics, or configure the workout sync companion with this person's connection."
            ).foregroundStyle(.secondary)
            if let error {
                ErrorNotice(message: error)
            }
            if !value["ingestUrl"].string.isEmpty {
                LabeledContent("Ingest URL", value: value["ingestUrl"].string).textSelection(
                    .enabled
                )
            }
            Button(copied ? "Token copied" : "Copy sync token") {
                UIPasteboard.general.string = value["authToken"].string
                copied = true
            }.disabled(value["authToken"].isEmpty)
            if let url = URL(string: value["appDeepLink"].string), url.scheme == "docvaultsync" {
                Link("Configure workout sync companion", destination: url)
            }
            Button("Prepare Health Shortcut") {
                Task {
                    do {
                        file = try await model.nativeDownload(
                            "api/health/{person}/shortcut.shortcut", scope: scope, record: .null,
                            method: "GET", body: nil, suffix: "shortcut"
                        )
                    } catch { self.error = error.localizedDescription }
                }
            }
            if let file {
                ShareLink("Open or share Health Shortcut", item: file)
            }
            NativeValueRow(label: "Metrics", value: value["metrics"])
        }.task {
            do {
                value = try await model.nativeRequest(
                    "api/health/{person}/shortcut-config", scope: scope
                )
            } catch { self.error = error.localizedDescription }
        }
        .onDisappear {
            if let file {
                VaultModel.removePreview(file)
            }
        }
    }
}
