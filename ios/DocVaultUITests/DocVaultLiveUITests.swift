import XCTest

/// Opt-in live browsing. Uses the app's saved session; never enters demo or resets data.
@MainActor final class DocVaultLiveUITests: XCTestCase {
    private func liveApp() throws -> XCUIApplication {
        guard let server = ProcessInfo.processInfo.environment["DOCVAULT_LIVE_TEST_SERVER"], !server.isEmpty else {
            throw XCTSkip("Set DOCVAULT_LIVE_TEST_SERVER after connecting this simulator to the live server.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.buttons["Workspace"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["Settings"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts[server].firstMatch.waitForExistence(timeout: 10), "The app must already be connected to the explicitly selected server.")
        XCTAssertFalse(app.buttons["Leave demo & connect server"].exists)
        app.buttons["Workspace"].firstMatch.tap()
        return app
    }

    private func feature(_ app: XCUIApplication, id: String, title: String) {
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        if let value = search.value as? String, value != "Find a feature", !value.isEmpty {
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        search.typeText(title)
        let link = app.buttons["feature-" + id].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 10)); link.tap()
        XCTAssertTrue(app.navigationBars.buttons["Workspace"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func capture(_ name: String) {
        // Live screenshots stay in the caller's private, gitignored result bundle.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Private live vault " + name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLiveInvoiceHistoryAndUnchangedStatusReview() throws {
        let app = try liveApp(); feature(app, id: "timesheet", title: "Time Tracking"); section(app, "Invoices")
        XCTAssertTrue(app.descendants(matching: .any)["nativeInvoices"].firstMatch.waitForExistence(timeout: 20))
        capture("Invoice history and currency totals")
        let invoice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "invoiceRow-")).firstMatch
        if invoice.exists {
            reveal(app, invoice); invoice.tap()
            XCTAssertTrue(app.descendants(matching: .any)["nativeInvoiceDetail"].firstMatch.waitForExistence(timeout: 20)); capture("Saved invoice lines and delivery metadata")
            let edit = app.buttons["invoiceEdit"].firstMatch; reveal(app, edit); edit.tap()
            XCTAssertTrue(app.buttons["invoiceSave"].firstMatch.waitForExistence(timeout: 10))
            XCTAssertFalse(app.buttons["invoiceSave"].firstMatch.isEnabled); capture("Unchanged invoice status review")
            app.buttons["Cancel"].firstMatch.tap()
        }
        XCTAssertEqual(app.webViews.count, 0)
        // No create, status save, PDF filing, parsing, deletion or email action.
    }

    func testLiveNativeWorkspacesOpen() throws {
        let app = try liveApp()
        let features: [(String, String)] = [
            ("portfolio", "Portfolio"), ("banks", "Banks"), ("brokers", "Brokers"),
            ("crypto", "Crypto"), ("gold", "Precious Metals"), ("property", "Property"),
            ("income", "Income"), ("debts", "Debts"), ("strategy", "Strategy"), ("quant", "Quant"),
            ("tax-year", "Tax Year"), ("business-docs", "Business Documents"),
            ("all-files", "All Files"), ("tn-tax", "Tennessee Tax"), ("solo-401k", "Solo"),
            ("estimated-tax", "Estimated Tax"), ("federal-tax", "Federal Tax"), ("sales", "Sales"),
            ("mileage", "Mileage"), ("timesheet", "Time Tracking"), ("calendar", "Calendar"),
            ("health", "Health"), ("health-activity", "Activity"), ("health-heart", "Heart"),
            ("health-sleep", "Sleep"), ("health-workouts", "Workouts"), ("health-body", "Body"),
            ("health-records", "Medical Records"), ("health-dna", "DNA"),
            ("health-nutrition", "Nutrition"), ("health-sickness", "Sickness"),
            ("health-analysis", "Health Analysis"), ("health-research", "Health Research"),
            ("deep-research", "Deep Research"), ("daily-news", "Daily News"), ("tech", "Tech"),
            ("local-news", "Local News"), ("politics", "Politics"), ("predictions", "Predictions"),
            ("chat", "Chat"), ("chat-history", "Chat History"),
            ("external-sources", "External Sources"), ("settings", "Server Settings"),
        ]
        for (id, title) in features {
            feature(app, id: id, title: title)
            if ["portfolio", "banks", "brokers", "tax-year", "health-heart", "deep-research", "daily-news"].contains(id) {
                capture(id)
            }
            app.navigationBars.buttons["Workspace"].firstMatch.tap()
        }
    }

    private func section(_ app: XCUIApplication, _ title: String) {
        let button = app.buttons["featureSection"].firstMatch
        if button.exists {
            button.tap()
        } else {
            app.descendants(matching: .any)["featureSection"].firstMatch.tap()
        }
        let search = app.searchFields["Find a section"].firstMatch
        if search.waitForExistence(timeout: 1) {
            search.tap(); search.typeText(title)
        }
        let option = app.buttons[title].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10)); option.tap()
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0 ..< 24 where !element.exists || element.frame.isEmpty || !element.frame.intersects(app.frame.insetBy(dx: 0, dy: 140)) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.74)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.36)))
        }
        XCTAssertTrue(element.waitForExistence(timeout: 10))
    }

    private func frameChart(_ app: XCUIApplication, _ identifier: String) {
        let plot = app.descendants(matching: .any)[identifier].firstMatch
        for _ in 0 ..< 20 {
            if plot.exists, !plot.frame.isEmpty, abs(plot.frame.minY - 210) < 45 {
                break
            }
            let difference = plot.exists && !plot.frame.isEmpty ? plot.frame.minY - 210 : app.frame.height * 0.3
            let distance = min(0.3, max(-0.3, difference / app.frame.height))
            let start = distance < 0 ? 0.4 : 0.7
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: start)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: start - distance)), withVelocity: .slow, thenHoldForDuration: 0.25)
        }
        XCTAssertTrue(plot.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(plot.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        XCTAssertLessThan(plot.frame.maxY, app.buttons["Settings"].firstMatch.frame.minY)
    }

    func testLiveTimesheetReportScopeChartsAndUnchangedScheduleReview() throws {
        let app = try liveApp(); feature(app, id: "timesheet", title: "Time Tracking"); section(app, "Weekly Report")
        let metrics = app.descendants(matching: .any)["reportMetrics"].firstMatch
        XCTAssertTrue(metrics.waitForExistence(timeout: 20)); capture("timesheet saved report metrics")
        for id in ["reportClientScope", "reportProjectScope", "reportCard-reportCategoryChart", "reportCard-reportDailyChart"] {
            reveal(app, app.descendants(matching: .any)[id].firstMatch); capture(id)
        }
        let edit = app.buttons["editReportConfig"].firstMatch
        for _ in 0 ..< 20 where !edit.isHittable {
            app.swipeDown()
        }
        reveal(app, edit); edit.tap()
        XCTAssertTrue(app.buttons["reportConfigSave"].firstMatch.waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["reportConfigSave"].firstMatch.isEnabled)
        capture("timesheet unchanged saved schedule")
        app.buttons["reportConfigCancel"].firstMatch.tap(); XCTAssertEqual(app.webViews.count, 0)
        // Never change schedule/scope, send a report, or invoke a provider here.
    }

    func testLiveQuantBandsDateControlsAndRecordedStatistics() throws {
        let app = try liveApp()
        feature(app, id: "quant", title: "Quant"); section(app, "Btc · Log Regression")
        let chart = app.descendants(matching: .any)["quantTimeChart"].firstMatch
        XCTAssertTrue(chart.waitForExistence(timeout: 20))
        XCTAssertTrue(chart.label.contains("From "), "Live BTC observations must be present for this review.")
        XCTAssertTrue(chart.label.contains("2 shaded bands"))
        frameChart(app, "quantTimeChart"); capture("quant regression filled bands")
        let inspect = app.buttons["quantInspectLatest"].firstMatch
        reveal(app, inspect); inspect.tap()
        XCTAssertTrue(app.staticTexts["quantSelectedDate"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["quantValue-price"].firstMatch.exists)
        let statistics = app.buttons["Statistics for this window"].firstMatch
        reveal(app, statistics); statistics.tap()
        XCTAssertTrue(app.staticTexts["Observations"].firstMatch.waitForExistence(timeout: 5))
        capture("quant recorded window statistics")
        let history = app.descendants(matching: .any)["quantHistory"].firstMatch
        for _ in 0 ..< 20 where !history.isHittable {
            app.swipeDown()
        }
        history.tap(); app.buttons["Custom"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["quantCustomStart"].firstMatch.waitForExistence(timeout: 5))
        let apply = app.buttons["quantApplyRange"].firstMatch
        reveal(app, apply); XCTAssertTrue(apply.isEnabled); apply.tap()
        XCTAssertTrue(app.staticTexts["quantAppliedRange"].firstMatch.label.contains("(UTC)"))
        capture("quant custom UTC date controls")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testLiveOperationsChartsAndSavedHistory() throws {
        let app = try liveApp()
        feature(app, id: "settings", title: "Server Settings")
        section(app, "Jobs")
        let metrics = app.descendants(matching: .any)["operationsMetrics"].firstMatch
        XCTAssertTrue(metrics.waitForExistence(timeout: 20)); capture("jobs metrics")
        for id in ["operationsOutcomeChart", "operationsScheduleChart"] {
            reveal(app, app.descendants(matching: .any)["operationsCard-" + id].firstMatch)
            capture(id)
        }
        app.buttons["operationsReview"].firstMatch.tap(); app.buttons["Jobs"].firstMatch.tap()
        let job = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "operationsJob-")).firstMatch
        reveal(app, job); job.tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeJobDetail"].firstMatch.waitForExistence(timeout: 20))
        reveal(app, app.descendants(matching: .any)["operationsCard-operationsLatestStatus"].firstMatch); capture("saved job status")
        reveal(app, app.descendants(matching: .any)["operationsCard-operationsHistoryChart"].firstMatch); capture("saved job history")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        section(app, "AI Usage")
        XCTAssertTrue(app.descendants(matching: .any)["usageMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("API usage metrics")
        for id in ["usageModelChart", "usagePurposeChart", "usageDailyChart"] {
            reveal(app, app.descendants(matching: .any)["operationsCard-" + id].firstMatch); capture(id)
        }
        section(app, "System Status")
        for id in ["operationsServerAccess", "operationsCacheStatus"] {
            reveal(app, app.descendants(matching: .any)["operationsCard-" + id].firstMatch); capture(id)
        }
        // Leave the live preview on its real data with ordinary text size.
        app.buttons["Documents"].firstMatch.tap()
    }

    func testLiveBrainSkillsAndRepositoryReaders() throws {
        let app = try liveApp()
        feature(app, id: "settings", title: "Server Settings")
        section(app, "Brain")
        XCTAssertTrue(app.descendants(matching: .any)["brainMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("Brain saved metrics")
        frameChart(app, "brainSectionChart"); capture("Brain section chart")
        app.buttons["brainActions"].firstMatch.tap(); app.buttons["Edit memory"].firstMatch.tap()
        XCTAssertTrue(app.textViews["instructionContent"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Preview"].firstMatch.tap(); capture("Brain unchanged editor preview")
        app.buttons["instructionCancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["instructionCancel"].firstMatch.waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.buttons["instructionDiscard"].exists)
        section(app, "Skills")
        XCTAssertTrue(app.descendants(matching: .any)["skillsMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("Skills saved metrics")
        frameChart(app, "skillsSizeChart"); capture("Skills size chart")
        let skill = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "skill-")).firstMatch
        reveal(app, skill); skill.tap()
        XCTAssertTrue(app.descendants(matching: .any)["skillInstructions"].firstMatch.waitForExistence(timeout: 20)); capture("Skill saved instructions")
        XCTAssertEqual(app.webViews.count, 0)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons["Workspace"].firstMatch.tap()
        feature(app, id: "external-sources", title: "External Sources")
        XCTAssertTrue(app.descendants(matching: .any)["sourcesMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("Source library saved metrics")
        let source = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "source-")).firstMatch
        reveal(app, source); source.tap()
        XCTAssertTrue(app.descendants(matching: .any)["sourceBreadcrumbs"].firstMatch.waitForExistence(timeout: 20)); capture("Repository current index")
        var page = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sourceFile-")).firstMatch
        for _ in 0 ..< 8 where !page.exists {
            let folder = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sourceFolder-")).firstMatch
            XCTAssertTrue(folder.waitForExistence(timeout: 5)); reveal(app, folder); folder.tap()
            page = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sourceFile-")).firstMatch
        }
        reveal(app, page); page.tap()
        XCTAssertTrue(app.descendants(matching: .any)["sourceFormattedContent"].firstMatch.waitForExistence(timeout: 20)); capture("Repository saved Markdown reader")
        XCTAssertEqual(app.webViews.count, 0)
        app.buttons["Documents"].firstMatch.tap()
    }

    func testLiveTaxFilingAndEntityReaders() throws {
        let app = try liveApp()
        feature(app, id: "tax-year", title: "Tax Year")
        let metrics = app.descendants(matching: .any)["filingTaskMetrics"].firstMatch
        XCTAssertTrue(metrics.waitForExistence(timeout: 20)); capture("Tax filing task metrics")
        reveal(app, app.descendants(matching: .any)["filingCard-filingUrgencyChart"].firstMatch); capture("Tax reminder urgency")
        for _ in 0 ..< 18 where !app.buttons["taxEntityDetails"].firstMatch.isHittable {
            app.swipeDown()
        }
        let details = app.buttons["taxEntityDetails"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 10)); details.tap()
        XCTAssertTrue(app.descendants(matching: .any)["entityDetailsMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("Entity saved information")
        let edit = app.buttons["entityDetailsEdit"].firstMatch; reveal(app, edit); edit.tap()
        let save = app.buttons["entityEditorSave"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 10)); XCTAssertFalse(save.isEnabled); capture("Entity unchanged editor")
        app.buttons["entityEditorCancel"].firstMatch.tap()
        XCTAssertTrue(save.waitForNonExistence(timeout: 10)); XCTAssertFalse(app.buttons["entityEditorDiscard"].exists)
        XCTAssertEqual(app.webViews.count, 0)
        // No completion, dismissal, payment, metadata save or upload actions are used.
        app.buttons["Documents"].firstMatch.tap()
    }

    func testLiveDocumentTrackingReaderAndUnchangedRenameReview() throws {
        let app = try liveApp()
        feature(app, id: "tax-year", title: "Tax Year")
        let picker = app.descendants(matching: .any)["taxReviewSection"].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 20)); picker.tap(); app.buttons["Documents"].firstMatch.tap()
        let source = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "taxSource-")).firstMatch
        reveal(app, source); source.tap()
        let totals = app.switches["documentTracked"].firstMatch
        reveal(app, totals); let initialValue = totals.value as? String
        XCTAssertNotNil(initialValue); capture("document inclusion and classification reader")
        app.buttons["Document actions"].firstMatch.tap(); app.buttons["Rename"].firstMatch.tap()
        XCTAssertTrue(app.textFields["field-newFilename"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["saveDocumentOrganization"].firstMatch.isEnabled)
        reveal(app, app.staticTexts["documentDestinationPreview"].firstMatch); capture("unchanged document naming review")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertEqual(totals.value as? String, initialValue)
        XCTAssertEqual(app.webViews.count, 0)
        // No toggle, provider parsing, save, rename or move is performed.
    }

    func testLiveProviderPreferencesAndSavedMailReaders() throws {
        let app = try liveApp()
        feature(app, id: "settings", title: "Server Settings")
        for title in ["AI & Chat", "Voice", "Location & Calendar", "Market Providers", "Email"] {
            section(app, title)
            XCTAssertTrue(app.descendants(matching: .any)["providerSettingsMetrics"].firstMatch.waitForExistence(timeout: 20)); capture(title + " saved preferences")
            XCTAssertEqual(app.webViews.count, 0)
        }
        let edit = app.buttons["providerEdit-email"].firstMatch; reveal(app, edit); edit.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["providerEditorSave"].firstMatch.isEnabled); capture("Email unchanged editor")
        app.buttons["providerEditorCancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.buttons["providerEditorDiscard"].exists)
        section(app, "Sent Mail")
        XCTAssertTrue(app.descendants(matching: .any)["mailMetrics"].firstMatch.waitForExistence(timeout: 20)); capture("Saved mail attempt metrics")
        let browse = app.buttons["mailBrowseAttempts"].firstMatch; reveal(app, browse); browse.tap()
        let attempt = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mailAttempt-")).firstMatch
        if attempt.exists {
            reveal(app, attempt); attempt.tap()
            XCTAssertTrue(app.descendants(matching: .any)["nativeEmailAttempt"].firstMatch.waitForExistence(timeout: 20)); capture("Saved mail metadata")
        }
        // No save, credential replacement, removal or test-send actions are used here.
        app.buttons["Documents"].firstMatch.tap()
    }
}
