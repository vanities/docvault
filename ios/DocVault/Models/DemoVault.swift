import SwiftUI

/// Invented fixtures only. Demo mode never creates a network client or saves credentials.
enum DemoVault {
    static let entities: [VaultEntity] = [
        .init(
            id: "personal", name: "Personal", color: "indigo", type: "tax",
            description: "Taxes, statements, and household records"
        ),
        .init(
            id: "acme", name: "Acme Studio", color: "teal", type: "tax",
            description: "Business documents and receipts"
        ),
        .init(
            id: "records", name: "Records", color: "orange", type: "docs",
            description: "Important documents, all in one place"
        ),
    ]
    static func files(entity: String) -> [VaultFile] {
        let names: [(String, String)] =
            switch entity {
            case "personal":
                [
                    ("AcmeBank_Statement_2026-09.pdf", "2026/Statements"),
                    ("Home_Insurance.pdf", "Insurance"),
                    ("AcmeBank_1099-INT_2025.pdf", "2025/Income"),
                    ("Equipment_Receipt.pdf", "2026/Expenses"),
                    ("AcmeEmployer_W2_2026.pdf", "2026/Income/w2"),
                ]
            case "acme":
                [
                    ("Acme_Invoice_2026-09.pdf", "2026/Invoices"),
                    ("Studio_Receipt.pdf", "2026/Expenses"),
                    ("Operating_Agreement.pdf", "business-docs"),
                ]
            default: [("Home_Inventory.pdf", "Home"), ("Vehicle_Records.pdf", "Vehicle")]
            }
        return names.enumerated().map { index, item in
            var file = VaultFile(
                name: item.0, path: "\(item.1)/\(item.0)", size: 24576,
                lastModified: 1_791_244_800_000 - Double(index) * 86_400_000,
                type: "application/pdf",
                tags: index == 0 ? ["Reviewed"] : [], notes: "", entity: entity,
                entityName: entities.first(where: { $0.id == entity })?.name
            )
            if item.0 == "AcmeEmployer_W2_2026.pdf" {
                file.parsedData = .object(["_documentType": .string("w2"), "employerName": .string("Acme Employer"), "wages": .number(42000), "federalWithheld": .number(4000), "stateWithheld": .number(1000)])
            } else if item.0 == "Equipment_Receipt.pdf" || item.0 == "Studio_Receipt.pdf" {
                file.parsedData = .object(["_documentType": .string("receipt"), "vendor": .string("Acme Supplies"), "amount": .number(item.0 == "Equipment_Receipt.pdf" ? 250 : 500), "category": .string("equipment")])
            } else if item.0 == "Acme_Invoice_2026-09.pdf" {
                file.parsedData = .object(["_documentType": .string("invoice"), "customer": .string("Acme Client"), "amount": .number(2000)])
            }
            return file
        }
    }

    /// Valid, deterministic archive containing invented demo text only.
    static func archive() -> Data {
        Data(base64Encoded: "UEsDBBQAAAAAAAAAIVxpz3yTUwAAAFMAAAAIAAAARGVtby50eHRTeW50aGV0aWMgRG9jVmF1bHQgYXJjaGl2ZS4gQ29ubmVjdCB5b3VyIHNlcnZlciB0byBleHBvcnQgeW91ciBzZWxlY3RlZCBkb2N1bWVudHMuClBLAQIUAxQAAAAAAAAAIVxpz3yTUwAAAFMAAAAIAAAAAAAAAAAAAACAAQAAAABEZW1vLnR4dFBLBQYAAAAAAQABADYAAAB5AAAAAAA=")!
    }

    @MainActor static func invoicePDF(_ invoice: VaultValue) -> Data {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            var y: CGFloat = 50
            let font = UIFont.systemFont(ofSize: 12)
            func page() {
                context.beginPage(); y = 50
                ("DocVault · invented demo invoice" as NSString).draw(at: CGPoint(x: 44, y: y), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 20)])
                y += 38
            }
            func text(_ value: String) {
                let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.black]
                let height = ceil((value as NSString).boundingRect(with: CGSize(width: 524, height: CGFloat.greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil).height) + 12
                // Split long descriptions into wrapped fragments so demo exports keep all text.
                if height > 620 {
                    let characters = Array(value); var offset = 0
                    while offset < characters.count {
                        let end = min(offset + 600, characters.count); text(String(characters[offset ..< end])); offset = end
                    }
                    return
                }
                if y + height > 744 {
                    page()
                }
                (value as NSString).draw(in: CGRect(x: 44, y: y, width: 524, height: height), withAttributes: attributes); y += height
            }
            page()
            text("Invoice \(invoice["number"].string)\n\(invoice["clientName"].string)\nIssued \(invoice["issueDate"].string) · Due \(invoice["dueDate"].string)")
            text("This PDF contains invented data. No email is sent in demo mode.")
            if invoice["lines"].array.isEmpty {
                text("Imported invoice summary. No line details are recorded.")
            }
            for line in invoice["lines"].array {
                text("\(line["date"].string) · \(line["projectName"].string)\n\(line["description"].string)\n\(NativeTimesheetReport.hours(line["minutes"].number)) · \(NativeFinance.money(line["amount"].number, currency: invoice["currency"].string))")
            }
            text("Subtotal: \(NativeFinance.money(invoice["subtotal"].number, currency: invoice["currency"].string))\nTax: \(NativeFinance.money(invoice["tax"].number, currency: invoice["currency"].string))\nTotal: \(NativeFinance.money(invoice["total"].number, currency: invoice["currency"].string))")
            if !invoice["comment"].string.isEmpty {
                text(invoice["comment"].string)
            }
        }
    }

    @MainActor static func pdf(title: String) -> Data {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData {
            context in
            context.beginPage()
            UIColor.systemIndigo.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 612, height: 12))
            let heading: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 30), .foregroundColor: UIColor.black,
            ]
            ("DocVault" as NSString).draw(at: CGPoint(x: 48, y: 64), withAttributes: heading)
            (title as NSString).draw(
                in: CGRect(x: 48, y: 130, width: 516, height: 90),
                withAttributes: [.font: UIFont.systemFont(ofSize: 18)]
            )
            ("Demo document\n\nThis document contains invented information for previewing DocVault.\n\nAcme Bank\nSample total: $1,234.56\n\nConnect your own server to browse your records."
                as NSString)
                .draw(
                    in: CGRect(x: 48, y: 240, width: 516, height: 350),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 16)]
                )
        }
    }
}
