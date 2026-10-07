@testable import DocVault
import Foundation
import Testing

@Suite("Native nutrition regimen and printed label facts")
struct NativeNutritionTests {
    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func filteringRetainsUnknownStatusesAndSchedulesWithoutInventingConsumption() throws {
        let data = try json(#"{"entries":[{"id":"a","status":"active","dose":{"amount":1,"unit":"capsule","timeOfDay":"morning"},"parsed":{"productName":"Daily Demo","category":"vitamin","brandName":"Acme"}},{"id":"b","status":"active","dose":{"frequency":"custom","frequencyCustom":"Fictional schedule","timeOfDay":"unknown"},"parsed":{"productName":"Demo Fiber","category":"fiber"}},{"id":"c","status":"future-status","parsed":null,"filename":"Unparsed Demo.png"}]}"#)
        let products = NativeNutrition.products(data)
        #expect(products.count == 3 && products[2].name == "Unparsed Demo.png")
        #expect(products[0].hasDose && !products[1].hasDose)
        #expect(products[1].time == "unscheduled" && products[1].dose == "Fictional schedule")
        #expect(NativeNutrition.products(data, status: "active", category: "vitamin", search: "Acme").map(\.id) == ["a"])
        #expect(NativeNutrition.products(data, status: "active", category: "fiber", search: "Acme").isEmpty)
        #expect(NativeNutrition.counts(products, key: \.status).reduce(0) { $0 + $1.count } == 3)
    }

    @Test func labelFactsKeepZeroMissingValuesAndIncompatibleUnitsSeparate() throws {
        let parsed = try json(#"{"macros":{"calories":0,"protein":{"amount":0,"unit":"g"},"sodium":{"amount":0,"unit":"mg","dv":0}},"vitamins":[{"name":"Vitamin D","amount":25,"unit":"mcg","dv":125},{"name":"Vitamin D","amount":1000,"unit":"IU"},{"name":"Missing"},{"name":"Negative","dv":-5}]}"#)
        let facts = NativeNutrition.facts(parsed, section: "vitamins")
        #expect(facts.count == 4 && Set(facts.map(\.id)).count == 4)
        #expect(facts[0].amount == "25 mcg" && facts[0].dailyValue == 125)
        #expect(facts[1].amount == "1,000 IU" && facts[1].dailyValue == nil)
        #expect(facts[2].amount == "Not recorded" && facts[3].dailyValue == nil)
        let macros = NativeNutrition.facts(parsed, section: "macros")
        #expect(macros.first { $0.id == "sodium" }?.dailyValue == 0)
        #expect(macros.first { $0.id == "protein" }?.amount == "0 g")
        #expect(NativeNutrition.number(.string("0")) == nil && NativeNutrition.number(.number(.infinity)) == nil)
    }

    @Test func doseCoverageRequiresPositiveFiniteAmountAndUnit() throws {
        for dose in [#"{}"#, #"{"amount":0,"unit":"capsule"}"#, #"{"amount":-1,"unit":"capsule"}"#, #"{"amount":1,"unit":" "}"#] {
            #expect(!NutritionProduct(value: try json("{\"dose\":" + dose + "}")).hasDose)
        }
        let product = NutritionProduct(value: try json(#"{"dose":{"amount":0.5,"unit":"scoop","frequency":"twice-daily"},"parsed":{"servingSize":{"amount":2,"unit":"scoops","description":"Fictional serving"}}}"#))
        #expect(product.hasDose && product.dose == "0.5 · scoop · Twice daily")
        #expect(product.serving == "2 · scoops · Fictional serving")
    }

    @Test func focusedCorrectionPreservesUneditedLabelAndRegimenFields() throws {
        let original = try json(#"{"status":"active","dose":{"amount":1,"unit":"capsule","frequency":"daily","timeOfDay":"morning"},"parsed":{"schemaVersion":1,"parserVersion":"synthetic","productName":"Demo","vitamins":[{"name":"Vitamin C","amount":90,"unit":"mg","dv":100}],"proprietaryBlends":[{"name":"Demo blend","totalAmount":{"amount":150,"unit":"mg"}}],"confidence":0.8},"research":"Synthetic note","citations":[{"id":"demo","title":"Invented reference"}]}"#)
        let fields = NativeNutritionFields.fields("Regimen & notes")
        var values = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, NativeForm.display(original.at($0.id), field: $0)) })
        values["dose.timeOfDay"] = "bedtime"
        let body = try NativeForm.body(fields: fields, values: values, original: original, patch: true)
        #expect(body["parsed"].isEmpty && body["citations"].isEmpty)
        #expect(body["dose"]["timeOfDay"].string == "bedtime" && body["dose"]["amount"].number == 1)
        var fresh = original; fresh.set("research", .string("Another invented note"))
        try NativeNutrition.validateRevision(patch: body, original: original, current: fresh)
        fresh.set("dose.amount", .number(2))
        #expect(throws: VaultError.self) { try NativeNutrition.validateRevision(patch: body, original: original, current: fresh) }
        #expect(NativeNutritionFields.edit.contains { $0.id == "parsed.proprietaryBlends" })
        #expect(NativeNutritionFields.create.first { $0.id == "category" }?.kind == .choices(NativeNutrition.categories))
        #expect(NativeNutritionFields.create.first { $0.id == "status" }?.initial == "considering")
    }

    @Test func referencesRejectExecutableSchemesAndCredentialBearingURLs() throws {
        for value in ["javascript:alert(1)", "file:///tmp/demo", "https://name:secret@example.com", "/relative"] {
            #expect(NativeNutrition.citationURL(try json("{\"url\":\"" + value + "\"}")) == nil)
        }
        #expect(NativeNutrition.citationURL(try json(#"{"url":"https://example.com/research"}"#))?.host == "example.com")
        #expect(NativeNutrition.citationURL(try json(#"{"pmid":"123456"}"#))?.absoluteString == "https://pubmed.ncbi.nlm.nih.gov/123456/")
        #expect(NativeNutrition.citationURL(try json(#"{"doi":"10.1234/demo#part"}"#))?.absoluteString == "https://doi.org/10.1234/demo%23part")
    }
}
