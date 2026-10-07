import SwiftUI

struct NativeInvoiceEditView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let invoice: VaultValue
    private let initialPaymentDay: String
    @State private var status: String
    @State private var paymentDate: Date
    @State private var comment: String
    @State private var busy = false
    @State private var error: String?
    @State private var discard = false
    @State private var confirm = false
    @State private var active = true
    init(invoice: VaultValue) {
        let day = NativeTimesheetReport.date(invoice["paymentDate"].string) ?? Date.now
        self.invoice = invoice; initialPaymentDay = NativeQuant.day(day); _status = State(initialValue: invoice["status"].string); _paymentDate = State(initialValue: day); _comment = State(initialValue: invoice["comment"].string)
    }

    private var dirty: Bool {
        status != invoice["status"].string || comment != invoice["comment"].string || (status == "paid" && NativeQuant.day(paymentDate) != initialPaymentDay)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Invoice \(invoice["number"].string)") {
                    Picker("Status", selection: $status) { Text("Unpaid").tag("new"); Text("Paid").tag("paid"); Text("Voided").tag("canceled") }.accessibilityIdentifier("invoiceStatus")
                    if status == "paid" {
                        DatePicker("Payment date", selection: $paymentDate, displayedComponents: .date).environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).accessibilityIdentifier("invoicePaymentDate")
                        if invoice["paymentDate"].string.isEmpty {
                            Text("No payment date is recorded. A comment-only edit keeps it unset; changing this date records your selection.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    TextField("Comment", text: $comment, axis: .vertical).lineLimit(3 ... 15).accessibilityIdentifier("invoiceEditComment")
                    Text("Changing status keeps billed entries locked. Deleting the invoice is the action that releases them.").font(.caption).foregroundStyle(.secondary)
                }
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("invoiceEditError")
                }
                if busy {
                    ProgressView("Saving invoice…")
                }
            }.disabled(busy).navigationTitle("Edit invoice").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { confirm = true }.disabled(busy || !dirty).accessibilityIdentifier("invoiceSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("invoiceKeyboardDone") }
                }.interactiveDismissDisabled(busy || dirty)
                .confirmationDialog("Save invoice changes?", isPresented: $confirm, titleVisibility: .visible) { Button("Save changes") { Task { await save() } } } message: { Text(status == "paid" ? "Record payment on \(NativeQuant.day(paymentDate))." : status == "canceled" ? "Void this invoice while retaining its billing lock." : "Record this invoice as unpaid and clear the payment date.") }
                .confirmationDialog("Discard invoice changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() } }
                .onDisappear { active = false }
        }
    }

    private func save() async {
        busy = true; error = nil; let api = model.api, demo = model.demo
        defer {
            if active {
                busy = false
            }
        }
        do {
            let body = try NativeInvoices.editBody(original: invoice, status: status, paymentDate: NativeQuant.day(paymentDate), initialPaymentDay: initialPaymentDay, comment: comment)
            _ = try await model.changeNativeInvoice(invoice, body: body)
            guard active, model.connected, model.api === api, model.demo == demo else { return }; dismiss()
        } catch { guard active, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
    }
}

struct NativeInvoiceComposeView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var review: NativeInvoiceEmailReview?
    @State private var baseline: NativeInvoiceEmailDraft?
    @State private var busy = false
    @State private var error: String?
    @State private var result: VaultValue?
    @State private var discard = false
    @State private var reloadConfirm = false
    @State private var sendConfirm = false
    @State private var generation = UUID()
    private var dirty: Bool {
        review?.draft != baseline
    }

    var body: some View {
        NavigationStack {
            Form {
                if let review {
                    Section("Email envelope") {
                        composeField("To", key: \.to, id: "invoiceEmailTo")
                        composeField("From (empty uses server default)", key: \.from, id: "invoiceEmailFrom")
                        composeField("CC (empty sends without CC)", key: \.cc, id: "invoiceEmailCC")
                        Text("Client CC is filled from saved server settings. Clearing this field explicitly suppresses it for this email.").font(.caption).foregroundStyle(.secondary)
                    }.disabled(result != nil)
                    Section("Message") {
                        composeField("Subject", key: \.subject, id: "invoiceEmailSubject")
                        TextField("Email body", text: draftBinding(\.text), axis: .vertical).lineLimit(6 ... 30).accessibilityIdentifier("invoiceEmailBody")
                        LabeledContent("Attachment", value: review.draft.attachment).accessibilityIdentifier("invoiceEmailAttachment")
                    }.disabled(result != nil)
                    Section("Delivery review") {
                        LabeledContent("Invoice", value: review.invoice["number"].string)
                        LabeledContent("Sender", value: review.sender).accessibilityIdentifier("invoiceEmailSender")
                        Text("The server attaches the invoice PDF and sends the reviewed fields. Subject whitespace is trimmed; an empty subject uses the invoice number.").font(.caption).foregroundStyle(.secondary)
                        if !review.invoice["sentAt"].string.isEmpty {
                            Label("Already accepted \(review.invoice["sentAt"].string) to \(review.invoice["sentTo"].string). Sending again creates another email.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).accessibilityIdentifier("invoiceAlreadySent")
                        }
                        if model.demo {
                            Label("Demo only: sending is simulated. No email leaves the app.", systemImage: "sparkles").accessibilityIdentifier("invoiceEmailDemo")
                        }
                        if result == nil {
                            Button(model.demo ? "Review & simulate send…" : "Review & send invoice…", systemImage: "paperplane") { sendConfirm = true }.disabled(review.draft.to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("invoiceEmailSend")
                            Button("Reload server draft") {
                                if dirty {
                                    reloadConfirm = true
                                } else {
                                    Task { await load() }
                                }
                            }.accessibilityIdentifier("invoiceEmailReload")
                        }
                    }
                }
                if let result {
                    Section("Confirmed result") {
                        Label(model.demo ? "Simulated send — no email sent" : "Email accepted by the provider", systemImage: "checkmark.circle.fill").foregroundStyle(.green).accessibilityIdentifier("invoiceEmailResult")
                        Text(result["sentTo"].string).textSelection(.enabled)
                        Text(result["sentAt"].string).font(.caption).foregroundStyle(.secondary)
                        if !model.demo {
                            Text("Check Sent Mail for the accepted attempt. Inbox delivery has not been confirmed.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if busy {
                    ProgressView("Preparing invoice email…")
                }
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("invoiceEmailError"); if review == nil {
                        Button("Retry loading draft") { Task { await load() } }
                    }
                }
            }.disabled(busy).navigationTitle("Compose invoice").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(result == nil ? "Cancel" : "Done") {
                        if dirty, result == nil {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(busy) }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("invoiceKeyboardDone") }
                }.interactiveDismissDisabled(busy || (dirty && result == nil))
                .task { await load() }
                .confirmationDialog(model.demo ? "Simulate invoice delivery?" : "Send this invoice email?", isPresented: $sendConfirm, titleVisibility: .visible) { Button(model.demo ? "Simulate send" : "Send invoice") {
                    if let review {
                        Task { await send(review) }
                    }
                } } message: { Text("To: \(review?.draft.to ?? "")\nFrom: \(review?.sender ?? "")\nCC: \(review?.draft.cc.isEmpty == false ? review!.draft.cc : "None")\nAttachment: \(review?.draft.attachment ?? "")" + ((review?.invoice["sentAt"].string.isEmpty == false) ? "\nThis invoice has already been sent; this sends it again." : "")) }
                .confirmationDialog("Discard email changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard draft", role: .destructive) { dismiss() } }
                .confirmationDialog("Replace this edited draft?", isPresented: $reloadConfirm, titleVisibility: .visible) { Button("Reload draft", role: .destructive) { Task { await load() } } }
                .onDisappear { generation = UUID() }
        }
    }

    private func draftBinding(_ key: WritableKeyPath<NativeInvoiceEmailDraft, String>) -> Binding<String> {
        Binding(get: { review?.draft[keyPath: key] ?? "" }, set: { review?.draft[keyPath: key] = $0 })
    }

    private func composeField(_ title: String, key: WritableKeyPath<NativeInvoiceEmailDraft, String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(title).font(.caption).foregroundStyle(.secondary); TextField(title, text: draftBinding(key)).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier(id) }
    }

    private func load() async {
        let token = UUID(), api = model.api, demo = model.demo; generation = token; busy = true; error = nil
        defer {
            if generation == token {
                busy = false
            }
        }
        do { let value = try await model.nativeInvoiceEmailReview(id: id); guard generation == token, model.connected, model.api === api, model.demo == demo else { return }; review = value; baseline = value.draft }
        catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
    }

    private func send(_ review: NativeInvoiceEmailReview) async {
        let token = generation, api = model.api, demo = model.demo; busy = true; error = nil
        defer {
            if generation == token {
                busy = false
            }
        }
        do { let value = try await model.sendNativeInvoice(review); guard generation == token, model.connected, model.api === api, model.demo == demo else { return }; result = value }
        catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription + " If the response was interrupted, check Sent Mail and reload this invoice before retrying." }
    }
}

struct NativeInvoiceFileView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let invoice: VaultValue
    @State private var entity = ""
    @State private var year: String
    @State private var parse = true
    @State private var busy = false
    @State private var outcome: NativeInvoiceFiling?
    @State private var confirmation = false
    @State private var active = true
    init(invoice: VaultValue) {
        self.invoice = invoice; _year = State(initialValue: String(invoice["issueDate"].string.prefix(4)))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Document destination") {
                    Picker("Entity", selection: $entity) { Text("Choose an entity").tag(""); ForEach(model.entities.filter(\.isTax)) { Text($0.name).tag($0.id) } }.accessibilityIdentifier("invoiceFileEntity")
                    TextField("Year", text: $year).keyboardType(.numberPad).accessibilityIdentifier("invoiceFileYear")
                    Text("\(year)/income/other/\(NativeInvoices.filingName(invoice))\nThe server assigns a collision suffix when needed.").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }.disabled(outcome?.path != nil)
                Section("Parsing") {
                    Toggle("Parse the filed PDF", isOn: $parse).accessibilityIdentifier("invoiceFileParse").disabled(outcome?.path != nil)
                    Text("Parsing uses the configured document provider. A saved PDF remains available if parsing fails.").font(.caption).foregroundStyle(.secondary)
                }
                if let outcome {
                    Section("Filing result") {
                        if let path = outcome.path {
                            Label("PDF saved", systemImage: "checkmark.circle.fill").foregroundStyle(.green); Text(outcome.entity + ":" + path).textSelection(.enabled).accessibilityIdentifier("invoiceFiledPath")
                        }
                        if outcome.parsed {
                            Label("Parsed data confirmed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        }
                        if let error = outcome.error {
                            ErrorNotice(message: error).accessibilityIdentifier("invoiceFileError")
                        }
                        if outcome.error != nil, outcome.path != nil {
                            Button("Retry parsing saved PDF") { Task { await file(parse: true) } }.accessibilityIdentifier("invoiceRetryParse")
                            Button("Keep PDF unparsed") { var kept = outcome; kept.error = nil; self.outcome = kept }.accessibilityIdentifier("invoiceKeepUnparsed")
                        }
                        if outcome.complete {
                            Text(outcome.parsed ? "The saved PDF and parsed data are ready." : "The PDF is saved without a confirmed extraction.")
                        }
                    }
                }
                if outcome?.complete != true, outcome?.path == nil {
                    Button("Review & file PDF…") { confirmation = true }.disabled(entity.isEmpty || year.range(of: "^[0-9]{4}$", options: .regularExpression) == nil).accessibilityIdentifier("invoiceFileConfirm")
                }
                if busy {
                    ProgressView("Filing invoice…")
                }
            }.disabled(busy).navigationTitle("File invoice PDF").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(outcome?.path == nil ? "Cancel" : "Done") { dismiss() }.disabled(busy) }; ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("invoiceKeyboardDone") } }
                .interactiveDismissDisabled(busy)
                .confirmationDialog("File a copy of this invoice?", isPresented: $confirmation, titleVisibility: .visible) { Button("File invoice") { Task { await file(parse: parse) } } } message: { Text("Save the PDF into \(model.entities.first { $0.id == entity }?.name ?? entity), year \(year)." + (parse ? " Then request document parsing." : " Keep it unparsed.")) }
                .onDisappear { active = false }
        }
    }

    private func file(parse: Bool) async {
        busy = true; let api = model.api, demo = model.demo
        defer {
            if active {
                busy = false
            }
        }
        let result = await model.fileNativeInvoice(invoice, filing: outcome ?? .init(entity: entity, year: year), parse: parse)
        guard active, model.connected, model.api === api, model.demo == demo else { return }; outcome = result
    }
}
