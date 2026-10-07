import SwiftUI

private struct NativeFilingComposer: Identifiable {
    let reminder: Bool
    let today: String
    var id: String {
        reminder ? "reminder" : "todo"
    }
}

private struct NativeReminderReview: Identifiable {
    let occurrence: VaultValue
    let payment: NativeReminderPayment?
    let skipped: Bool
    var id: String {
        NativeFilingTasks.id(occurrence)
    }
}

struct NativeFilingTasksSection: View {
    @Environment(VaultModel.self) private var model
    let entity: String
    @State private var calendar: VaultValue = .null
    @State private var todos: [VaultValue] = []
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var operationError: String?
    @State private var feedback: String?
    @State private var showCompleted = false
    @State private var composer: NativeFilingComposer?
    @State private var review: NativeReminderReview?
    @State private var confirmResolution = false
    @State private var deleting: VaultValue?
    @State private var confirmDelete = false
    @State private var generation = UUID()
    private var reminders: [VaultValue] {
        NativeFilingTasks.pending(calendar, entity: entity)
    }

    private var pendingTodos: [VaultValue] {
        todos.filter { $0["status"].string == "pending" }
    }

    var body: some View {
        Section("Filing tasks & deadlines") {
            if loading {
                ProgressView("Loading reminders and to-dos…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry tasks") { Task { await load() } }
            }
            if let operationError {
                ErrorNotice(message: operationError).accessibilityIdentifier("filingOperationError"); Button("Refresh tasks") { self.operationError = nil; Task { await load() } }
            }
            if let feedback {
                Text(feedback).font(.callout).accessibilityIdentifier("filingTaskFeedback")
            }
            if !calendar.isEmpty {
                VaultMetricGrid(metrics: [.init(title: "Pending reminders", value: String(reminders.count), symbol: "bell"), .init(title: "Shared open to-dos", value: String(pendingTodos.count), symbol: "checklist")], color: .orange).vaultStandaloneRow().accessibilityIdentifier("filingTaskMetrics")
                VaultAmountChart(title: "Reminder urgency", subtitle: "Overdue tasks and the next 60 days. Dates follow the server's calendar.", amounts: NativeOperations.groups(reminders, key: { NativeFilingTasks.urgency($0, today: calendar["today"].string) }), color: .orange, identifier: "filingUrgencyChart", cardPrefix: "filingCard-", unit: .number("reminders")).vaultStandaloneRow()
            }
            ForEach(reminders, id: \.self) { row in
                VStack(alignment: .leading, spacing: 10) {
                    Label(row["title"].string, systemImage: NativeFilingTasks.urgency(row, today: calendar["today"].string) == "Overdue" ? "exclamationmark.circle" : "bell").font(.headline)
                    Text(row["date"].string + (row["endDate"].string.isEmpty ? "" : " through " + row["endDate"].string) + " · " + NativeFilingTasks.urgency(row, today: calendar["today"].string)).font(.subheadline).foregroundStyle(.secondary)
                    if entity == "all" {
                        Text(model.entities.first { $0.id == row["entityId"].string }?.name ?? (row["entityId"].string.isEmpty ? "Global" : row["entityId"].string)).font(.caption).foregroundStyle(.secondary)
                    }
                    if !row["recurrenceLabel"].string.isEmpty {
                        Label(row["recurrenceLabel"].string, systemImage: "repeat").font(.caption).foregroundStyle(.secondary)
                    }
                    if !row["notes"].string.isEmpty {
                        Text(row["notes"].string).font(.callout).textSelection(.enabled)
                    }
                    HStack {
                        Button("Complete", systemImage: "checkmark.circle") { Task { await prepare(row, skipped: false) } }.accessibilityIdentifier("filingComplete-" + NativeFilingTasks.id(row))
                        Button("Dismiss…", systemImage: "xmark.circle") { Task { await prepare(row, skipped: true) } }.accessibilityIdentifier("filingDismiss-" + NativeFilingTasks.id(row))
                    }.buttonStyle(.borderless).disabled(busy || loading)
                }.padding(.vertical, 5).accessibilityIdentifier("filingReminder-" + NativeFilingTasks.id(row))
            }
            if !loading, !calendar.isEmpty, reminders.isEmpty {
                Text("No pending reminders for this scope in the next 60 days or overdue.").foregroundStyle(.secondary)
            }
            if entity != "all", !entity.isEmpty {
                Button("Add reminder", systemImage: "bell.badge") { composer = .init(reminder: true, today: calendar["today"].string) }.disabled(loading || busy || NativeFilingTasks.date(calendar["today"].string) == nil).accessibilityIdentifier("filingAddReminder")
            }
            Text("To-dos are shared across the vault; they are not filtered by entity or tax year.").font(.caption).foregroundStyle(.secondary)
            ForEach(todos.filter { $0["status"].string != "completed" || showCompleted }, id: \.self) { row in
                VStack(alignment: .leading, spacing: 8) {
                    Text(row["title"].string).font(.body.weight(.medium)).strikethrough(row["status"].string == "completed")
                    HStack {
                        Button(row["status"].string == "completed" ? "Reopen" : "Complete", systemImage: row["status"].string == "completed" ? "arrow.uturn.backward.circle" : "checkmark.circle") { Task { await toggle(row) } }.accessibilityIdentifier("filingToggleTodo-" + row["id"].string)
                        Button("Delete…", role: .destructive) { deleting = row; confirmDelete = true }.accessibilityIdentifier("filingDeleteTodo-" + row["id"].string)
                    }.buttonStyle(.borderless).disabled(busy || loading)
                }.padding(.vertical, 4).accessibilityIdentifier("filingTodo-" + row["id"].string)
            }
            if todos.contains(where: { $0["status"].string == "completed" }) {
                Toggle("Show completed to-dos", isOn: $showCompleted).accessibilityIdentifier("filingShowCompleted")
            }
            Button("Add shared to-do", systemImage: "plus.circle") { composer = .init(reminder: false, today: calendar["today"].string) }.disabled(busy).accessibilityIdentifier("filingAddTodo")
            if busy {
                ProgressView("Saving task changes…")
            }
            if let feature = NativeCatalog.features.first(where: { $0.id == "calendar" }) {
                NavigationLink("Open Calendar & task definitions") { NativeFeatureView(feature: feature, initialScope: .init(entity: entity)) }
            }
        }.accessibilityIdentifier("nativeFilingTasks")
            .task(id: model.revision) { await load() }
            .sheet(item: $composer) { item in NativeFilingTaskEditor(reminder: item.reminder, entity: entity, today: item.today).privacyProtected() }
            .confirmationDialog(review?.skipped == true ? "Dismiss this occurrence?" : "Complete this reminder?", isPresented: $confirmResolution, titleVisibility: .visible) {
                if let review {
                    if !review.skipped, review.payment != nil {
                        Button("Complete & record reviewed payment") { Task { await resolve(review, recordPayment: true) } }.accessibilityIdentifier("filingConfirmPayment")
                    }
                    Button(review.skipped ? "Dismiss occurrence" : "Complete reminder only") { Task { await resolve(review, recordPayment: false) } }.accessibilityIdentifier("filingConfirmResolution")
                }
                Button("Keep pending", role: .cancel) { review = nil }
            } message: {
                if let review, let payment = review.payment, !review.skipped {
                    Text("\(review.occurrence["title"].string)\nOptionally record \(NativeFinance.money(payment.amount)) in personal estimated-tax payments: \(payment.year), quarter \(payment.quarter), date \(payment.date). This amount is one quarter of the saved annual target.")
                } else {
                    Text(review?.skipped == true ? "This records a skipped occurrence; a recurring task advances to its next date." : "This completes the dated occurrence; a recurring task advances to its next date.")
                }
            }
            .confirmationDialog("Delete this shared to-do?", isPresented: $confirmDelete, titleVisibility: .visible) {
                if let deleting {
                    Button("Delete to-do", role: .destructive) { Task { await deleteTodo(deleting) } }.accessibilityIdentifier("filingConfirmDeleteTodo")
                }
                Button("Keep to-do", role: .cancel) { deleting = nil }
            } message: { Text(deleting?["title"].string ?? "") }
    }

    private func occurrences() async throws -> VaultValue {
        try await model.nativeRequest("api/calendar/occurrences?includeCompleted=true", scope: .init())
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        async let reminders = occurrences()
        async let tasks = model.nativeRequest("api/todos", scope: .init())
        var errors: [String] = []
        do { let value = try await reminders; guard generation == id, !Task.isCancelled else { return }; calendar = value } catch {
            if generation == id, !Task.isCancelled {
                errors.append("Reminders: " + error.localizedDescription)
            }
        }
        do { let value = try await tasks; guard generation == id, !Task.isCancelled else { return }; todos = value["todos"].array } catch {
            if generation == id, !Task.isCancelled {
                errors.append("To-dos: " + error.localizedDescription)
            }
        }
        if generation == id, !errors.isEmpty {
            error = errors.joined(separator: "\n")
        }
    }

    private func prepare(_ row: VaultValue, skipped: Bool) async {
        busy = true; operationError = nil; feedback = nil; review = nil
        defer { busy = false }
        do {
            var payment: NativeReminderPayment?
            if !skipped, let period = NativeFilingTasks.paymentPeriod(row) {
                let saved = try await model.nativeRequest("api/estimated-taxes/personal/\(period.year)", scope: .init())
                payment = NativeFilingTasks.payment(row, saved: saved, today: calendar["today"].string)
            }
            review = .init(occurrence: row, payment: payment, skipped: skipped); confirmResolution = true
        } catch { operationError = "Estimated-tax payment details are unavailable: " + error.localizedDescription + ". You can complete the reminder without recording a payment." }
        if review == nil {
            review = .init(occurrence: row, payment: nil, skipped: skipped); confirmResolution = true
        }
    }

    private func resolve(_ review: NativeReminderReview, recordPayment: Bool) async {
        busy = true; operationError = nil; feedback = nil
        defer { busy = false; self.review = nil }
        var completed = false
        do {
            let current = try await occurrences()
            let body = try NativeFilingTasks.resolution(review.occurrence, current: current, skipped: review.skipped)
            if recordPayment, let payment = review.payment {
                _ = try NativeFilingTasks.paymentPatch(payment, current: try await model.nativeRequest(payment.path, scope: .init()))
            }
            let result = try await model.nativeRequest("api/calendar/events/{eventId}/complete", scope: .init(), record: review.occurrence, method: "POST", body: body)
            try NativeProviderSettings.requireSaved(result); completed = true
            if recordPayment, let payment = review.payment {
                let saved = try await model.nativeRequest(payment.path, scope: .init())
                if let patch = try NativeFilingTasks.paymentPatch(payment, current: saved) {
                    try NativeProviderSettings.requireSaved(try await model.nativeRequest(payment.path, scope: .init(), method: "PUT", body: patch))
                }
                feedback = "Reminder completed and the reviewed payment is recorded."
            } else {
                feedback = review.skipped ? "Occurrence dismissed. Recurring tasks keep their next date." : "Reminder completed."
            }
            model.revision += 1
        } catch {
            let message = completed ? "The reminder was resolved, but the payment was not confirmed: " + error.localizedDescription + " Review Estimated Tax before recording it again." : error.localizedDescription
            if completed {
                model.revision += 1
            }; operationError = message
        }
    }

    private func toggle(_ row: VaultValue) async {
        await mutateTodo(row, delete: false)
    }

    private func deleteTodo(_ row: VaultValue) async {
        await mutateTodo(row, delete: true); deleting = nil
    }

    private func mutateTodo(_ row: VaultValue, delete: Bool) async {
        busy = true; operationError = nil; feedback = nil
        defer { busy = false }
        do {
            let current = try await model.nativeRequest("api/todos", scope: .init())["todos"].array.first { $0["id"] == row["id"] }
            guard current == row else { throw VaultError.server("This shared to-do changed. Refresh before editing it.") }
            let result = try await model.nativeRequest("api/todos/{id}", scope: .init(), record: row, method: delete ? "DELETE" : "PUT", body: delete ? nil : .object(["status": .string(row["status"].string == "completed" ? "pending" : "completed")]))
            try NativeProviderSettings.requireSaved(result); model.revision += 1
        } catch { operationError = error.localizedDescription }
    }
}

private struct NativeFilingTaskEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let reminder: Bool
    let entity: String
    let today: String
    @State private var title = ""
    @State private var due: String
    @State private var recurrence = ""
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?
    @State private var discard = false
    private var dirty: Bool {
        !title.isEmpty || due != today || !recurrence.isEmpty || !notes.isEmpty
    }

    init(reminder: Bool, entity: String, today: String) {
        self.reminder = reminder; self.entity = entity; self.today = today; _due = State(initialValue: today)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("filingEditorError")
                }
                TextField("Title", text: $title).accessibilityIdentifier("filingEditorTitle")
                if reminder {
                    LabeledContent("Entity", value: model.entities.first { $0.id == entity }?.name ?? entity)
                    TextField("Due date (YYYY-MM-DD)", text: $due).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("filingEditorDate")
                    Picker("Repeats", selection: $recurrence) { Text("One-time").tag(""); Text("Monthly").tag("monthly"); Text("Quarterly").tag("quarterly"); Text("Yearly").tag("yearly") }.accessibilityIdentifier("filingEditorRecurrence")
                    TextField("Notes", text: $notes, axis: .vertical).accessibilityIdentifier("filingEditorNotes")
                } else {
                    Text("This to-do is shared across all entities and years.").font(.caption).foregroundStyle(.secondary)
                }
                if saving {
                    ProgressView("Saving task…")
                }
            }.disabled(saving).navigationTitle(reminder ? "Add reminder" : "Add shared to-do").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("filingEditorCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("filingEditorSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("filingEditorKeyboardDone") }
                }.interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard this task draft?", isPresented: $discard, titleVisibility: .visible) { Button("Discard draft", role: .destructive) { dismiss() }.accessibilityIdentifier("filingEditorDiscard"); Button("Keep editing", role: .cancel) {} }
        }
    }

    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        do {
            let body = reminder ? try NativeFilingTasks.reminder(title: title, date: due, entity: entity, recurrence: recurrence, notes: notes) : .object(["title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines))])
            let result = try await model.nativeRequest(reminder ? "api/calendar/events" : "api/todos", scope: .init(), method: "POST", body: body)
            try NativeProviderSettings.requireSaved(result); model.revision += 1; dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
