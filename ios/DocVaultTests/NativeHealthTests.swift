@testable import DocVault
import Foundation
import Testing

@Suite("Native health observation semantics")
struct NativeHealthTests {
    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func missingReadingsSplitLinesAndZeroAndSameDayReadingsSurvive() throws {
        let rows = try json(#"[{"date":"2026-10-02","value":3},{"date":"2026-09-28","value":0},{"date":"2026-09-29","value":null},{"date":"2026-10-02","value":4}]"#).array
        let line = NativeHealth.line("value", title: "Readings", rows: rows)
        #expect(line.points.map(\.value) == [0, 3, 4])
        #expect(line.points.map(\.segment) == [0, 1, 1])
        #expect(Set(line.points.map(\.id)).count == 3)
        #expect(line.points.map { NativeQuant.day($0.date) } == ["2026-09-28", "2026-10-02", "2026-10-02"])
        #expect(NativeHealth.number(.string("0")) == nil)
        #expect(NativeHealth.number(.number(.infinity)) == nil)
        #expect(NativeHealth.display(.null, unit: "bpm") == "Unavailable")
    }

    @Test func chartsUseMetricUnitsAndSleepHoursWithoutInventingStages() throws {
        let data = try json(#"{"daily":[{"date":"2026-10-02","asleepMinutes":480,"deepMinutes":null,"awakeMinutes":0,"wristTempDeviationC":0}],"qualityScores":[{"date":"2026-10-02","score":88}]}"#)
        let panels = NativeHealth.panels(data, segment: "sleep")
        #expect(panels.first { $0.id == "duration" }?.lines.first?.points.first?.value == 8)
        let stages = try #require(panels.first { $0.id == "stages" })
        #expect(stages.unit == "hours")
        #expect(stages.lines.first?.points.isEmpty == true)
        #expect(stages.lines.last?.points.first?.value == 0)
        #expect(panels.first { $0.id == "temperature" }?.lines.first?.points.first?.value == 0)
        #expect(panels.first { $0.id == "quality" }?.unit == "/100")
        let body = NativeHealth.stats(try json(#"{"headline":{"change30d":null,"change1y":1}}"#), segment: "body")
        #expect(body.first { $0.title == "30-day change" }?.value == "Unavailable")
        #expect(body.first { $0.title == "One-year change" }?.value == "2.2 lb")
    }

    @Test func clinicalUnitsStaySeparateAndQualitativeValuesAreLiteral() throws {
        let rows = try json(#"[{"name":"Demo","date":"2026-10-01","unit":"mg/dL","value":0},{"name":"Demo","date":"2026-10-02","unit":"mmol/L","value":1.2},{"name":"Demo","date":"2026-10-03","unit":"mmol/L","value":null,"valueString":"Negative"}]"#).array
        let panels = NativeHealth.clinicalPanels(rows)
        #expect(panels.map(\.unit) == ["mg/dL", "mmol/L"])
        #expect(panels[0].lines.first?.points.first?.value == 0)
        #expect(panels[1].lines.first?.points.count == 1)
        #expect(NativeHealth.labValue(rows[2]) == "Negative")
        #expect(NativeHealth.labValue(.object(["value": .null])) == "Unavailable")
        #expect(NativeHealth.reference(try json(#"{"refLow":0,"refHigh":10,"unit":"mg/dL"}"#)) == "0–10 mg/dL")
        #expect(NativeHealth.reference(try json(#"{"refText":"Negative","refLow":0}"#)) == "Negative")
        #expect(NativeHealth.unit("/min", loinc: "9279-1") == "breaths/min")
    }

    @Test func referenceRangeChangesStayAttachedToTheirObservationAndUnit() throws {
        let rows = try json(#"[{"name":"Demo","date":"2026-10-01","unit":"mg/dL","value":80,"refLow":10,"refHigh":100},{"name":"Demo","date":"2026-10-02","unit":"mg/dL","value":90,"refLow":20,"refHigh":110},{"name":"Demo","date":"2026-10-03","unit":"mmol/L","value":1.2,"refLow":null,"refHigh":null}]"#).array
        let panels = NativeHealth.clinicalPanels(rows)
        let mg = try #require(panels.first { $0.unit == "mg/dL" })
        #expect(mg.lines.first { $0.title == "Reference lower" }?.points.map(\.value) == [10, 20])
        #expect(mg.lines.first { $0.title == "Reference upper" }?.points.map(\.value) == [100, 110])
        #expect(mg.lines.first { $0.title == "Reference upper" }?.points.last.map { NativeQuant.day($0.date) } == "2026-10-02")
        #expect(panels.first { $0.unit == "mmol/L" }?.lines.count == 1)
    }

    @Test func bloodPressureKeepsBothComponentsAndExactTimestampOrdering() throws {
        let row = try json(#"{"date":"2026-10-01","effectiveAt":"2026-10-02T00:30:00-05:00","value":null,"components":[{"loinc":"8480-6","name":"Systolic","unit":"mm[Hg]","value":120},{"loinc":"8462-4","name":"Diastolic","unit":"mm[Hg]","value":80}]}"#)
        #expect(NativeHealth.labValue(row) == "120/80 mmHg")
        let panel = try #require(NativeHealth.clinicalPanels([row]).first)
        #expect(panel.unit == "mmHg" && panel.lines.count == 2)
        #expect(Set(panel.lines.map(\.id)).count == 2)
        #expect(panel.lines.flatMap(\.points).map(\.value).sorted() == [80, 120])
        let instant = try #require(NativeHealth.date(row))
        #expect(instant == ISO8601DateFormatter().date(from: "2026-10-02T05:30:00Z"))
        #expect(NativeHealth.date(try json(#"{"date":"unknown"}"#)) == nil)
        #expect(NativeHealth.date(try json(#"{"date":"2026-02-30"}"#)) == nil)
        let fractional = try #require(NativeHealth.date(try json(#"{"effectiveAt":"2026-10-02T05:30:00.123Z"}"#)))
        #expect(abs(fractional.timeIntervalSince(instant) - 0.123) < 0.001)
    }

    @Test func multiYearHistoryRetainsAllObservationsAndMissingGaps() throws {
        let format = Date.ISO8601FormatStyle().year().month().day().dateSeparator(.dash)
        let start = try format.parse("2010-01-01")
        var readings: [VaultValue] = []
        for day in (0 ..< 4000).reversed() {
            let steps: VaultValue = day == 2000 ? .null : .number(Double(day))
            let fields: [String: VaultValue] = [
                "date": .string(format.format(start.addingTimeInterval(Double(day) * 86400))),
                "steps": steps,
                "steps7dAvg": .number(Double(day)), "activeEnergy": .number(Double(day)),
                "activeEnergy7dAvg": .number(Double(day)), "exerciseMinutes": .number(30),
                "exerciseMinutes7dAvg": .number(30), "distance": .number(2),
                "standHours": .number(12), "flightsClimbed": .number(3),
            ]
            readings.append(.object(fields))
        }
        let data: VaultValue = .object(["daily": .array(readings)])
        let clock = ContinuousClock(), beginning = clock.now
        let panels = NativeHealth.panels(data, segment: "activity")
        let sorted = NativeHealth.rows(data, segment: "activity")
        print("Synthetic 4,000-day Health chart preparation: \(clock.now - beginning)")
        let steps = try #require(panels.first { $0.id == "steps" }?.lines.first)
        #expect(steps.points.count == 3999)
        #expect(steps.points.first?.value == 0 && steps.points.last?.value == 3999)
        #expect(steps.points.first?.segment == 0 && steps.points.last?.segment == 1)
        #expect(panels.first { $0.id == "steps" }?.lines.last?.points.count == 4000)
        #expect(sorted.count == 4000 && sorted.first?["steps"].number == 3999)
        let finite = panels.flatMap(\.lines).flatMap(\.points).allSatisfy(\.value.isFinite)
        #expect(finite)
    }

    @Test func clinicalFiltersUseProviderFlagsAndStatusAndKeepArchivedRows() throws {
        let clinical = try json(#"{"labsByTest":[{"name":"Demo high","latestFlag":"high"},{"name":"Demo normal","latestFlag":"normal"}],"conditions":[{"name":"Demo chronic","category":"chronic","clinicalStatus":"active"},{"name":"Demo encounter","category":"encounter","clinicalStatus":"resolved"}],"medications":[{"name":"Demo active","status":"active","dosageText":"Literal synthetic dosage"},{"name":"Demo old","status":"stopped"}]}"#)
        #expect(NativeHealth.clinicalRows(clinical, kind: "labsByTest", search: "", filter: "Out of range").count == 1)
        #expect(NativeHealth.clinicalRows(clinical, kind: "conditions", search: "", filter: "Chronic / other").map { $0["name"].string } == ["Demo chronic"])
        #expect(NativeHealth.clinicalRows(clinical, kind: "medications", search: "dosage", filter: "Active").count == 1)
        #expect(NativeHealth.clinicalRows(clinical, kind: "medications", search: "", filter: "All").count == 2)
    }
}
