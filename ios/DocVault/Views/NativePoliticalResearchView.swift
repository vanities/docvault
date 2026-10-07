import Charts
import SwiftUI

struct NativePoliticalResearchView: View {
    @Environment(VaultModel.self) private var model
    @State private var data: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var kind = "All"
    @State private var generation = UUID()
    private var claims: [PoliticalResearchClaim] {
        NativePolitics.researchClaims(data, kind: kind, search: search)
    }

    private var signals: [VaultValue] {
        NativePolitics.researchSignals(data, kind: kind, search: search)
    }

    var body: some View {
        List {
            VaultHero(title: "Research radar", subtitle: "Follow the assets and topics in your commentary, then inspect the disclosures, bills and source notes linked to each claim.", symbol: "dot.radiowaves.left.and.right", eyebrow: "POLITICS / RESEARCH").vaultStandaloneRow()
            if loading {
                ProgressView("Loading linked research…")
            }
            if let error {
                ErrorNotice(message: error)
                Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                if !data["ok"].boolean {
                    Label("Political collection is unavailable. Refresh the feed before linking research.", systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                }
                VaultMetricGrid(metrics: [
                    .init(title: "Linked claims", value: String(NativePolitics.researchClaims(data).count), symbol: "text.quote"),
                    .init(title: "Asset signals", value: String(NativePolitics.researchSignals(data, kind: "Assets").count), symbol: "chart.line.uptrend.xyaxis"),
                    .init(title: "Topic signals", value: String(NativePolitics.researchSignals(data, kind: "Topics").count), symbol: "number"),
                ]).vaultStandaloneRow()
                Picker("Signals", selection: $kind) { ForEach(["All", "Assets", "Topics"], id: \.self) { Text($0) } }
                    .accessibilityIdentifier("politicalResearchKind")
                if !signals.isEmpty {
                    Section("Evidence by signal") {
                        Chart {
                            ForEach(signals, id: \.self) { signal in
                                ForEach(["tradeMatchCount", "voteMatchCount"], id: \.self) { key in
                                    if let count = NativePolitics.count(signal[key]) {
                                        BarMark(x: .value("Matches", count), y: .value("Signal", signal["label"].string))
                                            .foregroundStyle(by: .value("Evidence", key == "tradeMatchCount" ? "Trades" : "Bills / votes"))
                                            .position(by: .value("Evidence", key))
                                            .cornerRadius(3)
                                    }
                                }
                            }
                        }.chartForegroundStyleScale(["Trades": Color.indigo, "Bills / votes": Color.teal])
                            .frame(height: CGFloat(max(1, signals.count)) * 64 + 35)
                            .accessibilityIdentifier("politicalResearchChart")
                        Text("Matches are associations with a ticker or topic, not verification of a claim. The same record can match more than one signal.").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Assets and topics") {
                        ForEach(signals, id: \.self) { signal in
                            NavigationLink { NativePoliticalSignalDetail(signal: signal, claims: NativePolitics.researchClaims(data)) } label: {
                                PoliticalSignalCard(signal: signal)
                            }.vaultStandaloneRow().accessibilityIdentifier("politicalSignal-" + signal["key"].string)
                        }
                    }
                }
                Section("Linked claims") {
                    ForEach(claims) { claim in
                        NavigationLink { NativePoliticalClaimDetail(claim: claim) } label: {
                            PoliticalClaimCard(claim: claim)
                        }.vaultStandaloneRow().accessibilityIdentifier("politicalClaim-" + claim.value["entryId"].string + "-" + claim.value["claimId"].string)
                    }
                    if !loading, error == nil, claims.isEmpty {
                        Text(search.isEmpty ? "No linked claims yet. Add a politics source to the Research Inbox and analyze it to link assets and topics to collected activity." : "No matching claims.").foregroundStyle(.secondary)
                    }
                }
            }
            if let resource = NativeCatalog.resource("research-politics") {
                NavigationLink("Political research inbox") { NativeResourceView(resource: resource, scope: .init()) }
            }
        }.vaultDashboard().tint(.indigo).searchable(text: $search, prompt: "Find a claim, asset, topic or member")
            .task { await load() }.refreshable { await load() }
    }

    private func load() async {
        let id = UUID(); generation = id
        loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let response = try await model.nativeRequest("api/research/politics-links", scope: .init())
            guard generation == id, !Task.isCancelled else { return }
            data = response
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct PoliticalSignalCard: View {
    let signal: VaultValue
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(signal["kind"].string == "ticker" ? "ASSET SIGNAL" : "TOPIC SIGNAL").font(.caption2.weight(.semibold)).tracking(1.3).foregroundStyle(.indigo)
            Text(signal["label"].string).font(.system(.title3, design: .rounded, weight: .bold))
            Text("\(signal["claimCount"].string) claims · \(signal["tradeMatchCount"].string) trade matches · \(signal["voteMatchCount"].string) bill/vote matches").font(.caption).foregroundStyle(.secondary)
            if !signal["stances"].array.isEmpty {
                Text(signal["stances"].array.map(\.string).joined(separator: " · ")).font(.caption.weight(.medium))
            }
            if let sample = signal["sampleClaims"].array.first {
                Text(sample["text"].string).font(.subheadline).lineLimit(3)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard()
    }
}

private struct PoliticalClaimCard: View {
    let claim: PoliticalResearchClaim
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text((claim.value["tickers"].array.map(\.string) + claim.value["topics"].array.map { "#" + $0.string }).joined(separator: " · ")).font(.caption.weight(.medium)).foregroundStyle(.indigo)
            Text(claim.value["claimText"].string).font(.body).lineLimit(4)
            Text(claim.value["title"].string.isEmpty ? "Research source" : claim.value["title"].string).font(.caption).foregroundStyle(.secondary)
            Text("\(claim.value["matchedTrades"].array.count) trade matches · \(claim.value["matchedVotes"].array.count) bill/vote matches").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard()
    }
}

struct NativePoliticalSignalDetail: View {
    let signal: VaultValue
    let claims: [PoliticalResearchClaim]
    var matchingClaims: [PoliticalResearchClaim] {
        claims.filter { claim in
            let field = signal["kind"].string == "ticker" ? "tickers" : "topics"
            let label = signal["kind"].string == "ticker" ? signal["label"].string : String(signal["key"].string.dropFirst("topic:".count))
            return claim.value[field].array.contains { $0.string == label }
        }
    }

    var body: some View {
        List {
            VaultMetricGrid(metrics: [
                .init(title: "Claims", value: NativePolitics.count(signal["claimCount"]).map(String.init) ?? "Unavailable", symbol: "text.quote"),
                .init(title: "Trade matches", value: NativePolitics.count(signal["tradeMatchCount"]).map(String.init) ?? "Unavailable", symbol: "arrow.left.arrow.right"),
                .init(title: "Bill / vote matches", value: NativePolitics.count(signal["voteMatchCount"]).map(String.init) ?? "Unavailable", symbol: "building.columns"),
            ]).vaultStandaloneRow()
            Section("Source claims") {
                ForEach(matchingClaims) { claim in
                    NavigationLink { NativePoliticalClaimDetail(claim: claim) } label: { PoliticalClaimCard(claim: claim) }
                        .vaultStandaloneRow().accessibilityIdentifier("politicalSignalClaim-" + claim.value["claimId"].string)
                }
            }
            PoliticalResearchMatches(value: signal)
            Section("Original sources") {
                ForEach(signal["sourceUrls"].array, id: \.self) { source in
                    if let url = NativePolitics.sourceURL(source) {
                        Link(url.host() ?? "Source", destination: url)
                    }
                }
            }
        }.vaultDashboard().tint(.indigo).navigationTitle(signal["label"].string).navigationBarTitleDisplayMode(.inline)
    }
}

struct NativePoliticalClaimDetail: View {
    let claim: PoliticalResearchClaim
    var body: some View {
        List {
            Section("Research claim") {
                Text(claim.value["claimText"].string).textSelection(.enabled).accessibilityIdentifier("politicalClaimText")
                if !claim.value["stance"].isEmpty {
                    LabeledContent("Source stance", value: claim.value["stance"].string)
                }
                Text("A ticker or topic match shows related activity. It does not establish agreement, causation or the accuracy of this claim.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Source") {
                if let resource = NativeCatalog.resource("research-politics"), let collection = resource.collections.first {
                    NavigationLink("Read saved research source") {
                        NativeRecordView(record: .object(["id": claim.value["entryId"], "title": claim.value["title"]]), collection: collection, resource: resource, scope: .init(), changed: {})
                    }.accessibilityIdentifier("readPoliticalResearchSource")
                }
                if let url = NativePolitics.sourceURL(claim.value["sourceUrl"]) {
                    Link("Original source", destination: url)
                }
            }
            PoliticalResearchMatches(value: claim.value)
        }.vaultDashboard().tint(.indigo).navigationTitle("Claim evidence").navigationBarTitleDisplayMode(.inline)
    }
}

private struct PoliticalResearchMatches: View {
    let value: VaultValue
    var body: some View {
        Section("Matched disclosures") {
            ForEach(Array(value["matchedTrades"].array.enumerated()), id: \.offset) { _, trade in
                NativePoliticalTradeRow(trade: trade, simulation: false)
            }
            if value["matchedTrades"].array.isEmpty {
                Text("No matched disclosures.").foregroundStyle(.secondary)
            }
        }
        Section("Matched bills / votes") {
            ForEach(Array(value["matchedVotes"].array.enumerated()), id: \.offset) { _, vote in
                NavigationLink { NativePoliticalBillDetail(vote: vote) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(vote["label"].string).font(.headline)
                        Text(vote["externalId"].string).font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("politicalMatchedBill-" + vote["externalId"].string)
            }
            if value["matchedVotes"].array.isEmpty {
                Text("No matched bills or votes.").foregroundStyle(.secondary)
            }
            NavigationLink("Browse collected bills") { NativePoliticalArchive(kind: "bills") }
        }
    }
}

struct NativePoliticalBillDetail: View {
    @Environment(VaultModel.self) private var model
    let vote: VaultValue
    @State private var bill: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    var body: some View {
        List {
            if loading {
                ProgressView("Loading collected bill…")
            }
            if let error {
                ErrorNotice(message: error)
                Button("Retry") { Task { await load() } }
            }
            if !bill.isEmpty {
                VaultHero(title: bill["title"].string, subtitle: "\(bill["officialId"].string) · \(bill["status"].string.replacingOccurrences(of: "_", with: " "))", symbol: "building.columns", eyebrow: "POLITICS / BILL").vaultStandaloneRow()
                Section("Official summary") {
                    if !bill["summary"].string.isEmpty {
                        Text(bill["summary"].string).textSelection(.enabled).accessibilityIdentifier("politicalBillSummary")
                    } else {
                        Text("No official summary is available in the collection.").foregroundStyle(.secondary)
                    }
                    if let url = NativePolitics.sourceURL(bill["url"]) {
                        Link("Official bill source", destination: url)
                    }
                }
                Section("Activity") {
                    LabeledContent("Latest action", value: bill["latestAction"].string)
                    LabeledContent("Action date", value: bill["latestActionDate"].string)
                    LabeledContent("Introduced", value: bill["introducedDate"].string)
                }
                NavigationLink("Bill source fields") {
                    List { NativeValueSections(value: bill) }.navigationTitle("Bill source fields")
                }
            } else if !loading, error == nil {
                Text("This matched bill is no longer available in the current collection.").foregroundStyle(.secondary)
                Text(vote["label"].string).font(.headline)
                Text(vote["externalId"].string).font(.caption)
            }
        }.vaultDashboard().tint(.indigo).navigationTitle("Bill activity").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let data = try await model.nativeRequest("api/politics/feed", scope: .init())
            guard !Task.isCancelled else { return }
            bill = data["bills"].array.first { $0["externalId"] == vote["externalId"] && !$0["externalId"].isEmpty } ?? .null
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativePoliticalPortrait: View {
    @Environment(VaultModel.self) private var model
    let name: String
    let imagePath: String
    var size: CGFloat = 56
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Circle().fill(Color.indigo.opacity(0.14))
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .accessibilityLabel("Member portrait")
                    .accessibilityIdentifier("politicalPortraitImage-" + name)
            } else {
                Text(NativePolitics.initials(name)).font(.system(size: size * 0.3, weight: .semibold, design: .rounded)).foregroundStyle(.indigo)
                    .accessibilityLabel("Initials avatar")
                    .accessibilityIdentifier("politicalPortraitFallback-" + name)
            }
        }.frame(width: size, height: size).clipShape(Circle()).accessibilityElement(children: .contain)
            .task(id: imagePath + "-" + String(model.revision)) {
                image = nil
                do {
                    let result = try await model.politicalPortrait(imagePath)
                    guard !Task.isCancelled else { return }
                    image = result
                } catch {
                    if !Task.isCancelled {
                        image = nil
                    }
                }
            }
    }
}
