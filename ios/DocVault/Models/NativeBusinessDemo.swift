import Foundation

/// Invented, editable demo records. Mutations follow the existing server contracts.
enum NativeBusinessDemo {
    static func seed(_ kind: String) -> VaultValue {
        let raw = kind == "sales" ? #"""
        {"products":[{"id":"demo-box","name":"Acme Orchard Box","price":10},{"id":"demo-garden","name":"Acme Garden Box","price":25}],
         "sales":[{"id":"demo-sale1","person":"Acme Customer","productId":"demo-box","quantity":4,"total":40,"date":"2026-01-12","entity":"personal"},
                  {"id":"demo-sale2","person":"Acme Market","productId":"demo-garden","quantity":2,"total":50,"date":"2026-09-18","entity":"personal"},
                  {"id":"demo-sale0","person":"Acme Customer","productId":"demo-box","quantity":3,"total":30,"date":"2025-06-15","entity":"personal"}]}
        """# : #"""
        {"vehicles":[{"id":"demo-car","name":"Acme Demo Car","year":2020,"make":"Acme","model":"Tourer"}],
         "irsRate":0.5,"savedAddresses":[{"id":"demo-place","label":"Acme Office","formatted":"Synthetic Demo Location","lat":0,"lon":0}],
         "entries":[{"id":"demo-trip1","date":"2026-01-12","vehicleId":"demo-car","tripMiles":50,"odometerStart":1000,"odometerEnd":1050,"gallons":2,"totalCost":7,"purpose":"Acme supply run","entity":"personal"},
                    {"id":"demo-trip2","date":"2026-09-18","vehicleId":"demo-car","tripMiles":80,"gallons":4,"totalCost":14,"purpose":"Acme delivery","entity":"personal"},
                    {"id":"demo-fuel","date":"2026-09-20","vehicleId":"demo-car","gallons":5,"totalCost":17.5,"purpose":"Fuel only","entity":"personal"},
                    {"id":"demo-trip0","date":"2025-05-10","vehicleId":"demo-car","tripMiles":20,"purpose":"Prior-year journey","entity":"personal"}]}
        """#
        return try! JSONDecoder().decode(VaultValue.self, from: Data(raw.utf8))
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue]) throws -> VaultValue? {
        if request.path.prefix(2).joined(separator: "/") == "api/geocode" {
            if request.path.last == "enabled" {
                return .object(["enabled": .bool(false)])
            }
            throw VaultError.server("Connect your server for address search and driving routes.")
        }
        guard request.path.count >= 2, ["sales", "mileage"].contains(request.path[1]) else { return nil }
        let kind = request.path[1], base = "api/" + kind
        var store = stores[base] ?? seed(kind)
        if method == "GET" {
            stores[base] = store; return store
        }
        let body = body ?? .object([:])
        if kind == "mileage", request.path.last == "settings" {
            store.set("irsRate", body["irsRate"]); stores[base] = store
            return .object(["ok": .bool(true)])
        }
        let sub = request.path.count > 2 ? request.path[2] : ""
        let collection = ["products", "vehicles", "addresses"].contains(sub) ? (sub == "addresses" ? "savedAddresses" : sub) : kind == "sales" ? "sales" : "entries"
        var rows = store[collection].array
        let index = method == "POST" ? rows.count : rows.firstIndex { $0["id"].string == request.path.last }
        guard let index else { throw VaultError.server("Demo record unavailable.") }
        if method == "DELETE" {
            rows.remove(at: index)
        } else {
            var row = method == "POST" ? VaultValue.object(["id": .string(UUID().uuidString), "createdAt": .string(Date().ISO8601Format())]) : rows[index]
            for (field, value) in body.object {
                if kind == "mileage", ["odometerStart", "odometerEnd", "tripMiles", "gallons", "totalCost", "year"].contains(field), value == .string("") {
                    row.remove(field)
                } else {
                    row.set(field, value)
                }
            }
            if method == "POST", ["sales", "entries"].contains(collection), row["date"].string.isEmpty {
                row.set("date", .string(NativeQuant.day(.now)))
            }
            if collection == "sales", method == "POST" || body.object.keys.contains("productId") || body.object.keys.contains("quantity") {
                guard let product = store["products"].array.first(where: { $0["id"] == row["productId"] }), let price = NativeFinance.number(product["price"]), let quantity = NativeFinance.number(row["quantity"]) else { throw VaultError.server("Demo product unavailable.") }
                row.set("total", .number(price * quantity))
            }
            if collection == "entries", method == "POST", row["tripMiles"].isEmpty,
               let start = NativeFinance.number(row["odometerStart"]), let end = NativeFinance.number(row["odometerEnd"])
            {
                row.set("tripMiles", .number(end - start))
            }
            if method == "POST" {
                rows.append(row)
            } else {
                rows[index] = row
            }
            store.set(collection, .array(rows)); stores[base] = store
            let key = collection == "sales" ? "sale" : collection == "entries" ? "entry" : collection == "products" ? "product" : collection == "vehicles" ? "vehicle" : "address"
            return .object(["ok": .bool(true), key: row])
        }
        store.set(collection, .array(rows)); stores[base] = store
        return .object(["ok": .bool(true)])
    }
}
