import Foundation

enum NativeAdministrationDemo {
    static let brainText = "# Demo memory\n\n## Preferences\n\nUse clear language and show saved evidence.\n\n## Decisions\n\nKeep private records inside the vault. These are invented demonstration notes.\n"
    static let skillText = "# Review a document\n\n1. Read the complete source.\n2. Keep exact dates and amounts.\n3. List missing evidence.\n\n| Check | Result |\n| --- | --- |\n| Source | Read |\n| Missing values | Keep unavailable |"
    static let files = ["README.md", "Guides/Overview.md", "Guides/Planning/Checklist.md", "Guides/Planning/Notes.md", "Archive/Notes.md"]
    static let pages = [
        "README.md": "# Demo library\n\nRead [[Overview|the overview]] and the [planning checklist](Guides/Planning/Checklist.md).\n\nThese are invented source pages.\n",
        "Guides/Overview.md": "# Overview\n\nThis library keeps evidence organized.\n\nOpen [[Guides/Planning/Checklist]] or return to [Home](../README.md).",
        "Guides/Planning/Checklist.md": "# Checklist\n\n- Read the source\n- Preserve missing observations\n- Verify the saved result\n\n| Step | Status |\n| --- | --- |\n| Review | Pending |",
        "Guides/Planning/Notes.md": "# Planning notes\n\nInvented notes for the demonstration.",
        "Archive/Notes.md": "# Archived notes\n\nA second page deliberately has the same basename.",
    ]
    static var source: VaultValue {
        .object(["id": .string("acme-library"), "name": .string("Acme Research Library"), "url": .string("https://example.com/acme/library.git"), "branch": .string("main"), "enabled": .bool(true), "lastSyncedAt": .string("2026-10-01T12:00:00Z"), "fileCount": .number(Double(files.count)), "commit": .string("abcdef0"), "lastError": .null])
    }

    static func brain(_ content: String) -> VaultValue {
        .object(["content": .string(content), "bytes": .number(Double(content.utf8.count)), "exists": .bool(true), "updatedAt": .string("2026-10-01T12:00:00Z")])
    }

    static func skill(_ name: String, description: String, instructions: String) -> VaultValue {
        .object(["name": .string(name), "description": .string(description), "instructions": .string(instructions), "bytes": .number(Double((name + description + instructions).utf8.count)), "updatedAt": .string("2026-10-01T12:00:00Z")])
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue]) throws -> VaultValue? {
        guard request.path.count >= 2 else { return nil }
        let key = request.path[1]
        if key == "brain" {
            let current = stores["api/brain"] ?? brain(brainText)
            if method == "GET" {
                return current
            }
            let next: VaultValue
            if request.path.last == "append", method == "POST" {
                let text = (body ?? .null)["text"].string.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { throw VaultError.server("Enter a note.") }
                let tag = (body ?? .null)["tag"].string
                next = brain(current["content"].string + "\n- (2026-10-01" + (tag.isEmpty ? "" : ", " + tag) + ") " + text + "\n")
            } else if method == "DELETE" {
                next = brain("")
            } else if method == "PUT", case let .string(content) = (body ?? .null)["content"] {
                next = brain(content)
            } else {
                throw VaultError.server("Unsupported demo memory request.")
            }
            stores["api/brain"] = next; return next
        }
        if key == "skills" {
            var rows = stores["api/skills"]?["skills"].array ?? [skill("document-review", description: "Review a document and preserve source evidence.", instructions: skillText), skill("weekly-summary", description: "Summarize a week using saved records.", instructions: "# Weekly review\n\nUse recorded work only.")]
            if request.path.count == 2 {
                return .object(["skills": .array(rows.map { row in var summary = row; summary.remove("instructions"); return summary })])
            }
            let name = request.path[2]
            guard NativeAdministration.validSkillName(name) else { throw VaultError.server("Invalid skill name.") }
            let index = rows.firstIndex { $0["name"].string == name }
            if method == "GET" {
                guard let index else { throw VaultError.server("Demo skill not found.") }; return rows[index]
            }
            let result: VaultValue
            if method == "DELETE" {
                guard let index else { throw VaultError.server("Demo skill not found.") }; rows.remove(at: index); result = .object(["ok": .bool(true)])
            } else if method == "PUT" {
                let body = body ?? .null
                if let error = NativeAdministration.skillError(name: name, description: body["description"].string, instructions: body["instructions"].string) {
                    throw VaultError.server(error)
                }
                result = skill(name, description: body["description"].string, instructions: body["instructions"].string)
                if let index {
                    rows[index] = result
                } else {
                    rows.append(result)
                }
            } else {
                throw VaultError.server("Unsupported demo skill request.")
            }
            stores["api/skills"] = .object(["skills": .array(rows)]); return result
        }
        guard key == "external-sources" else { return nil }
        var list = stores["api/external-sources"] ?? .object(["repos": .array([source]), "tokenConfigured": .bool(false)])
        defer { stores["api/external-sources"] = list }
        if request.path.count == 2 {
            if method == "GET" {
                return list
            }
            guard method == "POST", let normalized = NativeAdministration.repositoryURL((body ?? .null)["url"].string) else { throw VaultError.server("Enter an HTTPS repository URL.") }
            guard !list["repos"].array.contains(where: { $0["url"].string == normalized }) else { throw VaultError.server("That repository is already a source.") }
            var row = body ?? .object([:]); row.set("id", .string(UUID().uuidString)); row.set("url", .string(normalized)); row.set("enabled", .bool(true))
            if row["name"].string.isEmpty {
                row.set("name", .string("Demo repository"))
            }
            list.set("repos", .array(list["repos"].array + [row])); return row
        }
        if request.path[2] == "token", method == "PUT" {
            list.set("tokenConfigured", .bool(!(body ?? .null)["token"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)); return .object(["tokenConfigured": list["tokenConfigured"]])
        }
        let id = request.path[2]
        var repos = list["repos"].array
        guard let index = repos.firstIndex(where: { $0["id"].string == id }) else { throw VaultError.server("Demo source not found.") }
        if request.path.count == 3, method == "DELETE" {
            repos.remove(at: index); list.set("repos", .array(repos)); return .object(["ok": .bool(true)])
        }
        guard request.path.count == 4 else { throw VaultError.server("Unsupported demo source request.") }
        if request.path[3] == "files", method == "GET" {
            return .object(["files": .array((id == "acme-library" ? files : []).map(VaultValue.string))])
        }
        if request.path[3] == "file", method == "GET", let path = request.query["path"], id == "acme-library", let content = pages[path] {
            return .object(["content": .string(content), "path": .string(path), "truncated": .bool(false)])
        }
        if request.path[3] == "sync", method == "POST" {
            repos[index].set("lastError", .null); repos[index].set("lastSyncedAt", .string("2026-10-01T12:00:00Z")); repos[index].set("fileCount", .number(id == "acme-library" ? Double(files.count) : 0)); list.set("repos", .array(repos)); return repos[index]
        }
        throw VaultError.server("Demo source page unavailable.")
    }
}
