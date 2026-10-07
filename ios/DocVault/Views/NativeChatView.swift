import SwiftUI
import UniformTypeIdentifiers

struct NativeChatView: View {
    @Environment(VaultModel.self) private var model
    @State private var threadID = UUID().uuidString.lowercased()
    @State private var resumeID = ""
    @State private var messages: [VaultValue] = []
    @State private var threads: [VaultValue] = []
    @State private var draft = ""
    @State private var entity = "all"
    @State private var error: String?
    @State private var task: Task<Void, Never>?
    @State private var history = false
    @State private var attachments: [VaultValue] = []
    @State private var importFile = false
    @State private var recordVoice = false
    @State private var tools: [VaultValue] = []
    @State private var renaming: VaultValue?
    @State private var threadTitle = ""
    @State private var conversationTitle = ""
    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if messages.isEmpty {
                            ContentUnavailableView(
                                "Ask your vault", systemImage: "bubble.left.and.bubble.right",
                                description: Text(
                                    "Explore your documents, finances, research, and health with your configured assistant."
                                )
                            )
                        }
                        ForEach(Array(messages.enumerated()), id: \.offset) { index, message in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(message["role"].string == "user" ? "You" : "DocVault").font(
                                    .caption.bold()
                                ).foregroundStyle(.secondary)
                                Text(.init(Self.messageText(message))).textSelection(.enabled)
                            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    message["role"].string == "user"
                                        ? Color.indigo.opacity(0.08)
                                        : Color(.secondarySystemBackground),
                                    in: RoundedRectangle(cornerRadius: 16)
                                ).id(index)
                        }
                        ForEach(Array(tools.enumerated()), id: \.offset) { index, tool in
                            DisclosureGroup(
                                tool["toolName"].string.isEmpty
                                    ? VaultValue.label(tool["type"].string)
                                    : VaultValue.label(tool["toolName"].string)
                            ) { NativeValueSections(value: tool) }.font(.caption).id(
                                "tool-\(index)"
                            )
                        }
                        if let error {
                            ErrorNotice(message: error)
                        }
                    }.padding()
                }.onChange(of: messages) { _, _ in
                    if let last = messages.indices.last {
                        reader.scrollTo(last, anchor: .bottom)
                    }
                }
            }
            VStack(spacing: 10) {
                if !attachments.isEmpty {
                    Text("\(attachments.count) attachment(s)").font(.caption)
                    Button("Remove attachments") { attachments = [] }
                }
                HStack(alignment: .bottom) {
                    Button("Attach", systemImage: "paperclip") { importFile = true }.labelStyle(
                        .iconOnly
                    ).disabled(task != nil)
                    Button("Record voice", systemImage: "mic") { recordVoice = true }.labelStyle(
                        .iconOnly
                    ).disabled(task != nil)
                    TextField("Message DocVault", text: $draft, axis: .vertical).lineLimit(1 ... 6)
                        .accessibilityIdentifier("chatMessage")
                    if task != nil {
                        Button("Stop", systemImage: "stop.circle.fill") { task?.cancel() }
                    } else {
                        Button("Send", systemImage: "arrow.up.circle.fill") { send() }.labelStyle(
                            .iconOnly
                        ).disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("sendChat")
                    }
                }
            }.padding().background(.bar)
        }
        .navigationTitle("Chat").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("New conversation") {
                        task?.cancel()
                        task = nil
                        threadID = UUID().uuidString.lowercased()
                        resumeID = ""
                        conversationTitle = ""
                        messages = []
                        tools = []
                        error = nil
                    }.disabled(task != nil)
                    Button("History") { history = true }.disabled(task != nil)
                    Picker("Entity", selection: $entity) {
                        Text("All entities").tag("all")
                        ForEach(model.entities) { Text($0.name).tag($0.id) }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }.accessibilityIdentifier("chatActions")
            }
        }
        .task { await loadHistory() }
        .onDisappear { task?.cancel() }
        .sheet(isPresented: $recordVoice) {
            NativeVoiceRecorder(transcript: { draft = $0 }).privacyProtected()
        }
        .sheet(isPresented: $history) {
            NavigationStack {
                List(threads, id: \.self) { thread in
                    Button(thread.title) {
                        Task {
                            await open(thread)
                            history = false
                        }
                    }
                    .swipeActions {
                        Button("Rename", systemImage: "pencil") {
                            threadTitle = thread.title
                            renaming = thread
                        }.tint(.indigo)
                        Button("Delete", role: .destructive) {
                            Task {
                                do {
                                    _ = try await model.nativeRequest(
                                        "api/chat/threads/{id}", scope: .init(), record: thread,
                                        method: "DELETE"
                                    )
                                    await loadHistory()
                                } catch { self.error = error.localizedDescription }
                            }
                        }
                    }
                }.navigationTitle("Conversations").toolbar { Button("Done") { history = false } }
                    .alert("Rename conversation", isPresented: Binding(
                        get: { renaming != nil }, set: {
                            if !$0 {
                                renaming = nil
                            }
                        }
                    )) {
                        TextField("Title", text: $threadTitle)
                        Button("Cancel", role: .cancel) { renaming = nil }
                        Button("Save") {
                            guard let thread = renaming else { return }
                            Task {
                                do {
                                    var record = try await model.nativeRequest(
                                        "api/chat/threads/{id}", scope: .init(), record: thread
                                    )
                                    record.set("title", .string(threadTitle.trimmingCharacters(in: .whitespacesAndNewlines)))
                                    _ = try await model.nativeRequest(
                                        "api/chat/threads/{id}", scope: .init(), record: thread,
                                        method: "PUT", body: record
                                    )
                                    if thread["id"].string == threadID {
                                        conversationTitle = record["title"].string
                                    }
                                    await loadHistory()
                                } catch { self.error = error.localizedDescription }
                            }
                        }.disabled(threadTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
            }.privacyProtected()
        }
        .fileImporter(isPresented: $importFile, allowedContentTypes: [.pdf, .image]) { selection in
            do {
                let url = try selection.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer {
                    if scoped {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 10 * 1024 * 1024, attachments.count < 8 else {
                    throw VaultError.server(
                        "Choose up to eight attachments, each smaller than 10 MB."
                    )
                }
                let mime =
                    UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/pdf"
                try attachments.append(
                    .object([
                        "name": .string(url.lastPathComponent), "mimeType": .string(mime),
                        "dataUrl": .string(
                            "data:\(mime);base64,\(Data(contentsOf: url).base64EncodedString())"
                        ),
                    ])
                )
            } catch { self.error = error.localizedDescription }
        }
    }

    static func messageText(_ message: VaultValue) -> String {
        if !message["content"].string.isEmpty {
            return message["content"].string
        }
        return message["blocks"].array.compactMap {
            $0["text"].string.isEmpty ? nil : $0["text"].string
        }.joined(separator: "\n")
    }

    private func loadHistory() async {
        do {
            let data = try await model.nativeRequest("api/chat/threads", scope: .init())
            threads = data["threads"].object.values.sorted {
                $0["updatedAt"].string > $1["updatedAt"].string
            }
        } catch { self.error = error.localizedDescription }
    }

    private func open(_ thread: VaultValue) async {
        task?.cancel()
        task = nil
        do {
            let data = try await model.nativeRequest(
                "api/chat/threads/{id}", scope: .init(), record: thread
            )
            threadID = thread["id"].string
            conversationTitle = data["title"].string
            resumeID = data["resumeSessionId"].string
            messages = data["messages"].array
            tools = []
        } catch { self.error = error.localizedDescription }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, task == nil else { return }
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
        let sessionAPI = model.api
        let isDemo = model.demo
        draft = ""
        error = nil
        tools = []
        messages.append(.object(["role": .string("user"), "content": .string(text)]))
        let incoming: [VaultValue] = messages.map {
            .object(["role": $0["role"], "content": .string(Self.messageText($0))])
        }
        let files = attachments
        attachments = []
        messages.append(.object(["role": .string("assistant"), "content": .string("")]))
        task = Task { @MainActor in
            defer { task = nil }
            do {
                if model.demo {
                    messages[messages.count - 1].set(
                        "content",
                        .string(
                            "This is a demo response. Connect your server to use your configured assistant."
                        )
                    )
                } else {
                    guard let api = model.api else { throw VaultError.signedOut }
                    var body = VaultValue.object([
                        "messages": .array(incoming), "entity": .string(entity),
                        "chatId": .string(threadID), "attachments": .array(files),
                    ])
                    if !resumeID.isEmpty {
                        body.set("resumeSessionId", .string(resumeID))
                    }
                    try await api.stream(VaultRequest("api/chat", scope: .init()), body: body) {
                        event in
                        guard model.api === api, !Task.isCancelled else { return }
                        switch event["type"].string {
                        case "text":
                            let index = messages.count - 1
                            messages[index].set(
                                "content",
                                .string(messages[index]["content"].string + event["text"].string)
                            )
                        case "session": resumeID = event["sessionId"].string
                        case "error", "assistant_error":
                            error =
                                event["message"].string.isEmpty
                                    ? event["error"].string : event["message"].string
                        case "done":
                            if !event["sessionId"].string.isEmpty {
                                resumeID = event["sessionId"].string
                            }
                        default: tools.append(event)
                        }
                    }
                }
            } catch {
                if !Task.isCancelled {
                    model.handle(error)
                    self.error = error.localizedDescription
                }
            }
            let record = VaultValue.object([
                "id": .string(threadID),
                "title": .string(conversationTitle.isEmpty
                    ? messages.first.map(Self.messageText) ?? "New chat" : conversationTitle),
                "messages": .array(messages),
                "resumeSessionId": resumeID.isEmpty ? .null : .string(resumeID),
            ])
            // A stopped response still saves its partial transcript. The save has
            // its own task so URLSession does not inherit the stream cancellation.
            await Task { @MainActor in
                guard model.demo == isDemo, model.api === sessionAPI else { return }
                do {
                    _ = try await model.nativeRequest(
                        "api/chat/threads/{id}", scope: .init(), record: record, method: "PUT",
                        body: record
                    )
                    await loadHistory()
                } catch {
                    self.error = error.localizedDescription
                }
            }.value
        }
    }
}
