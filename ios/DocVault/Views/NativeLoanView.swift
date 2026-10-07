import SwiftUI

struct NativeLoanView: View {
    @Environment(VaultModel.self) private var model
    let loan: VaultValue
    @State private var extra = "0"
    @State private var once = "0"
    @State private var onceMonth = "1"
    private var base: NativeAmortization {
        calculate()
    }

    private var scenario: NativeAmortization {
        calculate(extra: Double(extra) ?? 0, once: Double(once) ?? 0, month: Int(onceMonth) ?? 1)
    }

    private func calculate(extra: Double = 0, once: Double = 0, month: Int = 1)
        -> NativeAmortization
    {
        .calculate(
            balance: loan["balance"].number ?? 0, rate: loan["rate"].number ?? 0,
            payment: loan["monthlyPayment"].number ?? 0, extra: extra, once: once, onceMonth: month
        )
    }

    private func money(_ value: Double) -> String {
        model.blurNumbers ? "••••" : value.formatted(.currency(code: "USD"))
    }

    var body: some View {
        Form {
            Section("As scheduled") {
                LabeledContent("Balance", value: money(loan["balance"].number ?? 0))
                LabeledContent("Monthly payment", value: money(loan["monthlyPayment"].number ?? 0))
                LabeledContent(
                    "APR",
                    value: model.blurNumbers
                        ? "••••" : ((loan["rate"].number ?? 0) * 100).formatted() + "%"
                )
                LabeledContent(
                    "Payments to payoff",
                    value: base.negative || base.rows.last?["balance"].number != 0
                        ? "Does not amortize within 100 years" : String(base.months)
                )
                LabeledContent("Total interest", value: money(base.interest))
            }
            Section("Extra principal") {
                TextField("Extra per month", text: $extra).keyboardType(.decimalPad)
                TextField("One-time extra", text: $once).keyboardType(.decimalPad)
                TextField("Payment number for one-time extra", text: $onceMonth).keyboardType(
                    .numberPad
                )
                LabeledContent("Months saved", value: String(max(0, base.months - scenario.months)))
                LabeledContent(
                    "Interest saved", value: money(max(0, base.interest - scenario.interest))
                )
                if scenario.negative {
                    Text("The payment does not cover interest, or an input is invalid.")
                        .foregroundStyle(.red)
                }
            }
            NavigationLink("Payment schedule") {
                List {
                    NativeSeriesChart(values: scenario.rows)
                    ForEach(scenario.rows, id: \.self) { row in
                        NavigationLink("Payment \(row["month"].string)") {
                            List { NativeValueSections(value: row) }
                        }
                    }
                }.navigationTitle("Payment schedule")
            }
        }.navigationTitle("Loan payoff").navigationBarTitleDisplayMode(.inline)
    }
}
