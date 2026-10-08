import XCTest

@MainActor final class DocVaultUITests: XCTestCase {
    private func launchDemo() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--demo"]
        app.launchEnvironment["DOCVAULT_DEMO_NOW"] = "2026-10-07T12:00:00Z"
        if ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] == "1" {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launch()
        XCTAssertTrue(app.buttons["entity-personal"].waitForExistence(timeout: 10))
        return app
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testInvoiceCreationPreviewAndSimulatedEmailCompose() {
        let app = launchDemo(); app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "timesheet", name: "Time Tracking"); marketSection(app, "Invoices")
        XCTAssertTrue(app.descendants(matching: .any)["nativeInvoices"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["invoiceCreate"].firstMatch.tap()
        app.buttons["invoiceClient"].firstMatch.tap(); app.buttons["Acme Client"].firstMatch.tap()
        let total = app.descendants(matching: .any)["invoiceSelectionTotal"].firstMatch; taxReveal(app, total)
        XCTAssertTrue(total.label.contains("300")); capture("Native invoice reviewed open work")
        let preview = app.buttons["invoicePreviewDraft"].firstMatch; taxReveal(app, preview); preview.tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].firstMatch.waitForExistence(timeout: 10)); capture("Native invoice PDF preview")
        app.buttons["closeDocumentPreview"].firstMatch.tap()
        let create = app.buttons["invoiceConfirmCreate"].firstMatch; taxReveal(app, create); create.tap(); app.buttons["Create invoice"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["invoiceCreated"].firstMatch.waitForExistence(timeout: 10)); app.buttons["Open invoice"].firstMatch.tap()
        let compose = app.buttons["invoiceCompose"].firstMatch; taxReveal(app, compose); compose.tap()
        XCTAssertTrue(app.textFields["invoiceEmailTo"].firstMatch.waitForExistence(timeout: 10))
        administrationInput(app, "invoiceEmailTo", "reader@example.com")
        administrationInput(app, "invoiceEmailCC", "")
        let attachment = app.descendants(matching: .any)["invoiceEmailAttachment"].firstMatch; taxReveal(app, attachment)
        XCTAssertTrue(attachment.label.contains(".pdf")); capture("Native invoice recipients and resolved email")
        let send = app.buttons["invoiceEmailSend"].firstMatch; taxReveal(app, send); send.tap(); app.buttons["Simulate send"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["invoiceEmailResult"].firstMatch.waitForExistence(timeout: 10)); capture("Native invoice simulated delivery result")
        XCTAssertFalse(app.buttons["invoiceEmailSend"].exists); XCTAssertEqual(app.webViews.count, 0)
    }

    func testInvoiceDraftDateValidationAndDiscardPreserveOpenWork() {
        let app = launchDemo(); app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "timesheet", name: "Time Tracking"); marketSection(app, "Invoices")
        app.buttons["invoiceCreate"].firstMatch.tap(); app.buttons["invoiceClient"].firstMatch.tap(); app.buttons["Acme Client"].firstMatch.tap()
        administrationInput(app, "invoiceFrom", "2026-02-29")
        let error = app.staticTexts["invoiceDraftValidation"].firstMatch; taxReveal(app, error)
        XCTAssertTrue(error.label.contains("valid work window")); XCTAssertFalse(app.buttons["invoiceConfirmCreate"].exists)
        capture("Native invoice date validation")
        app.buttons["Cancel"].firstMatch.tap(); app.buttons["Discard draft"].firstMatch.tap()
        app.buttons["invoiceCreate"].firstMatch.tap(); app.buttons["invoiceClient"].firstMatch.tap(); app.buttons["Acme Client"].firstMatch.tap()
        let create = app.buttons["invoiceConfirmCreate"].firstMatch; taxReveal(app, create)
        XCTAssertTrue(create.isEnabled); XCTAssertTrue(app.descendants(matching: .any)["invoiceSelectionTotal"].firstMatch.label.contains("300"))
        app.buttons["Cancel"].firstMatch.tap(); app.buttons["Discard draft"].firstMatch.tap(); XCTAssertEqual(app.webViews.count, 0)
    }

    private func demoTimesheetReport() -> XCUIApplication {
        let app = launchDemo(); app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "timesheet", name: "Time Tracking"); marketSection(app, "Weekly Report")
        XCTAssertTrue(app.descendants(matching: .any)["reportMetrics"].firstMatch.waitForExistence(timeout: 15))
        return app
    }

    func testTimesheetReportChartsEntryReadingAndCompleteExports() {
        let app = demoTimesheetReport()
        taxFrame(app, "reportMetrics"); capture("Native timesheet report overview")
        for id in ["reportCategoryChart", "reportDailyChart"] {
            taxFrame(app, id); capture("Native timesheet " + id)
        }
        let category = app.buttons["reportCategory-Acme Studio"].firstMatch; taxReveal(app, category); category.tap()
        let entry = app.buttons["reportEntry-3"].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(app.staticTexts["Research and design\nReview recorded scope"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Acme Studio"].firstMatch.exists); capture("Native timesheet complete report entry")
        app.navigationBars.buttons["Time Tracking"].firstMatch.tap()
        let csv = app.buttons["reportExportCSV"].firstMatch; taxReveal(app, csv); csv.tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].firstMatch.waitForExistence(timeout: 10)); capture("Native timesheet full CSV export")
        app.buttons["closeDocumentPreview"].firstMatch.tap()
        let html = app.buttons["reportPreviewHTML"].firstMatch; taxReveal(app, html); html.tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].firstMatch.waitForExistence(timeout: 10)); capture("Native timesheet HTML mail preview")
        app.buttons["closeDocumentPreview"].firstMatch.tap(); XCTAssertEqual(app.webViews.count, 0)
    }

    func testTimesheetReportScopeValidationDraftDiscardAndSimulatedSendReview() {
        let app = demoTimesheetReport()
        let edit = app.buttons["editReportConfig"].firstMatch; taxReveal(app, edit); edit.tap()
        administrationInput(app, "reportConfigWindowDays", "0"); app.buttons["reportConfigSave"].firstMatch.tap()
        let error = app.staticTexts["reportConfigError"].firstMatch; taxReveal(app, error)
        XCTAssertTrue(error.label.contains("1 to 90 days"))
        let windowDays = app.textFields["reportConfigWindowDays"].firstMatch
        taxReveal(app, windowDays, scrollUp: true); XCTAssertEqual(windowDays.value as? String, "0")
        administrationInput(app, "reportConfigWindowDays", "7")
        let client = app.switches["reportScope-clients-acme-client"].firstMatch; taxReveal(app, client); tapSwitch(client)
        capture("Native timesheet reviewed client scope"); app.buttons["reportConfigSave"].firstMatch.tap()
        let scope = app.staticTexts["reportClientScope"].firstMatch; taxReveal(app, scope, scrollUp: true)
        XCTAssertEqual(scope.label, "Acme Client")
        edit.tap(); administrationInput(app, "reportConfigWindowDays", "90")
        app.buttons["reportConfigCancel"].firstMatch.tap(); app.buttons["Discard changes"].firstMatch.tap()
        edit.tap(); XCTAssertEqual(app.textFields["reportConfigWindowDays"].firstMatch.value as? String, "7")
        let selected = app.switches["reportScope-clients-acme-client"].firstMatch; taxReveal(app, selected); tapSwitch(selected)
        app.buttons["reportConfigSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["reportConfirmExpandedScope"].firstMatch.waitForExistence(timeout: 5)); capture("Native timesheet scope expansion review")
        app.buttons["reportConfirmExpandedScope"].firstMatch.tap(); taxReveal(app, scope, scrollUp: true); XCTAssertEqual(scope.label, "All clients")
        let send = app.buttons["reportReviewSend"].firstMatch; taxReveal(app, send); send.tap()
        let recipient = app.staticTexts["reportSendTo"].firstMatch
        XCTAssertTrue(recipient.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", "reportSendTo", "reader@example.com")).firstMatch.exists, app.debugDescription)
        let cc = app.staticTexts["reportSendCC"].firstMatch; taxReveal(app, cc)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", "reportSendCC", "billing@example.com")).firstMatch.exists, app.debugDescription); capture("Native timesheet recipient and CC review")
        let simulate = app.buttons["reportSend"].firstMatch; taxReveal(app, simulate); simulate.tap()
        app.buttons["reportConfirmSend"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["reportSendResult"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Simulated send — no email was sent"].firstMatch.exists)
        capture("Native timesheet simulated send outcome")
        app.buttons["closeReportSendReview"].firstMatch.tap(); XCTAssertEqual(app.webViews.count, 0)
    }

    func testBrowseFoldersAndDocumentPreview() {
        let app = launchDemo()
        capture("Documents")
        app.buttons["entity-personal"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["2026"].firstMatch.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["2026"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Statements"].firstMatch.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["Statements"].firstMatch.tap()
        app.descendants(matching: .any)["AcmeBank_Statement_2026-09.pdf"].firstMatch.tap()
        XCTAssertTrue(app.buttons["previewDocument"].waitForExistence(timeout: 5))
        capture("Document details")
        app.buttons["previewDocument"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        capture("PDF preview")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["previewDocument"].exists)
    }

    func testSearchAndEditMetadata() {
        let app = launchDemo()
        app.buttons["Search"].firstMatch.tap()
        let search = visibleSearchField(app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Insurance")
        let result = app.descendants(matching: .any)["Home_Insurance.pdf"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        app.buttons["Edit notes"].tap()
        let notes = app.textViews["documentNotes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        notes.tap()
        notes.typeText("Reviewed demo document")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Reviewed demo document"].firstMatch.waitForExistence(timeout: 5))
        capture("Updated document notes")
    }

    func testDocumentTrackingAndReviewedEntityYearCategoryMove() {
        let app = launchDemo(); app.buttons["Search"].firstMatch.tap()
        let search = visibleSearchField(app); search.tap(); search.typeText("Equipment")
        let original = app.descendants(matching: .any)["Equipment_Receipt.pdf"].firstMatch
        XCTAssertTrue(original.waitForExistence(timeout: 10)); original.tap()
        let tracked = app.switches["documentTracked"].firstMatch; taxReveal(app, tracked)
        tapSwitch(tracked)
        let excluded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "0"), object: tracked)
        XCTAssertEqual(XCTWaiter.wait(for: [excluded], timeout: 10), .completed)
        app.buttons["Edit notes"].firstMatch.tap()
        let notes = app.textViews["documentNotes"].firstMatch; notes.tap(); notes.typeText("Invented preserved review")
        app.buttons["Save"].firstMatch.tap()
        taxReveal(app, app.staticTexts["Invented preserved review"].firstMatch)
        XCTAssertEqual(tracked.value as? String, "0"); capture("Native document excluded from totals")
        documentAction(app, "Move")
        let entity = app.descendants(matching: .any)["documentOrganizationEntity"].firstMatch; taxReveal(app, entity); entity.tap(); app.buttons["Acme Studio"].firstMatch.tap()
        administrationInput(app, "documentOrganizationYear", "2025")
        let category = app.descendants(matching: .any)["documentOrganizationCategory"].firstMatch; taxReveal(app, category); category.tap(); app.buttons["Medical"].firstMatch.tap()
        let path = app.staticTexts["documentDestinationPreview"].firstMatch; taxReveal(app, path)
        XCTAssertEqual(path.label, "2025/expenses/medical/Equipment_Receipt.pdf"); capture("Native document reviewed canonical destination")
        app.buttons["saveDocumentOrganization"].firstMatch.tap()
        XCTAssertTrue(original.waitForExistence(timeout: 10)); original.tap()
        // LabeledContent exposes its label and value as one accessibility element.
        let folder = app.staticTexts["Folder, 2025/expenses/medical"].firstMatch
        XCTAssertTrue(folder.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Acme Studio"].firstMatch.exists)
        taxReveal(app, app.staticTexts["Invented preserved review"].firstMatch)
        XCTAssertEqual(app.switches["documentTracked"].firstMatch.value as? String, "0")
        capture("Native moved document retains exclusion and notes")
    }

    func testDocumentSavedNamingSuggestionExtensionValidationAndDraftDiscard() {
        let app = launchDemo(); app.buttons["Search"].firstMatch.tap()
        let search = visibleSearchField(app); search.tap(); search.typeText("Equipment")
        let original = app.descendants(matching: .any)["Equipment_Receipt.pdf"].firstMatch
        XCTAssertTrue(original.waitForExistence(timeout: 10)); original.tap()
        app.buttons["Edit notes"].firstMatch.tap()
        let notes = app.textViews["documentNotes"].firstMatch; notes.tap(); notes.typeText("Unsaved invented note")
        app.buttons["Cancel"].firstMatch.tap(); app.buttons["Discard changes"].firstMatch.tap()
        XCTAssertFalse(app.staticTexts["Unsaved invented note"].firstMatch.exists)
        documentAction(app, "Rename")
        administrationInput(app, "field-newFilename", "Acme.txt")
        let invalid = app.staticTexts["documentOrganizationValidationError"].firstMatch; taxReveal(app, invalid)
        XCTAssertTrue(invalid.label.contains("original file extension")); XCTAssertFalse(app.buttons["saveDocumentOrganization"].firstMatch.isEnabled)
        let suggest = app.buttons["documentSuggestName"].firstMatch
        for _ in 0 ..< 8 where !suggest.isHittable {
            app.swipeDown()
        }; taxReveal(app, suggest); suggest.tap()
        let expected = "Acme_Supplies_equipment_2026.pdf"
        let filename = app.textFields["field-newFilename"].firstMatch
        let suggested = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", expected), object: filename)
        XCTAssertEqual(XCTWaiter.wait(for: [suggested], timeout: 10), .completed)
        capture("Native saved-extraction standard filename review")
        app.buttons["saveDocumentOrganization"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)[expected].firstMatch.waitForExistence(timeout: 10))
        capture("Native renamed document search result")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testWorkspaceAndLeaveDemo() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        capture("Native workspace home")
        app.descendants(matching: .any)["Portfolio"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["netWorth"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Settings"].firstMatch.tap()
        capture("Settings")
        app.buttons["Leave demo & connect server"].tap()
        app.buttons["confirmSignOut"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Connect to DocVault"].waitForExistence(timeout: 5))
        capture("Server connection")
    }

    func testUploadDestinationAndSuccess() {
        let app = launchDemo()
        app.buttons["Add document"].tap()
        app.buttons["Add sample document"].tap()
        XCTAssertTrue(app.textFields["uploadFolder"].waitForExistence(timeout: 5))
        capture("Upload destination")
        app.buttons["Upload document"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Document uploaded"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["uploadedPath"].firstMatch.label.hasSuffix("/inbox/Sample.pdf"))
        capture("Upload complete")
        app.buttons["Done"].tap()
        app.buttons["entity-personal"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Sample.pdf"].firstMatch.waitForExistence(timeout: 5))
    }

    func testMultipleDocumentUploads() {
        let app = launchDemo()
        app.buttons["Add document"].tap()
        app.buttons["Add sample documents"].tap()
        XCTAssertTrue(app.textFields["uploadFilename-1"].waitForExistence(timeout: 5))
        let second = app.textFields["uploadFilename-1"]
        second.tap()
        second.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Sample Two.pdf".count) + "../Invalid.pdf")
        app.buttons["uploadDocuments"].tap()
        XCTAssertTrue(app.buttons["Retry remaining steps"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["uploadedPath"].firstMatch.label.hasSuffix("/inbox/Sample One.pdf"))
        second.tap()
        second.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "../Invalid.pdf".count) + "Sample Two.pdf")
        app.buttons["uploadDocuments"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Documents uploaded"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["uploadedPath-1"].firstMatch.label.hasSuffix("/inbox/Sample Two.pdf"))
        capture("Multiple documents uploaded")
        app.buttons["Done"].tap()
        app.buttons["entity-personal"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Sample One.pdf"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Sample Two.pdf"].firstMatch.exists)
    }

    func testUploadClassificationNamingExtractionAndOriginalPreview() {
        continueAfterFailure = false
        let app = launchDemo(); app.buttons["Add document"].tap(); app.buttons["Add sample document"].tap()
        let parse = app.switches["uploadParse"].firstMatch; XCTAssertTrue(parse.waitForExistence(timeout: 5)); tapSwitch(parse)
        let organize = app.switches["uploadOrganize"].firstMatch; tapSwitch(organize)
        let analyze = app.buttons["uploadAnalyze-0"].firstMatch; taxReveal(app, analyze)
        XCTAssertTrue(analyze.waitForExistence(timeout: 10)); capture("Native import analysis and destination")
        let original = app.buttons["uploadPreview-0"].firstMatch; for _ in 0 ..< 12 where !original.isHittable {
            app.swipeDown()
        }; original.tap()
        XCTAssertTrue(app.buttons["Done"].firstMatch.waitForExistence(timeout: 10)); capture("Native import original preview"); app.buttons["Done"].firstMatch.tap()
        let classification = app.buttons["Classification & naming"].firstMatch; taxReveal(app, classification); classification.tap()
        let type = app.descendants(matching: .any)["uploadType-0"].firstMatch; taxReveal(app, type); type.tap(); app.buttons["Receipt"].firstMatch.tap()
        app.descendants(matching: .any)["uploadCategory-0"].firstMatch.tap(); app.buttons["Medical"].firstMatch.tap()
        administrationInput(app, "uploadSource-0", "Acme Clinic"); administrationInput(app, "uploadDescription-0", "Invented visit")
        administrationInput(app, "uploadYear-0", "2024"); administrationInput(app, "uploadMonth-0", "2"); administrationInput(app, "uploadDay-0", "29")
        let standard = app.switches["uploadStandardName-0"].firstMatch; taxReveal(app, standard); tapSwitch(standard)
        let expected = "Acme_Clinic_medical_Invented-visit_2024-02-29.pdf"
        let filename = app.textFields["uploadFilename"].firstMatch; for _ in 0 ..< 18 where !filename.isHittable {
            app.swipeDown()
        }; XCTAssertEqual(filename.value as? String, expected); capture("Native import reviewed standard name")
        let extracted = app.buttons["uploadExtracted-0"].firstMatch; taxReveal(app, extracted); extracted.tap()
        XCTAssertTrue(healthText(app, "Invented demo analysis").waitForExistence(timeout: 10)); capture("Native import complete extracted fields"); app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["uploadDocuments"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["uploadedPath"].firstMatch.waitForExistence(timeout: 10)); XCTAssertEqual(app.staticTexts["uploadedPath"].firstMatch.label, "2024/expenses/medical/" + expected)
        XCTAssertEqual(app.staticTexts["uploadParseStatus-0"].firstMatch.label, "Parsed data saved"); capture("Native import saved parsed document")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testUploadBatchRemovalAndRestorePreserveOriginalFiles() {
        continueAfterFailure = false
        let app = launchDemo(); app.buttons["Add document"].tap(); app.buttons["Add sample documents"].tap()
        let removeSecond = app.buttons["uploadRemove-1"].firstMatch; taxReveal(app, removeSecond); removeSecond.tap()
        let removeFirst = app.buttons["uploadRemove-0"].firstMatch; for _ in 0 ..< 15 where !removeFirst.isHittable {
            app.swipeDown()
        }; removeFirst.tap()
        XCTAssertFalse(app.buttons["uploadDocuments"].firstMatch.isEnabled); capture("Native import empty batch protection")
        let restore = app.buttons["Restore Sample Two.pdf"].firstMatch; taxReveal(app, restore); restore.tap()
        XCTAssertTrue(app.textFields["uploadFilename"].firstMatch.waitForExistence(timeout: 5)); XCTAssertEqual(app.textFields["uploadFilename"].firstMatch.value as? String, "Sample Two.pdf")
        app.buttons["uploadDocuments"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["uploadedPath"].firstMatch.waitForExistence(timeout: 10)); XCTAssertTrue(app.staticTexts["uploadedPath"].firstMatch.label.hasSuffix("/inbox/Sample Two.pdf")); capture("Native import restored selection saved")
        app.buttons["Done"].firstMatch.tap(); app.buttons["entity-personal"].firstMatch.tap()
        XCTAssertTrue(healthText(app, "Sample Two.pdf").waitForExistence(timeout: 10)); XCTAssertFalse(healthText(app, "Sample One.pdf").exists)
    }

    func testBulkDocumentMoveTagAndDelete() {
        let app = launchDemo()
        app.buttons["entity-personal"].tap()
        XCTAssertTrue(app.buttons["selectDocuments"].waitForExistence(timeout: 5))
        app.buttons["selectDocuments"].tap()
        let names = ["AcmeBank_Statement_2026-09.pdf", "Home_Insurance.pdf"]
        for name in names {
            app.buttons[name].tap()
            XCTAssertEqual(app.buttons[name].value as? String, "Selected")
        }
        app.buttons["documentBatchMenu"].tap()
        app.buttons["Move documents"].tap()
        XCTAssertTrue(app.textFields["bulkDestination"].waitForExistence(timeout: 5))
        app.buttons["runDocumentBatch"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["All documents processed"].firstMatch.waitForExistence(timeout: 5))
        capture("Bulk document move")
        app.buttons["closeDocumentBatch"].tap()
        for name in names {
            app.buttons[name].tap()
        }
        app.buttons["documentBatchMenu"].tap()
        app.buttons["Add tags"].tap()
        let tags = app.textFields["bulkTags"]
        XCTAssertTrue(tags.waitForExistence(timeout: 5))
        tags.tap(); tags.typeText("Synthetic, Reviewed")
        app.buttons["runDocumentBatch"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["All documents processed"].firstMatch.waitForExistence(timeout: 5))
        capture("Bulk document tags")
        app.buttons["closeDocumentBatch"].tap()
        for name in names {
            app.buttons[name].tap()
        }
        app.buttons["documentBatchMenu"].tap()
        app.buttons["Delete documents"].tap()
        app.buttons["runDocumentBatch"].tap()
        XCTAssertTrue(app.buttons["confirmBulkDelete"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["confirmBulkDelete"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["All documents processed"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["closeDocumentBatch"].tap()
        for name in names {
            XCTAssertFalse(app.buttons[name].exists)
        }
    }

    func testWorkspaceFileSelectionAndArchive() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        visibleSearchField(app).tap()
        visibleSearchField(app).typeText("All Files")
        app.buttons["feature-all-files"].tap()
        XCTAssertTrue(app.buttons["selectDocuments"].waitForExistence(timeout: 5))
        app.buttons["selectDocuments"].tap()
        let file = app.buttons["AcmeBank_Statement_2026-09.pdf"]
        file.tap()
        XCTAssertEqual(file.value as? String, "Selected")
        app.buttons["documentBatchMenu"].tap()
        app.buttons["Download ZIP"].tap()
        app.buttons["runDocumentBatch"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Share or save ZIP"].firstMatch.waitForExistence(timeout: 5))
        capture("Selected document archive")
        app.buttons["closeDocumentBatch"].tap()
        file.tap()
        app.buttons["documentBatchMenu"].tap()
        app.buttons["Parse documents"].tap()
        app.buttons["runDocumentBatch"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["All documents processed"].firstMatch.waitForExistence(timeout: 5))
    }

    func testEveryNativeFeatureOpensWithoutWebKit() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
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
            let search = visibleSearchField(app)
            XCTAssertTrue(search.waitForExistence(timeout: 5), id)
            search.tap()
            if let text = search.value as? String, text != "Find a feature", !text.isEmpty {
                search.typeText(
                    String(repeating: XCUIKeyboardKey.delete.rawValue, count: text.count)
                )
            }
            search.typeText(title)
            let link = app.buttons["feature-\(id)"]
            XCTAssertTrue(link.waitForExistence(timeout: 5), id)
            link.tap()
            XCTAssertEqual(app.webViews.count, 0, id)
            XCTAssertTrue(app.navigationBars.buttons["Workspace"].waitForExistence(timeout: 5), id)
            if ["portfolio", "calendar", "timesheet", "health-heart", "chat", "settings"].contains(
                id
            ) {
                capture("Native \(id)")
            }
            app.navigationBars.buttons["Workspace"].tap()
        }
    }

    func testCalendarWeekdayLayout() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        visibleSearchField(app).tap()
        visibleSearchField(app).typeText("Calendar")
        app.buttons["feature-calendar"].tap()
        for weekday in 0 ..< 7 {
            XCTAssertTrue(app.descendants(matching: .any)["calendarWeekday-\(weekday)"].firstMatch.waitForExistence(timeout: 5))
        }
        capture("Native calendar readable weekdays")
    }

    func testCalendarOverlaysAndLayerControls() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        visibleSearchField(app).tap()
        visibleSearchField(app).typeText("Calendar")
        app.buttons["feature-calendar"].tap()
        let moon = app.descendants(matching: .any)["calendarMoon"].firstMatch
        for _ in 0 ..< 4 where !moon.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(moon.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Sunrise"].firstMatch.exists)
        capture("Native calendar almanac")
        app.buttons["calendarLayers"].tap()
        app.descendants(matching: .any)["Moon phases & eclipses"].firstMatch.tap()
        XCTAssertFalse(moon.waitForExistence(timeout: 2))
        app.buttons["calendarLayers"].tap()
        app.descendants(matching: .any)["Moon phases & eclipses"].firstMatch.tap()
        XCTAssertTrue(moon.waitForExistence(timeout: 5))
    }

    func testNativePortfolioAndChatHistory() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        let search = visibleSearchField(app)
        search.tap()
        search.typeText("Portfolio")
        app.buttons["feature-portfolio"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["netWorth"].firstMatch.waitForExistence(timeout: 5))
        capture("Native portfolio readable history")
        app.swipeUp()
        capture("Native portfolio allocation ring")
        app.navigationBars.buttons["Workspace"].tap()
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Portfolio".count))
        search.typeText("Calendar")
        app.buttons["feature-calendar"].tap()
        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        capture("Native calendar weekday labels")
        app.navigationBars.buttons["Workspace"].tap()
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Calendar".count))
        search.typeText("Chat")
        app.buttons["feature-chat"].tap()
        let field = app.textFields["chatMessage"]
        let message = field.exists ? field : app.textViews["chatMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("Acme test question")
        app.buttons["sendChat"].tap()
        let reply = app.descendants(matching: .any)["This is a demo response. Connect your server to use your configured assistant."].firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["chatActions"].firstMatch.tap()
        app.descendants(matching: .any)["History"].firstMatch.tap()
        let thread = app.buttons["Acme test question"].firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 5))
        thread.swipeLeft()
        app.buttons["Rename"].firstMatch.tap()
        let title = app.alerts.textFields.firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Acme test question".count))
        title.typeText("Acme renamed conversation")
        app.alerts.buttons["Save"].tap()
        let renamed = app.buttons["Acme renamed conversation"].firstMatch
        XCTAssertTrue(renamed.waitForExistence(timeout: 5))
        renamed.tap()
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("Acme follow-up")
        app.buttons["sendChat"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Acme follow-up"].firstMatch.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["chatActions"].firstMatch.tap()
        app.descendants(matching: .any)["History"].firstMatch.tap()
        XCTAssertTrue(renamed.waitForExistence(timeout: 5), "Continuing a chat must preserve its renamed title")
        renamed.tap()
        capture("Native resumed conversation")
    }

    func testNativeIncomeCRUD() {
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        let search = visibleSearchField(app)
        search.tap()
        search.typeText("Income")
        app.buttons["feature-income"].tap()
        app.buttons["add-sources"].tap()
        let name = app.textFields["field-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Acme New Income")
        let amount = app.textFields["field-amount"]
        amount.tap()
        amount.typeText("123.45")
        app.buttons["submitNativeForm"].tap()
        let row = app.descendants(matching: .any)["Acme New Income"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        app.buttons["editRecord"].tap()
        XCTAssertTrue(app.textFields["field-name"].waitForExistence(timeout: 5))
        app.textFields["field-name"].tap()
        app.textFields["field-name"].typeText(" Reviewed")
        app.buttons["submitNativeForm"].tap()
        let updated = app.descendants(matching: .any)["Acme New Income Reviewed"].firstMatch
        XCTAssertTrue(updated.waitForExistence(timeout: 5))
        updated.tap()
        let delete = app.buttons["deleteRecord"]
        for _ in 0 ..< 3 where !delete.isHittable {
            app.swipeUp()
        }
        delete.tap()
        let confirm = app.buttons["confirmDeleteRecord"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(app.buttons["add-sources"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["Acme New Income Reviewed"].firstMatch.exists)
        capture("Native income management")
    }

    func testRealHandlerConnectionPreviewAndWorkspaceSession() async throws {
        guard let address = ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_SERVER"] else {
            throw XCTSkip(
                "Optional integration test requires the isolated synthetic fixture server."
            )
        }
        // Only the documented loopback fixture is allowed; never exercise a real vault.
        guard address == "http://127.0.0.1:31305" else {
            XCTFail("Only the synthetic loopback fixture is allowed")
            return
        }
        let countersURL = URL(string: address + "/__test/counters")!
        let (baseline, _) = try await URLSession.shared.data(from: countersURL)
        let before = try JSONDecoder().decode([String: Int].self, from: baseline)
        let app = launchDemo()
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["Leave demo & connect server"].tap()
        app.buttons["confirmSignOut"].firstMatch.tap()
        let url = app.textFields["serverURL"]
        XCTAssertTrue(url.waitForExistence(timeout: 10))
        if app.buttons["clearServerURL"].exists {
            app.buttons["clearServerURL"].tap()
        }
        url.tap()
        url.typeText(address)
        app.buttons["Done"].firstMatch.tap()
        let password = app.secureTextFields["Password"]
        reveal(app, password)
        password.tap()
        password.typeText("synthetic-password")
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Connect to DocVault"].tap()
        XCTAssertTrue(
            app.buttons["entity-acme"].waitForExistence(timeout: 10), app.debugDescription
        )
        app.buttons["entity-acme"].tap()
        let document = app.descendants(matching: .any)["Acme Statement #1.pdf"].firstMatch
        XCTAssertTrue(document.waitForExistence(timeout: 10))
        document.tap()
        app.buttons["previewDocument"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        capture("Live handler PDF preview")
        app.buttons["closeDocumentPreview"].firstMatch.tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let form = app.descendants(matching: .any)["Synthetic Form.pdf"].firstMatch
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        form.tap()
        app.descendants(matching: .any)["Document actions"].firstMatch.tap()
        app.descendants(matching: .any)["Fill PDF form"].firstMatch.tap()
        let pdfName = app.textFields["pdfField-DemoName"]
        XCTAssertTrue(pdfName.waitForExistence(timeout: 10))
        pdfName.tap()
        pdfName.typeText("Acme Test")
        app.buttons["fillPDF"].tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].firstMatch.waitForExistence(timeout: 10))
        capture("Native filled PDF")
        app.buttons["closeDocumentPreview"].firstMatch.tap()
        let savePDF = app.buttons["saveFilledPDF"]
        XCTAssertTrue(savePDF.waitForExistence(timeout: 5))
        savePDF.tap()
        XCTAssertTrue(app.buttons["Upload document"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["uploadFilename"].value as? String, "Synthetic Form_filled.pdf")
        app.buttons["Upload document"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Document uploaded"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        app.buttons["Workspace"].firstMatch.tap()
        let workspaceSearch = app.searchFields["Find a feature"]
        XCTAssertTrue(workspaceSearch.waitForExistence(timeout: 5))
        workspaceSearch.tap(); workspaceSearch.typeText("Server Settings")
        let settings = app.descendants(matching: .any)["feature-settings"].firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let section = app.descendants(matching: .any)["featureSection"].firstMatch
        XCTAssertTrue(section.waitForExistence(timeout: 5))
        section.tap()
        app.descendants(matching: .any)["AI & Chat"].firstMatch.tap()
        XCTAssertTrue(app.buttons["editResource"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.webViews.count, 0)
        let (current, _) = try await URLSession.shared.data(from: countersURL)
        let after = try JSONDecoder().decode([String: Int].self, from: current)
        XCTAssertGreaterThan(
            after["settings"] ?? 0, before["settings"] ?? 0,
            "Native settings must make an authenticated request"
        )
        XCTAssertGreaterThan(
            after["documents"] ?? 0, before["documents"] ?? 0,
            "Native preview must fetch the real handler's document"
        )
        capture("Authenticated native settings")
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["Sign out"].tap()
        app.buttons["confirmSignOut"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Connect to DocVault"].waitForExistence(timeout: 10))
    }

    func testWorksheetsLoadSourcesKeepOverridesAndShowCompleteSchedules() async throws {
        guard ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_SERVER"] == "http://127.0.0.1:31305" else {
            throw XCTSkip("Requires the isolated synthetic fixture.")
        }
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-worksheets")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let app = launchDemo()
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["Leave demo & connect server"].tap()
        app.buttons["confirmSignOut"].firstMatch.tap()
        let url = app.textFields["serverURL"]
        XCTAssertTrue(url.waitForExistence(timeout: 10))
        if app.buttons["clearServerURL"].exists {
            app.buttons["clearServerURL"].tap()
        }
        url.tap()
        url.typeText("http://127.0.0.1:31305")
        app.buttons["Done"].firstMatch.tap()
        reveal(app, app.secureTextFields["Password"])
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("synthetic-password")
        app.buttons["Done"].firstMatch.tap()
        let connect = app.buttons["Connect to DocVault"]
        reveal(app, connect)
        connect.tap()
        let connected = app.buttons["entity-acme"].waitForExistence(timeout: 10)
        if !connected {
            capture("Synthetic connection failure")
        }
        XCTAssertTrue(connected, app.debugDescription)
        app.buttons["Workspace"].firstMatch.tap()
        let search = visibleSearchField(app)
        search.tap()
        search.typeText("Solo")
        app.buttons["feature-solo-401k"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["worksheetSource"].firstMatch.waitForExistence(timeout: 10))
        let gross = app.textFields["calculator-gross"]
        let expenses = app.textFields["calculator-expenses"]
        XCTAssertEqual(gross.value as? String, "25000.0")
        XCTAssertEqual(expenses.value as? String, "2500.0")
        gross.tap()
        gross.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "25000.0".count) + "30000")
        app.navigationBars.buttons["Workspace"].tap()
        app.buttons["feature-solo-401k"].tap()
        XCTAssertTrue(gross.waitForExistence(timeout: 5))
        XCTAssertEqual(gross.value as? String, "30000")
        capture("Native Solo worksheet source defaults and overrides")
        let section = app.descendants(matching: .any)["featureSection"].firstMatch
        section.tap()
        app.buttons["Contributions"].firstMatch.tap()
        XCTAssertTrue(app.buttons["add-contributions"].waitForExistence(timeout: 5))
        app.buttons["add-contributions"].tap()
        let date = app.textFields["field-date"]
        XCTAssertTrue(date.waitForExistence(timeout: 5))
        date.tap()
        date.typeText("2026-10-06")
        app.textFields["field-amount"].tap()
        app.textFields["field-amount"].typeText("100")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.buttons["add-contributions"].waitForExistence(timeout: 5))
        section.tap()
        app.buttons["Contribution Calculator"].firstMatch.tap()
        let total = app.descendants(matching: .any)["contributionTotal"].firstMatch
        XCTAssertTrue(total.waitForExistence(timeout: 5))
        XCTAssertTrue(total.label.contains("$100.00"), total.label)
        app.navigationBars.buttons["Workspace"].tap()
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Solo".count) + "Tennessee")
        app.buttons["feature-tn-tax"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["worksheetSource"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(gross.value as? String, "25000.0")
        XCTAssertEqual(expenses.value as? String, "2000.0")
        let payments = app.buttons["Schedule E payments"].firstMatch
        for _ in 0 ..< 5 where !payments.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(payments.waitForExistence(timeout: 5))
        payments.tap()
        let installment = app.textFields["calculator-e.2a"]
        XCTAssertTrue(installment.waitForExistence(timeout: 5))
        installment.tap()
        installment.typeText("100")
        capture("Native Tennessee required installment fields")
        app.swipeUp()
        let schedules = app.buttons["Calculated schedules"].firstMatch
        for _ in 0 ..< 8 where !schedules.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(schedules.waitForExistence(timeout: 5))
        schedules.tap()
        let scheduleE = app.buttons["Schedule E"].firstMatch
        for _ in 0 ..< 3 where !scheduleE.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(scheduleE.waitForExistence(timeout: 5))
        scheduleE.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Line 2A · Q1 Required Installment"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func launchMarketFixture() async throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_SERVER"] == "http://127.0.0.1:31305" else {
            throw XCTSkip("Requires the isolated synthetic fixture.")
        }
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:31305/__test/reset-markets")!)
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw NSError(domain: "SyntheticFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not reset fabricated markets"])
        }
        let app = launchDemo()
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["Leave demo & connect server"].tap()
        app.buttons["confirmSignOut"].firstMatch.tap()
        let url = app.textFields["serverURL"]
        XCTAssertTrue(url.waitForExistence(timeout: 10))
        if app.buttons["clearServerURL"].exists {
            app.buttons["clearServerURL"].tap()
        }
        url.tap()
        url.typeText("http://127.0.0.1:31305")
        app.buttons["Done"].firstMatch.tap()
        let password = app.secureTextFields["Password"]
        reveal(app, password)
        password.tap()
        password.typeText("synthetic-password")
        app.buttons["Done"].firstMatch.tap()
        let connect = app.buttons["Connect to DocVault"]
        reveal(app, connect)
        connect.tap()
        let connected = app.buttons["Workspace"].firstMatch.waitForExistence(timeout: 10)
        if !connected {
            capture("Synthetic connection failure")
        }
        XCTAssertTrue(connected, app.debugDescription)
        app.buttons["Workspace"].firstMatch.tap()
        return app
    }

    private func marketFeature(_ app: XCUIApplication, id: String, name: String) {
        let search = visibleSearchField(app)
        search.tap(); search.typeText(name)
        let feature = app.descendants(matching: .any)["feature-" + id].firstMatch
        XCTAssertTrue(feature.waitForExistence(timeout: 5)); feature.tap()
        if id != "predictions" {
            let selector = app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ["featureSection", "featureScope", "featureEntity", "featureYear"])).firstMatch
            XCTAssertTrue(selector.waitForExistence(timeout: 5))
        }
    }

    private func launchFinanceFixture() async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-finance")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return app
    }

    private func launchTaxFixture() async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-tax")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        marketFeature(app, id: "tax-year", name: "Tax Year")
        let options = taxOptions(app)
        let entity = app.descendants(matching: .any)["featureEntity"].firstMatch
        entity.tap(); app.buttons["Tax Demo LLC"].firstMatch.tap()
        app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2026"].firstMatch.tap()
        if options {
            app.buttons["closeFeatureScope"].tap()
        }
        if ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] == "1" {
            XCTAssertTrue(app.descendants(matching: .any)["nativeTaxYear"].firstMatch.waitForExistence(timeout: 10))
        } else {
            XCTAssertTrue(app.staticTexts["Recorded income"].firstMatch.waitForExistence(timeout: 10))
        }
        return app
    }

    private func taxOptions(_ app: XCUIApplication) -> Bool {
        let options = app.buttons["featureScope"].firstMatch
        if options.exists {
            options.tap(); return true
        }
        return false
    }

    private func taxReview(_ app: XCUIApplication, _ name: String) {
        let picker = app.descendants(matching: .any)["taxReviewSection"].firstMatch
        for _ in 0 ..< 15 where !picker.isHittable {
            app.collectionViews["nativeTaxYear"].firstMatch.swipeDown()
        }
        XCTAssertTrue(picker.isHittable, app.debugDescription)
        picker.tap(); app.buttons[name].firstMatch.tap()
    }

    private func taxReveal(_ app: XCUIApplication, _ element: XCUIElement, scrollUp: Bool = false) {
        for _ in 0 ..< 35 {
            if element.exists && element.isHittable { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: scrollUp ? 0.45 : 0.72))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: scrollUp ? 0.65 : 0.52)))
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    private func documentAction(_ app: XCUIApplication, _ name: String) {
        let menu = app.buttons["Document actions"].firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: menu)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        // The iOS 26 menu wrapper can report an invalid synthesized hit point
        // after a sheet closes even though its visible frame is valid.
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let action = app.buttons[name].firstMatch
        XCTAssertTrue(action.waitForExistence(timeout: 5)); action.tap()
    }

    private func tapSwitch(_ element: XCUIElement) {
        // SwiftUI can expose the entire labelled row as a switch. Tap its control.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
    }

    private func taxFrame(_ app: XCUIApplication, _ identifier: String) {
        let isMetrics = ["taxYearOverviewMetrics", "financialMetrics", "businessMetrics", "businessCurrentMonthMetrics", "researchMetrics", "knowledgeMetrics", "operationsMetrics", "logsMetrics", "usageMetrics", "reportMetrics"].contains(identifier)
        let prefix = identifier.hasPrefix("report") ? "reportCard-" : ["operations", "logs", "usage"].contains(where: { identifier.hasPrefix($0) }) ? "operationsCard-" : identifier.hasPrefix("research") ? "researchCard-" : identifier.hasPrefix("knowledge") ? "knowledgeCard-" : identifier.hasPrefix("business") ? "businessCard-" : identifier.hasPrefix("financial") ? "financialCard-" : "taxCard-"
        let card = app.descendants(matching: .any)[isMetrics ? identifier : prefix + identifier].firstMatch
        reveal(app, card, requireHittable: false)
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let options = app.buttons["featureScope"].firstMatch
        let selector = app.descendants(matching: .any)["featureSection"].firstMatch
        let year = app.descendants(matching: .any)["featureYear"].firstMatch
        let top = (options.exists ? options.frame.maxY : selector.exists ? selector.frame.maxY : year.exists ? year.frame.maxY : app.navigationBars.firstMatch.frame.maxY) + 18
        let tabY = app.buttons["Settings"].firstMatch.frame.minY
        let bottom = tabY > app.frame.height * 0.6 ? tabY - 14 : app.frame.height - 20
        let available = bottom - top
        let chart = app.descendants(matching: .any)[identifier].firstMatch
        let target = !isMetrics && card.frame.height > available && chart.exists ? chart : card
        let dragX = ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] == "1" && app.frame.width < 500 ? 0.04 : 0.5
        for _ in 0 ..< 5 {
            guard target.exists else { break }
            let rect = target.frame
            if rect.minY >= top - 12, rect.maxY <= bottom + 12 {
                break
            }
            let delta = rect.height > available ? rect.minY - top : rect.midY - (top + bottom) / 2
            if abs(delta) < 10 {
                break
            }
            let startY = top + available * (delta > 0 ? 0.75 : 0.25)
            let endY = startY - max(-available * 0.4, min(available * 0.4, delta))
            app.coordinate(withNormalizedOffset: CGVector(dx: dragX, dy: startY / app.frame.height))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: dragX, dy: endY / app.frame.height)), withVelocity: .slow, thenHoldForDuration: 0.25)
        }
        if target.exists, target.frame.height <= available {
            XCTAssertGreaterThanOrEqual(target.frame.minY, top - 12)
            XCTAssertLessThanOrEqual(target.frame.maxY, bottom + 12)
        }
    }

    private func launchBusinessFixture(_ kind: String) async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:31305/__test/reset-business")!)
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        marketFeature(app, id: kind, name: kind == "sales" ? "Sales" : "Mileage")
        businessScope(app, entity: "Acme Test Vault", year: "2026")
        XCTAssertTrue(app.descendants(matching: .any)["nativeBusiness-" + kind].firstMatch.waitForExistence(timeout: 10))
        return app
    }

    private func launchResearchFixture(_ id: String, _ name: String) async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-research")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let search = visibleSearchField(app)
        search.tap(); search.typeText(name)
        let feature = app.descendants(matching: .any)["feature-" + id].firstMatch
        XCTAssertTrue(feature.waitForExistence(timeout: 5)); feature.tap()
        return app
    }

    private func researchReview(_ app: XCUIApplication, _ section: String, knowledge: Bool = false) {
        app.buttons[knowledge ? "knowledgeReviewSection" : "researchReviewSection"].firstMatch.tap()
        app.buttons[section].firstMatch.tap()
    }

    private func launchOperationsFixture(_ section: String) async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-operations")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        marketFeature(app, id: "settings", name: "Server Settings")
        marketSection(app, section)
        return app
    }

    private func launchAdministrationFixture(_ section: String? = nil) async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-administration")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        if let section {
            marketFeature(app, id: "settings", name: "Server Settings"); marketSection(app, section)
        } else {
            let search = visibleSearchField(app); search.tap(); search.typeText("External Sources"); app.buttons["feature-external-sources"].firstMatch.tap()
        }
        return app
    }

    private func administrationFrame(_ app: XCUIApplication, _ id: String) {
        let item = app.descendants(matching: .any)[id].firstMatch
        for _ in 0 ..< 20 {
            let tabY = app.buttons["Settings"].firstMatch.frame.minY
            let bottom = tabY > app.frame.height * 0.6 ? tabY - 14 : app.frame.height - 35
            if item.exists, !item.frame.isEmpty, item.frame.minY >= 210, item.frame.maxY < bottom {
                break
            }
            if item.exists, !item.frame.isEmpty, abs(item.frame.minY - 210) < 65 {
                break
            }
            let difference = item.exists && !item.frame.isEmpty ? item.frame.minY - 210 : app.frame.height * 0.3
            let distance = min(0.3, max(-0.3, difference / app.frame.height))
            let start = distance < 0 ? 0.4 : 0.7
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: start)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: start - distance)), withVelocity: .slow, thenHoldForDuration: 0.25)
        }
        XCTAssertTrue(item.waitForExistence(timeout: 10))
    }

    private func administrationInput(_ app: XCUIApplication, _ id: String, _ value: String, multiline: Bool = false) {
        let field = multiline ? app.textViews[id].firstMatch : app.textFields[id].firstMatch
        taxReveal(app, field); field.tap()
        if !multiline, let old = field.value as? String, old != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
        }
        field.typeText(value)
        for name in ["instructionKeyboardDone", "sourceSetupKeyboardDone", "providerEditorKeyboardDone", "entityEditorKeyboardDone", "filingEditorKeyboardDone", "uploadKeyboardDone", "documentOrganizationKeyboardDone", "reportConfigKeyboardDone", "invoiceKeyboardDone"] where app.buttons[name].firstMatch.exists {
            app.buttons[name].firstMatch.tap(); break
        }
    }

    private func visibleSearchField(_ app: XCUIApplication) -> XCUIElement {
        let field = app.searchFields.firstMatch
        let control = app.navigationBars.buttons["Search"].firstMatch
        if !field.exists, control.exists {
            control.tap()
        }
        for _ in 0 ..< 10 where !field.exists {
            app.swipeDown()
        }
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        return field
    }

    func testNativeBrainAndSkillsReadPreviewEditDraftRetryAndDelete() async throws {
        continueAfterFailure = false
        let app = try await launchAdministrationFixture("Brain")
        XCTAssertTrue(app.descendants(matching: .any)["brainMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native Brain saved metrics")
        administrationFrame(app, "adminCard-brainSectionChart"); capture("Native Brain section words")
        app.buttons["brainActions"].firstMatch.tap(); app.buttons["Edit memory"].firstMatch.tap()
        administrationInput(app, "instructionContent", "\nA revised fictional preference.", multiline: true)
        app.buttons["Preview"].firstMatch.tap(); capture("Native Brain draft Markdown preview")
        var failure = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/fail-administration-save"))); failure.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: failure)
        app.buttons["instructionSave"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["instructionError"].firstMatch.waitForExistence(timeout: 10)); capture("Native Brain failed save kept draft")
        XCTAssertTrue(healthText(app, "A revised fictional preference.").exists)
        app.buttons["instructionSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["brainActions"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["brainActions"].firstMatch.tap(); app.buttons["Append a note"].firstMatch.tap()
        administrationInput(app, "instructionTag", "decision")
        administrationInput(app, "instructionContent", "An appended fictional decision.", multiline: true)
        capture("Native Brain append note editor"); app.buttons["instructionSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["brainActions"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(healthText(app, "An appended fictional decision.").waitForExistence(timeout: 10))
        administrationFrame(app, "brainSavedContent"); capture("Native Brain saved appended note")
        app.buttons["brainActions"].firstMatch.tap(); app.buttons["Edit memory"].firstMatch.tap()
        administrationInput(app, "instructionContent", "\nUnsaved fictional draft.", multiline: true)
        app.buttons["instructionCancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["instructionDiscard"].firstMatch.waitForExistence(timeout: 5)); capture("Native Brain discard confirmation"); app.buttons["instructionDiscard"].firstMatch.tap()
        XCTAssertTrue(app.buttons["instructionSave"].firstMatch.waitForNonExistence(timeout: 10))
        let sectionButton = app.buttons["featureSection"].firstMatch
        sectionButton.tap()
        if !app.navigationBars["Sections"].waitForExistence(timeout: 2) {
            sectionButton.tap()
        }
        let sectionSearch = app.searchFields["Find a section"].firstMatch
        XCTAssertTrue(sectionSearch.waitForExistence(timeout: 10)); sectionSearch.tap(); sectionSearch.typeText("Skills")
        app.buttons["section-skills"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["skillsMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native Skills saved metrics")
        administrationFrame(app, "adminCard-skillsSizeChart"); capture("Native Skills instruction sizes")
        let skill = app.buttons["skill-document-review"].firstMatch; taxReveal(app, skill); skill.tap()
        XCTAssertTrue(app.descendants(matching: .any)["skillInstructions"].firstMatch.waitForExistence(timeout: 10)); capture("Native Skill formatted instructions")
        app.buttons["skillEditToolbar"].firstMatch.tap()
        administrationInput(app, "instructionDescription", "Revised fictional source review.")
        administrationInput(app, "instructionContent", "\nPreserve exact evidence.", multiline: true)
        app.buttons["Preview"].firstMatch.tap(); capture("Native Skill draft preview"); app.buttons["instructionSave"].firstMatch.tap()
        XCTAssertTrue(healthText(app, "Revised fictional source review.").waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["skillsCreateToolbar"].firstMatch.tap()
        administrationInput(app, "instructionName", "acme-new-review")
        administrationInput(app, "instructionDescription", "An invented new review.")
        administrationInput(app, "instructionContent", "# Acme review\n\nRead the complete source.", multiline: true)
        capture("Native New Skill editor"); app.buttons["instructionSave"].firstMatch.tap()
        let newSkill = app.buttons["skill-acme-new-review"].firstMatch; taxReveal(app, newSkill); newSkill.tap()
        let remove = app.buttons["skillDelete"].firstMatch; taxReveal(app, remove); remove.tap()
        app.buttons["confirmSkillDelete"].firstMatch.tap()
        XCTAssertTrue(app.buttons["skillsCreateToolbar"].firstMatch.waitForExistence(timeout: 10)); XCTAssertFalse(newSkill.exists)
        capture("Native Skills after deletion")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeExternalSourceFoldersSearchLinksReadingAndSyncFailure() async throws {
        continueAfterFailure = false
        let app = try await launchAdministrationFixture()
        XCTAssertTrue(app.descendants(matching: .any)["sourcesMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native External Sources metrics")
        administrationFrame(app, "adminCard-sourcesStatusChart"); capture("Native External Sources status chart")
        administrationFrame(app, "adminCard-sourcesFileChart"); capture("Native External Sources file chart")
        let source = app.buttons["source-acme-library"].firstMatch; taxReveal(app, source); source.tap()
        XCTAssertTrue(app.buttons["sourceFile-README.md"].firstMatch.waitForExistence(timeout: 10)); capture("Native Source library folders")
        app.buttons["sourceFolder-Guides"].firstMatch.tap(); capture("Native Source folder breadcrumbs")
        app.buttons["sourceFile-Guides/Overview.md"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["sourceFormattedContent"].firstMatch.waitForExistence(timeout: 10)); capture("Native Source formatted reader")
        let home = app.links["Home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 5)); home.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["README"].waitForExistence(timeout: 10)); capture("Native Source relative Markdown link")
        let wiki = app.links["the overview"].firstMatch
        XCTAssertTrue(wiki.waitForExistence(timeout: 5)); wiki.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Overview"].waitForExistence(timeout: 10)); capture("Native Source wiki link")
        app.buttons["Plain text"].firstMatch.tap(); capture("Native Source plain text reader")
        app.buttons["sourcePreviousPage"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["README"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let search = visibleSearchField(app); search.tap(); search.typeText("ARCHIVE\n")
        XCTAssertTrue(app.buttons["sourceFile-Archive/Notes.md"].firstMatch.waitForExistence(timeout: 5)); capture("Native Source search across folders")
        app.buttons["sourceManage"].firstMatch.tap(); capture("Native Source management")
        app.buttons["sourceSync"].firstMatch.tap(); app.buttons["confirmSourceSync"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["sourceManagementError"].firstMatch.waitForExistence(timeout: 10)); capture("Native Source sync failure diagnostic")
        XCTAssertTrue(healthText(app, "Sync failed").exists)
        app.buttons["sourceManagementDone"].firstMatch.tap()
        XCTAssertTrue(app.buttons["sourceFile-Archive/Notes.md"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeExternalSourceAddRemoveAndWriteOnlyToken() async throws {
        continueAfterFailure = false
        let app = try await launchAdministrationFixture()
        XCTAssertTrue(app.descendants(matching: .any)["sourcesMetrics"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["sourcesAddToolbar"].firstMatch.tap()
        administrationInput(app, "sourceURLInput", "https://example.com/acme/new-library.git")
        administrationInput(app, "sourceNameInput", "Acme New Library")
        capture("Native Add Repository editor"); app.buttons["sourceSetupSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["sourcesAddToolbar"].firstMatch.waitForExistence(timeout: 10))
        let search = visibleSearchField(app); search.tap(); search.typeText("Acme New\n")
        let added = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "source-", "Acme New Library")).firstMatch
        taxReveal(app, added); capture("Native Repository not synced state"); added.tap()
        app.buttons["sourceManage"].firstMatch.tap()
        app.buttons["sourceRemove"].firstMatch.tap(); app.buttons["confirmSourceRemove"].firstMatch.tap()
        XCTAssertTrue(app.buttons["sourcesAddToolbar"].firstMatch.waitForExistence(timeout: 10))
        let clearSearch = visibleSearchField(app); clearSearch.tap(); clearSearch.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Acme New".count) + "\n")
        if app.buttons["Close"].firstMatch.exists {
            app.buttons["Close"].firstMatch.tap()
        } else if app.buttons["Cancel"].firstMatch.exists {
            app.buttons["Cancel"].firstMatch.tap()
        }
        // An empty iPad search disables its submit key; use the visible keyboard-hide control.
        let searchKeyboard = app.keyboards.firstMatch
        if searchKeyboard.exists, app.frame.width > 700 {
            let hideKeyboard = searchKeyboard.buttons["Hide keyboard"].firstMatch
            if hideKeyboard.exists {
                hideKeyboard.tap()
            } else {
                searchKeyboard.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.95)).tap()
            }
        }
        let keyboardDismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: app.keyboards)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardDismissed], timeout: 5), .completed)
        let token = app.buttons["sourcesToken"].firstMatch; taxReveal(app, token); token.tap()
        let secret = app.secureTextFields["sourceTokenInput"].firstMatch; XCTAssertTrue(secret.waitForExistence(timeout: 5)); secret.tap(); secret.typeText("synthetic-token-only")
        if app.buttons["sourceSetupKeyboardDone"].firstMatch.exists {
            app.buttons["sourceSetupKeyboardDone"].firstMatch.tap()
        }
        capture("Native GitHub token write-only editor"); app.buttons["sourceSetupSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["sourceSetupSave"].firstMatch.waitForNonExistence(timeout: 10)); taxReveal(app, token); token.tap()
        XCTAssertTrue(app.buttons["sourceTokenRemove"].firstMatch.waitForExistence(timeout: 5)); capture("Native GitHub token configured state")
        XCTAssertFalse((secret.value as? String ?? "").contains("synthetic-token-only"))
        app.buttons["sourceTokenRemove"].firstMatch.tap(); app.buttons["confirmSourceTokenRemove"].firstMatch.tap()
        XCTAssertTrue(app.buttons["sourceTokenRemove"].firstMatch.waitForNonExistence(timeout: 10)); taxReveal(app, token); capture("Native GitHub token removed state")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeSourceReaderRelativeLinkRegression() {
        continueAfterFailure = false
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        visibleSearchField(app).tap(); visibleSearchField(app).typeText("External Sources")
        app.buttons["feature-external-sources"].firstMatch.tap()
        let source = app.buttons["source-acme-library"].firstMatch; operationsReach(app, source); source.tap()
        app.buttons["sourceFolder-Guides"].firstMatch.tap(); app.buttons["sourceFile-Guides/Overview.md"].firstMatch.tap()
        let home = app.links["Home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        home.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["README"].waitForExistence(timeout: 5), "A real tap on the relative Markdown link must open its page.")
    }

    func testNativeProviderSettingsFocusedDraftsSecretsAndDemoSend() {
        continueAfterFailure = false
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "settings", name: "Server Settings"); marketSection(app, "Email")
        XCTAssertTrue(app.descendants(matching: .any)["providerSettingsMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native Email saved configuration")
        let edit = app.buttons["providerEdit-email"].firstMatch; taxReveal(app, edit); edit.tap()
        let newsCC = app.textFields["providerField-email.cc.news"].firstMatch
        taxReveal(app, newsCC)
        XCTAssertEqual(newsCC.value as? String, "news@example.com")
        administrationInput(app, "providerField-email.cc.news", "revised-news@example.com")
        capture("Native Email focused CC editor")
        app.buttons["providerEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEdit-email"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(healthText(app, "billing@example.com").exists)
        taxReveal(app, edit); edit.tap()
        administrationInput(app, "providerField-email.fromName", "Unsaved fictional sender")
        app.buttons["providerEditorCancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorDiscard"].firstMatch.waitForExistence(timeout: 5)); capture("Native Provider discard protection"); app.buttons["providerEditorDiscard"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        let replace = app.buttons["providerReplace-email.resendApiKey"].firstMatch; taxReveal(app, replace, scrollUp: true); replace.tap()
        XCTAssertFalse(app.buttons["providerConfirmRemove"].firstMatch.exists)
        let secret = app.secureTextFields["providerField-email.resendApiKey"].firstMatch
        XCTAssertTrue(secret.waitForExistence(timeout: 5)); XCTAssertTrue((secret.value as? String ?? "").isEmpty || secret.value as? String == secret.placeholderValue)
        XCTAssertFalse(app.buttons["providerEditorSave"].firstMatch.isEnabled)
        secret.tap(); secret.typeText("synthetic-demo-key")
        if app.buttons["providerEditorKeyboardDone"].firstMatch.exists {
            app.buttons["providerEditorKeyboardDone"].firstMatch.tap()
        }
        capture("Native Provider write-only credential"); app.buttons["providerEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        let send = app.buttons["providerTestEmail"].firstMatch; taxReveal(app, send); send.tap()
        XCTAssertTrue(app.buttons["providerConfirmTestEmail"].firstMatch.waitForExistence(timeout: 5)); capture("Native Email explicit test confirmation")
        XCTAssertTrue(healthText(app, "Recipient: reader@example.com. No CC is used.").exists)
        app.buttons["providerConfirmTestEmail"].firstMatch.tap()
        let feedback = app.staticTexts["providerSettingsFeedback"].firstMatch
        taxReveal(app, feedback, scrollUp: true)
        XCTAssertEqual(feedback.label, "A demo attempt was recorded. No email was sent.")
        capture("Native Email simulated test result")
        let remove = app.buttons["providerRemove-email.resendApiKey"].firstMatch
        taxReveal(app, remove)
        remove.tap(); app.buttons["providerConfirmRemove"].firstMatch.tap()
        taxReveal(app, feedback, scrollUp: true)
        XCTAssertTrue(feedback.label.hasPrefix("The server saved the removal request."))
        taxReveal(app, remove)
        XCTAssertFalse(remove.isEnabled)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeTaskModelChoicesEffortAndNewsThemeDrafts() {
        continueAfterFailure = false
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "settings", name: "Server Settings"); marketSection(app, "AI & Chat")
        let edit = app.buttons["providerEdit-chat"].firstMatch; taxReveal(app, edit); edit.tap()
        XCTAssertTrue(app.descendants(matching: .any)["providerModelCatalog"].firstMatch.waitForExistence(timeout: 10))
        let models = app.buttons["providerModelChoices-chat.apiModel.model"].firstMatch; taxReveal(app, models); models.tap()
        XCTAssertTrue(app.buttons["providerModelChoice-demo-news"].firstMatch.waitForExistence(timeout: 10)); capture("Native Provider discovered model choices")
        app.buttons["providerModelChoice-demo-news"].firstMatch.tap()
        app.buttons["providerEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        taxReveal(app, healthText(app, "demo-news")); XCTAssertTrue(healthText(app, "high").exists); capture("Native Provider retained task effort")
        taxReveal(app, edit); edit.tap()
        let defaults = app.buttons["providerDefaultModel-chat.apiModel"].firstMatch; taxReveal(app, defaults); defaults.tap()
        app.buttons["providerEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        taxReveal(app, edit); edit.tap()
        let modelField = app.textFields["providerField-chat.apiModel.model"].firstMatch
        XCTAssertTrue(modelField.waitForExistence(timeout: 10)); XCTAssertTrue((modelField.value as? String ?? "").isEmpty || modelField.value as? String == modelField.placeholderValue)
        XCTAssertFalse(app.buttons["providerEditorSave"].firstMatch.isEnabled); capture("Native Provider restored model defaults")
        app.buttons["providerEditorCancel"].firstMatch.tap()
        let appearance = app.buttons["providerEdit-news-design"].firstMatch; taxReveal(app, appearance); appearance.tap()
        let themes = app.buttons["providerThemeChoices"].firstMatch; taxReveal(app, themes); themes.tap()
        XCTAssertTrue(app.buttons["providerThemeChoice-cycle"].firstMatch.waitForExistence(timeout: 10)); app.buttons["providerThemeChoice-cycle"].firstMatch.tap()
        let images = app.buttons["providerModelChoices-dailyNews.imageModel"].firstMatch; taxReveal(app, images); images.tap()
        XCTAssertTrue(app.buttons["providerModelChoice-demo-image"].firstMatch.waitForExistence(timeout: 10)); app.buttons["providerModelChoice-demo-image"].firstMatch.tap()
        capture("Native Provider theme and image model draft")
        app.buttons["providerEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["providerEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        taxReveal(app, healthText(app, "demo-image")); XCTAssertTrue(healthText(app, "cycle").exists); capture("Native Provider saved news appearance")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeMailDashboardSearchAndSavedAttemptDetails() {
        continueAfterFailure = false
        let app = launchDemo()
        app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "settings", name: "Server Settings"); marketSection(app, "Sent Mail")
        XCTAssertTrue(app.descendants(matching: .any)["mailMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native Mail saved attempt metrics")
        administrationFrame(app, "mailCard-mailOutcomeChart"); capture("Native Mail recorded outcomes")
        administrationFrame(app, "mailCard-mailPurposeChart"); capture("Native Mail purposes")
        administrationFrame(app, "mailCard-mailDailyChart"); capture("Native Mail dated attempts")
        let browse = app.buttons["mailBrowseAttempts"].firstMatch; taxReveal(app, browse); browse.tap()
        let failed = app.buttons["mailAttempt-demo-failure"].firstMatch; taxReveal(app, failed); failed.tap()
        XCTAssertTrue(app.descendants(matching: .any)["mailAttemptError"].firstMatch.waitForExistence(timeout: 10)); capture("Native Mail failed request detail")
        XCTAssertTrue(healthText(app, "Provider acceptance does not verify inbox delivery.").exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let invoice = app.buttons["mailAttempt-demo-invoice"].firstMatch; taxReveal(app, invoice); invoice.tap()
        XCTAssertTrue(healthText(app, "Acme_Invoice_Demo.pdf").waitForExistence(timeout: 10)); capture("Native Mail attachment metadata")
        taxReveal(app, app.buttons["mailShareAttempt"].firstMatch)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let search = visibleSearchField(app); search.tap(); search.typeText("invented provider\n")
        XCTAssertTrue(failed.waitForExistence(timeout: 10)); XCTAssertFalse(invoice.exists); capture("Native Mail searched failure")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeTaxFilingReminderAndSharedTodoWorkflows() {
        continueAfterFailure = false
        let app = launchDemo(); app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "tax-year", name: "Tax Year")
        let options = taxOptions(app)
        app.descendants(matching: .any)["featureEntity"].firstMatch.tap(); app.buttons["Acme Studio"].firstMatch.tap()
        if options {
            app.buttons["closeFeatureScope"].firstMatch.tap()
        }
        taxReveal(app, app.descendants(matching: .any)["filingTaskMetrics"].firstMatch); capture("Native Tax filing task metrics")
        administrationFrame(app, "filingCard-filingUrgencyChart"); capture("Native Tax reminder urgency")
        let add = app.buttons["filingAddReminder"].firstMatch; taxReveal(app, add); add.tap()
        administrationInput(app, "filingEditorTitle", "Acme filing rehearsal")
        app.descendants(matching: .any)["filingEditorRecurrence"].firstMatch.tap(); app.buttons["Quarterly"].firstMatch.tap()
        administrationInput(app, "filingEditorNotes", "Literal invented filing notes")
        capture("Native Tax scoped reminder draft"); app.buttons["filingEditorSave"].firstMatch.tap()
        XCTAssertTrue(healthText(app, "Acme filing rehearsal").waitForExistence(timeout: 10))
        let dismiss = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "filingDismiss-demo-deadline:")).firstMatch; taxReveal(app, dismiss); dismiss.tap()
        XCTAssertTrue(app.buttons["filingConfirmResolution"].firstMatch.waitForExistence(timeout: 5)); capture("Native Tax dismiss occurrence review"); app.buttons["filingConfirmResolution"].firstMatch.tap()
        let feedback = app.staticTexts["filingTaskFeedback"].firstMatch
        taxReveal(app, feedback, scrollUp: true)
        XCTAssertEqual(feedback.label, "Occurrence dismissed. Recurring tasks keep their next date.")
        let shared = app.buttons["filingToggleTodo-demo-review"].firstMatch; taxReveal(app, shared); shared.tap()
        let completed = app.switches["filingShowCompleted"].firstMatch; taxReveal(app, completed); tapSwitch(completed)
        taxReveal(app, shared, scrollUp: true); capture("Native Tax shared completed to-dos"); shared.tap()
        let addTodo = app.buttons["filingAddTodo"].firstMatch; taxReveal(app, addTodo); addTodo.tap()
        administrationInput(app, "filingEditorTitle", "Unsaved Acme task")
        app.buttons["filingEditorCancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["filingEditorDiscard"].firstMatch.waitForExistence(timeout: 5)); capture("Native Tax task draft protection"); app.buttons["filingEditorDiscard"].firstMatch.tap()
        XCTAssertFalse(healthText(app, "Unsaved Acme task").exists)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeEntityMetadataAndScopedTaxUpload() {
        continueAfterFailure = false
        let app = launchDemo(); app.buttons["Workspace"].firstMatch.tap()
        marketFeature(app, id: "tax-year", name: "Tax Year")
        let options = taxOptions(app)
        app.descendants(matching: .any)["featureEntity"].firstMatch.tap(); app.buttons["Acme Studio"].firstMatch.tap()
        app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2024"].firstMatch.tap()
        if options {
            app.buttons["closeFeatureScope"].firstMatch.tap()
        }
        let details = app.buttons["taxEntityDetails"].firstMatch; taxReveal(app, details); details.tap()
        XCTAssertTrue(app.descendants(matching: .any)["entityDetailsMetrics"].firstMatch.waitForExistence(timeout: 10)); capture("Native Tax entity information")
        let identifier = app.staticTexts["entityMetadata-ein"].firstMatch; taxReveal(app, identifier); XCTAssertEqual(identifier.label, "••••••••")
        app.buttons["entityReveal-ein"].firstMatch.tap(); XCTAssertEqual(identifier.label, "DEMO-IDENTIFIER"); app.buttons["entityReveal-ein"].firstMatch.tap()
        let edit = app.buttons["entityDetailsEdit"].firstMatch; for _ in 0 ..< 12 where !edit.isHittable {
            app.swipeDown()
        }; edit.tap()
        administrationInput(app, "entityNewKey", "Filing note"); administrationInput(app, "entityNewValue", "Invented entity note")
        let addField = app.buttons["entityAddField"].firstMatch; taxReveal(app, addField); addField.tap(); capture("Native Tax custom metadata draft"); app.buttons["entityEditorSave"].firstMatch.tap()
        XCTAssertTrue(app.buttons["entityEditorSave"].firstMatch.waitForNonExistence(timeout: 10))
        let saved = app.staticTexts["entityMetadata-filingNote"].firstMatch; taxReveal(app, saved); XCTAssertEqual(saved.label, "Invented entity note")
        let list = app.staticTexts["entityMetadata-naicsCodes"].firstMatch; taxReveal(app, list); XCTAssertEqual(list.label, "000000\n111111"); capture("Native Tax preserved text list")
        let structured = app.buttons["Calculation"].firstMatch; taxReveal(app, structured); structured.tap()
        XCTAssertTrue(healthText(app, "Invented structured value").waitForExistence(timeout: 10)); capture("Native Tax preserved structured value")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let add = app.buttons["taxAddDocuments"].firstMatch; taxReveal(app, add); add.tap(); app.buttons["Business receipts"].firstMatch.tap()
        XCTAssertTrue(app.buttons["taxSample-expenses/business"].firstMatch.waitForExistence(timeout: 5)); app.buttons["taxSample-expenses/business"].firstMatch.tap()
        XCTAssertTrue(app.textFields["uploadFolder"].firstMatch.waitForExistence(timeout: 10)); XCTAssertEqual(app.textFields["uploadFolder"].firstMatch.value as? String, "2024/expenses/business"); capture("Native Tax selected year upload destination")
        administrationInput(app, "uploadFilename", "Acme_Sample.pdf")
        app.buttons["uploadDocuments"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["uploadedPath"].firstMatch.waitForExistence(timeout: 10)); XCTAssertTrue(app.staticTexts["uploadedPath"].firstMatch.label.hasPrefix("2024/expenses/business/")); capture("Native Tax scoped upload saved")
        app.buttons["Done"].firstMatch.tap(); taxReview(app, "Documents")
        XCTAssertTrue(healthText(app, "Acme_Sample.pdf").waitForExistence(timeout: 10)); capture("Native Tax new analyzed source")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeOperationsOutcomesHistoryCustomEditsAndRunResults() async throws {
        continueAfterFailure = false
        let app = try await launchOperationsFixture("Jobs")
        operationsFrame(app, "operationsMetrics")
        XCTAssertTrue(app.descendants(matching: .any)["operationsMetrics"].firstMatch.waitForExistence(timeout: 10))
        capture("Native operations job metrics")
        operationsFrame(app, "operationsOutcomeChart"); capture("Native operations outcome chart")
        operationsFrame(app, "operationsScheduleChart"); capture("Native operations schedule chart")
        app.buttons["operationsReview"].firstMatch.tap(); app.buttons["Jobs"].firstMatch.tap()
        operationsReach(app, app.buttons["operationsIssues"].firstMatch)
        app.buttons["operationsIssues"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Show all jobs"].firstMatch.waitForExistence(timeout: 5))
        operationsFrame(app, "operationsInvalidManifest"); capture("Native operations invalid manifest")
        let collector = app.buttons["operationsJob-acme-collector"].firstMatch
        for _ in 0 ..< 10 where !collector.isHittable {
            app.swipeDown()
        }
        taxReveal(app, collector); capture("Native operations partial collection card"); collector.tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeJobDetail"].firstMatch.waitForExistence(timeout: 10))
        operationsFrame(app, "operationsLatestStatus")
        capture("Native operations retry and clean success status")
        operationsFrame(app, "operationsHistoryChart"); capture("Native operations history chart")
        let partial = app.buttons["operationsRun-acme-collector-2026-10-01T12-00-00Z"].firstMatch
        taxReveal(app, partial); partial.tap()
        let diagnostic = healthText(app, "Synthetic source unavailable; retry required."); taxReveal(app, diagnostic)
        capture("Native operations run diagnostics")
        XCTAssertTrue(healthText(app, "Some items failed").exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let edit = app.buttons["operationsEdit"].firstMatch
        for _ in 0 ..< 18 where !edit.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(edit.isHittable); edit.tap()
        businessInput(app, "jobName", "Acme edited collector"); capture("Native operations custom job editor")
        app.buttons["jobSave"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Acme edited collector"].waitForExistence(timeout: 10))
        let run = app.buttons["operationsRun"].firstMatch; taxReveal(app, run); run.tap()
        XCTAssertTrue(app.buttons["operationsConfirmDryRun"].firstMatch.waitForExistence(timeout: 5)); app.buttons["operationsConfirmDryRun"].firstMatch.tap()
        let result = healthText(app, "Manual attempt result"); taxReveal(app, result)
        let dryRun = healthText(app, "Dry run"); taxReveal(app, dryRun)
        capture("Native operations dry run result")
        XCTAssertTrue(dryRun.exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let create = app.buttons["operationsCreate"].firstMatch; taxReveal(app, create); create.tap()
        businessInput(app, "jobID", "acme-new-job"); businessInput(app, "jobName", "Acme new job")
        app.buttons["jobSave"].firstMatch.tap()
        let missingScript = healthText(app, "Job saved; the script still needs attention.")
        XCTAssertTrue(missingScript.waitForExistence(timeout: 10)); capture("Native operations saved missing script outcome")
        app.buttons["jobSavedDone"].firstMatch.tap()
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeAdministrationHistoricalLogsAndUnpricedUsage() async throws {
        continueAfterFailure = false
        let app = try await launchOperationsFixture("Logs")
        operationsReach(app, app.buttons["logsFilters"].firstMatch)
        XCTAssertTrue(app.buttons["logsFilters"].firstMatch.waitForExistence(timeout: 10)); app.buttons["logsFilters"].firstMatch.tap()
        app.descendants(matching: .any)["logsSource"].firstMatch.tap(); app.buttons["2026-10-01"].firstMatch.tap()
        app.buttons["logsCloseFilters"].firstMatch.tap()
        operationsFrame(app, "logsMetrics"); capture("Native operations historical log metrics")
        operationsFrame(app, "logsLevelChart"); capture("Native operations historical log levels")
        operationsFrame(app, "logsNamespaceChart"); capture("Native operations historical log namespaces")
        app.buttons["logsReview"].firstMatch.tap(); app.buttons["Events"].firstMatch.tap()
        let warning = healthText(app, "Synthetic source unavailable; retry required."); taxReveal(app, warning)
        capture("Native operations historical log reader")
        operationsReach(app, app.buttons["logsFilters"].firstMatch, towardTop: true)
        app.buttons["logsFilters"].firstMatch.tap(); app.descendants(matching: .any)["logsLevel"].firstMatch.tap(); app.buttons["Error"].firstMatch.tap(); app.buttons["logsCloseFilters"].firstMatch.tap()
        taxReveal(app, healthText(app, "1 matching events"))
        XCTAssertTrue(healthText(app, "1 matching events").waitForExistence(timeout: 5)); capture("Native operations error log filter")
        marketSection(app, "AI Usage")
        operationsFrame(app, "usageMetrics")
        XCTAssertTrue(app.descendants(matching: .any)["usageMetrics"].firstMatch.waitForExistence(timeout: 10))
        capture("Native operations AI usage metrics")
        for (id, name) in [("usageModelChart", "models"), ("usagePurposeChart", "purposes"), ("usageDailyChart", "daily priced costs")] {
            operationsFrame(app, id); capture("Native operations AI usage " + name)
        }
        app.buttons["usageReview"].firstMatch.tap(); app.buttons["Calls"].firstMatch.tap()
        let unpriced = app.buttons["usageCall-1"].firstMatch; taxReveal(app, unpriced); capture("Native operations AI usage recent calls"); unpriced.tap()
        let error = healthText(app, "Synthetic provider failure"); taxReveal(app, error)
        capture("Native operations failed unpriced API call")
        let unavailable = healthText(app, "Unpriced. The usage log does not have a price for this model."); taxReveal(app, unavailable)
        XCTAssertTrue(healthText(app, "0.0 s").exists)
        capture("Native operations unpriced call cost")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        marketSection(app, "System Status")
        operationsFrame(app, "operationsServerAccess")
        capture("Native operations server access and cache status")
        operationsFrame(app, "operationsCacheStatus")
        capture("Native operations saved balance cache dates")
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func operationsFrame(_ app: XCUIApplication, _ id: String) {
        let metrics = ["operationsMetrics", "logsMetrics", "usageMetrics"].contains(id)
        let card = app.descendants(matching: .any)[metrics ? id : "operationsCard-" + id].firstMatch
        for _ in 0 ..< 20 where !card.exists {
            operationsScroll(app, towardTop: false)
        }
        for _ in 0 ..< 20 where !card.exists {
            operationsScroll(app, towardTop: true)
        }
        taxFrame(app, id)
    }

    private func operationsReach(_ app: XCUIApplication, _ element: XCUIElement, towardTop: Bool = false) {
        for _ in 0 ..< 20 where !element.isHittable {
            operationsScroll(app, towardTop: towardTop)
        }
        for _ in 0 ..< 20 where !element.isHittable {
            operationsScroll(app, towardTop: !towardTop)
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    private func operationsScroll(_ app: XCUIApplication, towardTop: Bool) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: towardTop ? 0.3 : 0.78))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: towardTop ? 0.78 : 0.3)))
    }

    func testNativeResearchInboxChartsFiltersQuotesAndReading() async throws {
        continueAfterFailure = false
        let app = try await launchResearchFixture("deep-research", "Deep Research")
        marketSection(app, "Research Inbox")
        XCTAssertTrue(app.descendants(matching: .any)["nativeResearch-finance"].firstMatch.waitForExistence(timeout: 10))
        taxFrame(app, "researchMetrics"); capture("Native research inbox overview")
        for (id, title) in [("researchMonthlyChart", "Native research monthly sources"), ("researchPublisherChart", "Native research publishers"), ("researchMediaChart", "Native research formats"), ("researchStanceChart", "Native research claim stances")] {
            taxFrame(app, id); capture(title)
        }
        researchReview(app, "Sources")
        taxReveal(app, app.buttons["researchSource-financesource"].firstMatch)
        XCTAssertFalse(app.buttons["researchSource-healthsource"].exists)
        capture("Native research saved sources")
        app.buttons["researchFilters"].tap()
        capture("Native research filter sheet")
        let pdf = app.descendants(matching: .any)["researchMedia-PDF"].firstMatch
        XCTAssertTrue(pdf.waitForExistence(timeout: 3), app.debugDescription)
        pdf.tap(); app.buttons["closeResearchFilters"].tap()
        taxReveal(app, app.buttons["researchSource-financepdf"].firstMatch)
        XCTAssertFalse(app.buttons["researchSource-financesource"].exists)
        capture("Native research PDF filter")
        app.buttons["researchFilters"].tap()
        let clear = app.buttons["clearResearchFilters"].firstMatch; taxReveal(app, clear); clear.tap(); app.buttons["closeResearchFilters"].tap()
        let source = app.buttons["researchSource-financesource"].firstMatch; taxReveal(app, source); source.tap()
        let read = app.buttons["readResearchText"].firstMatch; taxReveal(app, read); read.tap()
        XCTAssertTrue(healthText(app, "A fictional observation 🧪 supports a careful comparison.").waitForExistence(timeout: 5))
        capture("Native research verbatim source text")
        app.buttons["Formatted"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["researchFormattedText"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Signal").exists)
        capture("Native research formatted source table")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let quote = healthText(app, "Quote matches the saved text at its recorded character range.")
        taxReveal(app, quote)
        let quotedText = app.staticTexts["researchQuotedText"].firstMatch
        XCTAssertTrue(quotedText.exists)
        if app.frame.width < 500 {
            XCTAssertGreaterThan(quotedText.frame.height, 30, "The exact quoted evidence must wrap rather than truncate on a phone.")
        }
        capture("Native research cited summary")
        let file = app.buttons["researchOpenFile"].firstMatch
        for _ in 0 ..< 12 where !file.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(file.waitForExistence(timeout: 5)); file.tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].waitForExistence(timeout: 10)); capture("Native research saved source file")
        app.buttons["closeDocumentPreview"].tap()
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeResearchHealthImportMetadataAndDeleteRemainScoped() async throws {
        continueAfterFailure = false
        let app = try await launchResearchFixture("health-research", "Health Research")
        XCTAssertTrue(app.descendants(matching: .any)["nativeResearch-health"].firstMatch.waitForExistence(timeout: 10))
        taxFrame(app, "researchMetrics"); capture("Native research health overview")
        researchReview(app, "Sources")
        XCTAssertTrue(app.buttons["researchSource-healthsource"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["researchSource-financesource"].exists)
        let add = app.buttons["action-text"].firstMatch; taxReveal(app, add); add.tap()
        let text = app.textViews.firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5)); text.tap(); text.typeText("Synthetic health research imported from the native editor.")
        app.buttons["nativeFormKeyboardDone"].firstMatch.tap()
        businessInput(app, "field-title", "Acme native health source")
        XCTAssertFalse(app.descendants(matching: .any)["field-domain"].exists)
        capture("Native research text import")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeResearch-health"].firstMatch.waitForExistence(timeout: 10))
        researchReview(app, "Sources")
        let source = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Acme native health source")).firstMatch
        reveal(app, source); source.tap()
        let edit = app.buttons["editRecord"].firstMatch; taxReveal(app, edit); edit.tap()
        businessInput(app, "field-title", "Acme revised health source")
        businessInput(app, "field-publisher", "Acme Health Lab")
        capture("Native research metadata editor")
        app.buttons["submitNativeForm"].tap()
        for _ in 0 ..< 8 where !healthText(app, "Acme revised health source").exists {
            app.swipeDown()
        }
        XCTAssertTrue(healthText(app, "Acme revised health source").waitForExistence(timeout: 10))
        let read = app.buttons["readResearchText"].firstMatch; reveal(app, read); read.tap()
        XCTAssertTrue(healthText(app, "Synthetic health research imported from the native editor.").waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let remove = app.buttons["deleteRecord"].firstMatch; taxReveal(app, remove); remove.tap()
        app.buttons["confirmDeleteRecord"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeResearch-health"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(healthText(app, "Acme revised health source").exists)
        capture("Native research health source deleted")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeDeepResearchHistoryRichReportsExportsAndNewJobs() async throws {
        continueAfterFailure = false
        let app = try await launchResearchFixture("deep-research", "Deep Research")
        XCTAssertTrue(app.descendants(matching: .any)["nativeKnowledge-research"].firstMatch.waitForExistence(timeout: 10))
        taxFrame(app, "knowledgeMetrics"); capture("Native research reports overview")
        taxFrame(app, "knowledgeMonthlyChart"); capture("Native research report activity")
        taxFrame(app, "knowledgeStatusChart"); capture("Native research report job states")
        researchReview(app, "History", knowledge: true)
        let saved = app.buttons["knowledgeRecord-syntheticreport"].firstMatch; taxReveal(app, saved); saved.tap()
        let read = app.buttons["readKnowledgeReport"].firstMatch; taxReveal(app, read); read.tap()
        XCTAssertTrue(app.descendants(matching: .any)["knowledgeReportReader"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Findings").exists)
        XCTAssertEqual(app.webViews.count, 0)
        capture("Native research report rich reading")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let citation = app.buttons["researchCitation-0"].firstMatch; taxReveal(app, citation); capture("Native research report source ledger")
        let export = app.buttons["knowledgeExport"].firstMatch; reveal(app, export); export.tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].waitForExistence(timeout: 10)); capture("Native research report HTML export")
        app.buttons["closeDocumentPreview"].tap(); app.navigationBars.buttons.element(boundBy: 0).tap()
        let create = app.buttons["knowledgeCreate"].firstMatch; reveal(app, create); create.tap()
        let question = app.textViews["researchQuestion"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 5)); question.tap(); question.typeText("Compare fictional native sources")
        app.buttons["nativeFormKeyboardDone"].firstMatch.tap(); capture("Native research question composer")
        let submit = app.buttons["knowledgeSubmit"].firstMatch; taxReveal(app, submit); submit.tap()
        taxReveal(app, app.buttons["readKnowledgeReport"].firstMatch); capture("Native research generated report")
        let remove = app.buttons["deleteKnowledgeRecord"].firstMatch; taxReveal(app, remove); remove.tap(); app.buttons["confirmDeleteKnowledgeRecord"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeKnowledge-research"].firstMatch.waitForExistence(timeout: 10))
    }

    func testNativeNewsReadingWeatherWarningsNarrationAndGeneration() async throws {
        continueAfterFailure = false
        let app = try await launchResearchFixture("daily-news", "Daily News")
        XCTAssertTrue(app.descendants(matching: .any)["nativeKnowledge-news"].firstMatch.waitForExistence(timeout: 10))
        taxFrame(app, "knowledgeMetrics"); capture("Native newsstand overview")
        taxFrame(app, "knowledgeMonthlyChart"); capture("Native newsstand saved activity")
        researchReview(app, "History", knowledge: true); capture("Native newsstand edition history")
        let edition = app.buttons["knowledgeRecord-syntheticnews"].firstMatch; taxReveal(app, edition); edition.tap()
        let read = app.buttons["readKnowledgeReport"].firstMatch; taxReveal(app, read); read.tap()
        XCTAssertTrue(app.descendants(matching: .any)["knowledgeReportReader"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "The lead").exists); XCTAssertEqual(app.webViews.count, 0); capture("Native news edition rich reading")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let weather = app.descendants(matching: .any)["newsWeatherChart"].firstMatch; taxReveal(app, weather); capture("Native news edition weather graph")
        let sun = healthText(app, "11h 45m"); taxReveal(app, sun); capture("Native news daylight and week ahead")
        let warning = healthText(app, "Synthetic source unavailable; edition is partial."); taxReveal(app, warning); capture("Native news source ledger and warning")
        let load = app.buttons["newsLoadAudio"].firstMatch; taxReveal(app, load); load.tap()
        let play = app.buttons["newsAudioPlayback"].firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 10)); play.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Pause")).firstMatch.waitForExistence(timeout: 2)); play.tap()
        capture("Native news saved narration controls")
        let email = app.buttons["newsEmail"].firstMatch; taxReveal(app, email); email.tap()
        XCTAssertTrue(app.buttons["confirmEmailEdition"].firstMatch.waitForExistence(timeout: 5)); capture("Native news email confirmation")
        if app.buttons["Cancel"].firstMatch.exists {
            app.buttons["Cancel"].firstMatch.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
        XCTAssertFalse(app.buttons["confirmEmailEdition"].firstMatch.exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let create = app.buttons["knowledgeCreate"].firstMatch; reveal(app, create); create.tap()
        let submit = app.buttons["knowledgeSubmit"].firstMatch; taxReveal(app, submit); capture("Native news edition and theme composer")
        submit.tap()
        taxReveal(app, app.buttons["readKnowledgeReport"].firstMatch); capture("Native news generated edition")
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func businessScope(_ app: XCUIApplication, entity: String? = nil, year: String? = nil) {
        let options = taxOptions(app)
        if let entity {
            app.descendants(matching: .any)["featureEntity"].firstMatch.tap(); app.buttons[entity].firstMatch.tap()
        }
        if let year {
            app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons[year].firstMatch.tap()
        }
        if options {
            app.buttons["closeFeatureScope"].tap()
        }
    }

    private func businessReview(_ app: XCUIApplication, _ section: String) {
        app.buttons["businessReviewSection"].firstMatch.tap(); app.buttons[section].firstMatch.tap()
    }

    private func businessInput(_ app: XCUIApplication, _ id: String, _ text: String) {
        let field = app.textFields[id].firstMatch
        reveal(app, field)
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        field.tap()
        let value = field.value as? String ?? ""
        field.typeText((value == field.placeholderValue ? "" : String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)) + text)
        for key in ["businessKeyboardDone", "nativeFormKeyboardDone"] {
            if app.buttons[key].firstMatch.exists {
                app.buttons[key].firstMatch.tap(); break
            }
        }
    }

    func testNativeSalesChartsHistoryAndEntityYearBoundaries() async throws {
        continueAfterFailure = false
        let app = try await launchBusinessFixture("sales")
        taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "$85.00").exists)
        XCTAssertTrue(healthText(app, "$115.00").exists)
        capture("Native business sales overview")
        taxFrame(app, "businessCurrentMonthMetrics")
        capture("Native business sales current month")
        for (chart, name) in [("businessMonthlyChart", "sales monthly revenue"), ("businessCategoryChart", "sales product revenue"), ("businessCustomerChart", "sales customer revenue")] {
            taxFrame(app, chart); capture("Native business " + name)
        }
        businessReview(app, "History")
        XCTAssertFalse(app.buttons["businessRecord-business-other"].exists)
        capture("Native business sales history")
        let zero = app.buttons["businessRecord-business-zero"].firstMatch
        taxReveal(app, zero); zero.tap()
        XCTAssertTrue(healthText(app, "$0.00").waitForExistence(timeout: 5))
        capture("Native business zero sale")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let removed = app.buttons["businessRecord-business-removed"].firstMatch
        taxReveal(app, removed); removed.tap()
        XCTAssertTrue(healthText(app, "Unavailable product").waitForExistence(timeout: 5))
        capture("Native business retired product sale")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        businessScope(app, year: "2025")
        taxFrame(app, "businessMetrics"); XCTAssertTrue(healthText(app, "$30.00").exists)
        capture("Native business prior year sales")
        businessReview(app, "All years"); taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "$115.00").exists)
        capture("Native business all year sales")
        businessScope(app, entity: "All entities", year: "2026")
        taxFrame(app, "businessMetrics"); XCTAssertTrue(healthText(app, "$192.00").exists)
        capture("Native business whole vault sales")
        businessScope(app, entity: "Other Tax Demo")
        taxFrame(app, "businessMetrics"); XCTAssertTrue(healthText(app, "$100.00").exists)
        capture("Native business other entity sales")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeSalesPriceChangesQuantityEditsAndCreationDeletion() async throws {
        continueAfterFailure = false
        let app = try await launchBusinessFixture("sales")
        businessReview(app, "Products")
        capture("Native business products")
        app.buttons["businessCatalogue-business-box"].firstMatch.tap()
        app.buttons["editRecord"].tap()
        businessInput(app, "field-price", "20")
        capture("Native business product price editor")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        businessReview(app, "Overview"); taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "$85.00").exists)
        businessReview(app, "History")
        let original = app.buttons["businessRecord-business-sale1"].firstMatch
        taxReveal(app, original); original.tap(); app.buttons["editRecord"].tap()
        businessInput(app, "field-person", "Acme Renamed Customer")
        XCTAssertTrue(healthText(app, "$20.00").exists)
        capture("Native business preserved sale total")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        taxReveal(app, original); original.tap(); app.buttons["editRecord"].tap()
        businessInput(app, "field-quantity", "3")
        XCTAssertTrue(healthText(app, "$60.00").exists)
        capture("Native business repriced sale")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        app.buttons["businessAddRecord"].firstMatch.tap()
        businessInput(app, "field-person", "Acme New Customer")
        businessInput(app, "field-quantity", "1000")
        businessInput(app, "field-date", "2026-10-01")
        XCTAssertTrue(healthText(app, "$20,000.00").exists)
        capture("Native business new sale")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        let created = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Acme New Customer")).firstMatch
        taxReveal(app, created); created.tap()
        app.buttons["editRecord"].tap()
        let savedQuantity = app.textFields["field-quantity"].firstMatch.value as? String ?? ""
        XCTAssertEqual(Double(savedQuantity), 1000)
        XCTAssertFalse(savedQuantity.contains(","))
        businessInput(app, "field-person", "Acme Large Customer")
        XCTAssertTrue(healthText(app, "$20,000.00").exists)
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        let renamed = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Acme Large Customer")).firstMatch
        taxReveal(app, renamed); renamed.tap()
        let delete = app.buttons["deleteRecord"].firstMatch
        taxReveal(app, delete); delete.tap(); app.buttons["confirmDeleteRecord"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Sales"].waitForExistence(timeout: 10))
        businessReview(app, "Overview"); taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "$125.00").exists)
        capture("Native business saved sale edits")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeMileageChartsOdometerClearsRateAndYearScope() async throws {
        continueAfterFailure = false
        let app = try await launchBusinessFixture("mileage")
        taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "130 mi").exists)
        XCTAssertTrue(healthText(app, "$65.00").exists)
        XCTAssertTrue(healthText(app, "22.5 MPG").exists)
        capture("Native business mileage overview")
        taxFrame(app, "businessCurrentMonthMetrics")
        capture("Native business mileage current month")
        for (chart, name) in [("businessMonthlyChart", "mileage monthly distance"), ("businessCategoryChart", "mileage vehicle distance")] {
            taxFrame(app, chart); capture("Native business " + name)
        }
        businessReview(app, "Trips")
        capture("Native business trip history")
        let fuel = app.buttons["businessRecord-business-fuel"].firstMatch
        taxReveal(app, fuel); fuel.tap()
        XCTAssertTrue(healthText(app, "Unavailable").waitForExistence(timeout: 5))
        capture("Native business fuel only entry")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let zero = app.buttons["businessRecord-business-zero-trip"].firstMatch
        taxReveal(app, zero); zero.tap()
        XCTAssertTrue(healthText(app, "0 mi").waitForExistence(timeout: 5))
        capture("Native business zero mile entry")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let original = app.buttons["businessRecord-business-trip1"].firstMatch
        taxReveal(app, original); original.tap(); app.buttons["editRecord"].tap()
        businessInput(app, "field-odometerEnd", "1060")
        XCTAssertTrue(healthText(app, "60 mi").exists)
        capture("Native business odometer editor")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Mileage"].waitForExistence(timeout: 10))
        taxReveal(app, original); original.tap(); app.buttons["editRecord"].tap()
        app.descendants(matching: .any)["businessDistanceMode"].firstMatch.tap(); app.buttons["Direct distance"].firstMatch.tap()
        businessInput(app, "field-tripMiles", "")
        businessInput(app, "field-gallons", "")
        capture("Native business cleared trip fields")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Mileage"].waitForExistence(timeout: 10))
        businessReview(app, "Settings")
        let editRate = app.buttons["businessEditRate"].firstMatch
        taxReveal(app, editRate); editRate.tap()
        businessInput(app, "field-irsRate", "0.6"); app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Mileage"].waitForExistence(timeout: 10))
        capture("Native business mileage rate")
        businessReview(app, "Overview"); taxFrame(app, "businessMetrics")
        XCTAssertTrue(healthText(app, "80 mi").exists)
        XCTAssertTrue(healthText(app, "$48.00").exists)
        capture("Native business saved mileage edits")
        businessScope(app, year: "2025")
        taxFrame(app, "businessMetrics"); XCTAssertTrue(healthText(app, "20 mi").exists)
        capture("Native business prior year mileage")
        businessScope(app, entity: "Other Tax Demo", year: "2026")
        taxFrame(app, "businessMetrics"); XCTAssertTrue(healthText(app, "100 mi").exists)
        capture("Native business other entity mileage")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeMileageSavedAddressesSearchRouteAndNewTrip() async throws {
        continueAfterFailure = false
        let app = try await launchBusinessFixture("mileage")
        businessReview(app, "Vehicles"); capture("Native business vehicles")
        businessReview(app, "Addresses"); capture("Native business saved addresses")
        businessReview(app, "Route"); app.buttons["businessPlanRoute"].tap()
        XCTAssertTrue(app.buttons["businessCalculateRoute"].waitForExistence(timeout: 10))
        app.buttons["businessSaved-from"].tap(); app.buttons["Acme Alpha"].firstMatch.tap()
        app.buttons["businessSaved-to"].tap(); app.buttons["Acme Beta"].firstMatch.tap()
        app.buttons["businessCalculateRoute"].tap()
        XCTAssertTrue(healthText(app, "5 mi").waitForExistence(timeout: 10))
        capture("Native business driving route")
        app.buttons["businessSearch-to"].tap()
        businessInput(app, "businessAddressQuery", "empty")
        app.buttons["businessSearchAddresses"].tap()
        XCTAssertTrue(healthText(app, "No addresses returned").waitForExistence(timeout: 10))
        businessInput(app, "businessAddressQuery", "Acme")
        app.buttons["businessSearchAddresses"].tap()
        let result = app.buttons.matching(NSPredicate(format: "label == %@", "Acme Search Location")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        capture("Native business address search")
        result.tap()
        XCTAssertFalse(app.buttons["businessUseRoute"].exists)
        app.buttons["businessCalculateRoute"].tap()
        taxReveal(app, app.buttons["businessUseRoute"]); app.buttons["businessUseRoute"].tap()
        XCTAssertEqual(app.textFields["field-tripMiles"].firstMatch.value as? String, "5.0")
        businessInput(app, "field-purpose", "Acme routed trip")
        capture("Native business route trip draft")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.navigationBars["Driving route"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        businessReview(app, "Trips")
        let created = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Acme routed trip")).firstMatch
        taxReveal(app, created); created.tap()
        XCTAssertTrue(healthText(app, "5 mi").waitForExistence(timeout: 5))
        capture("Native business saved routed trip")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-business-empty"))); reset.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: reset)
        businessReview(app, "Route"); app.buttons["businessPlanRoute"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["businessRouteUnavailable"].firstMatch.waitForExistence(timeout: 10))
        capture("Native business unconfigured routing")
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func launchSnapshotFixture() async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:31305/__test/reset-snapshot")!)
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        marketFeature(app, id: "tax-year", name: "Tax Year")
        let options = taxOptions(app)
        app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2026"].firstMatch.tap()
        app.descendants(matching: .any)["featureSection"].firstMatch.tap(); app.buttons["Financial Summary"].firstMatch.tap()
        if options, app.buttons["closeFeatureScope"].exists {
            app.buttons["closeFeatureScope"].tap()
        }
        XCTAssertTrue(app.descendants(matching: .any)["nativeFinancialSnapshot"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(app.descendants(matching: .any)["featureEntity"].firstMatch.exists)
        return app
    }

    private func financialReview(_ app: XCUIApplication, _ name: String) {
        app.buttons["financialReviewSection"].firstMatch.tap(); app.buttons[name].firstMatch.tap()
    }

    func testNativeFinancialSnapshotEntrySectionsPreserveGlobalYearScope() async throws {
        continueAfterFailure = false
        let app = try await launchSnapshotFixture()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        for (feature, title, resource, section) in [
            ("debts", "Debts", "Debt Service", "Debt service"),
            ("solo-401k", "Solo 401(k)", "Income & Limits", "Retirement"),
            ("federal-tax", "Federal Tax", "Projected Return", "Tax projection"),
        ] {
            let search = visibleSearchField(app)
            search.tap()
            let value = search.value as? String ?? ""
            if value != search.placeholderValue, !value.isEmpty {
                search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
            }
            marketFeature(app, id: feature, name: title)
            let options = taxOptions(app)
            app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2026"].firstMatch.tap()
            app.descendants(matching: .any)["featureSection"].firstMatch.tap(); app.buttons[resource].firstMatch.tap()
            if options, app.buttons["closeFeatureScope"].exists {
                app.buttons["closeFeatureScope"].tap()
            }
            XCTAssertTrue(app.descendants(matching: .any)["nativeFinancialSnapshot"].firstMatch.waitForExistence(timeout: 10))
            XCTAssertEqual(app.buttons["financialReviewSection"].firstMatch.label, "Review, " + section)
            XCTAssertFalse(app.descendants(matching: .any)["featureEntity"].firstMatch.exists)
            capture("Native consolidated entry from " + title)
            XCTAssertEqual(app.webViews.count, 0)
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }

    func testNativeFinancialSnapshotValuesCurrenciesFixedAccountsAndDebt() async throws {
        continueAfterFailure = false
        let app = try await launchSnapshotFixture()
        capture("Native consolidated financial overview")
        taxFrame(app, "financialMetrics")
        XCTAssertTrue(app.staticTexts["Known USD net worth"].waitForExistence(timeout: 10))
        XCTAssertTrue(healthText(app, "$1,734.56").exists)
        capture("Native consolidated financial metrics")
        taxFrame(app, "financialAssetsChart")
        capture("Native consolidated net worth components")
        let history = app.descendants(matching: .any)["financialHistoryChart"].firstMatch
        reveal(app, history, requireHittable: false)
        capture("Native consolidated recorded balance history")
        let historyDetails = app.buttons["financialHistoryDetails"].firstMatch
        taxReveal(app, historyDetails); historyDetails.tap()
        XCTAssertTrue(app.navigationBars["Recorded balances"].waitForExistence(timeout: 5))
        capture("Native consolidated daily observations")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        financialReview(app, "Assets")
        let euro = app.buttons["financialBank-synthetic-euro"].firstMatch
        taxReveal(app, euro); euro.tap()
        XCTAssertTrue(healthText(app, "€500.00").waitForExistence(timeout: 5))
        capture("Native consolidated foreign currency account")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let fixed = app.buttons["financialBroker-synthetic-fixed"].firstMatch
        taxReveal(app, fixed)
        capture("Native consolidated fixed brokerage balances")
        fixed.tap()
        XCTAssertTrue(app.navigationBars["Acme Fixed Account"].waitForExistence(timeout: 5))
        capture("Native consolidated fixed brokerage detail")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        financialReview(app, "Debt service")
        taxFrame(app, "financialDebtChart")
        capture("Native consolidated monthly debt service")
        let income = app.buttons["financialIncomeSources"].firstMatch
        taxReveal(app, income); income.tap()
        XCTAssertTrue(healthText(app, "Acme Monthly Income").waitForExistence(timeout: 5))
        capture("Native consolidated qualifying income sources")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeFinancialSnapshotTaxBusinessRetirementRemindersAndYearScope() async throws {
        continueAfterFailure = false
        let app = try await launchSnapshotFixture()
        financialReview(app, "Tax projection")
        taxFrame(app, "financialTaxChart")
        capture("Native consolidated federal projection")
        let tax = app.buttons["financialTaxDetails"].firstMatch
        taxReveal(app, tax); tax.tap()
        XCTAssertTrue(app.navigationBars["Complete tax calculation"].waitForExistence(timeout: 5))
        capture("Native consolidated complete tax calculation")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        financialReview(app, "Business")
        taxFrame(app, "financialBusinessIncomeChart")
        capture("Native consolidated entity income")
        taxFrame(app, "financialBusinessExpenseChart")
        capture("Native consolidated entity expenses")
        taxFrame(app, "financialSalesChart")
        capture("Native consolidated quarterly sales")
        let unknown = app.buttons["financialDeposit-tax-demo:2026-03:2"].firstMatch
        taxReveal(app, unknown); unknown.tap()
        XCTAssertTrue(healthText(app, "Unavailable").waitForExistence(timeout: 5))
        capture("Native consolidated unparsed deposit coverage")
        let yearLink = app.buttons["financialFeature-tax-year"].firstMatch
        taxReveal(app, yearLink); yearLink.tap()
        XCTAssertTrue(app.descendants(matching: .any)["featureEntity"].firstMatch.waitForExistence(timeout: 5) || app.buttons["featureScope"].firstMatch.waitForExistence(timeout: 5))
        let options = taxOptions(app)
        XCTAssertTrue(app.descendants(matching: .any)["featureEntity"].firstMatch.label.contains("Tax Demo LLC"))
        if options {
            app.buttons["closeFeatureScope"].tap()
        }
        capture("Native consolidated scoped Tax Year navigation")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        financialReview(app, "Retirement")
        taxFrame(app, "financialRetirementChart")
        capture("Native consolidated combined retirement contributions")
        financialReview(app, "Reminders")
        let reminder = app.buttons["financialReminder-0"].firstMatch
        taxReveal(app, reminder); reminder.tap()
        XCTAssertTrue(healthText(app, "Invented filing-season reminder").waitForExistence(timeout: 5))
        capture("Native consolidated filing-season reminder")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2025"].firstMatch.tap()
        financialReview(app, "Retirement")
        taxFrame(app, "financialRetirementChart")
        XCTAssertTrue(healthText(app, "$50.00").exists)
        capture("Native consolidated prior-year contributions")
        financialReview(app, "Overview")
        let historyDetails = app.buttons["financialHistoryDetails"].firstMatch
        taxReveal(app, historyDetails)
        XCTAssertTrue(app.staticTexts["No recorded balance history for this year."].exists)
        capture("Native consolidated unavailable prior-year history")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeTaxYearChartsDeductionsAndSourceEntityBoundaries() async throws {
        continueAfterFailure = false
        let app = try await launchTaxFixture()
        capture("Native tax year overview")
        taxFrame(app, "taxYearOverviewMetrics")
        capture("Native tax year metric cards")
        let chart = app.descendants(matching: .any)["taxIncomeChart"].firstMatch
        reveal(app, chart, requireHittable: false)
        taxFrame(app, "taxIncomeChart")
        XCTAssertTrue(healthText(app, "-$200.00").exists)
        capture("Native tax year income composition")
        let deductionChart = app.descendants(matching: .any)["taxDeductionChart"].firstMatch
        reveal(app, deductionChart, requireHittable: false)
        taxFrame(app, "taxDeductionChart")
        capture("Native tax year deduction composition")
        let coverage = app.descendants(matching: .any)["taxParsingCoverage"].firstMatch
        reveal(app, coverage, requireHittable: false)
        XCTAssertEqual(coverage.label, "10 of 11 parsed")
        capture("Native tax year parsing coverage")
        taxReview(app, "Income")
        let income = app.buttons["taxRecord-Acme Employer"].firstMatch
        taxReveal(app, income); income.tap()
        capture("Native tax year income record")
        let source = app.buttons["taxSource-tax-demo/2026/income/w2/AcmeEmployer_W2_2026.pdf"].firstMatch
        taxReveal(app, source); source.tap()
        XCTAssertTrue(app.buttons["previewDocument"].waitForExistence(timeout: 10))
        capture("Native tax year source document")
        app.buttons["previewDocument"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        capture("Native tax year source PDF")
        app.buttons["Done"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        taxReview(app, "Expenses")
        let category = app.buttons["taxExpenseCategory-meals"].firstMatch
        taxReveal(app, category); category.tap()
        XCTAssertTrue(healthText(app, "$50.00").waitForExistence(timeout: 5))
        capture("Native tax year expense category")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        taxReview(app, "Income")
        let options = taxOptions(app)
        app.descendants(matching: .any)["featureEntity"].firstMatch.tap()
        app.buttons["All tax entities"].firstMatch.tap()
        if options {
            app.buttons["closeFeatureScope"].tap()
        }
        taxReview(app, "Income")
        taxReveal(app, income); income.tap()
        taxReveal(app, source)
        let otherSource = app.buttons["taxSource-tax-other/2026/income/w2/AcmeEmployer_W2_2026.pdf"].firstMatch
        taxReveal(app, otherSource)
        capture("Native tax year ambiguous source entities")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeTaxYearDepositCoverageRetirementInvoicesAndDownloads() async throws {
        continueAfterFailure = false
        let app = try await launchTaxFixture()
        taxReview(app, "Deposits")
        let chart = app.descendants(matching: .any)["taxDepositChart-tax-demo"].firstMatch
        reveal(app, chart, requireHittable: false)
        taxFrame(app, "taxDepositChart-tax-demo")
        capture("Native tax year deposits")
        let zero = app.buttons["taxDeposit-tax-demo:2026-02:1"].firstMatch
        reveal(app, zero); zero.tap()
        XCTAssertTrue(healthText(app, "$0.00").waitForExistence(timeout: 5))
        capture("Native tax year zero deposits")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let unknown = app.buttons["taxDeposit-tax-demo:2026-03:2"].firstMatch
        reveal(app, unknown); unknown.tap()
        XCTAssertTrue(healthText(app, "Parsed source unavailable.").waitForExistence(timeout: 5))
        capture("Native tax year unparsed statement")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        taxReview(app, "Retirement")
        let retirement = app.descendants(matching: .any)["taxRetirementChart"].firstMatch
        reveal(app, retirement, requireHittable: false)
        taxFrame(app, "taxRetirementChart")
        capture("Native tax year retirement")
        taxReview(app, "Invoices")
        let invoices = app.descendants(matching: .any)["taxInvoiceChart"].firstMatch
        reveal(app, invoices, requireHittable: false)
        taxFrame(app, "taxInvoiceChart")
        capture("Native tax year invoices")
        let export = app.buttons["taxExportCPA"].firstMatch
        reveal(app, export); export.tap()
        XCTAssertTrue(app.buttons["submitNativeForm"].waitForExistence(timeout: 5))
        capture("Native tax year CPA export form")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Share"].firstMatch.exists)
        capture("Native tax year exported CPA package")
        app.buttons["closeDocumentPreview"].tap()
        app.buttons["Done"].firstMatch.tap()
        taxReview(app, "Documents")
        let unparsed = app.buttons["taxSource-tax-demo/2026/statements/bank/AcmeBank_Statement_2026-03.pdf"].firstMatch
        reveal(app, unparsed)
        XCTAssertFalse(app.buttons["taxSource-tax-demo/2026/expenses/software/Untracked_Receipt.pdf"].exists)
        capture("Native tax year included documents")
        let search = app.searchFields["Find a source document"]
        search.tap(); search.typeText("Statement_2026-03")
        XCTAssertTrue(unparsed.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["taxSource-tax-demo/2026/statements/bank/AcmeBank_Statement_2026-01.pdf"].exists)
        capture("Native tax year source document search")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Statement_2026-03".count) + "\n")
        let done = app.buttons["taxDismissSearchKeyboard"].firstMatch
        if done.waitForExistence(timeout: 2) {
            done.tap()
        } else if app.buttons["Close"].firstMatch.exists {
            app.buttons["Close"].firstMatch.tap()
        } else if app.buttons["Cancel"].firstMatch.exists {
            app.buttons["Cancel"].firstMatch.tap()
        }
        let keyboardDismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: app.keyboards)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardDismissed], timeout: 5), .completed)
        if app.buttons["Cancel"].firstMatch.exists {
            app.buttons["Cancel"].firstMatch.tap()
        }
        let details = app.buttons["taxAllRecordedValues"].firstMatch
        taxReveal(app, details); details.tap()
        XCTAssertTrue(app.navigationBars["Tax details"].waitForExistence(timeout: 5))
        capture("Native tax year all recorded values")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let options = taxOptions(app)
        app.descendants(matching: .any)["featureYear"].firstMatch.tap(); app.buttons["2025"].firstMatch.tap()
        if options {
            app.buttons["closeFeatureScope"].tap()
        }
        taxReview(app, "Retirement")
        XCTAssertTrue(app.staticTexts["No recorded contributions"].waitForExistence(timeout: 10))
        capture("Native tax year unavailable retirement")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeBanksKeepCurrenciesSeparateAndOpenAccountNotes() async throws {
        let app = try await launchFinanceFixture()
        marketFeature(app, id: "banks", name: "Banks")
        let chart = app.descendants(matching: .any)["bankInstitutionChart"].firstMatch
        capture("Native bank dashboard")
        reveal(app, chart)
        capture("Native bank institution balances")
        let currency = app.descendants(matching: .any)["bankCurrency"].firstMatch
        for _ in 0 ..< 3 where !currency.isHittable {
            app.swipeDown()
        }
        currency.tap()
        app.buttons["EUR"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Partial balances: 1 of 2")).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        if app.frame.width < 600 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52)))
        }
        capture("Native bank currency and missing balance")
        app.descendants(matching: .any)["bankCurrency"].firstMatch.tap()
        app.buttons["USD"].firstMatch.tap()
        let zero = app.buttons["bankAccount-synthetic-zero"]
        reveal(app, zero); zero.tap()
        XCTAssertTrue(app.staticTexts["Acme Empty Savings"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["$0.00"].firstMatch.exists)
        capture("Native zero bank balance")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let card = app.buttons["bankAccount-synthetic-card"]
        // The previous account may leave this one above the current scroll position.
        for _ in 0 ..< 3 where !card.isHittable {
            app.swipeDown()
        }
        reveal(app, card); card.tap()
        XCTAssertTrue(app.staticTexts["Synthetic account note."].firstMatch.waitForExistence(timeout: 5))
        capture("Native bank account details")
        let edit = app.buttons["bankEditAnnotation"]
        reveal(app, edit); edit.tap()
        XCTAssertTrue(app.buttons["editRecord"].waitForExistence(timeout: 5)); app.buttons["editRecord"].tap()
        XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 5))
        capture("Native bank annotation form")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeBrokerAccountsHoldingsAndHistoricalPriceChanges() async throws {
        let app = try await launchFinanceFixture()
        marketFeature(app, id: "brokers", name: "Brokers")
        capture("Native broker dashboard")
        let chart = app.descendants(matching: .any)["financeBalanceChart"].firstMatch
        reveal(app, chart)
        capture("Native brokerage balance history")
        let allocation = app.descendants(matching: .any)["brokerAllocationChart"].firstMatch
        reveal(app, allocation)
        if app.frame.width < 600 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.58)))
        } else {
            app.swipeUp()
        }
        capture("Native brokerage account allocation")
        let fixed = app.buttons["brokerAccount-synthetic-fixed"]
        reveal(app, fixed); fixed.tap()
        XCTAssertTrue(app.staticTexts["Acme Fixed Account"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "No positions are recorded.")).firstMatch.exists)
        capture("Native fixed brokerage account")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let holding = app.buttons["holding-synthetic-broker-FDEMO"]
        reveal(app, holding); holding.tap()
        XCTAssertTrue(app.descendants(matching: .any)["holdingPriceChart"].firstMatch.waitForExistence(timeout: 10))
        let change = app.descendants(matching: .any)["holdingChange-1D"].firstMatch
        reveal(app, change)
        XCTAssertTrue(change.label.contains("$8.00"), app.debugDescription)
        XCTAssertTrue(change.label.contains("2.04%"), app.debugDescription)
        let missing = app.descendants(matching: .any)["holdingChange-1M"].firstMatch
        reveal(app, missing)
        XCTAssertTrue(missing.label.contains("Unavailable"), app.debugDescription)
        if app.frame.width < 600 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)))
        }
        capture("Native holding historical price changes")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeBrokerHoldingEditorPersistsQuantityAndRefreshesValues() async throws {
        let app = try await launchFinanceFixture()
        marketFeature(app, id: "brokers", name: "Brokers")
        let manage = app.buttons["Manual Accounts"].firstMatch
        reveal(app, manage); manage.tap()
        let account = app.buttons["Acme Brokerage"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 5)); account.tap()
        app.buttons["editRecord"].tap()
        let holdings = app.buttons["Holdings"].firstMatch
        reveal(app, holdings); holdings.tap()
        let shares = app.textFields["record-field-0-shares"]
        XCTAssertTrue(shares.waitForExistence(timeout: 5)); shares.tap()
        if let value = shares.value as? String {
            shares.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        shares.typeText("5")
        capture("Native brokerage holding editor")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(account.waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let refresh = app.buttons["action-sync"]
        reveal(app, refresh); refresh.tap()
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.staticTexts["Result"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["Done"].firstMatch.tap()
        let holding = app.buttons["holding-synthetic-broker-FDEMO"]
        for _ in 0 ..< 4 where !holding.isHittable {
            app.swipeDown()
        }
        reveal(app, holding)
        XCTAssertTrue(holding.label.contains("5 units"), app.debugDescription)
        XCTAssertTrue(holding.label.contains("$500.00"), app.debugDescription)
        capture("Native brokerage updated holding")
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func marketSection(_ app: XCUIApplication, _ name: String) {
        let button = app.buttons["featureSection"].firstMatch
        if button.exists {
            button.tap()
        } else {
            app.descendants(matching: .any)["featureSection"].firstMatch.tap()
        }
        let search = app.searchFields["Find a section"]
        if search.waitForExistence(timeout: 1) {
            search.tap(); search.typeText(name)
        }
        let item = app.descendants(matching: .any)[name].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), app.debugDescription)
        item.tap()
    }

    private func healthText(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func healthFeature(_ app: XCUIApplication, id: String, name: String) {
        let search = visibleSearchField(app)
        search.tap(); search.typeText(name)
        let feature = app.descendants(matching: .any)["feature-" + id].firstMatch
        XCTAssertTrue(feature.waitForExistence(timeout: 5)); feature.tap()
        XCTAssertTrue(app.descendants(matching: .any)["featurePerson"].firstMatch.waitForExistence(timeout: 5))
    }

    private func launchNutritionFixture() async throws -> XCUIApplication {
        let app = try await launchMarketFixture()
        var reset = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/reset-nutrition")))
        reset.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        healthFeature(app, id: "health-nutrition", name: "Nutrition")
        XCTAssertTrue(app.descendants(matching: .any)["nativeNutrition"].firstMatch.waitForExistence(timeout: 10))
        return app
    }

    private func nutritionTab(_ app: XCUIApplication, name: String) {
        let picker = app.descendants(matching: .any)["nutritionDetailsTab"].firstMatch
        for _ in 0 ..< 12 where !picker.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(picker.isHittable, app.debugDescription)
        picker.buttons[name].firstMatch.tap()
    }

    func testNativeNutritionDashboardFiltersAndPersonIsolation() async throws {
        let app = try await launchNutritionFixture()
        let chart = app.descendants(matching: .any)["nutritionStatusChart"].firstMatch
        capture("Native nutrition dashboard")
        if ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] == "1" {
            reveal(app, app.staticTexts["Saved products"].firstMatch, requireHittable: false)
            capture("Native nutrition large text metric cards")
        }
        reveal(app, chart, requireHittable: false)
        let top = app.descendants(matching: .any)["featurePerson"].firstMatch.frame.maxY + 18
        if ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] != "1", chart.frame.minY < top {
            let distance = min(0.22, (top - chart.frame.minY) / app.frame.height)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65 + distance)))
        } else if chart.frame.maxY > app.frame.height - 120 {
            let distance = min(0.3, max(0.1, (chart.frame.maxY - app.frame.height + 150) / app.frame.height))
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7 - distance)))
        }
        capture("Native nutrition library overview")
        let categories = app.buttons["Categories · all saved products"].firstMatch
        reveal(app, categories); categories.tap()
        reveal(app, app.descendants(matching: .any)["nutritionCategoryChart"].firstMatch, requireHittable: false)
        capture("Native nutrition category chart")
        if ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_LARGE_TEXT"] == "1" {
            let coverage = app.descendants(matching: .any)["nutritionDoseCoverage"].firstMatch
            reveal(app, coverage, requireHittable: false)
            let top = app.descendants(matching: .any)["featurePerson"].firstMatch.frame.maxY + 18
            let distance = max(-0.22, min(0.22, (coverage.frame.minY - top) / app.frame.height))
            if abs(distance) > 0.01 {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
                    .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65 - distance)))
            }
            capture("Native nutrition large text dose details")
        }
        let status = app.descendants(matching: .any)["nutritionStatus"].firstMatch
        reveal(app, status); status.tap(); app.buttons["Considering"].firstMatch.tap()
        let mineral = app.buttons["nutritionProduct-demomineral"]
        reveal(app, mineral)
        XCTAssertFalse(app.buttons["nutritionProduct-demodaily"].exists)
        capture("Native nutrition considering filter")
        let person = app.descendants(matching: .any)["featurePerson"].firstMatch
        person.tap(); app.buttons["Other Demo Person"].firstMatch.tap()
        let other = app.buttons["nutritionProduct-otherdemo"]
        reveal(app, other)
        XCTAssertFalse(app.buttons["nutritionProduct-demodaily"].exists)
        XCTAssertFalse(app.buttons["nutritionProduct-demomineral"].exists)
        capture("Native nutrition person isolation")
    }

    func testNativeNutritionPhotosFactsResearchAndUnavailableLabel() async throws {
        let app = try await launchNutritionFixture()
        let daily = app.buttons["nutritionProduct-demodaily"]
        reveal(app, daily); daily.tap()
        XCTAssertTrue(app.buttons["nutritionEditRegimen"].waitForExistence(timeout: 10))
        capture("Native nutrition product details")
        let photo = app.buttons["nutritionImage-primary"]
        reveal(app, photo)
        XCTAssertTrue(photo.waitForExistence(timeout: 10))
        capture("Native nutrition authenticated product photo")
        let label = app.buttons["nutritionImage-facts"]
        reveal(app, label)
        XCTAssertTrue(label.waitForExistence(timeout: 10))
        capture("Native nutrition authenticated facts photo")
        nutritionTab(app, name: "Facts")
        XCTAssertTrue(healthText(app, "about 30").waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["nutritionFactsChart-Nutrition facts"].exists)
        capture("Native nutrition per serving facts")
        let vitamins = app.descendants(matching: .any)["nutritionFactsChart-Vitamins"].firstMatch
        reveal(app, vitamins)
        capture("Native nutrition vitamin daily values")
        nutritionTab(app, name: "Research")
        XCTAssertTrue(app.staticTexts["Fictional nutrition evidence"].firstMatch.waitForExistence(timeout: 5))
        capture("Native nutrition research and references")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let unparsed = app.buttons["nutritionProduct-demounparsed"]
        reveal(app, unparsed); unparsed.tap()
        let unavailable = app.staticTexts["Image unavailable"].firstMatch
        reveal(app, unavailable)
        XCTAssertTrue(app.staticTexts["The label could not be parsed"].firstMatch.exists)
        capture("Native nutrition unavailable label")
        nutritionTab(app, name: "Facts")
        XCTAssertTrue(app.staticTexts["Label facts unavailable"].firstMatch.waitForExistence(timeout: 5))
    }

    func testNativeNutritionRegimenEditsSaveAndDoseCanBeCleared() async throws {
        let app = try await launchNutritionFixture()
        let mineral = app.buttons["nutritionProduct-demomineral"]
        reveal(app, mineral); mineral.tap()
        let edit = app.buttons["nutritionEditRegimen"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10)); edit.tap()
        let status = app.descendants(matching: .any)["field-status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 5)); status.tap(); app.buttons["Taking"].firstMatch.tap()
        let amount = app.textFields["field-dose.amount"]
        amount.tap(); amount.typeText("2")
        app.textFields["field-dose.unit"].tap(); app.textFields["field-dose.unit"].typeText("capsules")
        let frequency = app.descendants(matching: .any)["field-dose.frequency"].firstMatch
        frequency.tap(); app.buttons["Daily"].firstMatch.tap()
        let time = app.descendants(matching: .any)["field-dose.timeOfDay"].firstMatch
        reveal(app, time); time.tap(); app.buttons["Bedtime"].firstMatch.tap()
        capture("Native nutrition regimen editor")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.staticTexts["2 · capsules · Daily"].firstMatch.waitForExistence(timeout: 10))
        capture("Native nutrition saved regimen")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        reveal(app, app.staticTexts["Taking · Bedtime"].firstMatch)
        reveal(app, mineral); mineral.tap()
        XCTAssertTrue(app.staticTexts["2 · capsules · Daily"].firstMatch.waitForExistence(timeout: 10))
        let clear = app.buttons["nutritionClearDose"]
        reveal(app, clear); clear.tap()
        XCTAssertTrue(app.staticTexts["Dose not recorded"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["nutritionClearDose"].exists)
        capture("Native nutrition cleared dose")
        nutritionTab(app, name: "Facts")
        XCTAssertTrue(app.staticTexts["Serving size not recorded"].firstMatch.waitForExistence(timeout: 5))
    }

    func testNativeNutritionProductCreationAndDeletion() async throws {
        let app = try await launchNutritionFixture()
        let add = app.buttons["action-manual"]
        reveal(app, add); add.tap()
        XCTAssertTrue(app.textFields["field-brandName"].waitForExistence(timeout: 5))
        app.textFields["field-brandName"].tap(); app.textFields["field-brandName"].typeText("Acme Nutrition")
        app.textFields["field-productName"].tap(); app.textFields["field-productName"].typeText("Demo Added Product")
        app.descendants(matching: .any)["field-category"].firstMatch.tap(); app.buttons["Other"].firstMatch.tap()
        capture("Native nutrition add product form")
        app.buttons["submitNativeForm"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["nativeNutrition"].firstMatch.waitForExistence(timeout: 10))
        let search = visibleSearchField(app)
        for _ in 0 ..< 9 where !search.isHittable {
            app.swipeDown()
        }
        search.tap(); search.typeText("Demo Added Product")
        let row = app.staticTexts["Demo Added Product"].firstMatch
        reveal(app, row); row.tap()
        XCTAssertTrue(app.staticTexts["CONSIDERING"].firstMatch.waitForExistence(timeout: 10))
        capture("Native nutrition created product")
        let delete = app.buttons["nutritionDelete"]
        reveal(app, delete); delete.tap()
        let confirm = app.buttons["confirmDeleteNutrition"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        XCTAssertTrue(app.staticTexts["No matching products"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Demo Added Product"].exists)
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, attempts: Int = 9, requireHittable: Bool = true) {
        func visible() -> Bool {
            if requireHittable {
                return element.isHittable
            }
            return element.exists && !element.frame.isEmpty && element.frame.intersects(app.frame.insetBy(dx: 0, dy: 130))
        }
        for _ in 0 ..< attempts where !visible() {
            app.swipeUp()
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5), app.debugDescription)
    }

    private func clinicalTab(_ app: XCUIApplication, name: String) {
        app.descendants(matching: .any)["clinicalTab"].firstMatch.tap()
        let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name + " (")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), app.debugDescription); item.tap()
    }

    func testNativeHealthActivityPeriodsAndPersonIsolation() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-activity", name: "Activity")
        XCTAssertTrue(healthText(app, "5,000 steps/day").waitForExistence(timeout: 10))
        capture("Native activity metric cards")
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        let inspect = app.buttons["healthInspectLatest"]
        reveal(app, inspect); inspect.tap()
        XCTAssertTrue(app.staticTexts["healthSelectedDate"].waitForExistence(timeout: 5))
        capture("Native activity dated chart")
        let period = app.buttons["healthPeriod-This Week"]
        reveal(app, period); period.tap()
        XCTAssertTrue(healthText(app, "25 %").waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        capture("Native health period comparison")
        app.navigationBars.buttons.firstMatch.tap()
        for _ in 0 ..< 8 {
            app.swipeDown()
        }
        app.descendants(matching: .any)["featurePerson"].firstMatch.tap()
        app.buttons["Other Demo Person"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "No parsed summary")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(healthText(app, "5,000 steps/day").exists)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeSleepStagesAndNightDetails() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-sleep", name: "Sleep")
        XCTAssertTrue(healthText(app, "7.5 hours").waitForExistence(timeout: 10))
        capture("Native sleep metric cards")
        let metric = app.descendants(matching: .any)["healthMetric"].firstMatch
        reveal(app, metric); metric.tap(); app.buttons["Sleep stages"].firstMatch.tap()
        let inspect = app.buttons["healthInspectLatest"]; reveal(app, inspect); inspect.tap()
        capture("Native sleep stages")
        let night = app.buttons["healthReading-2026-10-02"]
        reveal(app, night); night.tap()
        XCTAssertTrue(healthText(app, "480 min").waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        XCTAssertTrue(healthText(app, "0 min").exists)
        capture("Native sleep night details")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeWorkoutsTypeAndSessionDetails() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-workouts", name: "Workouts")
        XCTAssertTrue(healthText(app, "95 min").waitForExistence(timeout: 10))
        capture("Native workout metric cards")
        let metric = app.descendants(matching: .any)["healthMetric"].firstMatch
        reveal(app, metric)
        XCTAssertTrue(metric.label.contains("Weekly workouts"), metric.label)
        let inspect = app.buttons["healthInspectLatest"]
        reveal(app, inspect); inspect.tap()
        capture("Native weekly workout chart")
        let type = app.buttons["healthWorkoutType-HKWorkoutActivityTypeYoga"]
        reveal(app, type); type.tap()
        XCTAssertTrue(healthText(app, "25 min").waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        let session = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "2026-10-01T10:00:00Z")).firstMatch
        reveal(app, session); session.tap()
        XCTAssertTrue(healthText(app, "2026-10-01T10:00:00Z").waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        capture("Native workout session")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeHeartAndBodyUseDifferentUnitsAndRetainClinicalSource() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-heart", name: "Heart")
        XCTAssertTrue(healthText(app, "64 bpm").waitForExistence(timeout: 10))
        capture("Native heart metric cards")
        let metric = app.descendants(matching: .any)["healthMetric"].firstMatch
        reveal(app, metric); metric.tap(); app.buttons["Heart rate variability"].firstMatch.tap()
        let inspect = app.buttons["healthInspectLatest"]; reveal(app, inspect); inspect.tap()
        capture("Native heart variability chart")
        app.navigationBars.buttons["Workspace"].firstMatch.tap()
        let search = visibleSearchField(app)
        search.tap()
        if let value = search.value as? String {
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        search.typeText("Body")
        app.descendants(matching: .any)["feature-health-body"].firstMatch.tap()
        XCTAssertTrue(healthText(app, "157.63 lb").waitForExistence(timeout: 10))
        capture("Native body metric cards")
        XCTAssertTrue(healthText(app, "Unavailable").exists)
        let bodyMetric = app.descendants(matching: .any)["healthMetric"].firstMatch
        reveal(app, bodyMetric)
        XCTAssertTrue(bodyMetric.label.contains("Weight"), bodyMetric.label)
        let bodyInspect = app.buttons["healthInspectLatest"]
        reveal(app, bodyInspect); bodyInspect.tap()
        capture("Native body readings")
        let reading = app.buttons["healthReading-2026-10-02"].firstMatch
        reveal(app, reading); reading.tap()
        XCTAssertTrue(healthText(app, "71 kg").exists || healthText(app, "71.5 kg").exists)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeClinicalLabsPanelsAndBloodPressure() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-records", name: "Medical Records")
        let glucose = app.buttons["clinicalRecord-Demo glucose"]
        XCTAssertTrue(glucose.waitForExistence(timeout: 10)); glucose.tap()
        XCTAssertTrue(healthText(app, "120 mg/dL").waitForExistence(timeout: 5))
        XCTAssertTrue(healthText(app, "10–100 mg/dL").exists)
        capture("Native clinical lab trend")
        let labInspect = app.buttons["healthInspectLatest"].firstMatch
        reveal(app, labInspect); labInspect.tap()
        capture("Native clinical lab chart and readings")
        app.navigationBars.buttons.firstMatch.tap()
        let panel = app.buttons["clinicalPanel-demo-panel"]; reveal(app, panel); panel.tap()
        XCTAssertTrue(healthText(app, "Synthetic panel narrative preserved verbatim.").waitForExistence(timeout: 5))
        app.buttons["clinicalPanelResult-lab-negative"].tap()
        XCTAssertTrue(healthText(app, "Negative").waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
        for _ in 0 ..< 5 {
            app.swipeDown()
        }
        clinicalTab(app, name: "Vitals")
        let bp = app.buttons["clinicalRecord-bp-new"]
        XCTAssertTrue(bp.waitForExistence(timeout: 5)); bp.tap()
        XCTAssertTrue(healthText(app, "120/80 mmHg").waitForExistence(timeout: 5))
        capture("Native clinical blood pressure")
        let pressureInspect = app.buttons["healthInspectLatest"].firstMatch
        reveal(app, pressureInspect); pressureInspect.tap()
        capture("Native clinical blood pressure chart and readings")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeClinicalHistoryFiltersAndLiteralSourceText() async throws {
        let app = try await launchMarketFixture()
        healthFeature(app, id: "health-records", name: "Medical Records")
        XCTAssertTrue(app.descendants(matching: .any)["clinicalTab"].firstMatch.waitForExistence(timeout: 10))
        clinicalTab(app, name: "Conditions")
        app.descendants(matching: .any)["clinicalFilter"].firstMatch.tap(); app.buttons["Chronic / other"].firstMatch.tap()
        XCTAssertTrue(app.buttons["clinicalRecord-condition-chronic"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["clinicalRecord-condition-visit"].exists)
        clinicalTab(app, name: "Medications")
        app.buttons["clinicalRecord-med-active"].tap()
        XCTAssertTrue(healthText(app, "Synthetic instruction: one fictional tablet daily.").waitForExistence(timeout: 5))
        capture("Native clinical medication details")
        app.navigationBars.buttons.firstMatch.tap()
        clinicalTab(app, name: "Immunizations"); app.buttons["clinicalRecord-immunization-demo"].tap()
        XCTAssertTrue(healthText(app, "No").waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        clinicalTab(app, name: "Allergies"); app.buttons["clinicalRecord-allergy-demo"].tap()
        XCTAssertTrue(healthText(app, "Synthetic reaction text.").waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        clinicalTab(app, name: "Procedures"); app.buttons["clinicalRecord-procedure-demo"].tap()
        XCTAssertTrue(healthText(app, "completed").waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        clinicalTab(app, name: "Documents"); app.buttons["clinicalRecord-document-demo"].tap()
        XCTAssertTrue(healthText(app, "Synthetic narrative from the source document reference.").waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeHealthOverviewNotesAndDismissalPersist() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "health", name: "Health")
        let person = app.buttons["healthPerson-demo-person"]
        XCTAssertTrue(person.waitForExistence(timeout: 10)); person.tap()
        XCTAssertTrue(app.buttons["healthOverview-sleep"].waitForExistence(timeout: 10))
        capture("Native person health overview")
        reveal(app, healthText(app, "Recovery"))
        capture("Native health score rings")
        let illness = app.buttons["healthIllness-2026-09-28-2026-09-29"]
        reveal(app, illness); illness.tap()
        let note = app.textViews["healthIllnessNote"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        let clear = app.buttons["clearHealthIllnessNote"]
        if clear.isEnabled {
            reveal(app, clear); clear.tap()
        }
        reveal(app, note); note.tap(); note.typeText("Synthetic native note.")
        app.swipeUp()
        let toggle = app.descendants(matching: .any)["healthIllnessDismiss"].firstMatch
        let actualSwitch = toggle.switches.firstMatch
        if actualSwitch.exists {
            actualSwitch.tap()
        } else {
            toggle.tap()
        }
        app.buttons["saveHealthIllness"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["healthIllnessSaved"].firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertFalse(illness.exists)
        let show = app.descendants(matching: .any)["healthShowDismissed"].firstMatch
        reveal(app, show)
        let showSwitch = show.switches.firstMatch
        if showSwitch.exists {
            showSwitch.tap()
        } else {
            show.tap()
        }
        XCTAssertTrue(illness.waitForExistence(timeout: 5)); illness.tap()
        XCTAssertEqual(note.value as? String, "Synthetic native note.")
        capture("Native detected period notes")
        reveal(app, clear); clear.tap()
        app.swipeUp()
        if actualSwitch.exists {
            actualSwitch.tap()
        } else {
            toggle.tap()
        }
        app.buttons["saveHealthIllness"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["healthIllnessSaved"].firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons.firstMatch.tap()
        reveal(app, illness); illness.tap()
        XCTAssertEqual(note.value as? String, "")
        app.navigationBars.buttons.firstMatch.tap()
        let parsed = app.buttons["Parsed export: all recorded metrics and workouts"]
        reveal(app, parsed); parsed.tap()
        let summary = app.buttons["Summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10)); summary.tap()
        let parser = healthText(app, "Parser Version")
        reveal(app, parser)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testQuantOverviewSignalsOpenTheirDetailedChart() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant")
        let price = app.buttons["quantSignal-btc-price"]
        XCTAssertTrue(price.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(price.label.contains("3,300"), price.label)
        capture("Native combined market snapshot")
        let search = app.searchFields["Find a signal"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("Sahm")
        let sahm = app.buttons["quantSignal-sahm"]
        XCTAssertTrue(sahm.waitForExistence(timeout: 5))
        XCTAssertTrue(sahm.label.contains("0.00"), sahm.label)
        XCTAssertTrue(sahm.label.contains("Calm"), sahm.label)
        XCTAssertFalse(app.buttons["quantSignal-btc-price"].exists)
        capture("Native macro snapshot zero value")
        sahm.tap()
        XCTAssertTrue(app.descendants(matching: .any)["quantTimeChart"].firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["quantSignal-sahm"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPredictionMarketsFilterInspectAndShowProviderHealth() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "predictions", name: "Predictions")
        let mover = app.buttons["predictionMover-polymarket:demo-politics"]
        XCTAssertTrue(mover.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(mover.label.contains("-4 pp"), mover.label)
        XCTAssertTrue(app.staticTexts["Synthetic secondary source is unavailable."].exists)
        capture("Native prediction market movers and sources")
        mover.tap()
        XCTAssertTrue(app.buttons["predictionSource"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["40%"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["Closes, Unspecified"].exists)
        capture("Native prediction market detail")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let domain = app.descendants(matching: .any)["predictionDomain"].firstMatch
        for _ in 0 ..< 5 where !domain.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(domain.isHittable, app.debugDescription)
        domain.tap(); app.buttons["Politics"].firstMatch.tap()
        let count = app.descendants(matching: .any)["predictionCount"].firstMatch
        XCTAssertTrue(count.label.contains("1"), count.label)
        let row = app.buttons["predictionMarket-polymarket:demo-politics"]
        for _ in 0 ..< 4 where !row.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(row.isHittable)
        XCTAssertFalse(app.buttons["predictionMarket-kalshi:demo-finance"].exists)
        capture("Native prediction market category filter")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testMacroCalendarShowsPublishedDatesAndPreviousReleasedResults() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant")
        marketSection(app, "Macro · Calendar")
        let type = app.descendants(matching: .any)["macroReleaseType"].firstMatch
        XCTAssertTrue(type.waitForExistence(timeout: 10))
        type.tap(); app.buttons["CPI"].firstMatch.tap()
        let event = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "macroEvent-")).firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(event.label.contains("CPI"))
        XCTAssertTrue(event.label.contains("Last released: +2.6% y/y"), event.label)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "macroEvent-", "-fomc")).count, 0)
        capture("Native macro release calendar")
        event.tap()
        XCTAssertTrue(app.buttons["macroOfficialCalendar"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["As of 2025-12-01"].exists)
        XCTAssertTrue(app.staticTexts["This is the previous released observation, not a forecast for the scheduled event."].exists)
        capture("Native macro release previous result")
        app.buttons["Explore observations"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["quantTimeChart"].firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let sources = app.buttons["Source data and refresh actions"]
        for _ in 0 ..< 5 where !sources.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(sources.isHittable)
        sources.tap()
        XCTAssertTrue(app.buttons["action-refresh"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPoliticalMemberConsensusAndPerformanceExplorers() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "politics", name: "Politics")
        marketSection(app, "Trades")
        let member = app.buttons["politicsRow-Demo Member A & B"]
        XCTAssertTrue(member.waitForExistence(timeout: 10), app.debugDescription)
        member.tap()
        XCTAssertTrue(app.descendants(matching: .any)["politicsMonthlyChart"].firstMatch.waitForExistence(timeout: 10))
        capture("Native political member explorer")
        let option = app.descendants(matching: .any)["politicalOption"].firstMatch
        for _ in 0 ..< 4 where !option.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(option.exists)
        XCTAssertTrue(option.label.contains("Call"))
        XCTAssertTrue(app.descendants(matching: .any)["Source disclosure"].firstMatch.exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.descendants(matching: .any)["featureSection"].firstMatch.label.contains("Trades"))
        marketSection(app, "Trade Clusters")
        XCTAssertTrue(app.buttons["politicsRow-DEMO"].waitForExistence(timeout: 10))
        app.descendants(matching: .any)["politicsDirection"].firstMatch.tap()
        app.buttons["Sells"].firstMatch.tap()
        XCTAssertTrue(app.buttons["politicsRow-SYNTH"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["politicsRow-DEMO"].exists)
        app.descendants(matching: .any)["politicsWindow"].firstMatch.tap()
        app.buttons["90 days"].firstMatch.tap()
        app.descendants(matching: .any)["politicsSort"].firstMatch.tap()
        app.buttons["Recent"].firstMatch.tap()
        capture("Native political consensus controls")
        app.buttons["politicsRow-SYNTH"].tap()
        XCTAssertTrue(app.staticTexts["Demo Member C"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Source disclosure"].firstMatch.exists)
        capture("Native political consensus disclosures")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        marketSection(app, "Backtest")
        XCTAssertTrue(app.buttons["politicsRow-Demo Member A & B"].waitForExistence(timeout: 10))
        app.buttons["politicsRow-Demo Member A & B"].tap()
        let proxy = app.descendants(matching: .any).matching(identifier: "politicalTradeReturn")
        for _ in 0 ..< 4 where proxy.count < 2 {
            app.swipeUp()
        }
        XCTAssertEqual(proxy.count, 2, app.debugDescription)
        XCTAssertTrue(proxy.allElementsBoundByIndex.contains { $0.label.contains("Option underlying move: 5.0%") })
        XCTAssertFalse(proxy.allElementsBoundByIndex.contains { $0.label.contains("999") })
        capture("Native political simulated performance")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPoliticalResearchRadarFiltersAndOpensSavedSource() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "politics", name: "Politics")
        marketSection(app, "Research Radar")
        XCTAssertTrue(app.descendants(matching: .any)["politicalResearchChart"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        capture("Native political research radar")
        let chart = app.descendants(matching: .any)["politicalResearchChart"].firstMatch
        reveal(app, chart)
        if app.frame.width < 600 {
            // A full swipe can put the chart's first row under the pinned header.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.58)))
        }
        capture("Native political radar evidence chart")
        let kind = app.descendants(matching: .any)["politicalResearchKind"].firstMatch
        for _ in 0 ..< 3 where !kind.isHittable {
            app.swipeDown()
        }
        kind.tap()
        app.buttons["Topics"].firstMatch.tap()
        let rates = app.buttons["politicalSignal-topic:rates"]
        reveal(app, rates); rates.tap()
        XCTAssertTrue(app.staticTexts["Synthetic rates policy bill"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        let bill = app.buttons["politicalMatchedBill-synthetic-rates-bill"]
        reveal(app, bill); bill.tap()
        XCTAssertTrue(app.staticTexts["politicalBillSummary"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.staticTexts["politicalBillSummary"].label, "Synthetic official summary about fictional rates policy.")
        XCTAssertTrue(app.descendants(matching: .any)["Official bill source"].firstMatch.exists)
        capture("Native political matched bill summary")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let claim = app.buttons["politicalSignalClaim-rates-claim"]
        for _ in 0 ..< 3 where !claim.isHittable {
            app.swipeDown()
        }
        reveal(app, claim); claim.tap()
        XCTAssertTrue(app.staticTexts["politicalClaimText"].label.contains("Fictional rates commentary"))
        capture("Native political claim evidence")
        app.buttons["readPoliticalResearchSource"].tap()
        let source = app.buttons["readResearchText"]
        XCTAssertTrue(source.waitForExistence(timeout: 10), app.debugDescription)
        source.tap()
        XCTAssertTrue(app.staticTexts["Synthetic political source: fictional commentary on DEMO and rates policy."].firstMatch.waitForExistence(timeout: 5))
        capture("Native political saved source")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPoliticalResearchUnavailableStateDoesNotInventEvidence() async throws {
        let app = try await launchMarketFixture()
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31305/__test/empty-politics")))
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        marketFeature(app, id: "politics", name: "Politics")
        marketSection(app, "Research Radar")
        XCTAssertTrue(app.staticTexts["Political collection is unavailable. Refresh the feed before linking research."].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        capture("Native political research unavailable")
        XCTAssertFalse(app.debugDescription.contains("politicalResearchChart"))
        let empty = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "No linked claims yet.")).firstMatch
        reveal(app, empty)
        XCTAssertEqual(empty.label, "No linked claims yet. Add a politics source to the Research Inbox and analyze it to link assets and topics to collected activity.")
        capture("Native political empty research")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPoliticalPortraitAndConsensusMemberNavigation() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "politics", name: "Politics")
        marketSection(app, "Trades")
        let member = app.buttons["politicsRow-Demo Member A & B"]
        XCTAssertTrue(member.waitForExistence(timeout: 10), app.debugDescription)
        member.tap()
        XCTAssertTrue(app.images["politicalPortraitImage-Demo Member A & B"].waitForExistence(timeout: 10), app.debugDescription)
        capture("Native political member portrait")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        marketSection(app, "Trade Clusters")
        XCTAssertTrue(app.buttons["politicsRow-DEMO"].waitForExistence(timeout: 10))
        app.buttons["politicsRow-DEMO"].tap()
        let other = app.buttons["consensusMember-Demo Member C"]
        reveal(app, other); other.tap()
        XCTAssertTrue(app.staticTexts["politicalPortraitFallback-Demo Member C"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.descendants(matching: .any)["politicsMonthlyChart"].firstMatch.waitForExistence(timeout: 10))
        capture("Native political missing portrait fallback")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testQuantChartControlsHeatmapAndSectorRotation() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant")
        marketSection(app, "Btc · Log Regression")
        XCTAssertTrue(app.descendants(matching: .any)["quantTimeChart"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        capture("Native Bitcoin chart overview")
        let inspect = app.buttons["quantInspectLatest"]
        for _ in 0 ..< 3 where !inspect.isHittable {
            app.swipeUp()
        }
        inspect.tap()
        XCTAssertTrue(app.staticTexts["2025-12-01"].firstMatch.waitForExistence(timeout: 5))
        capture("Native Bitcoin regression chart")
        for _ in 0 ..< 4 where !app.descendants(matching: .any)["quantChartPicker"].firstMatch.isHittable {
            app.swipeDown()
        }
        app.descendants(matching: .any)["quantChartPicker"].firstMatch.tap()
        app.buttons["BTC composite risk"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["quantHistory"].firstMatch.waitForExistence(timeout: 5))
        app.descendants(matching: .any)["quantHistory"].firstMatch.tap()
        app.buttons["1 year"].firstMatch.tap()
        assertQuantChart(app, contains: "From 2024-12-01 through 2025-12-01")
        app.buttons["Series"].firstMatch.tap()
        let series = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH %@", "quantSeries-risk.normalized")).firstMatch
        XCTAssertTrue(series.waitForExistence(timeout: 5))
        let original = series.value as? String
        let control = series.switches.firstMatch
        if control.exists {
            control.tap()
        } else {
            series.tap()
        }
        XCTAssertNotEqual(series.value as? String, original)
        app.buttons["Series"].firstMatch.tap()
        for _ in 0 ..< 3 where !inspect.isHittable {
            app.swipeUp()
        }
        inspect.tap()
        let metric = app.descendants(matching: .any)["quantValue-risk.metric1.0"].firstMatch
        XCTAssertTrue(metric.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(metric.label.contains("0.66"))
        capture("Native Bitcoin risk controls")
        let export = app.buttons["prepareQuantExport"]
        for _ in 0 ..< 4 where !export.isHittable {
            app.swipeUp()
        }
        export.tap()
        XCTAssertTrue(app.buttons["shareQuantExport"].waitForExistence(timeout: 10))
        marketSection(app, "Cycle · Presidential")
        let cell = app.buttons["cycleCell-0-0"]
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        let observation = app.staticTexts["cycleObservation"]
        XCTAssertTrue(observation.label.contains("10 observations"))
        capture("Native presidential cycle heatmap")
        marketSection(app, "Tradfi · Sectors · Rotation")
        XCTAssertTrue(app.descendants(matching: .any)["sectorRotationChart"].firstMatch.waitForExistence(timeout: 10))
        let period = app.descendants(matching: .any)["sectorPeriod"].firstMatch
        for _ in 0 ..< 3 where !period.isHittable {
            app.swipeUp()
        }
        period.tap(); app.buttons["YTD"].firstMatch.tap()
        let annual = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Return 6.00%")).firstMatch
        for _ in 0 ..< 3 where !annual.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(annual.waitForExistence(timeout: 5))
        capture("Native sector rotation")
        XCTAssertEqual(app.webViews.count, 0)
    }

    private func assertQuantChart(_ app: XCUIApplication, contains text: String) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label CONTAINS %@", text), object: app.descendants(matching: .any)["quantTimeChart"].firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed, app.debugDescription)
    }

    func testQuantFilledBandsCustomWindowAndRecordedStatistics() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant"); marketSection(app, "Btc · Log Regression")
        assertQuantChart(app, contains: "2 shaded bands")
        let shading = app.switches["quantOverlays"].firstMatch
        reveal(app, shading); tapSwitch(shading)
        assertQuantChart(app, contains: "0 shaded bands")
        tapSwitch(shading); assertQuantChart(app, contains: "2 shaded bands")
        let picker = app.descendants(matching: .any)["quantChartPicker"].firstMatch
        for _ in 0 ..< 8 where !picker.isHittable {
            app.swipeDown()
        }
        picker.tap(); app.buttons["Bull market support band"].firstMatch.tap()
        assertQuantChart(app, contains: "1 shaded bands")
        let history = app.descendants(matching: .any)["quantHistory"].firstMatch
        history.tap(); app.buttons["Custom"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["quantCustomStart"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["quantCustomEnd"].firstMatch.exists)
        let apply = app.buttons["quantApplyRange"].firstMatch
        reveal(app, apply); apply.tap()
        XCTAssertTrue(app.staticTexts["quantAppliedRange"].firstMatch.label.contains("2024-01-01 through 2025-12-01 (UTC)"))
        capture("Native support band custom date controls")
        for _ in 0 ..< 8 where !history.isHittable {
            app.swipeDown()
        }
        history.tap(); app.buttons["1 year"].firstMatch.tap()
        assertQuantChart(app, contains: "From 2024-12-01 through 2025-12-01")
        let stats = app.buttons["Statistics for this window"].firstMatch
        reveal(app, stats); stats.tap()
        XCTAssertTrue(app.staticTexts["First · 2024-12-01"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Last · 2025-12-01"].firstMatch.exists)
        capture("Native support band selected-window statistics")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testQuantRecessionLegendAndDatedCrossEventInspection() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant"); marketSection(app, "Macro · Yield Curve")
        assertQuantChart(app, contains: "2 shaded periods")
        let legend = app.buttons["Shading legend"].firstMatch
        reveal(app, legend); legend.tap()
        XCTAssertTrue(app.staticTexts["NBER recession (source USREC)"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["10Y − 2Y below zero"].firstMatch.exists)
        capture("Native yield curve recession and inversion legend")
        marketSection(app, "Btc · Log Regression")
        let picker = app.descendants(matching: .any)["quantChartPicker"].firstMatch
        for _ in 0 ..< 8 where !picker.isHittable {
            app.swipeDown()
        }
        picker.tap(); app.buttons["Golden / death crosses"].firstMatch.tap()
        assertQuantChart(app, contains: "2 events")
        let events = app.buttons["Events · 2 in range"].firstMatch
        reveal(app, events); events.tap()
        let death = app.buttons["quantEvent-2025-07-01-Death"].firstMatch
        reveal(app, death); death.tap()
        let selected = app.staticTexts["quantSelectedDate"].firstMatch
        for _ in 0 ..< 8 where !selected.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(selected.waitForExistence(timeout: 5)); XCTAssertEqual(selected.label, "2025-07-01")
        XCTAssertTrue(app.descendants(matching: .any)["quantValue-price"].firstMatch.label.contains("2,800"))
        capture("Native cross event dated price inspection")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testNativeResearchTickersOpenSourceNotes() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "quant", name: "Quant")
        marketSection(app, "Research Tickers")
        XCTAssertTrue(healthText(app, "123.45 USD").waitForExistence(timeout: 10))
        capture("Native research ticker statistics")
        let mentions = app.buttons["Research mentions"]
        reveal(app, mentions)
        XCTAssertTrue(mentions.waitForExistence(timeout: 10), app.debugDescription)
        mentions.tap()
        let note = app.buttons["tickerMention-syntheticnote"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        capture("Native research ticker quotes")
        note.tap()
        XCTAssertTrue(app.buttons["readResearchText"].waitForExistence(timeout: 10))
        app.buttons["readResearchText"].tap()
        XCTAssertTrue(app.staticTexts["Synthetic research mentioning DEMO."].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        capture("Native research source text")
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testPoliticalTradeFiltersAndArchivedSourcePreview() async throws {
        let app = try await launchMarketFixture()
        marketFeature(app, id: "politics", name: "Politics")
        app.buttons["Disclosed trades"].tap()
        let options = app.switches["politicalArchiveOptions"]
        XCTAssertTrue(options.waitForExistence(timeout: 10))
        let control = options.switches.firstMatch
        if control.exists {
            control.tap()
        } else {
            options.tap()
        }
        XCTAssertEqual(options.value as? String, "1")
        let count = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "1 matching record")).firstMatch
        XCTAssertTrue(count.waitForExistence(timeout: 5), app.debugDescription)
        let option = app.descendants(matching: .any)["politicalOption"].firstMatch
        for _ in 0 ..< 4 where !option.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(option.waitForExistence(timeout: 5), app.debugDescription)
        capture("Native political trade filters")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        marketSection(app, "Filings")
        let filing = app.buttons["politicalFiling-DEMO-001"]
        XCTAssertTrue(filing.waitForExistence(timeout: 10))
        filing.tap()
        app.buttons["readPoliticalFilingText"].tap()
        XCTAssertTrue(app.staticTexts["politicalFilingText"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["politicalFilingText"].label.contains("Synthetic disclosure text"))
        app.buttons["previewPoliticalFiling"].tap()
        XCTAssertTrue(app.buttons["closeDocumentPreview"].firstMatch.waitForExistence(timeout: 10))
        capture("Native archived political filing PDF")
        app.buttons["closeDocumentPreview"].firstMatch.tap()
        XCTAssertEqual(app.webViews.count, 0)
    }
}
