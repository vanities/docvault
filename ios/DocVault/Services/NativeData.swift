import Foundation
import Observation

extension VaultModel {
    func nativeRequest(
        _ path: String, scope: VaultScope, record: VaultValue = .null, method: String = "GET",
        body: VaultValue? = nil
    ) async throws -> VaultValue {
        let request = try VaultRequest(path, scope: scope, record: record)
        if demo {
            if request.path.count == 3, request.path.prefix(2).joined(separator: "/") == "api/tax-summary", method == "GET" {
                return demoTaxSummary(year: request.path[2])
            }
            if request.path.count == 5, request.path.prefix(3).joined(separator: "/") == "api/analytics/quick-stats", method == "GET" {
                return NativeTaxDemo.statistics(entity: request.path[3], year: request.path[4], sourceSummary: demoTaxSummary(year: request.path[4]))
            }
            return try nativeDemo.request(request, method: method, body: body)
        }
        guard let api else { throw VaultError.signedOut }
        do {
            let result = try await api.request(request, method: method, body: body)
            guard self.api === api else { throw CancellationError() }
            return result
        } catch {
            if self.api === api {
                handle(error)
            }
            throw error
        }
    }

    func nativeSaveList(
        collection: NativeCollection, resource: NativeResource, scope: VaultScope,
        original: VaultValue, updated: VaultValue, editing: Bool, delete: Bool = false
    ) async throws {
        var fresh = try await nativeRequest(resource.path, scope: scope)
        var rows = fresh.at(collection.path).array
        if editing || delete {
            guard let index = rows.firstIndex(where: { $0["id"] == original["id"] }),
                  rows[index] == original
            else {
                throw VaultError.server("This record changed on the server. Reload before saving.")
            }
            if delete {
                rows.remove(at: index)
            } else {
                rows[index] = updated
            }
        } else {
            var row = updated
            row.set("id", .string(UUID().uuidString))
            rows.append(row)
        }
        fresh.set(collection.path, .array(rows))
        _ = try await nativeRequest(resource.path, scope: scope, method: "PUT", body: fresh)
    }

    func nativeDelete(
        collection: NativeCollection, resource: NativeResource, scope: VaultScope,
        record: VaultValue
    ) async throws {
        if collection.wholeList {
            try await nativeSaveList(
                collection: collection, resource: resource, scope: scope, original: record,
                updated: .null, editing: false, delete: true
            )
        } else {
            _ = try await nativeRequest(
                collection.deletePath, scope: scope, record: record, method: "DELETE"
            )
        }
    }

    func nativeUpload(_ path: String, scope: VaultScope, record: VaultValue, fileURL: URL, method: String, contentType: String = "application/octet-stream") async throws -> VaultValue {
        if demo {
            let request = try VaultRequest(path, scope: scope, record: record)
            if request.path.count == 3, request.path[1] == "research" {
                return try nativeDemo.request(request, method: method, body: .object(["domain": .string(request.query["domain"] ?? "finance"), "mediaType": .string(contentType)]))
            }
            return .object(["ok": .bool(true), "message": .string("Demo import simulated. Connect a server to import records.")])
        }
        guard let api else { throw VaultError.signedOut }
        do {
            let result = try await api.uploadFile(VaultRequest(path, scope: scope, record: record), fileURL: fileURL, method: method, contentType: contentType)
            guard self.api === api else { throw CancellationError() }
            revision += 1
            return result
        } catch {
            if self.api === api {
                handle(error)
            }
            throw error
        }
    }

    func nativeRestore(fileURL: URL, password: String) async throws -> VaultValue {
        guard password.count >= 4 else { throw VaultError.server("Enter a backup password of at least four characters.") }
        if demo {
            return .object(["ok": .bool(true), "message": .string("Demo restore only.")])
        }
        guard let api else { throw VaultError.signedOut }
        do {
            let result = try await api.restoreBackup(fileURL: fileURL, password: password)
            guard self.api === api else { throw CancellationError() }
            let entities = try await api.entities()
            guard self.api === api else { throw CancellationError() }
            self.entities = entities
            revision += 1
            return result
        } catch {
            if self.api === api {
                handle(error)
            }
            throw error
        }
    }

    func nativeDownload(
        _ path: String, scope: VaultScope, record: VaultValue, method: String, body: VaultValue?,
        suffix: String
    ) async throws -> URL {
        let folder = Self.previewRoot.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        do {
            if demo {
                if let invoice = try nativeDemo.invoiceForPDF(VaultRequest(path, scope: scope, record: record), method: method, body: body) {
                    let url = folder.appendingPathComponent("Invoice_" + invoice["number"].string.replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "-", options: .regularExpression) + ".pdf")
                    try DemoVault.invoicePDF(invoice).write(to: url, options: [.atomic, .completeFileProtection]); return url
                }
                if let bytes = try nativeDemo.researchDownload(VaultRequest(path, scope: scope, record: record), suffix: suffix) {
                    let url = folder.appendingPathComponent("Acme source." + suffix)
                    try bytes.write(to: url, options: [.atomic, .completeFileProtection]); return url
                }
                let bytes = suffix == "zip" ? DemoVault.archive() : DemoVault.pdf(title: "Demo \(suffix.uppercased())")
                let url = folder.appendingPathComponent(suffix == "zip" ? "DocVault.zip" : "DocVault.pdf")
                try bytes.write(to: url, options: [.atomic, .completeFileProtection])
                return url
            }
            guard let api else { throw VaultError.signedOut }
            let url = try await api.downloadFile(VaultRequest(path, scope: scope, record: record), method: method, body: body, fallback: suffix, folder: folder)
            guard self.api === api else { throw CancellationError() }
            return url
        } catch {
            try? FileManager.default.removeItem(at: folder)
            handle(error)
            throw error
        }
    }
}

@Observable @MainActor
final class NativeDemoStore {
    private var records: [String: VaultValue] = [:]
    func invoiceForPDF(_ request: VaultRequest, method: String, body: VaultValue?) throws -> VaultValue? {
        try NativeInvoicesDemo.pdfInvoice(request, method: method, body: body, stores: records)
    }

    func researchDownload(_ request: VaultRequest, suffix: String) throws -> Data? {
        try NativeResearchDemo.download(request, suffix: suffix, stores: &records)
    }

    func request(_ request: VaultRequest, method: String, body: VaultValue?) throws -> VaultValue {
        let key = request.path.joined(separator: "/")
        if let workspace = try NativeTaxWorkspaceDemo.request(request, method: method, body: body, entities: DemoVault.entities, stores: &records) {
            return workspace
        }
        if let administration = try NativeAdministrationDemo.request(request, method: method, body: body, stores: &records) {
            return administration
        }
        if let provider = NativeProviderDemo.request(request, method: method, body: body, stores: &records) {
            return provider
        }
        if let operations = try NativeOperationsDemo.request(request, method: method, body: body, stores: &records) {
            return operations
        }
        if let research = try NativeResearchDemo.request(request, method: method, body: body, stores: &records) {
            return research
        }
        if let business = try NativeBusinessDemo.request(request, method: method, body: body, stores: &records) {
            return business
        }
        if let report = try NativeTimesheetReportDemo.request(request, method: method, body: body, stores: &records) {
            return report
        }
        if let invoice = try NativeInvoicesDemo.request(request, method: method, body: body, stores: &records) {
            return invoice
        }
        if request.path.count >= 4, request.path[1] == "health", request.path[3] == "nutrition" {
            let base = request.path.prefix(4).joined(separator: "/")
            var store = records[base] ?? .object(["entries": .array([.object([
                "id": .string("demodaily"), "status": .string("active"),
                "dose": .object(["amount": .number(1), "unit": .string("capsule"), "frequency": .string("daily"), "timeOfDay": .string("morning")]),
                "parsed": .object(["schemaVersion": .number(1), "parserVersion": .string("synthetic"),
                                   "brandName": .string("Acme Nutrition"), "productName": .string("Daily Demo"), "category": .string("vitamin"),
                                   "servingSize": .object(["amount": .number(2), "unit": .string("capsules")]),
                                   "vitamins": .array([.object(["name": .string("Vitamin C"), "amount": .number(90), "unit": .string("mg"), "dv": .number(100)])])]),
                "notes": .string("Invented product for exploring the native regimen."),
            ])])])
            var rows = store["entries"].array
            if request.path.count == 4 {
                if method == "POST" {
                    var row = body ?? .object([:])
                    var parsed = row
                    for field in ["status", "dose", "notes", "research", "citations"] {
                        parsed.remove(field)
                    }
                    parsed.set("schemaVersion", .number(1)); parsed.set("parserVersion", .string("synthetic"))
                    row.set("parsed", parsed); row.set("id", .string(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()))
                    if row["status"].isEmpty {
                        row.set("status", .string("considering"))
                    }
                    rows.insert(row, at: 0); store.set("entries", .array(rows)); records[base] = store
                    return .object(["entry": row])
                }
                records[base] = store
                return store
            }
            guard let index = rows.firstIndex(where: { $0["id"].string == request.path[4] }) else { throw VaultError.server("Demo product unavailable.") }
            if method == "PATCH" {
                for (field, value) in (body ?? .null).object {
                    rows[index].set(field, value)
                }
            }
            let row = rows[index]
            if method == "DELETE" {
                rows.remove(at: index)
            }
            store.set("entries", .array(rows)); records[base] = store
            return .object(["entry": row])
        }
        if method == "GET", key == "api/calendar/almanac" {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            var days: [VaultValue] = []
            if var date = formatter.date(from: request.query["start"] ?? ""), let end = formatter.date(from: request.query["end"] ?? "") {
                while date <= end, days.count < 94 {
                    days.append(.object([
                        "date": .string(formatter.string(from: date)),
                        "marks": .array([.object(["layer": .string("showMoon"), "emoji": .string("🌔"), "label": .string("Demo moon phase")])]),
                        "moon": .object(["name": .string("Demo moon"), "emoji": .string("🌔"), "illumination": .number(0.75)]),
                        "astrology": .object(["sunSign": .object(["name": .string("Libra"), "emoji": .string("♎")]), "moonSign": .object(["name": .string("Leo"), "emoji": .string("♌")]), "mercuryRetrograde": .bool(false)]),
                        "sun": .object(["sunrise": .string("7:00 AM"), "sunset": .string("6:30 PM"), "daylight": .string("11h 30m"), "change": .string("-2m 00s"), "timeZone": .string("Demo location"), "location": .string("Invented sun times")]),
                    ]))
                    date = date.addingTimeInterval(86400)
                }
            }
            return .object(["days": .array(days), "display": (records["api/settings"] ?? seed("api/settings"))["calendar"]])
        }
        if method == "GET" {
            if let saved = records[key] {
                return saved
            }
            let value = seed(key)
            records[key] = value
            return value
        }
        if request.path.count == 4, request.path.prefix(3).joined(separator: "/") == "api/chat/threads" {
            let id = request.path[3]
            let indexKey = "api/chat/threads"
            var index = records[indexKey] ?? seed(indexKey)
            if method == "DELETE" {
                records.removeValue(forKey: key)
                var threads = index["threads"]
                threads.remove(id)
                index.set("threads", threads)
            } else if method == "PUT", var thread = body {
                thread.set("updatedAt", .string(Date().ISO8601Format()))
                records[key] = thread
                var summary = thread
                summary.remove("messages")
                var threads = index["threads"]
                threads.set(id, summary)
                index.set("threads", threads)
            }
            records[indexKey] = index
            return .object(["ok": .bool(true)])
        }
        let matching = NativeCatalog.features.flatMap(\.resources).flatMap { resource in
            resource.collections.map { (resource, $0) }
        }.first { _, collection in
            [collection.createPath, collection.updatePath, collection.deletePath].contains {
                template in
                guard !template.isEmpty else { return false }
                let route = template.split(separator: "?")[0].split(separator: "/").map(String.init)
                return route.count == request.path.count
                    && zip(route, request.path).allSatisfy { $0.hasPrefix("{") || $0 == $1 }
            }
        }
        if let (resource, collection) = matching, !collection.wholeList {
            let scope = VaultScope(entity: "personal", person: "demo-person")
            let base =
                (try? VaultRequest(resource.path, scope: scope).path.joined(separator: "/"))
                    ?? resource.path
            var store = records[base] ?? seed(base)
            var rows = store.at(collection.path).array
            if method == "DELETE" {
                rows.removeAll {
                    $0["id"].string == request.path.last || $0["name"].string == request.path.last
                }
            } else if method == "POST" {
                var row = body ?? .object([:])
                row.set("id", .string(UUID().uuidString))
                rows.insert(row, at: 0)
            } else if let index = rows.firstIndex(where: {
                $0["id"].string == request.path.last || $0["name"].string == request.path.last
            }) {
                for (field, value) in (body ?? .null).object {
                    rows[index].set(field, value)
                }
            }
            store.set(collection.path, .array(rows))
            records[base] = store
        } else if method == "PUT" || method == "PATCH" || key == "api/settings" {
            var original = records[key] ?? seed(key)
            for (field, value) in (body ?? .null).object {
                if key == "api/settings", field == "calendar" {
                    for (toggle, setting) in value.object {
                        original.set("calendar.\(toggle)", setting)
                    }
                } else {
                    original.set(field, value)
                }
            }
            records[key] = original
        }
        return .object(["ok": .bool(true), "message": .string("Saved in this demo session.")])
    }

    private static func demoDate(daysAgo: Int) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(
            from: Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date())!
        )
    }

    private func seed(_ path: String) -> VaultValue {
        if path.hasPrefix("api/financial-snapshot/"), let year = path.split(separator: "/").last {
            let bankData = seed("api/simplefin/balances")
            let brokerData = seed("api/brokers/portfolio")
            let tax = NativeTaxDemo.statistics(entity: "all", year: String(year))
            let summaries = NativeTaxDemo.summary(year: String(year))["summary"].object
            let entities = Dictionary(uniqueKeysWithValues: summaries.map { id, summary in
                let statistics = NativeTaxDemo.statistics(entity: id, year: String(year))
                return (id, VaultValue.object(["entity": summary["entity"], "income": statistics["income"]["items"], "expenses": statistics["expenses"]["expenses"]]))
            })
            var banks = bankData
            let salesData = records["api/sales"] ?? NativeBusinessDemo.seed("sales")
            let mileageData = records["api/mileage"] ?? NativeBusinessDemo.seed("mileage")
            let businessScope = VaultScope(entity: "all", year: Int(year) ?? 0)
            let salesReport = NativeBusiness(value: salesData, kind: "sales", scope: businessScope)
            let mileageReport = NativeBusiness(value: mileageData, kind: "mileage", scope: businessScope)
            let quarterRows: [String: [BusinessRecord]] = Dictionary(grouping: salesReport.records) { row in
                "Q" + String(((Int(row.value["date"].string.dropFirst(5).prefix(2)) ?? 1) - 1) / 3 + 1)
            }
            let quarters: [VaultValue] = quarterRows.keys.sorted().map { quarter in
                let rows = quarterRows[quarter] ?? []
                let amount = NativeBusiness.sum(rows.map { NativeFinance.number($0.value["total"]) })
                return .object(["quarter": .string(quarter), "total": amount.map(VaultValue.number) ?? .null])
            }
            banks.set("accounts", .array(bankData["accounts"].array.map { row in
                var account = row
                account.set("category", .string(row["id"].string == "demo-card" ? "credit-card" : "depository"))
                return account
            }))
            return .object([
                "year": .string(String(year)), "generatedAt": .string(Date().ISO8601Format()), "entities": .object(entities),
                "bankAccounts": banks, "investments": .object(["brokerAccounts": brokerData["accounts"], "brokerLastUpdated": brokerData["lastUpdated"]]),
                "crypto": .object(["sources": .array([]), "totalUsdValue": .number(0)]),
                "preciousMetals": .object(["entries": .array([]), "totalValue": .number(0), "spotPrices": .object([:])]),
                "property": .object(["entries": .array([]), "totalEquity": .number(0)]),
                "portfolioSummary": .object(["manualLiabilities": .number(0), "monthlyDebtService": .number(0), "bankMonthlyDebtService": .number(0), "manualLiabilityMonthlyPayment": .number(0), "mortgageMonthlyPayment": .number(0), "qualifyingMonthlyIncome": .number(0), "dtiRatio": .null]),
                "taxSummary": .object(["wages": tax["income"]["w2Total"], "federalWithheld": tax["income"]["federalWithheld"], "note": .string("Connect a server for its complete tax projection. Demo documents do not calculate a tax return.")]),
                "sales": .object(["products": salesData["products"], "entries": .array(salesReport.records.map(\.value)), "totalRevenue": salesReport.knownTotal.map(VaultValue.number) ?? .null, "byQuarter": .array(quarters)]),
                "mileage": .object(["vehicles": mileageData["vehicles"], "entries": .array(mileageReport.records.map(\.value)), "totalMiles": mileageReport.knownTotal.map(VaultValue.number) ?? .null, "totalDeduction": mileageReport.deduction.map(VaultValue.number) ?? .null]),
                "retirement": .object([:]), "bankStatementDeposits": .object([:]), "reminders": .array([]), "form2210Periods": .object([:]), "additionalIncome": .array([]),
            ])
        }
        if path.hasPrefix("api/tax-summary/"), let year = path.split(separator: "/").last {
            return NativeTaxDemo.summary(year: String(year))
        }
        if path.hasPrefix("api/analytics/quick-stats/") {
            let parts = path.split(separator: "/").map(String.init)
            if parts.count == 5 {
                return NativeTaxDemo.statistics(entity: parts[3], year: parts[4])
            }
        }
        if path == "api/simplefin/balances" || path == "api/account-annotations/merged" {
            return .object(["lastUpdated": .string(ISO8601DateFormatter().string(from: Date())), "accounts": .array([
                .object(["id": .string("demo-checking"), "name": .string("Acme Checking"), "connectionName": .string("Acme Bank"), "currency": .string("USD"), "balance": .number(5500), "availableBalance": .number(5400)]),
                .object(["id": .string("demo-card"), "name": .string("Acme Credit Card"), "connectionName": .string("Acme Bank"), "currency": .string("USD"), "balance": .number(-500), "availableBalance": .number(0), "annotation": .object(["type": .string("credit-card"), "notes": .string("Invented account for the demo.")])]),
            ])])
        }
        if path == "api/brokers/portfolio" {
            return .object(["totalValue": .number(7400), "totalCostBasis": .number(1750), "lastUpdated": .string(ISO8601DateFormatter().string(from: Date())), "accounts": .array([
                .object(["id": .string("demo-broker"), "name": .string("Acme Brokerage"), "broker": .string("other"), "totalValue": .number(7400), "totalCostBasis": .number(1750), "holdings": .array([
                    .object(["ticker": .string("FDEMO"), "label": .string("Fictional Growth Fund"), "shares": .number(20), "price": .number(100), "marketValue": .number(2000), "costBasis": .number(1750), "gainLoss": .number(250)]),
                    .object(["ticker": .string("CASH"), "label": .string("Synthetic cash"), "shares": .number(5400), "price": .number(1), "marketValue": .number(5400)]),
                ])]),
            ])])
        }
        if path == "api/quant/tickers/prices" {
            return .object(["quotes": .array([.object([
                "symbol": .string("FDEMO"), "currency": .string("USD"), "sparklineCloses": .array([80, 90, 88, 100].map(VaultValue.number)),
                "performance": .object(["asOf": .string(ISO8601DateFormatter().string(from: Date())), "changes": .object([
                    "1D": .object(["amount": .number(2), "percent": .number(2.04), "baselineDate": .string(Self.demoDate(daysAgo: 1))]),
                    "7D": .object(["amount": .number(5), "percent": .number(5.26), "baselineDate": .string(Self.demoDate(daysAgo: 7))]),
                    "1M": .null,
                ])]),
            ])])])
        }
        if path == "api/health/people" {
            return .object([
                "people": .array([
                    .object(["id": .string("demo-person"), "name": .string("Demo Person")]),
                ]),
            ])
        }
        if path == "api/entities" {
            return .object([
                "entities": .array([
                    .object([
                        "id": .string("personal"), "name": .string("Personal"),
                        "type": .string("tax"),
                    ]),
                ]),
            ])
        }
        if path == "api/timesheet" {
            return NativeTimesheetReportDemo.seed
        }
        if path == "api/portfolio/snapshots" {
            return .object([
                "snapshots": .array(
                    (0 ..< 35).map { day in
                        .object([
                            "date": .string(Self.demoDate(daysAgo: 34 - day)),
                            "totalValue": .number(10000 + Double(day) * 100),
                            "bankValue": .number(5000),
                            "brokerValue": .number(4000 + Double(day) * 100),
                            "cryptoValue": .number(1000),
                        ])
                    }
                ),
            ])
        }
        if path.hasPrefix("api/health/"), path.contains("/snapshot/") {
            return .object([
                "data": .object([
                    "daily": .array(
                        (0 ..< 14).map { index in
                            .object([
                                "date": .string("2026-09-\(String(format: "%02d", index + 1))"),
                                "value": .number(Double(5000 + index * 230)),
                            ])
                        }
                    ), "summary": .object(["average": .number(6500)]),
                ]),
            ])
        }
        if path == "api/chat/threads" {
            return .object(["threads": .object([:]), "activeThreadId": .null])
        }
        let resources = NativeCatalog.features.flatMap(\.resources)
        let actual = path.split(separator: "/")
        if let resource = resources.first(where: {
            let template = $0.path.split(separator: "?")[0].split(separator: "/")
            return template.count == actual.count
                && zip(template, actual).allSatisfy { $0.hasPrefix("{") || $0 == $1 }
        }) {
            var value = VaultValue.object([:])
            for collection in resource.collections {
                var row = VaultValue.object([
                    "id": .string("demo-\(collection.id)"),
                    "name": .string("Acme \(collection.title)"),
                    "title": .string("Demo \(collection.title)"),
                ])
                for field in collection.fields {
                    let raw: String
                    switch field.kind {
                    case .date: raw = "2026-10-06"
                    case .time: continue
                    case .number, .integer, .percentage:
                        raw = field.initial.isEmpty ? "10" : field.initial
                    case let .choices(options):
                        raw = field.initial.isEmpty ? (options.first ?? "") : field.initial
                    case .boolean: raw = "false"
                    case .reference, .references: raw = ""
                    case .records, .images: raw = "[]"
                    case .secret: continue
                    default: raw = field.initial.isEmpty ? "Demo \(field.label)" : field.initial
                    }
                    if let converted = try? NativeForm.value(field: field, text: raw) {
                        row.set(field.id, converted)
                    }
                }
                value.set(collection.path, .array([row]))
            }
            for field in resource.editFields {
                let raw =
                    field.initial.isEmpty
                        ? (field.kind == .number || field.kind == .integer
                            ? "0" : field.kind == .boolean ? "false" : "") : field.initial
                if let converted = try? NativeForm.value(field: field, text: raw) {
                    value.set(field.id, converted)
                }
            }
            if value.isEmpty {
                value = .object([
                    "status": .string("Demo data"),
                    "summary": .string("Your connected server supplies this information."),
                ])
            }
            return value
        }
        return .object(["status": .string("Demo data")])
    }
}
