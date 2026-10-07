import SwiftUI

private struct QuantSourceResult: Sendable {
    let id: String
    let data: VaultValue
    let error: String?
}

struct NativeQuantOverviewView: View {
    @Environment(VaultModel.self) private var model
    @State private var sources: [String: VaultValue] = [:]
    @State private var errors: [String: String] = [:]
    @State private var pending = Set<String>()
    @State private var category = "All"
    @State private var search = ""
    @State private var selectedResource: NativeResource?
    private var resources: [NativeResource] {
        NativeCatalog.features.first { $0.id == "quant" }?.resources ?? []
    }

    private var signals: [QuantSignal] {
        NativeQuantOverview.signals(sources).filter { (category == "All" || $0.category == category) && (search.isEmpty || ($0.title + " " + $0.detail).localizedCaseInsensitiveContains(search)) }
    }

    var body: some View {
        List {
            VaultHero(title: "Market snapshot", subtitle: "Explore the latest signals, then open a chart for the dated observations behind each one.", symbol: "waveform.path", color: .indigo, eyebrow: "QUANT / OVERVIEW").vaultStandaloneRow()
            Section {
                Picker("Category", selection: $category) { ForEach(["All", "Crypto", "Macro", "TradFi"], id: \.self) { Text($0).tag($0) } }
                    .accessibilityIdentifier("quantOverviewCategory")
                if !pending.isEmpty {
                    ProgressView("Loading \(pending.count) sources…")
                }
                Button("Refresh snapshot") { Task { await load() } }.disabled(!pending.isEmpty).accessibilityIdentifier("refreshQuantOverview")
            }
            ForEach(["Crypto", "Macro", "TradFi"], id: \.self) { group in
                let members = signals.filter { $0.category == group }
                if !members.isEmpty {
                    Section(group) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 12)], spacing: 12) {
                            ForEach(members) { signal in
                                if let resource = resources.first(where: { $0.id == signal.resource }) {
                                    Button { selectedResource = resource } label: { card(signal) }
                                        .buttonStyle(.plain)
                                        .accessibilityIdentifier("quantSignal-" + signal.id)
                                }
                            }
                        }.vaultStandaloneRow()
                    }
                }
            }
            if signals.isEmpty {
                ContentUnavailableView.search(text: search)
            }
        }
        .vaultDashboard().tint(.indigo).searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a signal")
        .navigationDestination(item: $selectedResource) { resource in
            NativeQuantView(resource: resource).navigationTitle(resource.title)
        }
        .task { await load() }.refreshable { await load() }
    }

    private func card(_ signal: QuantSignal) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(signal.title).font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            Text(signal.value ?? (pending.contains(signal.resource) ? "Loading…" : "Unavailable"))
                .font(.system(.title2, design: .rounded, weight: .bold)).monospacedDigit().foregroundStyle(signal.tone == 3 ? Color.red : signal.tone == 2 ? Color.orange : signal.tone == 1 ? Color.green : Color.primary)
            if !signal.detail.isEmpty {
                Text(signal.detail).font(.caption).foregroundStyle(.secondary)
            }
            if let error = errors[signal.resource] {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                if sources[signal.resource] != nil {
                    Text("Previous snapshot retained").font(.caption).foregroundStyle(.secondary)
                }
            }
            let data = sources[signal.resource] ?? .null
            if data["stale"].boolean {
                Label("Cached data is stale", systemImage: "clock.badge.exclamationmark").font(.caption).foregroundStyle(.orange)
            }
            if !data["fetchError"].isEmpty {
                Text(data["fetchError"].string).font(.caption).foregroundStyle(.orange)
            }
            if let timestamp = data["fetchedAt"].number, timestamp.isFinite {
                Text("Fetched " + Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .abbreviated, time: .shortened)).font(.caption2).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .indigo)
    }

    private func load() async {
        guard pending.isEmpty else { return }
        let endpoints = resources.filter { NativeQuantOverview.sourceIDs.contains($0.id) }
        pending = Set(endpoints.map(\.id))
        errors = [:]
        await withTaskGroup(of: QuantSourceResult.self) { group in
            for resource in endpoints {
                group.addTask {
                    do {
                        let data = try await model.nativeRequest(resource.path, scope: .init())
                        if !data["error"].isEmpty {
                            throw VaultError.server(data["error"].string)
                        }
                        return .init(id: resource.id, data: data, error: nil)
                    } catch { return .init(id: resource.id, data: .null, error: error.localizedDescription) }
                }
            }
            for await result in group {
                guard !Task.isCancelled else { group.cancelAll(); break }
                pending.remove(result.id)
                if let error = result.error {
                    errors[result.id] = error
                } else {
                    sources[result.id] = result.data
                }
            }
        }
        pending = []
    }
}
