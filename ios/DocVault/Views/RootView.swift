import SwiftUI

struct RootView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    var body: some View {
        @Bindable var model = model
        ZStack {
            Group {
                if model.restoring {
                    ProgressView("Opening your vault…")
                } else if model.connected {
                    TabView(selection: $selectedTab) {
                        Tab("Documents", systemImage: "folder", value: 0) { VaultLibraryView() }
                        Tab("Search", systemImage: "magnifyingglass", value: 1) {
                            VaultSearchView()
                        }
                        Tab("Workspace", systemImage: "square.grid.2x2", value: 2) {
                            NativeWorkspaceView()
                        }
                        Tab("Settings", systemImage: "gearshape", value: 3) { VaultSettingsView() }
                    }
                } else {
                    ConnectView()
                }
            }
            .disabled(scenePhase != .active || !model.unlocked)
            .accessibilityHidden(scenePhase != .active || !model.unlocked)
            if scenePhase != .active || !model.unlocked {
                ZStack {
                    Color(.systemBackground).ignoresSafeArea()
                    VStack(spacing: 20) {
                        Image(systemName: "lock.shield.fill").font(.system(size: 64))
                            .foregroundStyle(.indigo)
                        Text("DocVault").font(.largeTitle.bold())
                        if scenePhase == .active {
                            Button("Unlock vault") { Task { await model.unlock() } }.buttonStyle(
                                .borderedProminent
                            )
                            .disabled(model.unlocking)
                            if let error = model.lockError {
                                Text(error).font(.footnote).foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                        }
                    }.padding(32)
                }
            }
        }
        .sheet(
            item: Binding(get: { model.connected ? model.draft : nil }, set: { model.draft = $0 })
        ) { draft in
            UploadView(draft: draft).privacyProtected()
        }
        .onChange(of: scenePhase) { _, phase in
            SnapshotShield.show(phase != .active)
            if phase == .background, model.lockEnabled {
                model.unlocked = false
            }
        }
        .onChange(of: model.connected) {
            _, connected in if !connected {
                selectedTab = 0
            }
        }
    }
}

struct ConnectView: View {
    @Environment(VaultModel.self) private var model
    private enum Field: Hashable { case address, username, password }
    @FocusState private var focusedField: Field?
    @State private var address = ""
    @State private var username = "admin"
    @State private var password = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "doc.on.doc.fill").font(.system(size: 48))
                            .foregroundStyle(.indigo)
                        Text("Your documents.\nYour vault.").font(.largeTitle.bold())
                        Text(
                            "Connect to your DocVault server to keep your records close, wherever you are."
                        )
                        .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Server").font(.headline)
                        HStack {
                            TextField("https://vault.example.com", text: $address)
                                .keyboardType(.URL).textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textContentType(.URL).accessibilityIdentifier("serverURL")
                                .focused($focusedField, equals: .address)
                                .submitLabel(.next).onSubmit { focusedField = .username }
                            if !address.isEmpty {
                                Button {
                                    address = ""
                                    focusedField = .address
                                } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                        .frame(minWidth: 44, minHeight: 44)
                                }.buttonStyle(.plain).accessibilityLabel("Clear server address")
                                    .accessibilityIdentifier("clearServerURL")
                            }
                        }
                        Divider()
                        TextField("Username", text: $username).textContentType(.username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focusedField, equals: .username)
                            .submitLabel(.next).onSubmit { focusedField = .password }
                        Divider()
                        SecureField("Password", text: $password).textContentType(.password)
                            .focused($focusedField, equals: .password)
                            .submitLabel(.done).onSubmit { focusedField = nil }
                        Text(
                            "Use the same sign-in as your web app. For a local NAS, enter its network address and port, such as http://nas.local:3005."
                        )
                        .font(.footnote).foregroundStyle(.secondary)
                    }.padding(20).background(
                        .regularMaterial, in: RoundedRectangle(cornerRadius: 20)
                    )
                    if let error = model.error {
                        ErrorNotice(message: error)
                    }
                    Button {
                        focusedField = nil
                        Task {
                            await model.connect(
                                address: address, username: username, password: password
                            )
                            if model.connected {
                                password = ""
                            }
                        }
                    } label: {
                        HStack {
                            if model.connecting {
                                ProgressView().tint(.white)
                            }
                            Text(model.connecting ? "Connecting…" : "Connect to DocVault").frame(
                                maxWidth: .infinity
                            )
                        }
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(
                        address.isEmpty || model.connecting
                    )
                    Button("Explore a demo vault") { model.enterDemo() }.frame(maxWidth: .infinity)
                }.padding(24).frame(maxWidth: 540)
                    .frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively)
                .navigationTitle("DocVault").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") { focusedField = nil }
                    }
                }
        }.onAppear { address = model.savedAddress }
    }
}

struct ErrorNotice: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle").font(.callout)
            .foregroundStyle(.red).accessibilityIdentifier("errorNotice")
    }
}
