import SwiftUI

/// A window-level cover also shields UIKit sheets (Quick Look, scan, share)
/// before iOS captures the app switcher snapshot.
@MainActor enum SnapshotShield {
    private static var covers: [UIWindow: UIView] = [:]
    static func show(_ visible: Bool) {
        if !visible {
            for cover in covers.values {
                cover.removeFromSuperview()
            }
            covers.removeAll()
            return
        }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows where window.windowLevel == .normal {
                if let existing = covers[window] {
                    window.bringSubviewToFront(existing)
                    continue
                }
                let cover = UIView(frame: window.bounds)
                cover.backgroundColor = .systemBackground
                cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                let label = UILabel()
                label.text = "DocVault"
                label.font = .preferredFont(forTextStyle: .largeTitle)
                label.textColor = .systemIndigo
                label.translatesAutoresizingMaskIntoConstraints = false
                cover.addSubview(label)
                NSLayoutConstraint.activate([
                    label.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
                    label.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
                ])
                cover.layer.zPosition = 10000
                window.addSubview(cover)
                covers[window] = cover
            }
        }
    }
}

struct PrivacyProtection: ViewModifier {
    @Environment(VaultModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    func body(content: Content) -> some View {
        content
            .disabled(!model.unlocked || scenePhase != .active)
            .accessibilityHidden(!model.unlocked || scenePhase != .active)
            .overlay {
                if !model.unlocked || scenePhase != .active {
                    ZStack {
                        Color(.systemBackground).ignoresSafeArea()
                        VStack(spacing: 20) {
                            Image(systemName: "lock.shield.fill").font(.largeTitle).foregroundStyle(
                                .indigo
                            )
                            Text("DocVault").font(.title.bold())
                            if scenePhase == .active {
                                Button("Unlock vault") { Task { await model.unlock() } }
                                    .buttonStyle(.borderedProminent).disabled(model.unlocking)
                                if let error = model.lockError {
                                    ErrorNotice(message: error)
                                }
                            }
                        }.padding()
                    }
                }
            }
    }
}

extension View { func privacyProtected() -> some View {
    modifier(PrivacyProtection())
} }
