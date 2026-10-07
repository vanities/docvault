import Charts
import SwiftUI

enum VaultAmountUnit {
    case money, moneyPrecision(Int), currency(String), number(String)
    var title: String {
        switch self { case .money, .moneyPrecision: "Amount (USD)"; case let .currency(code): "Amount (" + code + ")"; case let .number(unit): unit }
    }

    func display(_ value: Double) -> String {
        switch self {
        case .money: NativeFinance.money(value)
        case let .currency(code): NativeFinance.money(value, currency: NativeFinance.currency(code))
        case let .moneyPrecision(digits): value.formatted(.currency(code: "USD").precision(.fractionLength(digits)))
        case let .number(unit):
            NativeBusiness.number(value, suffix: value == 1 && ["sources", "claims", "records", "jobs", "runs", "events", "calls"].contains(unit) ? String(unit.dropLast()) : unit)
        }
    }
}

struct VaultAmountChart: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 34
    let title: String
    let subtitle: String
    let amounts: [TaxYearAmount]
    let color: Color
    let identifier: String
    var cardPrefix = "taxCard-"
    var unit = VaultAmountUnit.money
    var preserveOrder = false
    private var grouped: [TaxYearAmount] {
        let values = Dictionary(grouping: amounts, by: \.label).compactMap { label, rows -> TaxYearAmount? in
            let value = rows.reduce(0) { $0 + $1.amount }
            return value.isFinite ? .init(label: label, amount: value) : nil
        }.sorted { abs($0.amount) == abs($1.amount) ? $0.label < $1.label : abs($0.amount) > abs($1.amount) }
        return preserveOrder ? values.sorted { left, right in
            (amounts.firstIndex { $0.label == left.label } ?? 0) < (amounts.firstIndex { $0.label == right.label } ?? 0)
        } : values
    }

    private var extent: ClosedRange<Double> {
        let low = min(0, grouped.map(\.amount).min() ?? 0)
        let high = max(0, grouped.map(\.amount).max() ?? 0)
        let padding = high == low ? 1 : (high - low) * 0.08
        return (low < 0 ? low - padding : 0) ... (high > 0 ? high + padding : 1)
    }

    private var accessibleTicks: [Double] {
        let low = min(0, grouped.map(\.amount).min() ?? 0)
        let high = max(0, grouped.map(\.amount).max() ?? 0)
        return low == high ? [low] : [low, high]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
            if model.blurNumbers {
                Label("Chart hidden while numbers are private", systemImage: "eye.slash").font(.caption).foregroundStyle(.secondary)
            } else if grouped.isEmpty {
                Text("No recorded amounts available.").foregroundStyle(.secondary)
            } else {
                if textSize.isAccessibilitySize {
                    Text("Match each bar to its numbered amount below.").font(.caption).foregroundStyle(.secondary)
                }
                Chart {
                    ForEach(grouped) { item in
                        BarMark(x: .value(unit.title, item.amount), y: .value("Category", item.label)).foregroundStyle(item.amount < 0 ? Color.pink.gradient : color.gradient).cornerRadius(4)
                            .accessibilityLabel(item.label).accessibilityValue(unit.display(item.amount))
                    }
                    RuleMark(x: .value("Zero", 0)).foregroundStyle(Color.secondary.opacity(0.3)).accessibilityHidden(true)
                }
                .chartXScale(domain: extent, range: .plotDimension(startPadding: 10, endPadding: 22))
                .chartYScale(domain: grouped.map(\.label))
                .chartYAxis { AxisMarks(preset: .aligned, position: .leading) { value in AxisValueLabel {
                    if let name = value.as(String.self) {
                        if textSize.isAccessibilitySize {
                            Text(grouped.firstIndex { $0.label == name }.map { String($0 + 1) } ?? "")
                                .font(.caption2).fixedSize()
                        } else {
                            Text(name).font(.caption).lineLimit(2).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 110, alignment: .leading)
                        }
                    }
                } } }
                .chartXAxis {
                    if textSize.isAccessibilitySize {
                        AxisMarks(values: accessibleTicks) { value in
                            AxisGridLine()
                            if let amount = value.as(Double.self) {
                                AxisValueLabel(anchor: amount == accessibleTicks.first ? .topLeading : .topTrailing) {
                                    Text(amount.formatted(.number.notation(.compactName))).font(.caption2).fixedSize()
                                }
                            }
                        }
                    } else {
                        AxisMarks(values: .automatic(desiredCount: 4)) { value in AxisGridLine(); AxisValueLabel {
                            if let amount = value.as(Double.self) {
                                Text(amount.formatted(.number.notation(.compactName))).font(.caption2).fixedSize()
                            }
                        } }
                    }
                }
                .frame(height: max(125, rowHeight * CGFloat(grouped.count) + 35)).accessibilityIdentifier(identifier)
                ForEach(Array(grouped.enumerated()), id: \.element.id) { index, item in
                    LabeledContent(textSize.isAccessibilitySize ? "\(index + 1). \(item.label)" : item.label) { Text(unit.display(item.amount)).monospacedDigit().font(.caption.weight(.semibold)) }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).accessibilityElement(children: .contain).accessibilityIdentifier(cardPrefix + identifier)
    }
}
