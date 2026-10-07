import Foundation

/// Invented, session-only task and entity stores. No server or provider requests.
enum NativeTaxWorkspaceDemo {
    static func request(_ request: VaultRequest, method: String, body: VaultValue?, entities: [VaultEntity], stores: inout [String: VaultValue]) throws -> VaultValue? {
        let path = request.path.joined(separator: "/")
        let today = String(Date.now.ISO8601Format().prefix(10))
        if path == "api/entities" || request.path.count == 3 && request.path.prefix(2).joined(separator: "/") == "api/entities" {
            var rows = (stores["api/entities"] ?? .object(["entities": .array(entities.map { .object(["id": .string($0.id), "name": .string($0.name), "color": .string($0.color), "type": .string($0.type ?? "tax"), "description": .string($0.description ?? ""), "metadata": .object(["ein": .string("DEMO-IDENTIFIER"), "naicsCodes": .array([.string("000000"), .string("111111")]), "filingStatus": .string("single"), "calculation": .object(["note": .string("Invented structured value")])])]) })]))["entities"].array
            if method == "GET" {
                stores["api/entities"] = .object(["entities": .array(rows)]); return stores["api/entities"]
            }
            var updated: VaultValue = .null
            if method == "POST", path == "api/entities" {
                guard let body, body["id"].string.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil, !body["name"].string.isEmpty, !rows.contains(where: { $0["id"] == body["id"] }) else { throw VaultError.server("Enter an unused entity ID and name.") }
                updated = body; updated.set("color", body["color"].string.isEmpty ? .string("gray") : body["color"]); rows.append(updated)
            } else if let index = rows.firstIndex(where: { $0["id"].string == request.path.last }) {
                if method == "DELETE" {
                    rows.remove(at: index)
                } else if method == "PUT", let body {
                    for key in NativeEntityDetails.identityFields where body[key] != .null {
                        rows[index].set(key, body[key])
                    }
                    var metadata = rows[index]["metadata"].object
                    for (key, value) in body["metadata"].object {
                        if value == .null {
                            metadata.removeValue(forKey: key)
                        } else {
                            metadata[key] = value
                        }
                    }
                    rows[index].set("metadata", .object(metadata)); updated = rows[index]
                } else {
                    return nil
                }
            } else {
                throw VaultError.server("Demo entity not found.")
            }
            stores["api/entities"] = .object(["entities": .array(rows)])
            return .object(["ok": .bool(true), "entity": updated])
        }
        if path == "api/todos" || request.path.count == 3 && request.path.prefix(2).joined(separator: "/") == "api/todos" {
            var rows = (stores["api/todos"] ?? .object(["todos": .array([.object(["id": .string("demo-review"), "title": .string("Review invented tax records"), "status": .string("pending")]), .object(["id": .string("demo-done"), "title": .string("Collect Acme source files"), "status": .string("completed")])])]))["todos"].array
            if method == "GET" {
                stores["api/todos"] = .object(["todos": .array(rows)]); return stores["api/todos"]
            }
            var updated: VaultValue = .null
            if method == "POST", path == "api/todos" {
                guard let body, !body["title"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.server("Enter a title.") }
                updated = .object(["id": .string(UUID().uuidString), "title": body["title"], "status": .string("pending"), "createdAt": .string(Date.now.ISO8601Format())]); rows.append(updated)
            } else if let index = rows.firstIndex(where: { $0["id"].string == request.path.last }) {
                if method == "DELETE" {
                    rows.remove(at: index)
                } else if method == "PUT", let body {
                    for (key, value) in body.object where ["title", "status"].contains(key) {
                        rows[index].set(key, value)
                    }; rows[index].set("updatedAt", .string(Date.now.ISO8601Format())); updated = rows[index]
                } else {
                    return nil
                }
            } else {
                throw VaultError.server("Demo to-do not found.")
            }
            stores["api/todos"] = .object(["todos": .array(rows)]); return .object(["ok": .bool(true), "todo": updated])
        }
        if request.path.count == 4, request.path.prefix(2).joined(separator: "/") == "api/estimated-taxes" {
            if method == "GET" {
                let value = stores[path] ?? .object(["payments": .array([]), "config": .object(["annualTarget": .number(400)])]); stores[path] = value; return value
            }
            if method == "PUT", let body {
                stores[path] = body; return .object(["ok": .bool(true), "payments": body["payments"], "config": body["config"]])
            }
        }
        guard request.path.prefix(2).joined(separator: "/") == "api/calendar", request.path.count >= 3 else { return nil }
        guard ["events", "occurrences"].contains(request.path[2]) else { return nil }
        let seed = [event("demo-deadline", title: "Review Acme filing deadline", date: today, entity: "acme"), event("demo-payment", title: "Estimated Tax Payment — Acme demo", date: today, entity: "personal")]
        var events = (stores["api/calendar/events"] ?? .object(["events": .array(seed)]))["events"].array
        if method == "GET" {
            stores["api/calendar/events"] = .object(["events": .array(events)])
            if request.path[2] == "events" {
                return .object(["events": .array(events.filter { event in request.query["entity"].map { $0 == event["entityId"].string } ?? true })])
            }
            let start = request.query["start"] ?? today
            let end = request.query["end"] ?? advanced(today, interval: 60, unit: "day", steps: 1)
            var rows: [VaultValue] = []
            for event in events where event["status"].string != "archived" && (request.query["entity"] == nil || request.query["entity"] == event["entityId"].string) {
                var tail: VaultValue?
                for step in 0 ..< 4000 {
                    let due = step == 0 ? event["date"].string : advanced(event["date"].string, interval: Int(event["recurrence"]["interval"].number ?? 1), unit: event["recurrence"]["unit"].string, steps: step)
                    if due.isEmpty || due > end {
                        break
                    }
                    let completion = event["completions"].array.first { $0["occurrenceDate"].string == due }
                    var row: VaultValue = .object(["eventId": event["id"], "title": event["title"], "kind": event["kind"], "date": .string(due), "entityId": event["entityId"], "notes": event["notes"], "completable": .bool(event["kind"].string == "task"), "completed": .bool(completion != nil), "overdue": .bool(completion == nil && due < today && event["kind"].string == "task"), "recurrenceLabel": .string(event["recurrence"].isEmpty ? "one-off" : "Repeats every \(event["recurrence"]["interval"].string) \(event["recurrence"]["unit"].string)")])
                    if let completion {
                        row.set("skipped", completion["skipped"])
                    }
                    if due >= start {
                        if request.query["includeCompleted"] != "false" || completion == nil {
                            rows.append(row)
                        }
                    } else if completion == nil, event["kind"].string == "task" {
                        tail = row
                    }
                    if event["recurrence"].isEmpty {
                        break
                    }
                }
                if let tail, start <= today {
                    rows.append(tail)
                }
            }
            return .object(["today": .string(today), "occurrences": .array(rows.sorted { $0["date"].string < $1["date"].string })])
        }
        if path == "api/calendar/events", method == "POST", var body {
            guard ["task", "event", "birthday"].contains(body["kind"].string), !body["title"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, NativeFilingTasks.date(body["date"].string) != nil else { throw VaultError.server("Enter a valid event kind, title and date.") }
            body.set("id", .string(UUID().uuidString)); body.set("status", .string("active")); body.set("completions", .array([])); events.append(body)
            stores["api/calendar/events"] = .object(["events": .array(events)]); return .object(["ok": .bool(true), "event": body])
        }
        guard request.path.count >= 4, let index = events.firstIndex(where: { $0["id"].string == request.path[3] }) else { throw VaultError.server("Demo event not found.") }
        if request.path.count == 4, method == "DELETE" {
            events.remove(at: index)
        } else if request.path.count == 4, method == "PUT", let body {
            for (key, value) in body.object {
                events[index].set(key, value)
            }
        } else if request.path.count == 5, method == "POST", let body, NativeFilingTasks.date(body["occurrenceDate"].string) != nil {
            var completions = events[index]["completions"].array
            if request.path[4] == "uncomplete" {
                completions.removeAll { $0["occurrenceDate"] == body["occurrenceDate"] }
            } else if request.path[4] == "complete" {
                guard !completions.contains(where: { $0["occurrenceDate"] == body["occurrenceDate"] }) else { throw VaultError.server("Occurrence already completed.") }
                completions.append(body)
            } else {
                return nil
            }
            events[index].set("completions", .array(completions))
        } else {
            return nil
        }
        stores["api/calendar/events"] = .object(["events": .array(events)]); return .object(["ok": .bool(true)])
    }

    private static func event(_ id: String, title: String, date: String, entity: String) -> VaultValue {
        .object(["id": .string(id), "kind": .string("task"), "title": .string(title), "date": .string(date), "entityId": .string(entity), "status": .string("active"), "recurrence": .null, "completions": .array([])])
    }

    private static func advanced(_ date: String, interval: Int, unit: String, steps: Int) -> String {
        guard let date = NativeFilingTasks.date(date), interval > 0, interval <= 10000, steps < 4000 else { return "" }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let component: Calendar.Component = unit == "year" ? .year : unit == "month" ? .month : unit == "week" ? .weekOfYear : .day
        guard let next = calendar.date(byAdding: component, value: interval * steps, to: date) else { return "" }; return String(next.ISO8601Format().prefix(10))
    }
}
