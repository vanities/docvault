import Foundation

/// Native surfaces backed by the existing server contracts.
enum NativeCatalog {
    static func resource(_ id: String) -> NativeResource? {
        features.lazy.flatMap(\.resources).first { $0.id == id }
    }

    static func researchInbox(_ id: String, domain: ResearchDomain) -> NativeResource {
        let metadata: [NativeField] = [
            .init("title", "Title"), .init("author", "Author"), .init("publisher", "Publisher"),
            .init("reportDate", "Report date", .date), .init("sourceUrl", "Source URL"),
            .init("notes", "Notes", .multiline), .init("tags", "Tags", .strings),
            .init("tickers", "Tickers", .strings), .init("linkedPersonIds", "Linked people", .references("people")),
        ]
        return .init(id: id, title: "Research Inbox", path: "api/research?domain=" + domain.rawValue,
                     collections: [.init(id: "entries", title: "Research", path: "entries", fields: metadata,
                                         updatePath: "api/research/{id}", deletePath: "api/research/{id}", updateMethod: "PATCH", detailPath: "api/research/{id}",
                                         actions: [
                                             .init(id: "extract", title: "Extract text again", path: "api/research/{id}/re-extract"),
                                             .init(id: "transcribe", title: "Transcribe again", path: "api/research/{id}/re-transcribe"),
                                             .init(id: "intelligence", title: "Analyze research", path: "api/research/{id}/intelligence"),
                                             .init(id: "file", title: "Open source document", path: "api/research/{id}/file", method: "GET", response: "pdf"),
                                         ])],
                     actions: [
                         .init(id: "text", title: "Add text", path: "api/research/text", fields: [.init("text", "Text", .multiline, required: true)] + metadata.filter { $0.id != "notes" } + [.init("domain", "Domain", .choices([domain.rawValue]), initial: domain.rawValue)]),
                         .init(id: "youtube", title: "Import YouTube", path: "api/research/youtube", fields: [.init("url", "URL", required: true), .init("tickers", "Tickers", .strings), .init("domain", "Domain", .choices([domain.rawValue]), initial: domain.rawValue)]),
                         .init(id: "pdf", title: "Import document", path: "api/research/upload?filename={filename}&domain=" + domain.rawValue, response: "upload"),
                         .init(id: "video", title: "Import audio or video", path: "api/research/video?filename={filename}&domain=" + domain.rawValue, response: "upload"),
                     ])
    }

    static let groups = ["Finance", "Work & taxes", "Everyday", "Health", "Knowledge", "Manage"]
    static let features: [NativeFeature] = [
        .init(
            id: "portfolio", title: "Portfolio", symbol: "chart.pie", group: "Finance",
            resources: [.init(id: "portfolio", title: "Net Worth", path: "api/portfolio/snapshots")]
        ),
        .init(
            id: "banks", title: "Banks", symbol: "building.columns", group: "Finance",
            resources: [
                .init(
                    id: "banks", title: "Accounts & Balances",
                    path: "api/simplefin/balances?cached=1",
                    actions: [
                        .init(
                            id: "sync", title: "Sync banks", path: "api/simplefin/balances",
                            method: "GET"
                        ),
                    ]
                ),
                .init(
                    id: "bank-status", title: "Connection Health", path: "api/simplefin/status",
                    actions: [
                        .init(
                            id: "connect", title: "Connect SimpleFIN", path: "api/simplefin/setup",
                            fields: [.init("setupToken", "Setup Token", .secret, required: true)]
                        ),
                        .init(
                            id: "disconnect", title: "Disconnect banks", path: "api/simplefin",
                            method: "DELETE", destructive: true
                        ),
                    ]
                ),
                .init(
                    id: "annotations", title: "Account Categories",
                    path: "api/account-annotations/merged",
                    collections: [
                        .init(
                            id: "accounts", title: "Accounts", path: "accounts",
                            fields: [
                                .init(
                                    "type", "Type",
                                    .choices([
                                        "auto-loan", "personal-loan", "student-loan", "credit-card",
                                        "mortgage", "other",
                                    ])
                                ), .init("rate", "APR (%)", .percentage),
                                .init("monthlyPayment", "Monthly Payment", .number),
                                .init("originalBalance", "Original Balance", .number),
                                .init("term", "Term", .integer),
                                .init("startDate", "Start Date", .date),
                                .init("notes", "Notes", .multiline),
                            ], updatePath: "api/account-annotations/{id}"
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "brokers", title: "Brokers", symbol: "chart.line.uptrend.xyaxis", group: "Finance",
            resources: [
                .init(
                    id: "broker-portfolio", title: "Holdings",
                    path: "api/brokers/portfolio?cached=1",
                    actions: [
                        .init(
                            id: "sync", title: "Refresh holdings", path: "api/brokers/portfolio",
                            method: "GET"
                        ),
                    ]
                ),
                .init(
                    id: "broker-accounts", title: "Manual Accounts", path: "api/brokers/accounts",
                    collections: [
                        .init(
                            id: "accounts", title: "Manual Accounts", path: "accounts",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init(
                                    "broker", "Broker",
                                    .choices([
                                        "vanguard", "fidelity", "robinhood", "navy-federal", "chase", "altoira", "other",
                                    ]), required: true, initial: "other"
                                ),
                                .init("url", "Url", .text),
                                .init("overrideValue", "Override Value", .number),
                                .init(
                                    "holdings", "Holdings",
                                    .records([
                                        .init("ticker", "Ticker", .text, required: true),
                                        .init("shares", "Shares", .number, required: true),
                                        .init("costBasis", "Cost Basis", .number),
                                        .init("label", "Label", .text),
                                        .init("purchaseDate", "Purchase Date", .date),
                                        .init("price", "Price", .number),
                                    ])
                                ),
                            ], createPath: "api/brokers/accounts",
                            updatePath: "api/brokers/accounts/{id}",
                            deletePath: "api/brokers/accounts/{id}"
                        ),
                    ]
                ),
                .init(
                    id: "broker-activities", title: "Activity", path: "api/brokers/activities",
                    actions: [
                        .init(
                            id: "sync", title: "Sync activity", path: "api/brokers/activities/sync"
                        ),
                    ]
                ),
                .init(
                    id: "snaptrade", title: "Connections", path: "api/snaptrade/status",
                    actions: [
                        .init(
                            id: "setup", title: "Set up SnapTrade", path: "api/snaptrade/setup",
                            fields: [
                                .init("clientId", "Client Id", .text, required: true),
                                .init("consumerKey", "Consumer Key", .secret, required: true),
                            ]
                        ),
                        .init(
                            id: "connect", title: "Connect broker", path: "api/snaptrade/connect",
                            method: "GET"
                        ),
                        .init(id: "sync", title: "Sync broker", path: "api/snaptrade/sync"),
                        .init(
                            id: "disconnect", title: "Disconnect broker", path: "api/snaptrade",
                            method: "DELETE", destructive: true
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "crypto", title: "Crypto", symbol: "bitcoinsign.circle", group: "Finance",
            resources: [
                .init(
                    id: "crypto-balances", title: "Holdings", path: "api/crypto/balances?cached=1",
                    actions: [
                        .init(
                            id: "sync", title: "Refresh crypto", path: "api/crypto/balances",
                            method: "GET"
                        ),
                    ]
                ),
                .init(
                    id: "crypto-gains", title: "Gains", path: "api/crypto/gains?cached=1",
                    actions: [
                        .init(
                            id: "sync", title: "Refresh gains", path: "api/crypto/gains",
                            method: "GET"
                        ),
                    ]
                ), .init(id: "crypto-yields", title: "Yields", path: "api/crypto/yields"),
                .init(
                    id: "crypto-settings", title: "Connections & Manual Holdings",
                    path: "api/crypto/settings",
                    actions: [
                        .init(
                            id: "etherscan", title: "Set Etherscan key",
                            path: "api/crypto/settings",
                            fields: [.init("etherscanKey", "Etherscan Key", .secret)]
                        ),
                        .init(
                            id: "exchange", title: "Connect exchange", path: "api/crypto/settings",
                            fields: [
                                .init(
                                    "addExchange.id", "Id",
                                    .choices(["coinbase", "kraken", "gemini", "kucoin"]),
                                    required: true
                                ),
                                .init("addExchange.apiKey", "Api Key", .secret, required: true),
                                .init(
                                    "addExchange.apiSecret", "Api Secret", .secret, required: true
                                ),
                                .init("addExchange.passphrase", "Passphrase", .secret),
                            ]
                        ),
                        .init(
                            id: "wallet", title: "Add wallet", path: "api/crypto/settings",
                            fields: [
                                .init("addWallet.address", "Address", .text, required: true),
                                .init(
                                    "addWallet.chain", "Chain",
                                    .choices([
                                        "ethereum", "bitcoin", "solana", "polygon", "arbitrum",
                                        "optimism", "base",
                                    ]), required: true
                                ), .init("addWallet.label", "Label", .text),
                            ]
                        ),
                        .init(
                            id: "manual-holding", title: "Add manual holding",
                            path: "api/crypto/settings",
                            fields: [
                                .init("addManualHolding.asset", "Asset", .text, required: true),
                                .init("addManualHolding.amount", "Amount", .number, required: true),
                                .init("addManualHolding.label", "Label", .text),
                                .init("addManualHolding.note", "Note", .text),
                            ]
                        ),
                        .init(
                            id: "remove-exchange", title: "Remove exchange",
                            path: "api/crypto/settings",
                            fields: [
                                .init(
                                    "removeExchange", "Remove Exchange", .reference("exchanges"),
                                    required: true
                                ),
                            ], destructive: true
                        ),
                        .init(
                            id: "toggle-exchange", title: "Enable or disable exchange",
                            path: "api/crypto/settings",
                            fields: [
                                .init(
                                    "toggleExchange", "Toggle Exchange", .reference("exchanges"),
                                    required: true
                                ),
                            ]
                        ),
                        .init(
                            id: "remove-wallet", title: "Remove wallet",
                            path: "api/crypto/settings",
                            fields: [
                                .init(
                                    "removeWallet", "Remove Wallet", .reference("wallets"),
                                    required: true
                                ),
                            ], destructive: true
                        ),
                        .init(
                            id: "remove-holding", title: "Remove manual holding",
                            path: "api/crypto/settings",
                            fields: [
                                .init(
                                    "removeManualHolding", "Remove Manual Holding",
                                    .reference("manualHoldings"), required: true
                                ),
                            ], destructive: true
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "gold", title: "Precious Metals", symbol: "square.stack.3d.up", group: "Finance",
            resources: [
                .init(
                    id: "gold", title: "Metals", path: "api/gold",
                    collections: [
                        .init(
                            id: "entries", title: "Metals", path: "entries",
                            fields: [
                                .init(
                                    "metal", "Metal",
                                    .choices(["gold", "silver", "platinum", "palladium"]),
                                    required: true, initial: "gold"
                                ),
                                .init(
                                    "productId", "Product Id", .text, required: true,
                                    initial: "custom"
                                ),
                                .init("customDescription", "Custom Description", .text),
                                .init("coinYear", "Coin Year", .integer),
                                .init("size", "Size", .text, required: true, initial: "1 oz"),
                                .init(
                                    "weightOz", "Weight Oz", .number, required: true, initial: "1"
                                ),
                                .init(
                                    "purity", "Purity", .number, required: true, initial: "0.999"
                                ),
                                .init("purchasePrice", "Purchase Price", .number, required: true),
                                .init("purchaseDate", "Purchase Date", .date, required: true),
                                .init("dealer", "Dealer", .text),
                                .init(
                                    "quantity", "Quantity", .integer, required: true, initial: "1"
                                ),
                                .init("notes", "Notes", .multiline),
                            ], createPath: "api/gold", updatePath: "api/gold/{id}",
                            deletePath: "api/gold/{id}",
                            actions: [
                                .init(
                                    id: "receipt", title: "View receipt",
                                    path: "api/gold/{id}/receipt", method: "GET", response: "pdf"
                                ),
                                .init(
                                    id: "upload-receipt", title: "Attach receipt",
                                    path: "api/gold/{id}/receipt?filename={filename}",
                                    response: "upload"
                                ),
                                .init(
                                    id: "remove-receipt", title: "Remove receipt",
                                    path: "api/gold/{id}/receipt", method: "DELETE",
                                    destructive: true
                                ),
                            ]
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "property", title: "Property", symbol: "house", group: "Finance",
            resources: [
                .init(
                    id: "property", title: "Properties", path: "api/property",
                    collections: [
                        .init(
                            id: "entries", title: "Properties", path: "entries",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init(
                                    "type", "Type",
                                    .choices(["primary", "rental", "land", "commercial", "other"]),
                                    required: true, initial: "other"
                                ),
                                .init("address", "Address", .text, required: true),
                                .init("acreage", "Acreage", .number),
                                .init("squareFeet", "Square Feet", .number),
                                .init("purchaseDate", "Purchase Date", .date, required: true),
                                .init("purchasePrice", "Purchase Price", .number, required: true),
                                .init("currentValue", "Current Value", .number, required: true),
                                .init("annualPropertyTax", "Annual Property Tax", .number),
                                .init("mortgage.lender", "Lender", .text),
                                .init("mortgage.balance", "Balance", .number),
                                .init("mortgage.rate", "Mortgage APR (%)", .percentage),
                                .init("mortgage.monthlyPayment", "Monthly Payment", .number),
                                .init("notes", "Notes", .multiline),
                            ], createPath: "api/property", updatePath: "api/property/{id}",
                            deletePath: "api/property/{id}"
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "income", title: "Income", symbol: "dollarsign.circle", group: "Finance",
            resources: [
                .init(
                    id: "income", title: "Income Sources", path: "api/income",
                    collections: [
                        .init(
                            id: "sources", title: "Income Sources", path: "sources",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("amount", "Amount", .number, required: true),
                                .init(
                                    "frequency", "Frequency",
                                    .choices([
                                        "monthly", "biweekly", "weekly", "quarterly", "annually",
                                    ]), required: true, initial: "monthly"
                                ),
                                .init("taxable", "Taxable", .boolean, initial: "true"),
                                .init("entity", "Entity", .reference("entities")),
                                .init("notes", "Notes", .multiline),
                            ], createPath: "api/income", updatePath: "api/income/{id}",
                            deletePath: "api/income/{id}"
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "debts", title: "Debts", symbol: "creditcard", group: "Finance",
            resources: [
                .init(
                    id: "liabilities", title: "Liabilities", path: "api/liabilities",
                    collections: [
                        .init(
                            id: "entries", title: "Liabilities", path: "entries",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("lender", "Lender", .text),
                                .init(
                                    "type", "Type",
                                    .choices([
                                        "equipment-loan", "auto-loan", "personal-loan",
                                        "student-loan", "mortgage", "construction-loan",
                                        "credit-line", "other",
                                    ]), required: true, initial: "other"
                                ),
                                .init("originalBalance", "Original Balance", .number),
                                .init("balance", "Balance", .number, required: true),
                                .init("rate", "APR (%)", .percentage, required: true),
                                .init("monthlyPayment", "Monthly Payment", .number, required: true),
                                .init("termMonths", "Term Months", .integer),
                                .init("startDate", "Start Date", .date),
                                .init("payoffDate", "Payoff Date", .date),
                                .init("entity", "Entity", .reference("entities")),
                                .init("notes", "Notes", .multiline),
                            ], createPath: "api/liabilities", updatePath: "api/liabilities/{id}",
                            deletePath: "api/liabilities/{id}"
                        ),
                    ]
                ),
                .init(
                    id: "debt-snapshot", title: "Debt Service",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
            ], yearScoped: true
        ),
        .init(
            id: "strategy", title: "Strategy", symbol: "target", group: "Finance",
            resources: [
                .init(
                    id: "strategy", title: "Strategy Notes", path: "api/strategy",
                    collections: [
                        .init(
                            id: "entries", title: "Entries", path: "entries",
                            deletePath: "api/strategy/{id}"
                        ),
                    ],
                    actions: [
                        .init(
                            id: "add-strategy", title: "Save strategy", path: "api/strategy",
                            fields: [
                                .init("title", "Title", .text, required: true),
                                .init("body", "Body", .multiline, required: true),
                                .init("author", "Author", .text, initial: "DocVault iOS"),
                            ]
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "quant", title: "Quant", symbol: "chart.xyaxis.line", group: "Finance",
            resources: [
                .init(id: "quant-overview", title: "Overview", path: "api/quant/snapshots"),
                .init(
                    id: "quant-snapshots", title: "Snapshots", path: "api/quant/snapshots",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-cycle-presidential", title: "Cycle · Presidential",
                    path: "api/quant/cycle/presidential",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-business-cycle", title: "Macro · Business Cycle",
                    path: "api/quant/macro/business-cycle",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-calendar", title: "Macro · Calendar",
                    path: "api/quant/macro/calendar",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-inflation", title: "Macro · Inflation",
                    path: "api/quant/macro/inflation",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-financial-conditions", title: "Macro · Financial Conditions",
                    path: "api/quant/macro/financial-conditions",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-housing", title: "Macro · Housing",
                    path: "api/quant/macro/housing",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-gdp-growth", title: "Macro · Gdp Growth",
                    path: "api/quant/macro/gdp-growth",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-commodities", title: "Tradfi · Commodities",
                    path: "api/quant/tradfi/commodities",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-vix-term", title: "Tradfi · Vix Term",
                    path: "api/quant/tradfi/vix-term",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-global-markets", title: "Tradfi · Global Markets",
                    path: "api/quant/tradfi/global-markets",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-drawdown", title: "Btc · Drawdown",
                    path: "api/quant/btc/drawdown",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-fear-greed", title: "Btc · Fear Greed",
                    path: "api/quant/btc/fear-greed",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-flippening", title: "Btc · Flippening",
                    path: "api/quant/btc/flippening",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-real-rates", title: "Macro · Real Rates",
                    path: "api/quant/macro/real-rates",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-hash-rate", title: "Btc · Hash Rate",
                    path: "api/quant/btc/hash-rate",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-running-roi", title: "Running Roi", path: "api/quant/running-roi",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-jobs", title: "Macro · Jobs", path: "api/quant/macro/jobs",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-fed-policy", title: "Macro · Fed Policy",
                    path: "api/quant/macro/fed-policy",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-dashboard", title: "Macro · Dashboard",
                    path: "api/quant/macro/dashboard",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-macro-yield-curve", title: "Macro · Yield Curve",
                    path: "api/quant/macro/yield-curve",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-sp500-risk-metric", title: "Tradfi · Sp500 Risk Metric",
                    path: "api/quant/tradfi/sp500-risk-metric",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-midterm-drawdowns", title: "Tradfi · Midterm Drawdowns",
                    path: "api/quant/tradfi/midterm-drawdowns",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-shiller-valuation", title: "Tradfi · Shiller Valuation",
                    path: "api/quant/tradfi/shiller-valuation",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-predictions", title: "Predictions", path: "api/quant/predictions",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-tradfi-sectors-rotation", title: "Tradfi · Sectors · Rotation",
                    path: "api/quant/tradfi/sectors/rotation",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-altcoin-season", title: "Btc · Altcoin Season",
                    path: "api/quant/btc/altcoin-season",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-derivatives", title: "Btc · Derivatives",
                    path: "api/quant/btc/derivatives",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-dominance", title: "Btc · Dominance",
                    path: "api/quant/btc/dominance",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-log-regression", title: "Btc · Log Regression",
                    path: "api/quant/btc/log-regression",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "quant-btc-kronos", title: "Btc · Kronos", path: "api/quant/btc/kronos",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh market data", path: "api/quant/refresh"
                        ),
                    ]
                ),
                .init(id: "quant-tickers", title: "Research Tickers", path: "api/research"),
                researchInbox("quant-research", domain: .finance),
            ]
        ),
        .init(
            id: "tax-year", title: "Tax Year", symbol: "doc.plaintext", group: "Work & taxes",
            resources: [
                .init(
                    id: "tax-summary", title: "Tax Summary", path: "api/tax-summary/{year}",
                    actions: [
                        .init(
                            id: "parse-all", title: "Parse unparsed documents",
                            path: "api/parse-all/{entity}/{year}?unparsed=true"
                        ),
                        .init(
                            id: "export", title: "Export CPA package",
                            path: "api/download/cpa-package",
                            fields: [
                                .init("entity", "Entity", .reference("entities"), required: true),
                                .init("year", "Year", .integer, required: true),
                            ], response: "download"
                        ),
                    ]
                ),
                .init(
                    id: "tax-analytics", title: "Analytics",
                    path: "api/analytics/quick-stats/{entity}/{year}"
                ),
                .init(
                    id: "financial-snapshot", title: "Financial Summary",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "business-docs", title: "Business Documents", symbol: "briefcase",
            group: "Work & taxes",
            resources: [
                .init(id: "business-docs", title: "Documents", path: "api/business-docs/{entity}"),
            ], entityScoped: true
        ),
        .init(
            id: "all-files", title: "All Files", symbol: "folder", group: "Work & taxes",
            resources: [.init(id: "all-files", title: "Documents", path: "api/files-all/{entity}")],
            entityScoped: true
        ),
        .init(
            id: "tn-tax", title: "Tennessee Tax", symbol: "building.columns", group: "Work & taxes",
            resources: [
                .init(
                    id: "tn-calculator", title: "FAE170 Worksheet",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
                .init(
                    id: "assets", title: "Business Assets", path: "api/assets/{entity}",
                    collections: [
                        .init(
                            id: "assets", title: "Assets", path: "assets",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("value", "Value", .number, required: true),
                            ], createPath: "api/assets/{entity}", updatePath: "api/assets/{entity}",
                            deletePath: "api/assets/{entity}", wholeList: true
                        ),
                    ]
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "solo-401k", title: "Solo 401(k)", symbol: "banknote", group: "Work & taxes",
            resources: [
                .init(
                    id: "solo-calculator", title: "Contribution Calculator",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
                .init(
                    id: "contributions", title: "Contributions",
                    path: "api/contributions/all/{year}",
                    collections: [
                        .init(
                            id: "contributions", title: "Contributions", path: "contributions",
                            fields: [
                                .init("date", "Date", .date, required: true),
                                .init("amount", "Amount", .number, required: true),
                                .init(
                                    "type", "Type", .choices(["employee", "employer"]),
                                    required: true, initial: "employee"
                                ),
                            ], createPath: "api/contributions/all/{year}",
                            updatePath: "api/contributions/all/{year}",
                            deletePath: "api/contributions/all/{year}", wholeList: true
                        ),
                    ]
                ),
                .init(
                    id: "retirement-snapshot", title: "Income & Limits",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "estimated-tax", title: "Estimated Tax", symbol: "calendar.badge.clock",
            group: "Work & taxes",
            resources: [
                .init(
                    id: "estimated-tax", title: "Payments",
                    path: "api/estimated-taxes/{entity}/{year}",
                    collections: [
                        .init(
                            id: "payments", title: "Payments", path: "payments",
                            fields: [
                                .init("date", "Date", .date, required: true),
                                .init("quarter", "Quarter", .integer, required: true, initial: "1"),
                                .init("amount", "Amount", .number, required: true),
                            ], createPath: "api/estimated-taxes/{entity}/{year}",
                            updatePath: "api/estimated-taxes/{entity}/{year}",
                            deletePath: "api/estimated-taxes/{entity}/{year}", wholeList: true
                        ),
                    ],
                    editFields: [
                        .init("config.annualTarget", "Annual Target", .number, required: true),
                    ], editPath: "api/estimated-taxes/{entity}/{year}"
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "federal-tax", title: "Federal Tax", symbol: "doc.text", group: "Work & taxes",
            resources: [
                .init(
                    id: "federal-tax", title: "Filed Return", path: "api/federal-tax/{year}",
                    editFields: [
                        .init("filed", "Filed", .boolean), .init("filedDate", "Filed Date", .date),
                        .init(
                            "income.wages", "Income · Wages", .number, required: true, initial: "0"
                        ),
                        .init(
                            "income.interestIncome", "Income · Interest Income", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.dividendIncome", "Income · Dividend Income", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.businessIncome", "Income · Business Income", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.rentalK1Income", "Income · Rental K1Income", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.capitalGains", "Income · Capital Gains", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.taxableIRA", "Income · Taxable Ira", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "income.taxablePension", "Income · Taxable Pension", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "income.taxableSS", "Income · Taxable Ss", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "income.unemployment", "Income · Unemployment", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "income.otherIncome", "Income · Other Income", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "income.totalIncome", "Income · Total Income", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "adjustments.iraDeduction", "Adjustments · Ira Deduction", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.educatorExpenses", "Adjustments · Educator Expenses",
                            .number, required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.hsaDeduction", "Adjustments · Hsa Deduction", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.studentLoanInterest",
                            "Adjustments · Student Loan Interest", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "adjustments.seTaxDeduction", "Adjustments · Se Tax Deduction", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.sepDeduction", "Adjustments · Sep Deduction", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.otherAdjustments", "Adjustments · Other Adjustments",
                            .number, required: true, initial: "0"
                        ),
                        .init(
                            "adjustments.totalAdjustments", "Adjustments · Total Adjustments",
                            .number, required: true, initial: "0"
                        ),
                        .init("agi", "Agi · Agi", .number, required: true, initial: "0"),
                        .init(
                            "deductions.standardOrItemized", "Deductions · Standard Or Itemized",
                            .number, required: true, initial: "0"
                        ),
                        .init(
                            "deductions.qbiDeduction", "Deductions · Qbi Deduction", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "deductions.totalDeductions", "Deductions · Total Deductions", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "taxableIncome", "Taxableincome · Taxable Income", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "tax.incomeTax", "Tax · Income Tax", .number, required: true,
                            initial: "0"
                        ),
                        .init("tax.amt", "Tax · Amt", .number, required: true, initial: "0"),
                        .init("tax.seTax", "Tax · Se Tax", .number, required: true, initial: "0"),
                        .init(
                            "tax.additionalTaxQualifiedPlans",
                            "Tax · Additional Tax Qualified Plans", .number, required: true,
                            initial: "0"
                        ),
                        .init("tax.niit", "Tax · Niit", .number, required: true, initial: "0"),
                        .init(
                            "tax.totalTax", "Tax · Total Tax", .number, required: true, initial: "0"
                        ),
                        .init(
                            "credits.foreignTaxCredit", "Credits · Foreign Tax Credit", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "credits.childCareCredit", "Credits · Child Care Credit", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "credits.elderlyCredit", "Credits · Elderly Credit", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "credits.educationCredit", "Credits · Education Credit", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "credits.retirementSavingsCredit",
                            "Credits · Retirement Savings Credit", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "credits.childTaxCredit", "Credits · Child Tax Credit", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "credits.totalCredits", "Credits · Total Credits", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "payments.incomeTaxWithheld", "Payments · Income Tax Withheld", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "payments.eic", "Payments · Eic", .number, required: true, initial: "0"
                        ),
                        .init(
                            "payments.additionalChildTaxCredit",
                            "Payments · Additional Child Tax Credit", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "payments.excessSocialSecurity", "Payments · Excess Social Security",
                            .number, required: true, initial: "0"
                        ),
                        .init(
                            "payments.estimatedPayments", "Payments · Estimated Payments", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "payments.totalPayments", "Payments · Total Payments", .number,
                            required: true, initial: "0"
                        ),
                        .init(
                            "balance.amountOwed", "Balance · Amount Owed", .number, required: true,
                            initial: "0"
                        ),
                        .init(
                            "balance.underpaymentPenalty", "Balance · Underpayment Penalty",
                            .number, required: true, initial: "0"
                        ),
                        .init(
                            "balance.totalOwed", "Balance · Total Owed", .number, required: true,
                            initial: "0"
                        ),
                    ]
                ),
                .init(
                    id: "federal-snapshot", title: "Projected Return",
                    path: "api/financial-snapshot/{year}?format=json"
                ),
            ], yearScoped: true
        ),
        .init(
            id: "sales", title: "Sales", symbol: "cart", group: "Work & taxes",
            resources: [
                .init(
                    id: "sales", title: "Sales & Products", path: "api/sales",
                    collections: [
                        .init(
                            id: "sales", title: "Sales", path: "sales",
                            fields: [
                                .init("person", "Person", .text, required: true),
                                .init(
                                    "productId", "Product Id", .reference("products"),
                                    required: true
                                ),
                                .init(
                                    "quantity", "Quantity", .integer, required: true, initial: "1"
                                ),
                                .init("date", "Date", .date, required: true),
                                .init("entity", "Entity", .reference("entities")),
                            ], createPath: "api/sales", updatePath: "api/sales/{id}",
                            deletePath: "api/sales/{id}"
                        ),
                        .init(
                            id: "products", title: "Products", path: "products",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("price", "Price", .number, required: true),
                            ], createPath: "api/sales/products",
                            updatePath: "api/sales/products/{id}",
                            deletePath: "api/sales/products/{id}"
                        ),
                    ]
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "mileage", title: "Mileage", symbol: "car", group: "Work & taxes",
            resources: [
                .init(
                    id: "mileage", title: "Trips & Vehicles", path: "api/mileage",
                    collections: [
                        .init(
                            id: "entries", title: "Trips", path: "entries",
                            fields: [
                                .init("date", "Date", .date, required: true),
                                .init(
                                    "vehicleId", "Vehicle Id", .reference("vehicles"),
                                    required: true
                                ),
                                .init("odometerStart", "Odometer Start", .number),
                                .init("odometerEnd", "Odometer End", .number),
                                .init("tripMiles", "Trip Miles", .number),
                                .init("gallons", "Gallons", .number),
                                .init("totalCost", "Total Cost", .number),
                                .init("purpose", "Purpose", .text),
                                .init("entity", "Entity", .reference("entities")),
                            ], createPath: "api/mileage", updatePath: "api/mileage/{id}",
                            deletePath: "api/mileage/{id}"
                        ),
                        .init(
                            id: "vehicles", title: "Vehicles", path: "vehicles",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("year", "Year", .integer), .init("make", "Make", .text),
                                .init("model", "Model", .text),
                            ], createPath: "api/mileage/vehicles",
                            updatePath: "api/mileage/vehicles/{id}",
                            deletePath: "api/mileage/vehicles/{id}"
                        ),
                        .init(
                            id: "savedAddresses", title: "Saved Addresses", path: "savedAddresses",
                            fields: [
                                .init("label", "Label", .text, required: true),
                                .init("formatted", "Formatted", .text, required: true),
                                .init("lat", "Lat", .number, required: true),
                                .init("lon", "Lon", .number, required: true),
                            ], createPath: "api/mileage/addresses",
                            updatePath: "api/mileage/addresses/{id}",
                            deletePath: "api/mileage/addresses/{id}"
                        ),
                    ], editFields: [.init("irsRate", "Irs Rate", .number, required: true)],
                    editPath: "api/mileage/settings"
                ),
            ], entityScoped: true, yearScoped: true
        ),
        .init(
            id: "timesheet", title: "Time Tracking", symbol: "clock", group: "Work & taxes",
            resources: [
                .init(
                    id: "timesheet", title: "Entries & Billing", path: "api/timesheet",
                    collections: [
                        .init(
                            id: "entries", title: "Time Entries", path: "entries",
                            fields: [
                                .init(
                                    "projectId", "Project Id", .reference("projects"),
                                    required: true
                                ), .init("date", "Date", .date, required: true),
                                .init("start", "Start", .time), .init("end", "End", .time),
                                .init("durationMinutes", "Duration Minutes", .integer),
                                .init("subClientId", "Sub Client Id", .reference("subClients")),
                                .init("description", "Description", .multiline),
                                .init("hourlyRate", "Hourly Rate", .number),
                                .init("billable", "Billable", .boolean, initial: "true"),
                            ], createPath: "api/timesheet/entries",
                            updatePath: "api/timesheet/entries/{id}",
                            deletePath: "api/timesheet/entries/{id}"
                        ),
                        .init(
                            id: "clients", title: "Clients", path: "clients",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init(
                                    "currency", "Currency", .text, required: true, initial: "USD"
                                ),
                                .init("email", "Email", .text),
                                .init("dueDays", "Due Days", .integer),
                                .init(
                                    "autoFileEntityId", "Auto File Entity Id",
                                    .reference("entities")
                                ),
                                .init("archived", "Archived", .boolean),
                                .init("color", "Color", .text),
                                .init(
                                    "defaultTemplateId", "Default Template Id",
                                    .reference("templates")
                                ),
                            ], createPath: "api/timesheet/clients",
                            updatePath: "api/timesheet/clients/{id}",
                            deletePath: "api/timesheet/clients/{id}"
                        ),
                        .init(
                            id: "projects", title: "Projects", path: "projects",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init(
                                    "clientId", "Client Id", .reference("clients"), required: true
                                ),
                                .init("hourlyRate", "Hourly Rate", .number, required: true),
                                .init("minimumInvoice", "Minimum Invoice", .number),
                                .init("emailTo", "Email To", .text),
                                .init("emailFrom", "Email From", .text),
                                .init("emailSubject", "Email Subject", .text),
                                .init("emailBody", "Email Body", .multiline),
                                .init("archived", "Archived", .boolean),
                                .init(
                                    "subClients", "Sub Clients",
                                    .records([
                                        .init("name", "Name", .text, required: true),
                                        .init("archived", "Archived", .boolean),
                                    ])
                                ), .init("color", "Color", .text),
                            ], createPath: "api/timesheet/projects",
                            updatePath: "api/timesheet/projects/{id}",
                            deletePath: "api/timesheet/projects/{id}"
                        ),
                        .init(
                            id: "templates", title: "Invoice Templates", path: "templates",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("title", "Title", .text, initial: "Invoice"),
                                .init("company", "Company", .text),
                                .init("address", "Address", .strings),
                                .init("contact", "Contact", .strings),
                                .init("paymentTerms", "Payment Terms", .multiline),
                                .init("paymentDetails", "Payment Details", .strings),
                                .init("dueDays", "Due Days", .integer, initial: "14"),
                                .init("vat", "Vat", .number, initial: "0"),
                                .init(
                                    "descriptionStyle", "Description Style",
                                    .choices(["wrap", "truncate"]), initial: "wrap"
                                ),
                            ], createPath: "api/timesheet/templates",
                            updatePath: "api/timesheet/templates/{id}",
                            deletePath: "api/timesheet/templates/{id}"
                        ),
                    ]
                ),
                .init(id: "billing-invoices", title: "Invoices", path: "api/timesheet"),
                .init(
                    id: "weekly-report", title: "Weekly Report",
                    path: "api/timesheet/weekly-report/config",
                    actions: [
                        .init(
                            id: "preview", title: "Preview report",
                            path: "api/timesheet/weekly-report/preview?end={end}", method: "GET",
                            fields: [.init("end", "End", .date, required: true)]
                        ),
                        .init(
                            id: "send", title: "Send report",
                            path: "api/timesheet/weekly-report/send",
                            fields: [.init("end", "End", .date)]
                        ),
                    ],
                    editFields: [
                        .init("enabled", "Enabled", .boolean),
                        .init(
                            "cadence", "Cadence", .choices(["weekly", "biweekly", "monthly"]),
                            initial: "weekly"
                        ), .init("day", "Day", .integer),
                        .init("hour", "Hour", .integer), .init("timezone", "Timezone", .text),
                        .init("windowDays", "Window Days", .integer), .init("to", "To", .text),
                        .init("clientIds", "Client Ids", .references("clients")),
                        .init("projectIds", "Project Ids", .references("projects")),
                        .init(
                            "categories", "Categories",
                            .records([
                                .init("name", "Name", .text, required: true),
                                .init("keywords", "Keywords", .strings),
                            ])
                        ),
                    ], dataPath: "config"
                ),
                .init(
                    id: "time-analytics", title: "Hours & Billing Analytics", path: "api/timesheet"
                ),
            ]
        ),
        .init(
            id: "calendar", title: "Calendar", symbol: "calendar", group: "Everyday",
            resources: [
                .init(
                    id: "calendar-month", title: "Month & Agenda", path: "api/calendar/occurrences"
                ),
                .init(
                    id: "calendar-events", title: "Events & Tasks", path: "api/calendar/events",
                    collections: [
                        .init(
                            id: "events", title: "Events", path: "events",
                            fields: [
                                .init(
                                    "kind", "Kind", .choices(["birthday", "task", "event"]),
                                    required: true, initial: "task"
                                ),
                                .init("title", "Title", .text, required: true),
                                .init("date", "Date", .date, required: true),
                                .init("endDate", "End Date", .date),
                                .init("birthYear", "Birth Year", .integer),
                                .init("entityId", "Entity Id", .reference("entities")),
                                .init("recurrence.interval", "Interval", .integer),
                                .init(
                                    "recurrence.unit", "Unit",
                                    .choices(["day", "week", "month", "year"])
                                ),
                                .init(
                                    "recurrence.anchor", "Anchor",
                                    .choices(["fixed", "afterCompletion"])
                                ),
                                .init(
                                    "status", "Status", .choices(["active", "archived"]),
                                    initial: "active"
                                ), .init("notes", "Notes", .multiline),
                            ], createPath: "api/calendar/events",
                            updatePath: "api/calendar/events/{id}",
                            deletePath: "api/calendar/events/{id}",
                            actions: [
                                .init(
                                    id: "complete", title: "Complete occurrence",
                                    path: "api/calendar/events/{id}/complete",
                                    fields: [
                                        .init(
                                            "occurrenceDate", "Occurrence Date", .date,
                                            required: true
                                        ),
                                        .init("completedOn", "Completed On", .date),
                                        .init("skipped", "Skipped", .boolean),
                                        .init("notes", "Notes", .multiline),
                                    ]
                                ),
                                .init(
                                    id: "uncomplete", title: "Reopen occurrence",
                                    path: "api/calendar/events/{id}/uncomplete",
                                    fields: [
                                        .init(
                                            "occurrenceDate", "Occurrence Date", .date,
                                            required: true
                                        ),
                                    ]
                                ),
                            ]
                        ),
                    ]
                ),
                .init(id: "occurrences", title: "Upcoming", path: "api/calendar/occurrences"),
                .init(id: "weather", title: "Weather", path: "api/weather/forecast"),
                .init(
                    id: "todos", title: "To-do List", path: "api/todos",
                    collections: [
                        .init(
                            id: "todos", title: "To-dos", path: "todos",
                            fields: [
                                .init("title", "Title", .text, required: true),
                                .init(
                                    "status", "Status", .choices(["pending", "completed"]),
                                    initial: "pending"
                                ),
                            ], createPath: "api/todos", updatePath: "api/todos/{id}",
                            deletePath: "api/todos/{id}"
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "health", title: "Health", symbol: "heart", group: "Health",
            resources: [
                .init(
                    id: "health-people", title: "People", path: "api/health/people",
                    collections: [
                        .init(
                            id: "people", title: "People", path: "people",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("color", "Color", .text), .init("icon", "Icon", .text),
                            ], createPath: "api/health/people",
                            updatePath: "api/health/people/{id}",
                            deletePath: "api/health/people/{id}?mode=archive", deleteTitle: "Archive", updateMethod: "PATCH",
                            actions: [.init(id: "delete-person", title: "Delete person permanently", path: "api/health/people/{id}?mode=delete", method: "DELETE", destructive: true)]
                        ),
                    ]
                ),
                .init(
                    id: "health-overview", title: "Overview",
                    path: "api/health-snapshot?format=json"
                ),
            ]
        ),
        .init(
            id: "health-activity", title: "Activity", symbol: "figure.walk", group: "Health",
            resources: [
                .init(
                    id: "health-activity", title: "Activity",
                    path: "api/health/{person}/snapshot/activity"
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-heart", title: "Heart", symbol: "heart", group: "Health",
            resources: [
                .init(
                    id: "health-heart", title: "Heart", path: "api/health/{person}/snapshot/heart"
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-sleep", title: "Sleep", symbol: "bed.double", group: "Health",
            resources: [
                .init(
                    id: "health-sleep", title: "Sleep", path: "api/health/{person}/snapshot/sleep"
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-workouts", title: "Workouts", symbol: "figure.run", group: "Health",
            resources: [
                .init(
                    id: "health-workouts", title: "Workouts",
                    path: "api/health/{person}/snapshot/workouts"
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-body", title: "Body", symbol: "figure.stand", group: "Health",
            resources: [
                .init(id: "health-body", title: "Body", path: "api/health/{person}/snapshot/body"),
            ], personScoped: true
        ),
        .init(
            id: "health-records", title: "Medical Records", symbol: "cross.case", group: "Health",
            resources: [
                .init(
                    id: "clinical", title: "Clinical Records", path: "api/health/{person}/clinical"
                ),
                .init(
                    id: "health-exports", title: "Exports", path: "api/health/{person}/exports",
                    collections: [
                        .init(
                            id: "exports", title: "Exports", path: "exports",
                            detailPath: "api/health/{person}/summary/{filename}",
                            actions: [
                                .init(
                                    id: "parse", title: "Parse export",
                                    path: "api/health/{person}/parse-export",
                                    fields: [.init("filename", "Filename", .text, required: true)]
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "upload-export", title: "Import Apple Health export",
                            path: "api/health/{person}/upload-export?filename={filename}",
                            response: "upload"
                        ),
                    ]
                ),
                .init(
                    id: "health-sync", title: "Sync Setup",
                    path: "api/health/{person}/shortcut-config"
                ),
                .init(
                    id: "health-voice", title: "Voice Profile", path: "api/health/{person}/voice",
                    collections: [
                        .init(
                            id: "clips", title: "Clips", path: "clips",
                            deletePath: "api/health/{person}/voice/clips/{filename}",
                            actions: [
                                .init(
                                    id: "play", title: "Play clip",
                                    path: "api/health/{person}/voice/clips/{filename}",
                                    method: "GET", response: "audio"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "upload", title: "Import voice clip",
                            path: "api/health/{person}/voice/clips?filename={filename}",
                            response: "upload"
                        ),
                        .init(
                            id: "test", title: "Test voice", path: "api/health/{person}/voice/test",
                            fields: [.init("text", "Text", .multiline)], response: "audio"
                        ),
                    ]
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-dna", title: "DNA & Ancestry", symbol: "person.text.rectangle",
            group: "Health",
            resources: [
                .init(
                    id: "dna", title: "Genetic Traits", path: "api/health/{person}/dna",
                    actions: [
                        .init(
                            id: "upload-dna", title: "Import DNA file",
                            path: "api/health/{person}/dna/upload?filename={filename}",
                            response: "upload"
                        ),
                        .init(
                            id: "delete-dna", title: "Remove DNA", path: "api/health/{person}/dna",
                            method: "DELETE", destructive: true
                        ),
                    ]
                ),
                .init(
                    id: "ancestry", title: "Ancestry", path: "api/health/{person}/ancestry",
                    actions: [
                        .init(
                            id: "upload-ancestry", title: "Import ancestry report",
                            path: "api/health/{person}/ancestry/upload?filename={filename}",
                            response: "upload"
                        ),
                        .init(
                            id: "delete", title: "Remove ancestry report",
                            path: "api/health/{person}/ancestry", method: "DELETE",
                            destructive: true
                        ),
                    ]
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-nutrition", title: "Nutrition", symbol: "fork.knife", group: "Health",
            resources: [
                .init(
                    id: "nutrition", title: "Supplements & Foods",
                    path: "api/health/{person}/nutrition",
                    collections: [
                        .init(
                            id: "entries", title: "Products", path: "entries",
                            fields: NativeNutritionFields.edit, updatePath: "api/health/{person}/nutrition/{id}",
                            deletePath: "api/health/{person}/nutrition/{id}", updateMethod: "PATCH",
                            detailPath: "api/health/{person}/nutrition/{id}",
                            actions: [
                                .init(
                                    id: "reparse", title: "Reparse label",
                                    path: "api/health/{person}/nutrition/{id}/reparse"
                                ),
                                .init(
                                    id: "front-image", title: "Replace product photo",
                                    path:
                                    "api/health/{person}/nutrition/{id}/replace-image?filename={filename}&slot=primary",
                                    method: "PUT", response: "upload"
                                ),
                                .init(
                                    id: "facts-image", title: "Replace facts label",
                                    path:
                                    "api/health/{person}/nutrition/{id}/replace-image?filename={filename}&slot=facts",
                                    method: "PUT", response: "upload"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "upload-label", title: "Import label",
                            path: "api/health/{person}/nutrition/upload?filename={filename}",
                            response: "upload"
                        ),
                        .init(
                            id: "manual", title: "Add product",
                            path: "api/health/{person}/nutrition",
                            fields: NativeNutritionFields.create
                        ),
                    ]
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-sickness", title: "Sickness", symbol: "bandage", group: "Health",
            resources: [
                .init(
                    id: "sickness", title: "Illness Log", path: "api/health/{person}/sickness",
                    collections: [
                        .init(
                            id: "logs", title: "Episodes", path: "logs",
                            fields: [
                                .init("title", "Title", .text, required: true),
                                .init("startDate", "Start Date", .date, required: true),
                                .init("endDate", "End Date", .date),
                                .init(
                                    "category", "Category",
                                    .choices([
                                        "cold", "flu", "covid", "allergies", "sinus", "stomach",
                                        "injury", "migraine", "other",
                                    ]), initial: "other"
                                ),
                                .init(
                                    "severity", "Severity",
                                    .choices(["mild", "moderate", "severe"]), initial: "mild"
                                ),
                                .init("symptoms", "Symptoms", .strings),
                                .init("notes", "Notes", .multiline),
                                .init(
                                    "medications", "Medications",
                                    .records([
                                        .init("name", "Name", .text, required: true),
                                        .init("dose", "Dose", .text), .init("time", "Time", .text),
                                    ])
                                ),
                            ], createPath: "api/health/{person}/sickness",
                            updatePath: "api/health/{person}/sickness/{id}",
                            deletePath: "api/health/{person}/sickness/{id}", updateMethod: "PATCH"
                        ),
                    ]
                ),
            ], personScoped: true
        ),
        .init(
            id: "health-analysis", title: "Health Analysis", symbol: "waveform.path.ecg",
            group: "Health",
            resources: [
                .init(
                    id: "health-analysis", title: "Analysis Notes", path: "api/health-analysis",
                    collections: [
                        .init(
                            id: "entries", title: "Analysis", path: "entries",
                            fields: [
                                .init("title", "Title", .text, required: true),
                                .init("body", "Body", .multiline, required: true),
                                .init("personId", "Person Id", .reference("people")),
                            ], createPath: "api/health-analysis",
                            deletePath: "api/health-analysis/{id}"
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "health-research", title: "Health Research", symbol: "books.vertical",
            group: "Health",
            resources: [
                researchInbox("research-health", domain: .health),
            ]
        ),
        .init(
            id: "deep-research", title: "Deep Research", symbol: "sparkle.magnifyingglass",
            group: "Knowledge",
            resources: [
                .init(
                    id: "deep-research", title: "Reports", path: "api/deep-research",
                    collections: [
                        .init(
                            id: "runs", title: "Reports", path: "runs",
                            deletePath: "api/deep-research/{id}",
                            detailPath: "api/deep-research/{id}",
                            actions: [
                                .init(
                                    id: "export", title: "Export report",
                                    path: "api/deep-research/{id}/report.html", method: "GET",
                                    response: "html"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "run", title: "Start research", path: "api/deep-research/run",
                            fields: [
                                .init("question", "Question", .multiline),
                                .init("maxSearches", "Max Searches", .integer, initial: "18"),
                                .init("attachments", "Attachments", .images, initial: "[]"),
                            ]
                        ),
                    ]
                ),
                researchInbox("research-quant", domain: .finance),
            ]
        ),
        .init(
            id: "daily-news", title: "Daily News", symbol: "newspaper", group: "Knowledge",
            resources: [
                .init(
                    id: "daily-news", title: "Editions", path: "api/daily-news",
                    collections: [
                        .init(
                            id: "editions", title: "Editions", path: "editions",
                            deletePath: "api/daily-news/{id}", detailPath: "api/daily-news/{id}",
                            actions: [
                                .init(
                                    id: "edition", title: "Open edition",
                                    path: "api/daily-news/{id}/edition.html", method: "GET",
                                    response: "html"
                                ),
                                .init(
                                    id: "narrate", title: "Generate narration",
                                    path: "api/daily-news/{id}/narrate"
                                ),
                                .init(
                                    id: "audio", title: "Play narration",
                                    path: "api/daily-news/{id}/audio", method: "GET",
                                    response: "audio"
                                ),
                                .init(
                                    id: "email", title: "Email edition",
                                    path: "api/daily-news/{id}/email"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "run", title: "Generate edition", path: "api/daily-news/run",
                            fields: [
                                .init(
                                    "editionType", "Edition Type", .choices(["daily", "weekly"]),
                                    required: true, initial: "daily"
                                ),
                            ]
                        ),
                        .init(
                            id: "themes", title: "Sample themes",
                            path: "api/daily-news/sample-themes",
                            fields: [
                                .init(
                                    "editionType", "Edition Type", .choices(["daily", "weekly"]),
                                    initial: "daily"
                                ),
                            ]
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "tech", title: "Tech", symbol: "desktopcomputer", group: "Knowledge",
            resources: [
                researchInbox("research-tech", domain: .tech),
            ]
        ),
        .init(
            id: "local-news", title: "Local News", symbol: "mappin.and.ellipse", group: "Knowledge",
            resources: [
                researchInbox("research-local", domain: .local),
            ]
        ),
        .init(
            id: "politics", title: "Politics", symbol: "globe.americas", group: "Knowledge",
            resources: [
                .init(
                    id: "politics-feed", title: "Activity Feed", path: "api/politics/feed",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                .init(id: "politics-research-links", title: "Research Radar", path: "api/research/politics-links"),
                .init(
                    id: "politics-trades", title: "Trades", path: "api/politics/trades",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "politics-clusters", title: "Trade Clusters", path: "api/politics/clusters",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "politics-backtest", title: "Backtest", path: "api/politics/backtest",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "politics-filings", title: "Filings", path: "api/politics/filings",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                .init(
                    id: "politics-top-spenders", title: "Top Spenders",
                    path: "api/politics/top-spenders",
                    actions: [
                        .init(
                            id: "refresh", title: "Refresh politics", path: "api/politics/refresh"
                        ),
                    ]
                ),
                researchInbox("research-politics", domain: .politics),
            ]
        ),
        .init(
            id: "predictions", title: "Predictions", symbol: "chart.bar", group: "Knowledge",
            resources: [
                .init(id: "predictions", title: "Prediction Markets", path: "api/quant/predictions"),
            ]
        ),
        .init(
            id: "chat", title: "Chat", symbol: "bubble.left.and.bubble.right", group: "Knowledge",
            resources: [.init(id: "chat-config", title: "Configuration", path: "api/chat/config")]
        ),
        .init(
            id: "chat-history", title: "Chat History", symbol: "text.bubble", group: "Knowledge",
            resources: [.init(id: "chat-history", title: "Conversations", path: "api/chat/threads")]
        ),
        .init(
            id: "external-sources", title: "External Sources", symbol: "arrow.down.circle",
            group: "Manage",
            resources: [
                .init(
                    id: "external-sources", title: "Repositories", path: "api/external-sources",
                    collections: [
                        .init(
                            id: "repos", title: "Repositories", path: "repos",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("url", "Url", .text, required: true),
                                .init("branch", "Branch", .text),
                                .init("enabled", "Enabled", .boolean, initial: "true"),
                            ], createPath: "api/external-sources",
                            deletePath: "api/external-sources/{id}",
                            actions: [
                                .init(
                                    id: "sync", title: "Sync repository",
                                    path: "api/external-sources/{id}/sync"
                                ),
                                .init(
                                    id: "files", title: "Browse source files",
                                    path: "api/external-sources/{id}/files", method: "GET"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "token", title: "Set GitHub token",
                            path: "api/external-sources/token", method: "PUT",
                            fields: [.init("token", "Token", .secret)]
                        ),
                    ]
                ),
            ]
        ),
        .init(
            id: "settings", title: "Server Settings", symbol: "gearshape", group: "Manage",
            resources: [
                .init(
                    id: "entities", title: "Entities", path: "api/entities",
                    collections: [
                        .init(
                            id: "entities", title: "Entities", path: "entities",
                            fields: [
                                .init("id", "Id", .text, required: true),
                                .init("name", "Name", .text, required: true),
                                .init("color", "Color", .text),
                                .init("type", "Type", .choices(["tax", "docs"]), initial: "tax"),
                                .init("taxRate", "Tax Rate", .number),
                            ], createPath: "api/entities", updatePath: "api/entities/{id}",
                            deletePath: "api/entities/{id}"
                        ),
                    ]
                ),
                .init(
                    id: "ai", title: "AI & Chat", path: "api/settings",
                    actions: [
                        .init(
                            id: "clear-keys", title: "Remove saved credentials",
                            path: "api/settings",
                            fields: [
                                .init(
                                    "clearAnthropicKey", "Clear Anthropic Key", .boolean,
                                    initial: "true"
                                ),
                                .init(
                                    "clearAnthropicAuthToken", "Clear Anthropic Auth Token",
                                    .boolean, initial: "true"
                                ),
                                .init(
                                    "clearOpenaiApiKey", "Clear Openai Api Key", .boolean,
                                    initial: "true"
                                ),
                            ], destructive: true
                        ),
                    ],
                    editFields: [
                        .init("anthropicKey", "Anthropic Key", .secret),
                        .init("anthropicAuthToken", "Anthropic Auth Token", .secret),
                        .init("claudeModel", "Claude Model", .text),
                        .init("openaiApiKey", "Openai Api Key", .secret),
                        .init("openaiBaseUrl", "Openai Base Url", .text),
                        .init("chat.mode", "Mode", .choices(["agent", "api"])),
                        .init("chat.backend", "Backend", .choices(["claude", "codex"])),
                        .init(
                            "chat.apiModel.provider", "Provider", .choices(["anthropic", "openai"])
                        ),
                        .init("chat.apiModel.model", "Model", .text),
                        .init("chat.apiModel.effort", "API Reasoning Effort", .choices(["minimal", "low", "medium", "high", "xhigh", "max"])),
                        .init(
                            "chat.claudeEffort", "Claude Effort",
                            .choices(["low", "medium", "high", "xhigh", "max"])
                        ),
                        .init("chat.codexModel", "Codex Model", .text),
                        .init(
                            "chat.codexEffort", "Codex Effort",
                            .choices(["minimal", "low", "medium", "high", "xhigh"])
                        ),
                        .init("chat.codexHome", "Codex Home", .text),
                        .init("chat.codexBinary", "Codex Binary", .text),
                        .init(
                            "modelRouting.parsing.provider", "Provider",
                            .choices(["anthropic", "openai"])
                        ),
                        .init("modelRouting.parsing.model", "Model", .text),
                        .init("modelRouting.parsing.effort", "Parsing Reasoning Effort", .choices(["minimal", "low", "medium", "high", "xhigh", "max"])),
                        .init("deepResearch.mode", "Mode", .choices(["agent", "api"])),
                        .init(
                            "deepResearch.agentBackend", "Agent Backend",
                            .choices(["claude", "codex"])
                        ),
                        .init(
                            "deepResearch.model.provider", "Provider",
                            .choices(["anthropic", "openai"])
                        ),
                        .init("deepResearch.model.model", "Model", .text),
                        .init("deepResearch.model.effort", "Research Reasoning Effort", .choices(["minimal", "low", "medium", "high", "xhigh", "max"])),
                        .init("dailyNews.mode", "Mode", .choices(["agent", "api"])),
                        .init(
                            "dailyNews.agentBackend", "Agent Backend",
                            .choices(["claude", "codex"])
                        ),
                        .init(
                            "dailyNews.model.provider", "Provider",
                            .choices(["anthropic", "openai"])
                        ),
                        .init("dailyNews.model.model", "Model", .text),
                        .init("dailyNews.model.effort", "News Reasoning Effort", .choices(["minimal", "low", "medium", "high", "xhigh", "max"])),
                        .init("dailyNews.title", "Title", .text),
                        .init("dailyNews.theme", "Theme", .text),
                        .init("dailyNews.headlineImage", "Headline Image", .boolean),
                        .init("dailyNews.imageModel", "Image Model", .text),
                        .init("dailyNews.narration.personId", "Person Id", .reference("people")),
                        .init("dailyNews.narration.defaultSpeed", "Default Speed", .number),
                        .init("dailyNews.narration.exaggeration", "Exaggeration", .number),
                        .init("dailyNews.narration.cfgWeight", "Cfg Weight", .number),
                    ], editMethod: "POST"
                ),
                .init(
                    id: "brain", title: "Brain", path: "api/brain",
                    actions: [
                        .init(
                            id: "append", title: "Append memory", path: "api/brain/append",
                            fields: [
                                .init("text", "Text", .multiline, required: true),
                                .init("tag", "Tag", .text),
                            ]
                        ),
                        .init(
                            id: "clear", title: "Clear brain", path: "api/brain", method: "DELETE",
                            destructive: true
                        ),
                    ], editFields: [.init("content", "Content", .multiline, required: true)]
                ),
                .init(
                    id: "skills", title: "Skills", path: "api/skills",
                    collections: [
                        .init(
                            id: "skills", title: "Skills", path: "skills",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("description", "Description", .text, required: true),
                                .init("instructions", "Instructions", .multiline, required: true),
                            ], updatePath: "api/skills/{name}", deletePath: "api/skills/{name}",
                            detailPath: "api/skills/{name}"
                        ),
                    ],
                    actions: [
                        .init(
                            id: "create", title: "Create skill", path: "api/skills/{name}",
                            method: "PUT",
                            fields: [
                                .init("name", "Name", .text, required: true),
                                .init("description", "Description", .text, required: true),
                                .init("instructions", "Instructions", .multiline, required: true),
                            ]
                        ),
                    ]
                ),
                .init(
                    id: "email", title: "Email", path: "api/settings",
                    actions: [
                        .init(id: "test", title: "Send test email", path: "api/email/test"),
                        .init(
                            id: "clear-keys", title: "Remove saved credentials",
                            path: "api/settings",
                            fields: [
                                .init(
                                    "email.clearResendApiKey", "Clear Resend Api Key", .boolean,
                                    initial: "true"
                                ),
                            ], destructive: true
                        ),
                    ],
                    editFields: [
                        .init("email.fromEmail", "From Email", .text),
                        .init("email.fromName", "From Name", .text),
                        .init("email.toEmail", "To Email", .text),
                        .init("email.resendApiKey", "Resend Api Key", .secret),
                        .init("email.enabled", "Enabled", .boolean),
                        .init("email.cc.news", "News", .text),
                        .init("email.cc.client", "Client", .text),
                    ], editMethod: "POST"
                ),
                .init(id: "email-log", title: "Sent Mail", path: "api/email/log?limit=500"),
                .init(
                    id: "location", title: "Location & Calendar", path: "api/settings",
                    editFields: [
                        .init("geoapifyApiKey", "Geoapify Api Key", .secret),
                        .init("weather.enabled", "Enabled", .boolean),
                        .init("weather.latitude", "Latitude", .number),
                        .init("weather.longitude", "Longitude", .number),
                        .init("weather.label", "Label", .text),
                        .init("weather.units", "Units", .choices(["F", "C"])),
                        .init("weather.timezone", "Timezone", .text),
                        .init("calendar.showMoon", "Show Moon", .boolean, initial: "true"),
                        .init("calendar.showSeasons", "Show Seasons", .boolean, initial: "true"),
                        .init(
                            "calendar.showAstrology", "Show Astrology", .boolean, initial: "true"
                        ),
                        .init("calendar.showMeteors", "Show Meteors", .boolean, initial: "true"),
                        .init("calendar.showSunTimes", "Show Sun Times", .boolean, initial: "true"),
                        .init("calendar.showHolidays", "Show Holidays", .boolean, initial: "true"),
                        .init("calendar.showDst", "Show Dst", .boolean, initial: "true"),
                        .init("calendar.showWeather", "Show Weather", .boolean, initial: "true"),
                        .init("calendar.showOverdue", "Show Overdue", .boolean, initial: "false"),
                    ], editMethod: "POST"
                ),
                .init(
                    id: "voice", title: "Voice", path: "api/settings",
                    actions: [
                        .init(
                            id: "clear-keys", title: "Remove saved credentials",
                            path: "api/settings",
                            fields: [
                                .init(
                                    "clearTranscribeApiKey", "Clear Transcribe Api Key", .boolean,
                                    initial: "true"
                                ),
                                .init(
                                    "clearTtsApiKey", "Clear Tts Api Key", .boolean, initial: "true"
                                ),
                            ], destructive: true
                        ),
                    ],
                    editFields: [
                        .init("transcribeUrl", "Transcribe Url", .text),
                        .init("transcribeModel", "Transcribe Model", .text),
                        .init("transcribeApiKey", "Transcribe Api Key", .secret),
                        .init("ttsUrl", "Tts Url", .text),
                        .init("ttsLanguage", "Tts Language", .text),
                        .init("ttsApiKey", "Tts Api Key", .secret),
                    ], editMethod: "POST"
                ),
                .init(
                    id: "schedules", title: "Sync & Schedules", path: "api/schedules",
                    editFields: [
                        .init("snapshotEnabled", "Snapshot Enabled", .boolean),
                        .init("snapshotIntervalMinutes", "Snapshot Interval Minutes", .integer),
                        .init("quantRefreshEnabled", "Quant Refresh Enabled", .boolean),
                        .init(
                            "quantRefreshIntervalMinutes", "Quant Refresh Interval Minutes",
                            .integer
                        ),
                        .init("politicsRefreshEnabled", "Politics Refresh Enabled", .boolean),
                        .init(
                            "politicsRefreshIntervalMinutes", "Politics Refresh Interval Minutes",
                            .integer
                        ), .init("dailyNewsEnabled", "Daily News Enabled", .boolean),
                        .init("dailyNewsHour", "Daily News Hour", .integer),
                        .init("dailyNewsWeeklyDay", "Daily News Weekly Day", .integer),
                        .init("dropboxSyncEnabled", "Dropbox Sync Enabled", .boolean),
                        .init(
                            "dropboxSyncIntervalMinutes", "Dropbox Sync Interval Minutes", .integer
                        ),
                        .init("timezone", "Timezone", .text),
                        .init("backupPassword", "Backup Password", .secret),
                    ]
                ),
                .init(
                    id: "dropbox", title: "Dropbox", path: "api/dropbox/status",
                    actions: [
                        .init(
                            id: "authorize", title: "Connect Dropbox",
                            path: "api/dropbox/authorize",
                            fields: [.init("token", "Token", .secret, required: true)]
                        ),
                        .init(id: "sync", title: "Sync Dropbox", path: "api/dropbox/sync"),
                    ]
                ), .init(id: "status", title: "System Status", path: "api/status"),
                .init(id: "logs", title: "Logs", path: "api/logs?limit=200"),
                .init(id: "usage", title: "AI Usage", path: "api/ai-usage?limit=1000&summary=1"),
                .init(id: "cache", title: "Cache Status", path: "api/cache-status"),
                .init(
                    id: "jobs", title: "Jobs", path: "api/jobs",
                    collections: [
                        .init(
                            id: "builtInJobs", title: "Built-in Jobs", path: "builtInJobs",
                            actions: [
                                .init(
                                    id: "history", title: "Run history",
                                    path: "api/jobs/{id}/runs?kind=built-in", method: "GET"
                                ),
                            ]
                        ),
                        .init(
                            id: "customJobs", title: "Custom Jobs", path: "customJobs",
                            fields: [
                                .init("id", "Id", .text, required: true),
                                .init("label", "Label", .text, required: true),
                                .init("schedule", "Schedule", .text),
                                .init("script", "Script", .text, required: true),
                                .init("enabled", "Enabled", .boolean),
                                .init("tags", "Tags", .strings),
                                .init("scriptContent", "Script Content", .multiline),
                            ], updatePath: "api/jobs?overwrite=true", updateMethod: "POST",
                            actions: [
                                .init(id: "run", title: "Run job", path: "api/jobs/{id}/run"),
                                .init(
                                    id: "dry-run", title: "Dry run",
                                    path: "api/jobs/{id}/run?dryRun=true"
                                ),
                                .init(
                                    id: "history", title: "Run history", path: "api/jobs/{id}/runs",
                                    method: "GET"
                                ),
                            ]
                        ),
                    ],
                    actions: [
                        .init(
                            id: "create", title: "Create custom job", path: "api/jobs",
                            fields: [
                                .init("id", "Id", .text, required: true),
                                .init("label", "Label", .text, required: true),
                                .init(
                                    "schedule", "Schedule",
                                    .choices(["hourly", "daily", "every 6h", "every 12h"]),
                                    required: true, initial: "daily"
                                ),
                                .init("script", "Script", .text, required: true),
                                .init("enabled", "Enabled", .boolean),
                                .init("tags", "Tags", .strings),
                                .init("scriptContent", "Script Content", .multiline),
                            ]
                        ),
                    ]
                ),
                .init(
                    id: "quant-settings", title: "Market Providers", path: "api/settings",
                    editFields: [
                        .init("fredApiKey", "Fred Api Key", .secret),
                        .init("congressApiKey", "Congress Api Key", .secret),
                    ], editMethod: "POST"
                ),
                .init(
                    id: "backup", title: "Backup", path: "api/status",
                    actions: [
                        .init(
                            id: "backup", title: "Create encrypted backup", path: "api/backup",
                            fields: [.init("password", "Password", .secret, required: true)],
                            response: "download"
                        ),
                        .init(
                            id: "restore", title: "Restore encrypted backup", path: "api/restore",
                            fields: [.init("password", "Password", .secret, required: true)],
                            response: "upload", destructive: true
                        ),
                        .init(
                            id: "latest", title: "Download latest backup",
                            path: "api/backup/latest", method: "GET", response: "download"
                        ),
                    ]
                ),
                .init(id: "codex-login", title: "Codex Server Sign-in", path: "api/chat/config"),
            ]
        ),
    ]
}
