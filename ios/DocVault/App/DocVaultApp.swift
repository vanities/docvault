import SwiftUI

@main
struct DocVaultApp: App {
    @State private var model = VaultModel()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.indigo)
                .task { await model.restore() }
                .onOpenURL {
                    url in if url.isFileURL {
                        model.importFile(url)
                    }
                }
        }
    }
}
