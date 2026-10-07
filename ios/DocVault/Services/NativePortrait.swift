import ImageIO
import UIKit

extension VaultModel {
    func nutritionImage(product: VaultValue, scope: VaultScope, slot: String) async throws -> UIImage? {
        guard !demo, ["primary", "facts"].contains(slot), !product["id"].string.isEmpty else { return nil }
        let url = try await nativeDownload("api/health/{person}/nutrition/{id}/image?slot=" + slot,
                                           scope: scope, record: product, method: "GET", body: nil, suffix: "png")
        defer { Self.removePreview(url) }
        try Task.checkCancellation()
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 10 * 1024 * 1024,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceThumbnailMaxPixelSize: 1600,
                  kCGImageSourceCreateThumbnailWithTransform: true,
              ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }

    /// Authenticated, protected, short-lived download. Only the thumbnail remains
    /// in memory; no portrait files or image cache survive closing the app.
    func politicalPortrait(_ imagePath: String) async throws -> UIImage? {
        guard !demo, let request = NativePolitics.portraitRequest(imagePath) else { return nil }
        let path = request.path.joined(separator: "/")
        let url = try await nativeDownload(path, scope: .init(), record: .null, method: "GET", body: nil, suffix: "jpg")
        defer { Self.removePreview(url) }
        try Task.checkCancellation()
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 5 * 1024 * 1024,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceThumbnailMaxPixelSize: 256,
                  kCGImageSourceCreateThumbnailWithTransform: true,
              ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }
}
