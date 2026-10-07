import Foundation

struct VaultEntity: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String
    let type: String?
    let description: String?
    var isTax: Bool {
        type != "docs"
    }
}

struct VaultFile: Codable, Hashable, Identifiable, Sendable {
    let name: String
    let path: String
    let size: Int64
    let lastModified: Double
    let type: String
    var tags: [String]?
    var notes: String?
    var entity: String?
    var entityName: String?
    var parsedData: VaultValue?
    var tracked: Bool?
    var isTracked: Bool {
        tracked != false
    }

    var id: String {
        "\(entity ?? "")/\(path)"
    }

    var modifiedDate: Date {
        Date(timeIntervalSince1970: lastModified / 1000)
    }

    var folder: String {
        (path as NSString).deletingLastPathComponent
    }

    var symbol: String {
        switch (name as NSString).pathExtension.lowercased() {
        case "pdf": "doc.richtext"
        case "jpg", "jpeg", "png", "heic", "webp": "photo"
        case "csv", "xls", "xlsx": "tablecells"
        case "zip": "doc.zipper"
        default: "doc.text"
        }
    }
}

struct ServerStatus: Decodable, Sendable {
    let ok: Bool
    let authRequired: Bool
    let authenticated: Bool
    let error: String?
}

struct EntityResponse: Decodable { let entities: [VaultEntity] }
struct FileResponse: Decodable { let files: [VaultFile] }
struct UploadResponse: Decodable {
    let ok: Bool
    let path: String
}

struct EmptyResponse: Decodable { let ok: Bool }

struct ServerAddress: Equatable, Sendable {
    let url: URL
    init(_ text: String) throws {
        guard
            var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = parts.scheme?.lowercased(), ["https", "http"].contains(scheme),
            let host = parts.host, !host.isEmpty,
            parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
            !parts.path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
        else { throw VaultError.invalidAddress }
        if scheme == "http", !Self.isLocalHost(host) {
            throw VaultError.httpsRequired
        }
        parts.scheme = scheme
        parts.path = parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if !parts.path.isEmpty {
            parts.path = "/" + parts.path
        }
        guard let url = parts.url else { throw VaultError.invalidAddress }
        self.url = url
    }

    static func isLocalHost(_ host: String) -> Bool {
        let host = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "::1" || host.hasPrefix("fd") && host.contains(":")
            || host.hasPrefix("fc") && host.contains(":")
        {
            return true
        }
        if host.hasSuffix(".local") || !host.contains(".") && !host.contains(":") {
            return true
        }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0 ... 255).contains($0) }) else { return false }
        return octets[0] == 10 || octets[0] == 127
            || octets[0] == 192 && octets[1] == 168
            || octets[0] == 172 && (16 ... 31).contains(octets[1])
            || octets[0] == 100 && (64 ... 127).contains(octets[1])
    }

    func endpoint(_ segments: [String], query: [URLQueryItem] = []) throws -> URL {
        guard segments.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") })
        else {
            throw VaultError.invalidPath
        }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let allowed = CharacterSet(
            charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
        )
        parts.percentEncodedPath +=
            "/"
            + segments.map { $0.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(
                separator: "/"
            )
        parts.queryItems = query.isEmpty ? nil : query
        guard let result = parts.url else { throw VaultError.invalidAddress }
        return result
    }
}

enum VaultError: LocalizedError, Equatable {
    case invalidAddress, httpsRequired, invalidPath, signedOut, missingSession
    case server(String)
    case invalidResponse, emptyUpload, uploadTooLarge
    var errorDescription: String? {
        switch self {
        case .invalidAddress:
            "Enter a server URL such as https://vault.example.com or http://nas.local:3005."
        case .httpsRequired: "Use HTTPS for servers outside your local network."
        case .invalidPath: "Choose a relative folder without .. or empty path components."
        case .signedOut: "Your session expired. Sign in again to continue."
        case .missingSession: "The server did not return a sign-in session."
        case let .server(message): message
        case .invalidResponse: "DocVault returned an unexpected response."
        case .emptyUpload: "The selected document is empty."
        case .uploadTooLarge: "Choose a document no larger than 2 GB."
        }
    }
}
