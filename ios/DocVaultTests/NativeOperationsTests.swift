@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeOperationsTests {
    @Test func partialWarningsErrorsAndNeverRunStayDistinct() {
        let partial = NativeOperationsDemo.warning
        #expect(NativeOperations.outcome(partial) == "Some items failed" && NativeOperations.attention(partial))
        var status = partial; status.set("running", .bool(true)); #expect(NativeOperations.outcome(status) == "Running")
        #expect(NativeOperations.outcome(.null) == "Not run yet" && !NativeOperations.attention(.null))
        #expect(NativeOperations.outcome(.object(["lastOutcome": .string("warning")])) == "Completed with warnings")
        #expect(NativeOperations.outcome(.object(["lastOutcome": .string("error")])) == "Failed")
        #expect(NativeOperations.outcome(.object(["lastSuccessAt": .string("2026-10-01T12:00:00Z")])) == "Succeeded")
        #expect(NativeOperations.runOutcome(.object(["exitCode": .number(0)])) == "Outcome not recorded")
    }

    @Test func jobDashboardJoinsCustomStatusesAndRetainsInvalidManifests() throws {
        var data = NativeOperationsDemo.jobs; data.set("customJobStatuses.acme-collector", NativeOperationsDemo.warning)
        let report = NativeJobs(value: data)
        #expect(report.jobs.count == 2 && report.invalid.count == 1 && report.attention == 2 && report.running == 0)
        #expect(report.filtered("COLLECTION INCOMPLETE", issues: true).map(\.title) == ["Acme source collector"])
        #expect(report.outcomes.map(\.amount).reduce(0, +) == 3)
        let builtIn = report.jobs[0]
        #expect(try VaultRequest(NativeOperations.historyPath(builtIn), scope: .init(), record: builtIn.value).query["kind"] == "built-in")
        #expect(!(try #require(NativeCatalog.resource("jobs")?.collections[0].actions.contains { $0.id == "run" })))
    }

    @Test func customManifestValidationMatchesSupportedSchedulesAndPaths() {
        let original = NativeOperationsDemo.jobs["customJobs"].array[0]["manifest"]
        #expect(NativeOperations.validateManifest(original) == nil)
        for (key, bad) in [("id", "../escape"), ("id", "A"), ("label", "  "), ("schedule", "every 0h"), ("schedule", "weekly"), ("script", "scripts/../escape.local.sh"), ("script", "untrusted.sh")] {
            var value = original; value.set(key, .string(bad)); #expect(NativeOperations.validateManifest(value) != nil)
        }
        var good = original; good.set("schedule", .string("every 2h")); #expect(NativeOperations.validateManifest(good) == nil)
        good.set("scriptContent", .string("fabricated script")); #expect(NativeOperations.manifest(good)["scriptContent"] == .null)
    }

    @Test func usageCostsPreserveUnpricedCallsZeroLatencyAndCompleteSummaryBoundary() {
        let report = NativeUsage(value: NativeOperationsDemo.usage)
        #expect(report.unpriced == 1 && report.pricedSubtotal == 0.01 && report.medianLatency == 500)
        #expect(report.summaryGroups("byModel").map(\.amount).reduce(0, +) == 2)
        #expect(report.dailyCosts.map(\.label) == ["2026-10-01"] && report.dailyCosts[0].amount == 0.01)
        let unknown = NativeUsage(value: .object(["entries": .array([.object(["cost": .null])])]))
        #expect(unknown.pricedSubtotal == nil && unknown.medianLatency == nil && unknown.dailyCosts.isEmpty)
        #expect(NativeUsage(value: .object(["entries": .array([])])).pricedSubtotal == 0)
        #expect(NativeOperations.number(.number(-1)) == nil && NativeOperations.number(.string("0")) == nil)
    }

    @Test func dailyUsageGroupsInstantsInUTCAndSkipsMalformedDates() {
        let report = NativeUsage(value: .object(["entries": .array([
            .object(["ts": .string("2026-10-02T01:00:00+02:00"), "cost": .object(["total": .number(0)])]),
            .object(["ts": .string("2026-02-30T12:00:00Z"), "cost": .object(["total": .number(10)])]),
        ])]))
        #expect(report.dailyCosts.map(\.label) == ["2026-10-01"] && report.dailyCosts[0].amount == 0)
        #expect(NativeOperations.timestamp(.null) == "Not recorded")
        #expect(NativeOperations.duration(.number(0)) == "0.0 s")
    }

    @Test func demoCreationAndDryRunRetainManifestStateWithoutExecutingScripts() throws {
        let store = NativeDemoStore()
        var original = NativeOperationsDemo.jobs["customJobs"].array[0]["manifest"]
        original.set("label", .string("Edited synthetic collector"))
        let saved = try store.request(VaultRequest("api/jobs?overwrite=true", scope: .init()), method: "POST", body: original)
        #expect(saved["ok"].boolean)
        let result = try store.request(VaultRequest("api/jobs/acme-collector/run?dryRun=true", scope: .init()), method: "POST", body: nil)
        #expect(result["result"]["dryRun"].boolean && result["result"]["stdout"].string.contains("No script executed"))
        let list = try store.request(VaultRequest("api/jobs", scope: .init()), method: "GET", body: nil)
        #expect(NativeJobs(value: list).jobs.first { !$0.builtIn }?.title == "Edited synthetic collector")
    }
}
