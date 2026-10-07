import Foundation

extension VaultModel {
    func timesheetReportReview(end: String) async throws -> NativeReportReview {
        let client = api, wasDemo = demo
        return try await NativeTimesheetReport.review(end: end) { path in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            let value = try await self.nativeRequest(path, scope: .init())
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return value
        }
    }

    func saveTimesheetReport(original: VaultValue, draft: NativeReportDraft) async throws -> VaultValue {
        let client = api, wasDemo = demo
        func request(_ method: String, body: VaultValue? = nil) async throws -> VaultValue {
            guard connected, api === client, demo == wasDemo else { throw CancellationError() }
            let value = try await nativeRequest("api/timesheet/weekly-report/config", scope: .init(), method: method, body: body)
            guard connected, api === client, demo == wasDemo else { throw CancellationError() }
            return value
        }
        let saved = try await NativeTimesheetReport.save(original: original, draft: draft, fetch: { try await request("GET") }, write: { try await request("PUT", body: $0) })
        revision += 1; return saved
    }

    func sendTimesheetReport(_ review: NativeReportReview) async throws -> VaultValue {
        let client = api, wasDemo = demo
        let value = try await NativeTimesheetReport.send(review: review, fetch: {
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.timesheetReportReview(end: review.preview.end)
        }, send: { body in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet/weekly-report/send", scope: .init(), method: "POST", body: body)
        })
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        revision += 1; return value
    }
}
