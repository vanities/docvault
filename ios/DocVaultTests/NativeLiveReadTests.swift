@testable import DocVault
import Foundation
import Testing

/// Explicitly opt in on a device already connected to the chosen server.
/// Reads only: no fixture reset, save, sync, job execution or provider setup.
@Suite("Live native read audit", .serialized, .enabled(if: ProcessInfo.processInfo.environment["DOCVAULT_LIVE_TEST_SERVER"] != nil))
@MainActor struct NativeLiveReadTests {
    @Test func auditNativeReadContractsAndChartAdapters() async throws {
        let server = try #require(ProcessInfo.processInfo.environment["DOCVAULT_LIVE_TEST_SERVER"])
        let address = try ServerAddress(server)
        let token = try SessionStore().read(for: address)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        let api = VaultAPI(address: address, token: token, session: URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil))
        let status = try await api.status()
        #expect(status.ok)
        #expect(!status.authRequired || status.authenticated)
        let entities = try await api.entities()
        #expect(!entities.isEmpty)
        let people = try await api.request(VaultRequest("api/health/people", scope: .init()))["people"].array
        let scope = VaultScope(entity: entities.first(where: \.isTax)?.id ?? entities.first?.id ?? "", person: people.first(where: { $0["archivedAt"].string.isEmpty })?["id"].string ?? "")
        var responses: [VaultRequest: VaultValue] = [:]
        var rows: [VaultValue] = []
        for feature in NativeCatalog.features {
            for resource in feature.resources {
                let start = Date()
                var row: VaultValue = .object(["feature": .string(feature.id), "resource": .string(resource.id), "template": .string(resource.path)])
                do {
                    let request = try VaultRequest(resource.path, scope: scope)
                    let value: VaultValue
                    if let cached = responses[request] {
                        value = cached
                    } else {
                        value = try await api.request(request)
                        responses[request] = value
                    }
                    row.set("outcome", .string("decoded"))
                    switch value {
                    case .object: row.set("responseKind", .string("object"))
                    case .array: row.set("responseKind", .string("array"))
                    case .string: row.set("responseKind", .string("text"))
                    default: row.set("responseKind", .string("scalar"))
                    }
                    if case let .string(message) = value["error"], !message.isEmpty {
                        row.set("outcome", .string("reported-error"))
                        row.set("diagnostic", .string(message))
                    } else if value["ok"] == .bool(false) {
                        row.set("outcome", .string("reported-error"))
                    }
                    row.set("arrayRecords", .number(Double(value.array.count)))
                    row.set("collections", .object(Dictionary(uniqueKeysWithValues: resource.collections.map { ($0.id, .number(Double(value.at($0.path).array.count))) })))
                    if resource.id == "jobs" {
                        let report = NativeJobs(value: value)
                        let finiteOutcomes = report.outcomes.allSatisfy(\.amount.isFinite)
                        #expect(finiteOutcomes)
                        #expect(report.outcomes.reduce(0) { $0 + $1.amount } == Double(report.jobs.count + report.invalid.count))
                        row.set("validJobs", .number(Double(report.jobs.count)))
                        row.set("invalidManifests", .number(Double(report.invalid.count)))
                    }
                    if resource.id == "usage" {
                        let report = NativeUsage(value: value)
                        #expect(report.dailyCosts.allSatisfy { $0.amount.isFinite && $0.amount >= 0 })
                        #expect(report.unpriced <= report.entries.count)
                        row.set("recentCalls", .number(Double(report.entries.count)))
                        row.set("recentUnpriced", .number(Double(report.unpriced)))
                    }
                    if resource.id == "banks" {
                        let accounts = NativeFinance.accounts(value)
                        for currency in Set(accounts.map(\.currency)) {
                            let totals = NativeFinance.totals(accounts.filter { $0.currency == currency }.map(\.balance))
                            let finiteTotals = [totals.net, totals.assets, totals.debt].compactMap(\.self).allSatisfy(\.isFinite)
                            #expect(finiteTotals)
                        }
                        row.set("accounts", .number(Double(accounts.count)))
                    }
                    if resource.id == "brain" {
                        let stats = NativeMarkdownStats(value["content"].string)
                        #expect(value["bytes"].number == Double(stats.bytes))
                        #expect(stats.sections.reduce(0) { $0 + $1.amount } == Double(stats.words))
                        row.set("words", .number(Double(stats.words)))
                        row.set("headings", .number(Double(stats.headings)))
                    }
                    if resource.id == "skills" {
                        let skills = value["skills"].array
                        for skill in skills {
                            #expect(NativeAdministration.validSkillName(skill["name"].string))
                            let detail = try await api.request(VaultRequest("api/skills/{name}", scope: scope, record: skill))
                            #expect(detail["name"] == skill["name"])
                            #expect(!detail["instructions"].string.isEmpty)
                        }
                        row.set("instructionFilesRead", .number(Double(skills.count)))
                    }
                    if resource.id == "external-sources" {
                        var indexed = 0
                        for repo in value["repos"].array {
                            let index = try await api.request(VaultRequest("api/external-sources/{id}/files", scope: scope, record: repo))
                            let files = index["files"].array.map(\.string)
                            let validPaths = files.allSatisfy(NativeSourceFiles.safePath)
                            #expect(validPaths)
                            indexed += files.count
                            if let path = files.first {
                                var record = repo; record.set("sourcePath", .string(path))
                                let page = try await api.request(VaultRequest("api/external-sources/{id}/file?path={sourcePath}", scope: scope, record: record))
                                if case .string = page["content"] {} else {
                                    Issue.record("Source reader did not return text")
                                }
                            }
                        }
                        row.set("indexedPages", .number(Double(indexed)))
                    }
                } catch {
                    row.set("outcome", .string("unavailable"))
                    row.set("diagnostic", .string(error.localizedDescription))
                }
                row.set("elapsedSeconds", .number(Date().timeIntervalSince(start)))
                rows.append(row)
                // Private logs retain diagnostics without recording source payloads.
                print("DOCVAULT_LIVE_READ " + String(decoding: try JSONEncoder().encode(row), as: UTF8.self))
            }
        }
        #expect(rows.count == NativeCatalog.features.reduce(0) { $0 + $1.resources.count })
        #expect(rows.contains { $0["resource"].string == "jobs" && $0["outcome"].string == "decoded" })
        #expect(rows.contains { $0["resource"].string == "usage" && $0["outcome"].string == "decoded" })
        // A completed audit is not proof that unavailable providers or empty stores work.
        print("DOCVAULT_LIVE_READ_SUMMARY " + String(decoding: try JSONEncoder().encode(VaultValue.object(["sections": .number(Double(rows.count)), "decoded": .number(Double(rows.filter { $0["outcome"].string == "decoded" }.count)), "reportedErrors": .number(Double(rows.filter { $0["outcome"].string == "reported-error" }.count)), "unavailable": .number(Double(rows.filter { $0["outcome"].string == "unavailable" }.count))])), as: UTF8.self))
    }
}
