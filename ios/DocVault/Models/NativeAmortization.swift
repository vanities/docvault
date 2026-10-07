import Foundation

struct NativeAmortization {
    let rows: [VaultValue]
    let interest: Double
    let paid: Double
    let negative: Bool
    var months: Int {
        rows.count
    }

    static func calculate(
        balance: Double, rate: Double, payment: Double, extra: Double = 0, once: Double = 0,
        onceMonth: Int = 1
    ) -> NativeAmortization {
        guard [balance, rate, payment, extra, once].allSatisfy(\.isFinite), balance >= 0, rate >= 0,
              payment > 0, extra >= 0, once >= 0
        else { return .init(rows: [], interest: 0, paid: 0, negative: true) }
        var remaining = balance
        var interest = 0.0
        var principal = 0.0
        var rows: [VaultValue] = []
        var negative = false
        for month in 1 ... 1200 {
            if remaining <= 0.005 {
                break
            }
            let charge = remaining * rate / 12
            let scheduled = payment - charge
            let reduction = scheduled + extra + (month == onceMonth ? once : 0)
            if reduction <= 0 {
                negative = true
                break
            }
            let paid = min(reduction, remaining)
            remaining -= paid
            interest += charge
            principal += paid
            rows.append(
                .object([
                    "month": .number(Double(month)), "payment": .number(charge + paid),
                    "interest": .number(charge), "principal": .number(min(max(scheduled, 0), paid)),
                    "extra": .number(paid - min(max(scheduled, 0), paid)),
                    "balance": .number(remaining < 0.005 ? 0 : remaining),
                    "cumulativeInterest": .number(interest),
                ])
            )
        }
        return .init(rows: rows, interest: interest, paid: principal + interest, negative: negative)
    }
}
