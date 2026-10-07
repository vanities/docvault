import Foundation

struct NativeMarkdownStats {
    let bytes: Int
    let words: Int
    let lines: Int
    let headings: Int
    let sections: [TaxYearAmount]

    init(_ text: String) {
        bytes = text.utf8.count
        words = Self.wordCount(text)
        lines = text.isEmpty ? 0 : text.components(separatedBy: .newlines).count
        var groups: [String: Int] = [:]
        var heading = "Introduction"
        var fenced: String?
        var count = 0
        for line in text.components(separatedBy: .newlines) {
            let clean = line.trimmingCharacters(in: .whitespaces)
            if clean.hasPrefix("```") || clean.hasPrefix("~~~") {
                let marker = String(clean.prefix(3))
                if fenced == marker {
                    fenced = nil
                } else if fenced == nil {
                    fenced = marker
                }
            }
            if fenced == nil, let range = clean.range(of: "^#{1,6}\\s+", options: .regularExpression) {
                heading = String(clean[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                if heading.isEmpty {
                    heading = "Untitled section"
                }
                count += 1
            }
            groups[heading, default: 0] += Self.wordCount(line)
        }
        headings = count
        sections = groups.filter { $0.value > 0 }.map { .init(label: $0.key, amount: Double($0.value)) }.sorted { $0.label < $1.label }
    }

    private static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: \.isWhitespace).count
    }
}

enum NativeAdministration {
    static func validSkillName(_ name: String) -> Bool {
        name.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil
    }

    static func skillError(name: String, description: String, instructions: String) -> String? {
        if !validSkillName(name) {
            return "Use 1–64 lowercase letters, digits or hyphens. Start with a letter or digit."
        }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter a skill description."
        }
        if instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter skill instructions."
        }
        return nil
    }

    static func skills(_ rows: [VaultValue], query: String, recent: Bool) -> [VaultValue] {
        rows.filter { query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || ($0["name"].string + " " + $0["description"].string).localizedCaseInsensitiveContains(query.trimmingCharacters(in: .whitespacesAndNewlines)) }.sorted {
            if recent, $0["updatedAt"].string != $1["updatedAt"].string {
                return $0["updatedAt"].string > $1["updatedAt"].string
            }
            return $0["name"].string.localizedStandardCompare($1["name"].string) == .orderedAscending
        }
    }

    static func sourceOutcome(_ repo: VaultValue) -> String {
        if !repo["lastError"].string.isEmpty {
            return "Sync failed"
        }
        if repo["enabled"] == .bool(false) {
            return "Disabled"
        }
        return repo["lastSyncedAt"].string.isEmpty ? "Not synced yet" : "Saved sync"
    }

    static func repositoryURL(_ input: String) -> String? {
        guard var components = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)), components.scheme?.lowercased() == "https", let host = components.host, !host.isEmpty else { return nil }
        components.user = nil; components.password = nil
        return components.url?.absoluteString
    }
}

struct NativeSourceFolder: Identifiable {
    let path: String
    let name: String
    let count: Int
    var id: String {
        path
    }
}

enum NativeSourceFiles {
    static func safePath(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("\0") && path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func browse(_ files: [String], folder: String, query: String) -> (folders: [NativeSourceFolder], files: [String]) {
        let paths = Array(Set(files.filter(safePath))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !needle.isEmpty {
            return ([], paths.filter { $0.localizedCaseInsensitiveContains(needle) })
        }
        let prefix = folder.isEmpty ? "" : folder + "/"
        var folders: [String: Int] = [:]
        var direct: [String] = []
        for path in paths where path.hasPrefix(prefix) {
            let rest = String(path.dropFirst(prefix.count))
            if let slash = rest.firstIndex(of: "/") {
                folders[String(rest[..<slash]), default: 0] += 1
            } else {
                direct.append(path)
            }
        }
        return (folders.map { .init(path: prefix + $0.key, name: $0.key, count: $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }, direct)
    }

    static func basename(_ path: String) -> String {
        let name = path.split(separator: "/").last.map(String.init) ?? path
        return name.lowercased().hasSuffix(".md") ? String(name.dropLast(3)) : name
    }

    /// Resolve within this repository only. Ambiguous basename links stay unresolved.
    static func resolve(_ target: String, current: String, files: [String], wiki: Bool) -> String? {
        let clean = String(target.split(separator: "#", omittingEmptySubsequences: false).first ?? "").removingPercentEncoding ?? target
        if clean.isEmpty {
            return current
        }
        let suffix = clean.lowercased().hasSuffix(".md") ? clean : clean + ".md"
        let parent = current.split(separator: "/").dropLast().map(String.init)
        func normalized(_ parts: [String]) -> String? {
            var result: [String] = []
            for part in parts {
                if part == "." || part.isEmpty {
                    continue
                }
                if part == ".." {
                    guard !result.isEmpty else { return nil }; result.removeLast()
                } else {
                    result.append(part)
                }
            }
            let path = result.joined(separator: "/")
            return safePath(path) ? path : nil
        }
        let parts = suffix.split(separator: "/").map(String.init)
        let candidates = [normalized(clean.hasPrefix("/") ? parts : parent + parts), normalized(parts)].compactMap(\.self)
        for candidate in candidates {
            if let match = files.first(where: { $0 == candidate }) {
                return match
            }
        }
        if wiki, !clean.contains("/"), !clean.contains("\\") {
            let matches = files.filter { basename($0).localizedCaseInsensitiveCompare(basename(clean)) == .orderedSame }
            if matches.count == 1 {
                return matches[0]
            }
        }
        return nil
    }

    static func linkifyWiki(_ text: String) -> String {
        guard let pattern = try? NSRegularExpression(pattern: "(?<!!)\\[\\[([^\\]\\|]+)(?:\\|([^\\]]+))?\\]\\]") else { return text }
        let range = NSRange(text.startIndex..., in: text)
        let code = try? NSRegularExpression(pattern: "(?s)```.*?(?:```|$)|~~~.*?(?:~~~|$)|`[^`]*`")
        let protected = code?.matches(in: text, range: range).map(\.range) ?? []
        var result = text
        for match in pattern.matches(in: text, range: range).reversed() {
            if protected.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) {
                continue
            }
            guard let whole = Range(match.range, in: result), let targetRange = Range(match.range(at: 1), in: text) else { continue }
            let target = String(text[targetRange]).trimmingCharacters(in: .whitespaces)
            let alias = Range(match.range(at: 2), in: text).map { String(text[$0]) } ?? target
            var url = URLComponents(); url.scheme = "docvault-source"; url.host = "wiki"; url.queryItems = [.init(name: "target", value: target)]
            if let address = url.string {
                result.replaceSubrange(whole, with: "[" + alias + "](" + address + ")")
            }
        }
        return result
    }
}
