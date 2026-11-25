import Network
import Observation
import SwiftUI

/// Whether the phone is online, for the screens' offline state (the week table, the workout page). Everything those
/// screens show is worked out on the phone; offline only the AI's picks wait and a place never looked up counts as away.
@Observable
@MainActor
final class NetworkStatus {
    static let shared = NetworkStatus()

    /// True until the first answer, so a screen never opens on a false "offline".
    private(set) var online = true
    private let monitor = NWPathMonitor()

    private init() {
        #if DEBUG
        if let seconds = UITestArguments.offlineSeconds() {
            stayOffline(for: seconds)
            return
        }
        #endif
        // Called on the monitor's own queue, so the closure is @Sendable (not tied to the main actor) and only hands a Bool over.
        monitor.pathUpdateHandler = { @Sendable path in
            let online = path.status == .satisfied
            Task { @MainActor in NetworkStatus.shared.online = online }
        }
        monitor.start(queue: DispatchQueue(label: "com.evergreentraining.app.network"))
    }

    #if DEBUG
    /// A UI test's `-uiOfflineFor <seconds>` (Views/Debug/UITestArguments.swift): offline that long, then online, with
    /// the real network never asked.
    private func stayOffline(for seconds: Double) {
        online = false
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            NetworkStatus.shared.online = true
        }
    }
    #endif
}

/// The network status a screen reads, put into the environment at the app's root (the UI-test seeds launch through the
/// same root, so `-uiOfflineFor` still reaches every screen). Outside that root (a preview) there is none, and the screen
/// counts as online: the default never reaches for the shared monitor, so it is safe to read on any thread.
private struct NetworkStatusKey: EnvironmentKey {
    static let defaultValue: NetworkStatus? = nil
}

extension EnvironmentValues {
    var networkStatus: NetworkStatus? {
        get { self[NetworkStatusKey.self] }
        set { self[NetworkStatusKey.self] = newValue }
    }
}

extension Optional where Wrapped == NetworkStatus {
    /// Online, as the status says, or when there is no status (a screen never opens on a false "offline").
    @MainActor var isOnline: Bool { self?.online ?? true }
}

/// One line that says the phone is offline and what that changes, shown above a screen's content while it is.
struct OfflineLine: View {
    let words: String

    var body: some View {
        Label(words, systemImage: "wifi.slash")
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
            .accessibilityIdentifier("offline.line")
    }
}
