import SwiftUI

struct VaultSettingsView: View {
    @Environment(VaultModel.self) private var model
    @State private var confirmingDisconnect = false
    var body: some View {
        NavigationStack {
            Form {
                if let error = model.error {
                    ErrorNotice(message: error)
                }
                Section("Connection") {
                    Label(model.serverLabel, systemImage: model.demo ? "sparkles" : "server.rack")
                    if let api = model.api {
                        Text(api.address.url.absoluteString).font(.footnote).foregroundStyle(
                            .secondary
                        ).textSelection(.enabled)
                    }
                    if model.demo {
                        Text("Invented records. Changes last only until you leave this demo.")
                            .foregroundStyle(.secondary)
                    }
                    Button(
                        model.demo ? "Leave demo & connect server" : "Sign out",
                        role: model.demo ? nil : .destructive
                    ) { confirmingDisconnect = true }
                }
                Section {
                    Toggle(
                        "Blur financial numbers",
                        isOn: Binding(get: { model.blurNumbers }, set: { model.blurNumbers = $0 })
                    )
                    Toggle(
                        "Require device unlock",
                        isOn: Binding(
                            get: { model.lockEnabled },
                            set: { enabled in Task { await model.setLock(enabled) } }
                        )
                    )
                    if let error = model.lockError {
                        ErrorNotice(message: error)
                    }
                } header: {
                    Text("Privacy")
                } footer: {
                    Text(
                        "Use Face ID, Touch ID, or your device passcode after leaving the app. Your session is stored in this device’s Keychain. Passwords are never saved."
                    )
                }
                Section("About") {
                    LabeledContent(
                        "DocVault",
                        value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                            ?? "1.0"
                    )
                    Text(
                        "A private home for your documents, connected to your self-hosted DocVault."
                    ).foregroundStyle(.secondary)
                    Link(
                        "DocVault source code",
                        destination: URL(string: "https://github.com/vanities/docvault")!
                    )
                    NavigationLink("Open source licenses") {
                        ScrollView {
                            Text(openSourceNotices).font(.callout).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading).padding()
                        }.navigationTitle("Open source licenses").navigationBarTitleDisplayMode(.inline)
                    }
                }
                if let settings = NativeCatalog.features.first(where: { $0.id == "settings" }) {
                    Section("Server") {
                        NavigationLink("Server settings") { NativeFeatureView(feature: settings) }
                    }
                }
            }.navigationTitle("Settings")
                .confirmationDialog(
                    model.demo ? "Leave the demo?" : "Sign out of DocVault on this device?",
                    isPresented: $confirmingDisconnect, titleVisibility: .visible
                ) {
                    Button(model.demo ? "Leave demo" : "Sign out", role: .destructive) {
                        Task { await model.disconnect() }
                    }
                    .accessibilityIdentifier("confirmSignOut")
                }
        }
    }

    private var openSourceNotices: String {
        guard let url = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "Open source notices are unavailable." }
        return text
    }
}
