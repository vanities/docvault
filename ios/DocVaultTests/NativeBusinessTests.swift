@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeBusinessTests {
    private let scope = VaultScope(entity: "personal", year: 2026)
    @Test func salesUseSavedTotalsAndSeparateYearsEntitiesAndUnassignedRows() {
        var data = NativeBusinessDemo.seed("sales")
        var rows = data["sales"].array
        rows.append(.object(["id": .string("other"), "entity": .string("other"), "date": .string("2026-01-01"), "total": .number(999)]))
        rows.append(.object(["id": .string("unassigned"), "date": .string("2026-01-01"), "total": .number(7)]))
        data.set("sales", .array(rows))
        let report = NativeBusiness(value: data, kind: "sales", scope: scope)
        #expect(report.knownTotal == 90 && report.allTimeTotal == 120 && report.records.count == 2)
        #expect(report.monthlyAmounts.map(\.label) == ["Jan 2026", "Sep 2026"])
        #expect(report.categoryGroups.map(\.amount).compactMap(\.self).reduce(0, +) == 90)
        #expect(NativeBusiness(value: data, kind: "sales", scope: .init(entity: "all", year: 2026)).knownTotal == 1096)
        #expect(NativeBusiness(value: data, kind: "sales", scope: .init(entity: "personal", year: 2025)).knownTotal == 30)
        #expect(NativeBusiness(value: data, kind: "sales", scope: scope, allYears: true).records.count == 3)
    }

    @Test func mileageRetainsFuelOnlyEntriesAndUsesPairedMeanMPG() throws {
        let report = NativeBusiness(value: NativeBusinessDemo.seed("mileage"), kind: "mileage", scope: scope)
        #expect(report.knownTotal == 130 && report.allTimeTotal == 150 && report.deduction == 65)
        #expect(report.averageMPG == 22.5 && report.fuelCost == 38.5 && report.missingCount == 1)
        #expect(report.monthlyAmounts.map(\.amount) == [50, 80])
        let september = report.currentMonthRecords(now: try #require(NativeQuant.date("2026-09-25")))
        #expect(september.count == 2 && NativeBusiness.sum(september.map { NativeFinance.number($0.value["tripMiles"]) }) == 80)
        #expect(report.currentMonthRecords(now: try #require(NativeQuant.date("2025-05-01"))).count == 1)
    }

    @Test func zeroMissingAndEmptyObservationsStayDistinct() {
        var data = NativeBusinessDemo.seed("mileage")
        data.set("entries", .array([.object(["entity": .string("personal"), "date": .string("2026-01-01"), "tripMiles": .number(0)]), .object(["entity": .string("personal"), "date": .string("2026-01-02")])]))
        var report = NativeBusiness(value: data, kind: "mileage", scope: scope)
        #expect(report.knownTotal == 0 && report.deduction == 0 && report.missingCount == 1 && report.averageMPG == nil && report.fuelCost == nil)
        data.set("entries", .array([.object(["entity": .string("personal"), "date": .string("2026-01-02")])]))
        report = .init(value: data, kind: "mileage", scope: scope)
        #expect(report.knownTotal == nil && report.deduction == nil && report.monthlyAmounts.isEmpty)
        data.set("entries", .array([]))
        #expect(NativeBusiness(value: data, kind: "mileage", scope: scope).knownTotal == 0)
        #expect(NativeBusiness.sum([.infinity]) == nil)
    }

    @Test func invalidDatesDeletedProductsAndDuplicateNamesRemainInspectable() {
        var data = NativeBusinessDemo.seed("sales")
        data.set("products", .array([.object(["id": .string("a"), "name": .string("Acme Box")]), .object(["id": .string("b"), "name": .string("Acme Box")])]))
        data.set("sales", .array([
            .object(["entity": .string("personal"), "date": .string("2026-02-31"), "productId": .string("a"), "total": .number(10)]),
            .object(["entity": .string("personal"), "date": .string("2026-01-01"), "productId": .string("b"), "total": .number(-5)]),
            .object(["entity": .string("personal"), "date": .string("2026-01-02"), "productId": .string("gone"), "total": .number(0)]),
        ]))
        let report = NativeBusiness(value: data, kind: "sales", scope: scope)
        #expect(report.undatedCount == 1 && report.knownTotal == -5 && report.categoryGroups.count == 2)
        #expect(report.categoryGroups.contains { $0.title == "Acme Box · b" })
        #expect(report.categoryGroups.contains { $0.title == "Unavailable product · gone" && $0.amount == 0 })
        let all = NativeBusiness(value: data, kind: "sales", scope: scope, allYears: true)
        #expect(all.records.count == 3 && all.months.contains { $0.title == "Undated records" })
    }

    @Test func mileageClearsAreEncodedForTheServerWithoutInventingZero() throws {
        let fields = try #require(NativeCatalog.resource("mileage")?.collections.first { $0.id == "vehicles" }?.fields)
        let record: VaultValue = .object(["name": .string("Acme Vehicle"), "year": .number(2020)])
        let values = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.id == "year" ? "" : NativeForm.display(record[$0.id], field: $0)) })
        let body = try NativeForm.body(fields: fields, values: values, original: record, patch: true)
        #expect(NativeBusiness.mileagePatch(body)["year"] == .string(""))
        #expect(NativeBusiness.mileagePatch(.object(["tripMiles": .null, "gallons": .null, "totalCost": .number(0)])) == .object(["tripMiles": .string(""), "gallons": .string(""), "totalCost": .number(0)]))
        #expect(throws: (any Error).self) { try NativeBusiness.validate(.object(["quantity": .number(0)]), collection: "sales") }
    }

    @Test func routingAcceptsZeroCoordinatesAndRejectsInvalidPlaces() throws {
        let from = NativeRouteAddress(value: .object(["formatted": .string("Acme Alpha"), "lat": .number(0), "lon": .number(0)]))
        let to = NativeRouteAddress(value: .object(["formatted": .string("Acme Beta"), "lat": .number(1), "lon": .number(1)]))
        let path = try NativeRouteAddress.routePath(from: from, to: to)
        #expect(from.valid && path.contains("from_lat=0.0") && path.contains("to_lon=1.0"))
        let bad = NativeRouteAddress(value: .object(["formatted": .string("Acme Invalid"), "lat": .number(91), "lon": .number(0)]))
        #expect(!bad.valid)
        #expect(throws: (any Error).self) { try NativeRouteAddress.routePath(from: bad, to: to) }
    }

    @Test func demoProductEditsPreserveSalesUntilQuantityChanges() throws {
        let demo = NativeDemoStore()
        func call(_ path: String, _ method: String, _ body: VaultValue? = nil) throws -> VaultValue {
            try demo.request(VaultRequest(path, scope: scope), method: method, body: body)
        }
        _ = try call("api/sales/products/demo-box", "PUT", .object(["price": .number(20)]))
        _ = try call("api/sales/demo-sale1", "PUT", .object(["person": .string("Acme Renamed Customer")]))
        #expect(try call("api/sales", "GET")["sales"].array.first { $0["id"].string == "demo-sale1" }?["total"].number == 40)
        _ = try call("api/sales/demo-sale1", "PUT", .object(["quantity": .number(3)]))
        #expect(try call("api/sales", "GET")["sales"].array.first { $0["id"].string == "demo-sale1" }?["total"].number == 60)
    }

    @Test func demoMileageClearsAndFinancialSnapshotShareTheSameRecords() throws {
        let demo = NativeDemoStore()
        _ = try demo.request(VaultRequest("api/mileage/demo-trip1", scope: scope), method: "PUT", body: .object(["tripMiles": .string(""), "gallons": .string("")]))
        let mileage = try demo.request(VaultRequest("api/mileage", scope: scope), method: "GET", body: nil)
        #expect(mileage["entries"].array.first { $0["id"].string == "demo-trip1" }?["tripMiles"] == .null)
        let snapshot = try demo.request(VaultRequest("api/financial-snapshot/2026?format=json", scope: scope), method: "GET", body: nil)
        #expect(snapshot["mileage"]["totalMiles"].number == 80 && snapshot["mileage"]["totalDeduction"].number == 40 && snapshot["sales"]["totalRevenue"].number == 90)
    }
}
