import Foundation

struct NutritionProduct: Identifiable, Hashable {
    let value: VaultValue
    var id: String {
        value["id"].string
    }

    var parsed: VaultValue {
        value["parsed"]
    }

    var name: String {
        let name = parsed["productName"].string
        return name.isEmpty ? value["filename"].string.isEmpty ? "Unparsed product" : value["filename"].string : name
    }

    var brand: String {
        parsed["brandName"].string
    }

    var status: String {
        value["status"].string
    }

    var category: String {
        parsed["category"].string
    }

    var time: String {
        NativeNutrition.times.contains(value["dose"]["timeOfDay"].string) ? value["dose"]["timeOfDay"].string : "unscheduled"
    }

    var hasDose: Bool {
        guard let amount = NativeNutrition.number(value["dose"]["amount"]), amount > 0 else { return false }
        return !value["dose"]["unit"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var dose: String {
        let dose = value["dose"]
        var parts: [String] = []
        if let amount = NativeNutrition.number(dose["amount"]) {
            parts.append(NativeNutrition.display(amount))
        }
        if !dose["unit"].string.isEmpty {
            parts.append(dose["unit"].string)
        }
        let frequency = dose["frequency"].string
        if !frequency.isEmpty {
            parts.append(frequency == "custom" ? dose["frequencyCustom"].string.isEmpty ? "Custom frequency" : dose["frequencyCustom"].string : NativeNutrition.label(frequency))
        }
        if !dose["description"].string.isEmpty {
            parts.append(dose["description"].string)
        }
        return parts.isEmpty ? "Dose not recorded" : parts.joined(separator: " · ")
    }

    var serving: String {
        let serving = parsed["servingSize"]
        var parts: [String] = []
        if let amount = NativeNutrition.number(serving["amount"]) {
            parts.append(NativeNutrition.display(amount))
        }
        if !serving["unit"].string.isEmpty {
            parts.append(serving["unit"].string)
        }
        if !serving["description"].string.isEmpty {
            parts.append(serving["description"].string)
        }
        return parts.isEmpty ? "Serving size not recorded" : parts.joined(separator: " · ")
    }
}

struct NutritionFact: Identifiable {
    let id: String
    let name: String
    let value: VaultValue
    var amount: String {
        guard let amount = NativeNutrition.number(value["amount"]) else { return "Not recorded" }
        return NativeNutrition.display(amount) + (value["unit"].string.isEmpty ? " · unit not recorded" : " " + value["unit"].string)
    }

    var dailyValue: Double? {
        guard let value = NativeNutrition.number(value["dv"]), value >= 0 else { return nil }
        return value
    }
}

struct NutritionCount: Identifiable {
    let key: String
    let count: Int
    var id: String {
        key
    }

    var label: String {
        NativeNutrition.label(key)
    }
}

enum NativeNutrition {
    static let statuses = ["active", "considering", "past", "never"]
    static let times = ["morning", "midday", "pre-workout", "post-workout", "evening", "bedtime"]
    static let frequencies = ["daily", "twice-daily", "as-needed", "weekly", "custom"]
    static let categories = ["multivitamin", "vitamin", "mineral", "fish-oil", "omega-3", "fiber", "psyllium", "electrolyte", "sports-drink", "protein", "creatine", "amino-acid", "herbal", "adaptogen", "probiotic", "other"]
    static let macros = ["totalFat", "saturatedFat", "transFat", "cholesterol", "sodium", "totalCarbohydrate", "dietaryFiber", "solubleFiber", "insolubleFiber", "totalSugars", "addedSugars", "sugarAlcohols", "protein"]

    static func number(_ value: VaultValue) -> Double? {
        guard case let .number(number) = value, number.isFinite else { return nil }
        return number
    }

    static func display(_ number: Double) -> String {
        number.formatted(.number.precision(.fractionLength(0 ... 3)))
    }

    static func timestamp(_ raw: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fractional = formatter.date(from: raw)
        formatter.formatOptions = [.withInternetDateTime]
        return (fractional ?? formatter.date(from: raw))?.formatted(date: .abbreviated, time: .shortened) ?? raw
    }

    static func label(_ key: String) -> String {
        switch key {
        case "active": "Taking"
        case "never": "Passed on"
        case "twice-daily": "Twice daily"
        case "as-needed": "As needed"
        case "pre-workout": "Pre workout"
        case "post-workout": "Post workout"
        case "unscheduled": "Time not recorded"
        case "": "Category not recorded"
        default: VaultValue.label(key.replacingOccurrences(of: "-", with: " "))
        }
    }

    static func products(_ data: VaultValue, status: String = "all", category: String = "all", search: String = "") -> [NutritionProduct] {
        data["entries"].array.map { NutritionProduct(value: $0) }.filter {
            (status == "all" || $0.status == status) && (category == "all" || $0.category == category)
                && (search.isEmpty || ($0.name + " " + $0.brand + " " + $0.category + " " + $0.value["notes"].string).localizedCaseInsensitiveContains(search))
        }
    }

    static func counts(_ products: [NutritionProduct], key: (NutritionProduct) -> String) -> [NutritionCount] {
        Dictionary(grouping: products, by: key).map { .init(key: $0.key, count: $0.value.count) }.sorted { $0.count == $1.count ? $0.key < $1.key : $0.count > $1.count }
    }

    static func facts(_ parsed: VaultValue, section: String) -> [NutritionFact] {
        if section == "macros" {
            return macros.filter { !parsed["macros"][$0].isEmpty }.map { .init(id: $0, name: VaultValue.label($0), value: parsed["macros"][$0]) }
        }
        return parsed[section].array.enumerated().map { .init(id: "\(section)-\($0.offset)", name: $0.element["name"].string.isEmpty ? "Unnamed nutrient" : $0.element["name"].string, value: $0.element) }
    }

    static func citationURL(_ citation: VaultValue) -> URL? {
        let pmid = citation["pmid"].string.trimmingCharacters(in: .whitespacesAndNewlines)
        if pmid.range(of: "^[0-9]{1,12}$", options: .regularExpression) != nil {
            return URL(string: "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/")
        }
        let raw = citation["url"].string
        if let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil, url.user == nil, url.password == nil {
            return url
        }
        let doi = citation["doi"].string.trimmingCharacters(in: .whitespacesAndNewlines)
        if doi.count <= 256, doi.range(of: #"^10\.[0-9]{4,9}/\S+$"#, options: .regularExpression) != nil {
            var url = URLComponents()
            url.scheme = "https"; url.host = "doi.org"; url.path = "/" + doi
            return url.url
        }
        return nil
    }

    static func validateRevision(patch: VaultValue, original: VaultValue, current: VaultValue) throws {
        guard !current.isEmpty, patch.object.keys.allSatisfy({ current[$0] == original[$0] }) else {
            throw VaultError.server("These product fields changed on the server. Close the editor, refresh the product and try again.")
        }
    }
}

/// Shared with the generic native editor so every label field survives correction.
enum NativeNutritionFields {
    static let nutrient: [NativeField] = [
        .init("name", "Nutrient name", .text, required: true), .init("amount", "Amount", .number),
        .init("unit", "Unit", .text), .init("dv", "Daily value (%)", .number),
        .init("form", "Form", .text), .init("notes", "Notes", .multiline),
    ]
    static let dose: [NativeField] = [
        .init("dose.amount", "Dose amount", .number), .init("dose.unit", "Dose unit", .text),
        .init("dose.frequency", "Frequency", .choices(NativeNutrition.frequencies)),
        .init("dose.frequencyCustom", "Custom frequency", .text),
        .init("dose.description", "Dose description", .text),
        .init("dose.timeOfDay", "Time of day", .choices(NativeNutrition.times)),
    ]
    static let citations = NativeField("citations", "References", .records([
        .init("id", "Reference ID", .text, required: true), .init("title", "Title", .text, required: true),
        .init("authors", "Authors", .text), .init("year", "Year", .integer), .init("journal", "Journal", .text),
        .init("url", "Source URL", .text), .init("pmid", "PMID", .text), .init("doi", "DOI", .text), .init("findings", "Findings", .multiline),
    ]))
    static func labelFields(prefix: String, requiredIdentity: Bool) -> [NativeField] {
        var fields: [NativeField] = [
            .init(prefix + "brandName", "Brand name", .text, required: requiredIdentity),
            .init(prefix + "productName", "Product name", .text, required: requiredIdentity),
            .init(prefix + "category", "Category", .choices(NativeNutrition.categories)),
            .init(prefix + "servingSize.amount", "Serving amount", .number),
            .init(prefix + "servingSize.unit", "Serving unit", .text),
            .init(prefix + "servingSize.description", "Serving description", .text),
            .init(prefix + "servingsPerContainer", "Servings per container", .text),
            .init(prefix + "macros.calories", "Calories per serving", .number),
        ]
        for key in NativeNutrition.macros {
            let name = VaultValue.label(key)
            fields += [
                .init(prefix + "macros." + key + ".name", name + " label", .text),
                .init(prefix + "macros." + key + ".amount", name + " amount", .number),
                .init(prefix + "macros." + key + ".unit", name + " unit", .text),
                .init(prefix + "macros." + key + ".dv", name + " daily value (%)", .number),
                .init(prefix + "macros." + key + ".form", name + " form", .text),
                .init(prefix + "macros." + key + ".notes", name + " notes", .multiline),
            ]
        }
        fields += [
            .init(prefix + "vitamins", "Vitamins", .records(nutrient)),
            .init(prefix + "minerals", "Minerals", .records(nutrient)),
            .init(prefix + "otherActive", "Other active ingredients", .records(nutrient)),
            .init(prefix + "proprietaryBlends", "Proprietary blends", .records([
                .init("name", "Blend name", .text, required: true), .init("totalAmount.amount", "Total amount", .number),
                .init("totalAmount.unit", "Total unit", .text), .init("ingredients", "Ingredients", .strings),
            ])),
            .init(prefix + "ingredients", "Ingredients", .strings), .init(prefix + "allergenInfo", "Allergens", .strings),
            .init(prefix + "directions", "Directions", .multiline), .init(prefix + "warnings", "Warnings", .strings),
        ]
        return fields
    }

    static var edit: [NativeField] {
        [.init("status", "Status", .choices(NativeNutrition.statuses))] + dose
            + [.init("notes", "Notes", .multiline), .init("research", "Research", .multiline), citations]
            + labelFields(prefix: "parsed.", requiredIdentity: false)
            + [.init("parsed.parserNotes", "Parser notes", .multiline)]
    }

    static var create: [NativeField] {
        [.init("brandName", "Brand name", .text, required: true),
         .init("productName", "Product name", .text, required: true),
         .init("category", "Category", .choices(NativeNutrition.categories)),
         .init("status", "Status", .choices(NativeNutrition.statuses), initial: "considering")]
            + dose + [.init("directions", "Directions", .multiline), .init("ingredients", "Ingredients", .strings),
                      .init("notes", "Notes", .multiline), .init("research", "Research", .multiline), citations]
    }

    static let groups = ["Regimen & notes", "Product & serving", "Nutrition facts", "Vitamins", "Minerals", "Other active ingredients", "Proprietary blends", "Ingredients & instructions", "Research & references"]
    static func fields(_ group: String) -> [NativeField] {
        edit.filter { field in
            switch group {
            case "Regimen & notes": field.id == "status" || field.id.hasPrefix("dose.") || field.id == "notes"
            case "Product & serving": ["parsed.brandName", "parsed.productName", "parsed.category", "parsed.servingsPerContainer", "parsed.parserNotes"].contains(field.id) || field.id.hasPrefix("parsed.servingSize.")
            case "Nutrition facts": field.id.hasPrefix("parsed.macros.")
            case "Vitamins": field.id == "parsed.vitamins"
            case "Minerals": field.id == "parsed.minerals"
            case "Other active ingredients": field.id == "parsed.otherActive"
            case "Proprietary blends": field.id == "parsed.proprietaryBlends"
            case "Ingredients & instructions": ["parsed.ingredients", "parsed.allergenInfo", "parsed.directions", "parsed.warnings"].contains(field.id)
            default: field.id == "research" || field.id == "citations"
            }
        }
    }
}
