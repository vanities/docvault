@testable import DocVault
import Foundation
import Testing

struct NativeTaxWorkspaceTests {
    private let entities: [VaultEntity] = [.init(id: "personal", name: "Personal", color: "indigo", type: "tax", description: nil), .init(id: "acme", name: "Acme Studio", color: "teal", type: "tax", description: nil), .init(id: "records", name: "Records", color: "orange", type: "docs", description: nil)]

    @Test func taxUploadKeepsTheSelectedEntityYearAndCanonicalFolder() throws {
        let destination = try NativeTaxWorkspace.destination(entity: "acme", year: "2024", folder: "expenses/medical")
        #expect(destination == .init(entity: "acme", folder: "2024/expenses/medical"))
        #expect(NativeTaxWorkspace.uploadFolder(destination: destination, entity: entities[1], currentYear: 2026) == "2024/expenses/medical")
        #expect(NativeTaxWorkspace.uploadFolder(destination: destination, entity: entities[0], currentYear: 2026) == "2024/expenses/medical")
        #expect(NativeTaxWorkspace.uploadFolder(destination: destination, entity: entities[2], currentYear: 2026) == "inbox")
        #expect(NativeTaxWorkspace.uploadFolder(destination: nil, entity: entities[0], currentYear: 2026) == "2026/inbox")
        for (entity, year, folder) in [("all", "2024", "income/w2"), ("acme", "0", "income/w2"), ("acme", "0000", "income/w2"), ("acme", "2024", "../private"), ("..", "2024", "income/w2")] {
            #expect(throws: VaultError.self) { try NativeTaxWorkspace.destination(entity: entity, year: year, folder: folder) }
        }
        #expect(Set(NativeTaxWorkspace.folders.map(\.1)).count == 15)
    }

    @Test func metadataPartialEditsPreserveUnrelatedStructuredAndListValues() throws {
        let old: VaultValue = .object(["id": .string("acme"), "name": .string("Acme Studio"), "metadata": .object(["address": .string("Invented address"), "naicsCodes": .array([.string("000000"), .string("111111")]), "calculation": .object(["override": .number(1234.56)])])])
        var current = old; current.set("metadata.calculation.override", .number(777))
        var metadata = NativeEntityDetails.editable(old["metadata"]); metadata["address"] = .string("Revised invented address")
        let patch = try NativeEntityDetails.patch(original: old, current: current, identity: [:], metadata: metadata)
        #expect(patch == .object(["metadata": .object(["address": .string("Revised invented address")])]))
        #expect(metadata["naicsCodes"] == old["metadata"]["naicsCodes"])
        #expect(NativeEntityDetails.edited("000000\n111111", template: old["metadata"]["naicsCodes"]) == .array([.string("000000"), .string("111111")]))
        metadata.removeValue(forKey: "address")
        #expect(try NativeEntityDetails.patch(original: old, current: current, identity: [:], metadata: metadata) == .object(["metadata": .object(["address": .null])]))
        current.set("metadata.address", .string("Changed by another editor"))
        #expect(throws: VaultError.self) { try NativeEntityDetails.patch(original: old, current: current, identity: [:], metadata: metadata) }
    }

    @Test func metadataEditorRejectsCollisionsAndNeverExposesMaskedFragments() throws {
        #expect(try NativeEntityDetails.newKey("  Filing note ") == "filingNote")
        #expect(try NativeEntityDetails.newKey("sosControlNumber") == "sosControlNumber")
        #expect(NativeEntityDetails.masked(.string("DEMO-IDENTIFIER")) == "••••••••")
        #expect(NativeEntityDetails.masked(.string("1234")) == "••••••••")
        for key in ["", "__proto__", "constructor"] {
            #expect(throws: VaultError.self) { try NativeEntityDetails.newKey(key) }
        }
        let old: VaultValue = .object(["id": .string("acme"), "name": .string("Acme"), "metadata": .object(["internal": .object([:])])])
        #expect(throws: VaultError.self) { try NativeEntityDetails.patch(original: old, current: old, identity: [:], metadata: ["internal": .string("replacement")]) }
        #expect(throws: VaultError.self) { try NativeEntityDetails.patch(original: old, current: old, identity: ["name": " "], metadata: [:]) }
        var changed = old; changed.set("name", .string("Revised Acme"))
        #expect(throws: VaultError.self) { try NativeEntityDetails.patch(original: old, current: changed, identity: ["name": "Other Acme"], metadata: [:]) }
    }

    @Test func filingRemindersRespectEntityServerTodayAndOverdueOccurrenceIdentity() {
        func row(_ id: String, date: String, entity: String, completed: Bool = false) -> VaultValue {
            .object(["eventId": .string(id), "date": .string(date), "entityId": .string(entity), "completable": .bool(true), "completed": .bool(completed)])
        }
        let response: VaultValue = .object(["today": .string("2026-03-08"), "occurrences": .array([row("old", date: "2025-11-01", entity: "acme"), row("day", date: "2026-03-08", entity: "acme"), row("boundary", date: "2026-05-07", entity: "acme"), row("outside", date: "2026-05-08", entity: "acme"), row("other", date: "2026-03-08", entity: "personal"), row("done", date: "2026-03-08", entity: "acme", completed: true), row("invalid", date: "2026-02-30", entity: "acme")])])
        #expect(NativeFilingTasks.pending(response, entity: "acme").map { $0["eventId"].string } == ["old", "day", "boundary"])
        #expect(NativeFilingTasks.pending(response, entity: "all").count == 4)
        #expect(NativeFilingTasks.days("2026-03-08", "2026-03-09") == 1)
        #expect(NativeFilingTasks.date("2026-02-30") == nil)
        #expect(NativeFilingTasks.id(row("monthly", date: "2026-03-08", entity: "acme")) != NativeFilingTasks.id(row("monthly", date: "2026-04-08", entity: "acme")))
        #expect(NativeFilingTasks.urgency(.object(["date": .string("2026-03-06"), "endDate": .string("2026-03-10")]), today: "2026-03-08") == "Within 7 days")
    }

    @Test func reminderCreationAndResolutionKeepRecurrenceAndSkippedContracts() throws {
        let created = try NativeFilingTasks.reminder(title: " Acme deadline ", date: "2026-03-08", entity: "acme", recurrence: "quarterly", notes: "Literal invented notes")
        #expect(created["title"].string == "Acme deadline" && created["entityId"].string == "acme")
        #expect(created["recurrence"] == .object(["interval": .number(3), "unit": .string("month"), "anchor": .string("fixed")]))
        #expect(try NativeFilingTasks.reminder(title: "Acme", date: "2026-03-08", entity: "acme", recurrence: "", notes: "")["recurrence"] == .null)
        #expect(throws: VaultError.self) { try NativeFilingTasks.reminder(title: "Acme", date: "2026-03-08", entity: "all", recurrence: "", notes: "") }
        let row: VaultValue = .object(["eventId": .string("acme-monthly"), "date": .string("2026-03-08"), "completable": .bool(true), "completed": .bool(false)])
        let current: VaultValue = .object(["today": .string("2026-03-09"), "occurrences": .array([row])])
        #expect(try NativeFilingTasks.resolution(row, current: current, skipped: true) == .object(["occurrenceDate": .string("2026-03-08"), "completedOn": .string("2026-03-09"), "skipped": .bool(true)]))
        var resolved = row; resolved.set("completed", .bool(true))
        #expect(throws: VaultError.self) { try NativeFilingTasks.resolution(row, current: .object(["today": current["today"], "occurrences": .array([resolved])]), skipped: false) }
    }

    @Test func estimatedReminderPaymentsKeepQuarterYearAmountAndRetryIdentity() throws {
        let row: VaultValue = .object(["eventId": .string("demo-payment"), "title": .string("Estimated Tax Payment — Acme"), "date": .string("2026-01-15")])
        let saved: VaultValue = .object(["payments": .array([.object(["id": .string("prior-demo"), "amount": .number(111)])]), "config": .object(["annualTarget": .number(400), "note": .string("Invented target")])])
        let payment = try #require(NativeFilingTasks.payment(row, saved: saved, today: "2026-01-15"))
        #expect(payment.year == 2025 && payment.quarter == 4 && payment.amount == 100)
        #expect(payment.path == "api/estimated-taxes/personal/2025")
        let body = try #require(try NativeFilingTasks.paymentPatch(payment, current: saved))
        #expect(body["payments"].array.count == 2 && body["payments"].array[0] == saved["payments"].array[0] && body["config"] == saved["config"])
        #expect(try NativeFilingTasks.paymentPatch(payment, current: body) == nil)
        var changed = saved; changed.set("config.annualTarget", .number(800))
        #expect(throws: VaultError.self) { try NativeFilingTasks.paymentPatch(payment, current: changed) }
        #expect(NativeFilingTasks.payment(row, saved: .object(["config": .object(["annualTarget": .number(0)])]), today: "2026-01-15") == nil)
    }

    @Test func demoEntityAndTodoWritesPreserveDataAndUseNoExternalServices() throws {
        var stores: [String: VaultValue] = [:]
        func call(_ path: String, _ method: String = "GET", _ body: VaultValue? = nil) throws -> VaultValue {
            try #require(NativeTaxWorkspaceDemo.request(VaultRequest(path, scope: .init()), method: method, body: body, entities: entities, stores: &stores))
        }
        let entity = try #require(call("api/entities")["entities"].array.first { $0["id"].string == "acme" })
        _ = try call("api/entities/acme", "PUT", .object(["metadata": .object(["filingStatus": .null, "customNote": .string("Revised invented note")])]))
        let changed = try #require(call("api/entities")["entities"].array.first { $0["id"].string == "acme" })
        #expect(changed["metadata"]["filingStatus"] == .null && changed["metadata"]["customNote"].string == "Revised invented note")
        #expect(changed["metadata"]["naicsCodes"] == entity["metadata"]["naicsCodes"] && changed["metadata"]["calculation"] == entity["metadata"]["calculation"])
        _ = try call("api/todos/demo-review", "PUT", .object(["status": .string("completed")]))
        #expect(try call("api/todos")["todos"].array.first { $0["id"].string == "demo-review" }?["status"].string == "completed")
        _ = try call("api/todos/demo-review", "DELETE")
        #expect(try !call("api/todos")["todos"].array.contains { $0["id"].string == "demo-review" })
    }

    @Test func demoRecurringDismissalAdvancesWithoutDeletingTheTask() throws {
        var stores: [String: VaultValue] = [:]
        func call(_ path: String, _ method: String = "GET", _ body: VaultValue? = nil) throws -> VaultValue {
            try #require(NativeTaxWorkspaceDemo.request(VaultRequest(path, scope: .init()), method: method, body: body, entities: entities, stores: &stores))
        }
        let today = try call("api/calendar/occurrences")["today"].string
        let created = try call("api/calendar/events", "POST", NativeFilingTasks.reminder(title: "Acme recurring review", date: today, entity: "acme", recurrence: "monthly", notes: "Invented notes"))["event"]
        let id = created["id"].string
        _ = try call("api/calendar/events/\(id)/complete", "POST", .object(["occurrenceDate": .string(today), "skipped": .bool(true)]))
        let projected = try call("api/calendar/occurrences?includeCompleted=false")
        #expect(projected["occurrences"].array.contains { $0["eventId"].string == id && $0["date"].string > today && $0["completed"] == .bool(false) })
        #expect(try call("api/calendar/events?entity=acme")["events"].array.contains { $0["id"].string == id })
        #expect(throws: VaultError.self) { try call("api/calendar/events/\(id)/complete", "POST", .object(["occurrenceDate": .string(today)])) }
        _ = try call("api/calendar/events/\(id)/uncomplete", "POST", .object(["occurrenceDate": .string(today)]))
        #expect(try call("api/calendar/occurrences?includeCompleted=false")["occurrences"].array.contains { $0["eventId"].string == id && $0["date"].string == today })
    }
}
