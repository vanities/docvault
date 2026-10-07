import Foundation

@MainActor enum NativeOperationsDemo {
    private static func json(_ text: String) -> VaultValue {
        (try? JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))) ?? .null
    }

    static let warning = json(#"{"running":false,"lastOutcome":"partial","lastError":"Synthetic collection incomplete: 1 collected, 1 failed, 1 skipped","lastRanAt":"2026-10-01T12:00:00Z","lastSuccessAt":"2026-09-30T12:00:00Z","lastCleanSuccessAt":"2026-09-29T12:00:00Z","lastDurationMs":1250,"nextRetryAt":"2026-10-01T12:05:00Z","consecutiveFailures":2,"lastCollection":{"collected":1,"failed":1,"skipped":1}}"#)
    static let run = json(#"{"id":"acme-collector","runId":"acme-collector-demo","startedAt":"2026-10-01T12:00:00Z","finishedAt":"2026-10-01T12:00:01Z","durationMs":1000,"outcome":"partial","exitCode":0,"warningCount":1,"collection":{"collected":1,"failed":1,"skipped":1},"diagnostics":[{"ts":"2026-10-01T12:00:00Z","level":"warn","namespace":"Research","message":"Synthetic source unavailable; retry required."}],"stdout":"Fabricated collector output. No script executed.","stderr":"Synthetic collector warning."}"#)
    static let jobs = json(#"{"builtInJobs":[{"id":"snapshot","label":"Portfolio Snapshot","kind":"built-in","description":"Invented snapshot status for the demo.","enabled":false,"schedule":"every 1440m","tags":["demo"],"status":{"running":false,"lastRanAt":"2026-10-01T12:00:00Z","lastSuccessAt":"2026-10-01T12:00:01Z","lastCleanSuccessAt":"2026-10-01T12:00:01Z","lastOutcome":"success","lastDurationMs":1000}}],"customJobs":[{"status":"valid","path":"jobs/manifests/acme-collector.json","manifest":{"id":"acme-collector","label":"Acme source collector","kind":"local-script","schedule":"daily","script":"scripts/acme-collector.local.sh","enabled":false,"tags":["synthetic"]}},{"status":"invalid","path":"jobs/manifests/invalid.json","error":"Synthetic manifest is missing required fields."}],"customJobStatuses":{}}"#)
    static let logs = json(#"{"source":"disk","date":"2026-10-01","entries":[{"ts":"2026-10-01T12:00:00Z","level":"info","namespace":"Acme","message":"Synthetic collection started."},{"ts":"2026-10-01T12:00:01Z","level":"warn","namespace":"Research","message":"Synthetic source unavailable; retry required."},{"ts":"2026-10-01T12:00:02Z","level":"error","namespace":"Acme","message":"Synthetic collector could not read one item."}]}"#)
    static let usage = json(#"{"entries":[{"ts":"2026-10-02T12:00:00Z","model":"unpriced-synthetic-model","purpose":"synthetic-research","latencyMs":0,"usage":{"inputTokens":10,"outputTokens":0},"cost":null,"ok":false,"error":"Synthetic provider failure"},{"ts":"2026-10-01T12:00:00Z","model":"Demo model","purpose":"parse-synthetic","latencyMs":1000,"usage":{"inputTokens":100,"outputTokens":50},"cost":{"total":0.01},"ok":true}],"summary":{"totalCalls":2,"successfulCalls":1,"failedCalls":1,"totalInputTokens":110,"totalOutputTokens":50,"totalCacheWriteTokens":0,"totalCacheReadTokens":0,"totalCostUsd":0.01,"firstTs":"2026-10-01T12:00:00Z","lastTs":"2026-10-02T12:00:00Z","byModel":{"Demo model":{"calls":1},"unpriced-synthetic-model":{"calls":1}},"byPurpose":{"parse-synthetic":{"calls":1},"synthetic-research":{"calls":1}}}}"#)

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue]) throws -> VaultValue? {
        let key = request.path.joined(separator: "/")
        if key == "api/ai-usage", method == "GET" {
            return usage
        }
        if key == "api/logs", method == "GET" {
            if request.query["dates"] == "1" {
                return .object(["dates": .array([.string("2026-10-01")])])
            }
            var value = logs; value.set("source", .string(request.query["date"] == nil ? "buffer" : "disk")); return value
        }
        if key == "api/status", method == "GET" {
            return .object(["ok": .bool(true), "isDirectory": .bool(true), "authenticated": .bool(true), "entities": .array([.object(["name": .string("Demo entity")])])])
        }
        if key == "api/cache-status", method == "GET" {
            return .object(["bankLastUpdated": .string("2026-10-01T12:00:00Z"), "brokerLastUpdated": .null, "cryptoLastUpdated": .null])
        }
        guard request.path.count >= 2, request.path[1] == "jobs" else { return nil }
        var list = stores["api/jobs"] ?? jobs
        if stores["api/jobs"] == nil {
            list.set("customJobStatuses.acme-collector", warning)
        }
        defer { stores["api/jobs"] = list }
        if request.path.count == 2 {
            if method == "GET" {
                return list
            }
            guard method == "POST", let body else { throw VaultError.server("Unsupported demo job request.") }
            if let error = NativeOperations.validateManifest(body) {
                throw VaultError.server(error)
            }
            let id = body["id"].string
            var records = list["customJobs"].array
            if let index = records.firstIndex(where: { $0["manifest"]["id"].string == id }) {
                guard request.query["overwrite"] == "true" else { throw VaultError.server("Demo job already exists.") }
                records.remove(at: index)
            }
            let row = NativeOperations.manifest(body)
            records.append(.object(["status": .string("valid"), "manifest": row])); list.set("customJobs", .array(records))
            return .object(["ok": .bool(true), "manifest": row, "scriptStatus": .object(["runnable": .bool(true), "message": .string("Demo save simulated; no server script written.")])])
        }
        guard request.path.count == 4 else { throw VaultError.server("Unsupported demo job request.") }
        let id = request.path[2]
        let historyKey = "api/jobs/" + id + "/runs"
        if request.path[3] == "runs", method == "GET" {
            return stores[historyKey] ?? .object(["runs": .array(id == "acme-collector" || id == "snapshot" ? [run] : [])])
        }
        if request.path[3] == "run", method == "POST" {
            guard list["customJobs"].array.contains(where: { $0["manifest"]["id"].string == id }) else { throw VaultError.server("Demo custom job not found.") }
            var attempt = run; attempt.set("id", .string(id)); attempt.set("runId", .string(UUID().uuidString)); attempt.set("dryRun", .bool(request.query["dryRun"] == "true"))
            var history = stores[historyKey]?["runs"].array ?? []; history.insert(attempt, at: 0); stores[historyKey] = .object(["runs": .array(history)])
            if request.query["dryRun"] != "true" {
                list.set("customJobStatuses." + id, warning)
            }
            return .object(["ok": .bool(true), "result": attempt])
        }
        throw VaultError.server("Unsupported demo job request.")
    }
}
