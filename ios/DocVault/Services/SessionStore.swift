import Foundation
import Security

struct SessionStore {
    private let service = "com.vanities.docvault.session"
    func read(for address: ServerAddress) throws -> String? {
        var query = attributes(address)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw keychainError(status)
        }
        return String(data: data, encoding: .utf8)
    }

    func write(_ token: String, for address: ServerAddress) throws {
        let query = attributes(address)
        let update = [kSecValueData as String: Data(token.utf8)]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = Data(token.utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw keychainError(added) }
        } else if status != errSecSuccess {
            throw keychainError(status)
        }
    }

    func delete(for address: ServerAddress) throws {
        let status = SecItemDelete(attributes(address) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw keychainError(status)
        }
    }

    private func attributes(_ address: ServerAddress) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: address.url.absoluteString,
        ]
    }

    private func keychainError(_ status: OSStatus) -> NSError {
        NSError(
            domain: NSOSStatusErrorDomain, code: Int(status),
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Could not access your saved session: \(SecCopyErrorMessageString(status, nil) as String? ?? String(status)).",
            ]
        )
    }
}
