import SwiftUI

/// Shared native dashboard language: quiet surfaces, domain color and readable data.
enum VaultPalette {
    static func accent(_ group: String) -> Color {
        switch group {
        case "Health": .teal
        case "Finance": .blue
        case "Work & taxes": .orange
        case "Everyday": .cyan
        case "Knowledge": .indigo
        case "Manage": .gray
        default: .indigo
        }
    }

    static let chart: [Color] = [.teal, .indigo, .orange, .pink, .cyan, .purple, .green, .gray]

    static func resourceAccent(_ id: String) -> Color {
        accent(NativeCatalog.features.first { feature in feature.resources.contains { $0.id == id } }?.group ?? "")
    }

    static func healthSymbol(_ segment: String) -> String {
        switch segment {
        case "activity": "figure.walk"
        case "heart": "waveform.path.ecg"
        case "sleep": "moon.zzz"
        case "workouts": "figure.run"
        default: "scalemass"
        }
    }
}

struct VaultHero: View {
    let title: String
    let subtitle: String
    let symbol: String
    var color: Color = .indigo
    var eyebrow = "DOCVAULT"
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol).font(.system(size: 25, weight: .medium))
                .foregroundStyle(color).frame(width: 56, height: 56)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
            VStack(alignment: .leading, spacing: 7) {
                Text(eyebrow).font(.caption2.weight(.bold)).tracking(1.7).foregroundStyle(color)
                Text(title).font(.system(.title2, design: .rounded, weight: .bold)).foregroundStyle(.primary)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color)
    }
}

struct VaultMetricCard: View {
    @ScaledMetric(relativeTo: .caption) private var symbolSize: CGFloat = 28
    let title: String
    let value: String
    var symbol = "chart.bar.xaxis"
    var color: Color = .indigo
    var detail = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: symbol).font(.system(size: symbolSize * 0.48, weight: .semibold)).foregroundStyle(color)
                    .frame(width: symbolSize, height: symbolSize).background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
                    .accessibilityHidden(true)
                Text(title).font(.caption.weight(.medium)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            Text(value).font(.system(.title2, design: .rounded, weight: .bold)).monospacedDigit()
                .foregroundStyle(value == "Unavailable" ? Color.secondary : Color.primary)
                .lineLimit(2).minimumScaleFactor(0.65).frame(maxWidth: .infinity, alignment: .leading)
            if !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, minHeight: 100, alignment: .topLeading).vaultCard(color: color, padding: 16)
    }
}

struct VaultMetric: Identifiable {
    let title: String
    let value: String
    var symbol: String?
    var id: String {
        title
    }
}

struct VaultMetricGrid: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.horizontalSizeClass) private var sizeClass
    let metrics: [VaultMetric]
    let color: Color

    init(stats: [HealthStat], color: Color = .teal) {
        metrics = stats.map { .init(title: $0.title, value: $0.value) }
        self.color = color
    }

    init(metrics: [VaultMetric], color: Color = .indigo) {
        self.metrics = metrics
        self.color = color
    }

    var body: some View {
        let maximum = textSize.isAccessibilitySize ? (sizeClass == .regular ? 2 : 1) : (sizeClass == .regular ? 4 : 2)
        let balanced = maximum == 4 && metrics.count > 4 && (metrics.count + 2) / 3 == (metrics.count + 3) / 4
        let capacity = balanced ? 3 : maximum
        let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: max(1, min(capacity, metrics.count)))
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(metrics) { metric in
                VaultMetricCard(title: metric.title, value: model.blurNumbers ? "••••" : metric.value, symbol: metric.symbol ?? symbol(metric.title), color: color)
            }
        }
    }

    private func symbol(_ title: String) -> String {
        let text = title.lowercased()
        if text.contains("steps") {
            return "figure.walk"
        }
        if text.contains("energy") {
            return "flame"
        }
        if text.contains("sleep") || text.contains("nights") {
            return "moon.zzz"
        }
        if text.contains("heart") || text.contains("hrv") {
            return "waveform.path.ecg"
        }
        if text.contains("weight") {
            return "scalemass"
        }
        if text.contains("change") || text.contains("previous") {
            return "arrow.up.arrow.down"
        }
        if text.contains("distance") {
            return "point.topleft.down.to.point.bottomright.curvepath"
        }
        if text.contains("streak") {
            return "flame"
        }
        if text.contains("ring") {
            return "circle.dashed.inset.filled"
        }
        return "figure.run"
    }
}

struct VaultScoreCard: View {
    @Environment(VaultModel.self) private var model
    let title: String
    let score: VaultValue
    var color: Color = .teal
    var body: some View {
        HStack(spacing: 22) {
            ZStack {
                Circle().stroke(color.opacity(0.12), lineWidth: 9)
                if !model.blurNumbers, let value = NativeHealth.number(score["score"]) {
                    Circle().trim(from: 0, to: min(1, max(0, value / 100))).stroke(color.gradient, style: StrokeStyle(lineWidth: 9, lineCap: .round)).rotationEffect(.degrees(-90))
                }
                VStack(spacing: 2) {
                    Text(model.blurNumbers ? "••" : NativeHealth.display(score["score"])).font(.system(.title2, design: .rounded, weight: .bold)).monospacedDigit()
                    Text("/ 100").font(.caption2).foregroundStyle(.secondary)
                }
            }.frame(width: 85, height: 85).accessibilityElement(children: .combine)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline)
                Text(score["date"].string).font(.caption).foregroundStyle(.secondary)
                ForEach(score["components"].object.keys.sorted(), id: \.self) { key in
                    HStack {
                        Text(key == "hrv" ? "HRV" : VaultValue.label(key)).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(model.blurNumbers ? "••" : NativeHealth.display(score["components"][key])).font(.caption.weight(.semibold)).monospacedDigit()
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color)
    }
}

extension View {
    func vaultCard(color: Color = .indigo, padding: CGFloat = 20) -> some View {
        self.padding(padding)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 23))
            .overlay(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 23).fill(LinearGradient(colors: [color.opacity(0.07), .clear], startPoint: .topLeading, endPoint: .bottomTrailing)).allowsHitTesting(false)
            }
            .overlay { RoundedRectangle(cornerRadius: 23).strokeBorder(color.opacity(0.12), lineWidth: 1).allowsHitTesting(false) }
            .shadow(color: .black.opacity(0.025), radius: 10, y: 5)
    }

    func vaultDashboard(color: Color = .indigo) -> some View {
        scrollContentBackground(.hidden)
            .background { LinearGradient(colors: [color.opacity(0.055), Color(.systemGroupedBackground)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea() }
    }

    func vaultStandaloneRow() -> some View {
        listRowInsets(.init(top: 4, leading: 0, bottom: 4, trailing: 0)).listRowBackground(Color.clear).listRowSeparator(.hidden)
    }
}
