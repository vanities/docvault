import SwiftUI
import WebKit

struct NativeHTMLPreview: UIViewRepresentable {
    var url: URL?
    var html: String?
    func makeUIView(context _: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        if let url {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else if let html {
            view.loadHTMLString(html, baseURL: nil)
        }
        return view
    }

    func updateUIView(_: WKWebView, context _: Context) {}
}
