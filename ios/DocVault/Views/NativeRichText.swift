import SwiftUI
import Textual

struct NativeRichText: View {
    let text: String
    var openLink: ((URL) -> OpenURLAction.Result)?
    // The selection overlay intercepts link taps on the supported simulator OS.
    // Readers offer selectable plain text separately from interactive Markdown.
    var selectable = false
    var body: some View {
        if selectable {
            rendered.textual.textSelection(.enabled)
        } else {
            rendered.textual.textSelection(.disabled)
        }
    }

    private var rendered: some View {
        StructuredText(markdown: text)
            .textual.headingStyle(NativeResearchHeadingStyle())
            .textual.structuredTextStyle(.gitHub)
            .font(.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in
                if let openLink {
                    return openLink(url)
                }
                return NativeResearch.sourceURL(.string(url.absoluteString)) == nil ? .discarded : .systemAction
            })
    }
}

private struct NativeResearchHeadingStyle: StructuredText.HeadingStyle {
    @Environment(\.dynamicTypeSize) private var textSize
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        if textSize.isAccessibilitySize {
            configuration.label.fontWeight(.bold)
                .textual.fontScale(configuration.headingLevel <= 2 ? 1.08 : 1)
                .textual.blockSpacing(.init(top: 24, bottom: 16))
        } else {
            let style: StructuredText.GitHubHeadingStyle = .gitHub
            style.makeBody(configuration: configuration)
        }
    }
}

struct NativeSourceTextView: View {
    let title: String
    let text: String
    @State private var formatted = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("Reading", selection: $formatted) { Text("Plain text").tag(false); Text("Formatted").tag(true) }
                    .pickerStyle(.segmented).accessibilityIdentifier("researchReadingStyle")
                if formatted {
                    NativeRichText(text: text).accessibilityIdentifier("researchFormattedText")
                } else {
                    Text(text).font(.system(.body, design: .serif)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(24).frame(maxWidth: 900).frame(maxWidth: .infinity)
        }.vaultDashboard().navigationTitle(title).navigationBarTitleDisplayMode(.inline)
    }
}
