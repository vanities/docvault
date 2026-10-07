import Observation
import SwiftUI
import WebKit

struct WorkspaceSection: Identifiable {
    let id: String
    let title: String
    let symbol: String
    static let groups: [(String, [WorkspaceSection])] = [
        (
            "Finance",
            [
                .init(id: "portfolio", title: "Portfolio", symbol: "chart.pie"),
                .init(id: "banks", title: "Banks", symbol: "building.columns"),
                .init(id: "brokers", title: "Brokers", symbol: "chart.line.uptrend.xyaxis"),
                .init(id: "crypto", title: "Crypto", symbol: "bitcoinsign.circle"),
                .init(id: "gold", title: "Precious Metals", symbol: "square.stack.3d.up"),
                .init(id: "property", title: "Property", symbol: "house"),
                .init(id: "debts", title: "Debts", symbol: "creditcard"),
                .init(id: "strategy", title: "Strategy", symbol: "target"),
                .init(id: "quant", title: "Quant", symbol: "chart.xyaxis.line"),
            ]
        ),
        (
            "Work & taxes",
            [
                .init(id: "timesheet", title: "Time Tracking", symbol: "clock"),
                .init(id: "income", title: "Income", symbol: "dollarsign.circle"),
                .init(id: "tax-year", title: "Tax Year", symbol: "doc.plaintext"),
                .init(id: "business-docs", title: "Business Documents", symbol: "briefcase"),
                .init(id: "federal-tax", title: "Federal Tax", symbol: "doc.text"),
                .init(id: "estimated-tax", title: "Estimated Tax", symbol: "calendar.badge.clock"),
                .init(id: "tn-tax", title: "Tennessee Tax", symbol: "building.columns"),
                .init(id: "solo-401k", title: "Solo 401(k)", symbol: "banknote"),
                .init(id: "sales", title: "Sales", symbol: "cart"),
                .init(id: "mileage", title: "Mileage", symbol: "car"),
            ]
        ),
        (
            "Everyday",
            [
                .init(id: "calendar", title: "Calendar", symbol: "calendar"),
                .init(id: "health", title: "Health", symbol: "heart"),
                .init(id: "daily-news", title: "Daily News", symbol: "newspaper"),
                .init(id: "chat", title: "Chat", symbol: "bubble.left.and.bubble.right"),
                .init(id: "chat-history", title: "Chat History", symbol: "text.bubble"),
                .init(
                    id: "deep-research", title: "Deep Research", symbol: "sparkle.magnifyingglass"
                ),
                .init(id: "politics", title: "Politics", symbol: "globe.americas"),
                .init(id: "predictions", title: "Predictions", symbol: "chart.bar"),
                .init(id: "tech", title: "Tech", symbol: "desktopcomputer"),
                .init(id: "local-news", title: "Local News", symbol: "mappin.and.ellipse"),
            ]
        ),
        (
            "Manage",
            [
                .init(id: "all-files", title: "All Files", symbol: "folder"),
                .init(
                    id: "external-sources", title: "External Sources", symbol: "arrow.down.circle"
                ),
                .init(id: "settings", title: "Server Settings", symbol: "gearshape"),
            ]
        ),
    ]
}

struct WorkspaceView: View {
    @Environment(VaultModel.self) private var model
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Your full DocVault workspace, connected to the same server and sign-in.")
                        .foregroundStyle(.secondary)
                }
                ForEach(WorkspaceSection.groups, id: \.0) { title, sections in
                    Section(title) {
                        ForEach(sections) { section in
                            NavigationLink {
                                WorkspaceBrowser(section: section)
                            } label: {
                                Label(section.title, systemImage: section.symbol).labelStyle(
                                    .titleAndIcon
                                )
                            }
                        }
                    }
                }
            }.navigationTitle("Workspace")
        }
    }
}

@Observable @MainActor
final class BrowserState {
    var webView: WKWebView?
    var loading = true
    var error: String?
    var canGoBack = false
    var canGoForward = false
    var downloadURL: URL?
}

struct WorkspaceBrowser: View {
    @Environment(VaultModel.self) private var model
    let section: WorkspaceSection
    @State private var state = BrowserState()
    @State private var showingDownload = false
    var body: some View {
        VStack(spacing: 0) {
            if model.demo {
                ContentUnavailableView(
                    "Connect your server", systemImage: section.symbol,
                    description: Text(
                        "\(section.title) uses your DocVault server. Explore native documents in the demo, or leave demo mode in Settings to connect."
                    )
                )
            } else {
                if let error = state.error {
                    VStack {
                        ErrorNotice(message: error)
                        Button("Reload") {
                            state.error = nil
                            state.webView?.reload()
                        }
                    }.padding()
                }
                if state.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(8)
                }
                VaultWebView(model: model, section: section, state: state)
            }
        }
        .navigationTitle(section.title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !model.demo {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Back", systemImage: "chevron.left") { state.webView?.goBack() }
                            .disabled(!state.canGoBack)
                        Button("Forward", systemImage: "chevron.right") {
                            state.webView?.goForward()
                        }.disabled(!state.canGoForward)
                        Button("Reload", systemImage: "arrow.clockwise") {
                            state.error = nil
                            state.webView?.reload()
                        }
                    } label: {
                        Image(systemName: "ellipsis").accessibilityLabel("Page actions")
                    }
                }
            }
        }
        .onChange(of: state.downloadURL) { _, url in showingDownload = url != nil }
        .sheet(
            isPresented: $showingDownload,
            onDismiss: {
                if let url = state.downloadURL {
                    VaultModel.removePreview(url)
                    state.downloadURL = nil
                }
            }
        ) {
            if let url = state.downloadURL {
                DocumentPreviewSheet(url: url).privacyProtected()
            }
        }
        .onDisappear {
            if let url = state.downloadURL {
                VaultModel.removePreview(url)
            }
        }
    }
}

struct VaultWebView: UIViewRepresentable {
    let model: VaultModel
    let section: WorkspaceSection
    let state: BrowserState
    func makeCoordinator() -> Coordinator {
        Coordinator(model: model, state: state)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = model.webDataStore
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        state.webView = view
        guard let api = model.api else { return view }
        var parts = URLComponents(url: api.address.url, resolvingAgainstBaseURL: false)!
        parts.percentEncodedPath += "/"
        parts.fragment = section.id
        guard let url = parts.url else { return view }
        let store = view.configuration.websiteDataStore
        Task { @MainActor in
            if let cookie = api.webSessionCookie {
                await store.httpCookieStore.setCookie(cookie)
            }
            guard model.api === api else { return }
            store.httpCookieStore.add(context.coordinator)
            view.load(URLRequest(url: url))
        }
        return view
    }

    func updateUIView(_: WKWebView, context _: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.configuration.websiteDataStore.httpCookieStore.remove(coordinator)
        view.navigationDelegate = nil
        view.uiDelegate = nil
        coordinator.state.webView = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
        WKHTTPCookieStoreObserver, WKDownloadDelegate
    {
        let model: VaultModel
        let state: BrowserState
        private var downloadURL: URL?
        init(model: VaultModel, state: BrowserState) {
            self.model = model
            self.state = state
        }

        private func sameServer(_ url: URL) -> Bool {
            guard let base = model.api?.address.url else { return false }
            let normalizedPort: (URL) -> Int = { $0.port ?? ($0.scheme == "https" ? 443 : 80) }
            return url.scheme == base.scheme && url.host() == base.host()
                && normalizedPort(url) == normalizedPort(base)
                && url.user == nil && url.password == nil
                && (base.path.isEmpty || url.path == base.path
                    || url.path.hasPrefix(base.path + "/"))
        }

        func webView(_: WKWebView, decidePolicyFor navigationAction: WKNavigationAction)
            async -> WKNavigationActionPolicy
        {
            guard let url = navigationAction.request.url else { return .cancel }
            if sameServer(url) || url.scheme == "blob" {
                return navigationAction.shouldPerformDownload ? .download : .allow
            }
            if navigationAction.navigationType == .linkActivated,
               ["https", "http", "mailto", "tel"].contains(url.scheme ?? "")
            {
                await UIApplication.shared.open(url)
            }
            return .cancel
        }

        func webView(_: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse)
            async -> WKNavigationResponsePolicy
        {
            if let url = navigationResponse.response.url, url.scheme != "blob", !sameServer(url) {
                return .cancel
            }
            let disposition =
                (navigationResponse.response as? HTTPURLResponse)?.value(
                    forHTTPHeaderField: "Content-Disposition"
                ) ?? ""
            return !navigationResponse.canShowMIMEType
                || disposition.lowercased().hasPrefix("attachment") ? .download : .allow
        }

        func webView(
            _ webView: WKWebView, createWebViewWith _: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures _: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                if sameServer(url) || url.scheme == "blob" {
                    webView.load(navigationAction.request)
                } else if ["https", "http"].contains(url.scheme ?? "") {
                    UIApplication.shared.open(url)
                }
            }
            return nil
        }

        func webView(_: WKWebView, didStartProvisionalNavigation _: WKNavigation!) {
            state.loading = true
            state.error = nil
        }

        func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
            state.loading = false
            state.canGoBack = webView.canGoBack
            state.canGoForward = webView.canGoForward
        }

        func webView(
            _: WKWebView, didFailProvisionalNavigation _: WKNavigation!,
            withError error: Error
        ) {
            failed(error)
        }

        func webView(
            _: WKWebView, didFail _: WKNavigation!, withError error: Error
        ) {
            failed(error)
        }

        private func failed(_ error: Error) {
            state.loading = false
            if (error as NSError).code != NSURLErrorCancelled {
                state.error = error.localizedDescription
            }
        }

        func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            Task { @MainActor in
                guard cookieStore === model.webDataStore.httpCookieStore else { return }
                guard let api = model.api, let oldToken = api.token else { return }
                let cookies = await cookieStore.allCookies()
                guard model.api === api, cookieStore === model.webDataStore.httpCookieStore else {
                    return
                }
                let cookie = cookies.first {
                    $0.name == "docvault_session"
                        && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
                        == api.address.url.host()
                }
                guard let cookie, cookie.value != "deleted",
                      cookie.expiresDate.map({ $0 > Date() }) ?? true
                else {
                    model.handle(VaultError.signedOut)
                    return
                }
                if cookie.value != oldToken {
                    do {
                        try SessionStore().write(cookie.value, for: api.address)
                        api.updateToken(cookie.value)
                    } catch { state.error = error.localizedDescription }
                }
            }
        }

        func webView(
            _: WKWebView, navigationAction _: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _: WKWebView, navigationResponse _: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func download(
            _: WKDownload, decideDestinationUsing _: URLResponse,
            suggestedFilename: String
        ) async -> URL? {
            do {
                let folder = VaultModel.previewRoot.appendingPathComponent(
                    UUID().uuidString, isDirectory: true
                )
                try FileManager.default.createDirectory(
                    at: folder, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.complete]
                )
                let url = folder.appendingPathComponent(
                    (suggestedFilename as NSString).lastPathComponent
                )
                downloadURL = url
                return url
            } catch {
                failed(error)
                return nil
            }
        }

        func downloadDidFinish(_: WKDownload) {
            state.loading = false
            state.downloadURL = downloadURL
            downloadURL = nil
        }

        func download(_: WKDownload, didFailWithError error: Error, resumeData _: Data?) {
            if let downloadURL {
                VaultModel.removePreview(downloadURL)
                self.downloadURL = nil
            }
            failed(error)
        }
    }
}
