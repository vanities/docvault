import Foundation

struct BusinessRecord: Identifiable {
    let id: String
    let value: VaultValue
    var date: Date? {
        NativeQuant.date(value["date"].string)
    }

    var month: String {
        date == nil ? "Undated records" : String(value["date"].string.prefix(7))
    }
}

struct BusinessGroup: Identifiable {
    let id: String
    let title: String
    let records: [BusinessRecord]
    let amount: Double?
}

/// Display only stored observations. A missing distance is not an observed zero.
struct NativeBusiness {
    let value: VaultValue
    let kind: String
    let scope: VaultScope
    var allYears = false
    var allRecords: [BusinessRecord] {
        value[kind == "sales" ? "sales" : "entries"].array.enumerated().compactMap { index, row in
            guard scope.entity == "all" || row["entity"].string == scope.entity else { return nil }
            return .init(id: "\(index):" + row["id"].string, value: row)
        }.sorted { $0.value["date"].string == $1.value["date"].string ? $0.id < $1.id : $0.value["date"].string > $1.value["date"].string }
    }

    var records: [BusinessRecord] {
        allRecords.filter { allYears || ($0.date != nil && $0.value["date"].string.hasPrefix(String(scope.year) + "-")) }
    }

    var amountKey: String {
        kind == "sales" ? "total" : "tripMiles"
    }

    var knownTotal: Double? {
        Self.sum(records.map { NativeFinance.number($0.value[amountKey]) })
    }

    var allTimeTotal: Double? {
        Self.sum(allRecords.map { NativeFinance.number($0.value[amountKey]) })
    }

    func currentMonthRecords(now: Date = .now) -> [BusinessRecord] {
        let month = String(NativeQuant.day(now).prefix(7))
        return allRecords.filter { $0.date != nil && $0.value["date"].string.hasPrefix(month + "-") }
    }

    var currentMonthTotal: Double? {
        Self.sum(currentMonthRecords().map { NativeFinance.number($0.value[amountKey]) })
    }

    var currentMonthDeduction: Double? {
        guard let total = currentMonthTotal, let rate else { return nil }
        let result = total * rate
        return result.isFinite ? result : nil
    }

    var missingCount: Int {
        records.filter { NativeFinance.number($0.value[amountKey]) == nil }.count
    }

    var undatedCount: Int {
        allRecords.filter { $0.date == nil }.count
    }

    var rate: Double? {
        NativeFinance.number(value["irsRate"]).flatMap { $0 >= 0 ? $0 : nil }
    }

    var deduction: Double? {
        guard let total = knownTotal, let rate else { return nil }
        let result = total * rate
        return result.isFinite ? result : nil
    }

    var fuelCost: Double? {
        Self.sum(records.map { NativeFinance.number($0.value["totalCost"]) })
    }

    var averageMPG: Double? {
        let readings = records.compactMap { record -> Double? in
            guard let miles = NativeFinance.number(record.value["tripMiles"]), miles > 0,
                  let gallons = NativeFinance.number(record.value["gallons"]), gallons > 0 else { return nil }
            let mpg = miles / gallons
            return mpg.isFinite ? mpg : nil
        }
        guard !readings.isEmpty else { return nil }
        let mean = readings.reduce(0, +) / Double(readings.count)
        return mean.isFinite ? mean : nil
    }

    var months: [BusinessGroup] {
        Dictionary(grouping: records, by: \.month).map { month, rows in
            .init(id: month, title: Self.monthTitle(month), records: rows, amount: Self.sum(rows.map { NativeFinance.number($0.value[amountKey]) }))
        }.sorted { $0.id > $1.id }
    }

    var monthlyAmounts: [TaxYearAmount] {
        months.filter { $0.id != "Undated records" }.reversed().compactMap { row in
            row.amount.map { .init(label: row.title, amount: $0) }
        }
    }

    var categoryGroups: [BusinessGroup] {
        let key = kind == "sales" ? "productId" : "vehicleId"
        let source = kind == "sales" ? "products" : "vehicles"
        let groups = Dictionary(grouping: records, by: { $0.value[key].string })
        let names = Dictionary(grouping: value[source].array, by: { $0["name"].string })
        return groups.map { id, rows in
            let item = value[source].array.first { $0["id"].string == id }
            let name = item?["name"].string ?? ""
            let title = name.isEmpty ? (kind == "sales" ? "Unavailable product · " : "Unavailable vehicle · ") + (id.isEmpty ? "unassigned" : id) : (names[name]?.count ?? 0) > 1 ? name + " · " + id : name
            return .init(id: id, title: title, records: rows, amount: Self.sum(rows.map { NativeFinance.number($0.value[amountKey]) }))
        }.sorted { $0.title < $1.title }
    }

    var categoryAmounts: [TaxYearAmount] {
        categoryGroups.compactMap { group in group.amount.map { .init(label: group.title, amount: $0) } }
    }

    var customerAmounts: [TaxYearAmount] {
        Dictionary(grouping: records, by: { $0.value["person"].string }).compactMap { name, rows in
            Self.sum(rows.map { NativeFinance.number($0.value["total"]) }).map { .init(label: name.isEmpty ? "Unnamed customer" : name, amount: $0) }
        }.sorted { $0.label < $1.label }
    }

    var customers: [String] {
        Set(allRecords.map { $0.value["person"].string }.filter { !$0.isEmpty }).sorted()
    }

    func lookup(_ record: VaultValue) -> String {
        let source = kind == "sales" ? "products" : "vehicles"
        let key = kind == "sales" ? "productId" : "vehicleId"
        return value[source].array.first { $0["id"] == record[key] }?["name"].string ?? (kind == "sales" ? "Unavailable product" : "Unavailable vehicle")
    }

    static func sum(_ values: [Double?]) -> Double? {
        if values.isEmpty {
            return 0
        }
        let known = values.compactMap(\.self)
        guard !known.isEmpty else { return nil }
        let total = known.reduce(0, +)
        return total.isFinite ? total : nil
    }

    static func monthTitle(_ raw: String) -> String {
        guard let date = NativeQuant.date(raw + "-01") else { return raw }
        var format = Date.FormatStyle().month(.abbreviated).year()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return date.formatted(format)
    }

    static func number(_ value: Double?, suffix: String = "") -> String {
        guard let value, value.isFinite else { return "Unavailable" }
        return value.formatted(.number.precision(.fractionLength(0 ... 2))) + (suffix.isEmpty ? "" : " " + suffix)
    }

    static func defaultDate(_ scope: VaultScope, now: Date = .now) -> String {
        let today = NativeQuant.day(now)
        return today.hasPrefix(String(scope.year) + "-") ? today : "\(scope.year)-01-01"
    }

    static func validate(_ body: VaultValue, collection: String) throws {
        for key in ["quantity", "price", "tripMiles", "gallons", "totalCost", "odometerStart", "odometerEnd", "irsRate"] {
            if let number = NativeFinance.number(body[key]), number < 0 || (key == "quantity" && number <= 0) {
                throw VaultError.server(VaultValue.label(key) + (key == "quantity" ? " must be greater than zero." : " cannot be negative."))
            }
        }
        if collection == "savedAddresses" {
            guard let lat = NativeFinance.number(body["lat"]), let lon = NativeFinance.number(body["lon"]),
                  (-90 ... 90).contains(lat), (-180 ... 180).contains(lon) else { throw VaultError.server("Enter valid latitude and longitude.") }
        }
    }

    /// Mileage PUT uses empty strings to remove optional numeric observations.
    static func mileagePatch(_ body: VaultValue) -> VaultValue {
        var result = body
        for key in ["odometerStart", "odometerEnd", "tripMiles", "gallons", "totalCost", "year"] where body.object.keys.contains(key) && body[key] == .null {
            result.set(key, .string(""))
        }
        return result
    }
}

struct NativeRouteAddress: Identifiable, Hashable {
    let value: VaultValue
    var id: String {
        value["id"].string.isEmpty ? formatted + ":\(latitude ?? 0):\(longitude ?? 0)" : value["id"].string
    }

    var formatted: String {
        value["formatted"].string
    }

    var label: String {
        value["label"].string.isEmpty ? formatted : value["label"].string
    }

    var latitude: Double? {
        NativeFinance.number(value["lat"])
    }

    var longitude: Double? {
        NativeFinance.number(value["lon"])
    }

    var valid: Bool {
        !formatted.isEmpty && latitude.map { (-90 ... 90).contains($0) } == true && longitude.map { (-180 ... 180).contains($0) } == true
    }

    static func routePath(from: Self, to: Self) throws -> String {
        guard from.valid, to.valid else { throw VaultError.server("Choose two addresses with valid coordinates.") }
        var url = URLComponents()
        url.path = "api/geocode/route"
        url.queryItems = [URLQueryItem(name: "from_lat", value: String(from.latitude!)), .init(name: "from_lon", value: String(from.longitude!)), .init(name: "to_lat", value: String(to.latitude!)), .init(name: "to_lon", value: String(to.longitude!))]
        return url.string!
    }
}
