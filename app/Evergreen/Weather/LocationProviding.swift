import CoreLocation

enum LocationPermission: Equatable, Sendable {
    case notAsked, allowed, denied
}

/// Where the person is, for the forecast and nearby indoor places.
@MainActor
protocol LocationProviding: AnyObject {
    var permission: LocationPermission { get }
    /// Shows the system's When In Use prompt. Returns whether it was allowed.
    func request() async -> Bool
    /// Nil without permission or without a fix.
    func current() async -> Coordinate?
}

/// CoreLocation, When In Use, to the nearest kilometre.
@MainActor
final class DeviceLocation: NSObject, LocationProviding, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var permissionWaiters: [CheckedContinuation<Void, Never>] = []
    private var fixWaiters: [CheckedContinuation<Coordinate?, Never>] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    var permission: LocationPermission {
        switch manager.authorizationStatus {
        case .notDetermined: .notAsked
        case .authorizedWhenInUse, .authorizedAlways: .allowed
        default: .denied
        }
    }

    func request() async -> Bool {
        guard permission == .notAsked else { return permission == .allowed }
        await withCheckedContinuation { waiter in
            permissionWaiters.append(waiter)
            manager.requestWhenInUseAuthorization()
        }
        return permission == .allowed
    }

    func current() async -> Coordinate? {
        guard permission == .allowed else { return nil }
        if let recent = manager.location, recent.timestamp > Date().addingTimeInterval(-3600) {
            return Coordinate(latitude: recent.coordinate.latitude, longitude: recent.coordinate.longitude)
        }
        return await withCheckedContinuation { waiter in
            fixWaiters.append(waiter)
            if fixWaiters.count == 1 { manager.requestLocation() }
        }
    }

    private func answerFix(_ place: Coordinate?) {
        let waiters = fixWaiters
        fixWaiters = []
        waiters.forEach { $0.resume(returning: place) }
    }

    // The manager was made on the main thread, so it calls back there.

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            guard permission != .notAsked else { return }
            let waiters = permissionWaiters
            permissionWaiters = []
            waiters.forEach { $0.resume() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let place = locations.last.map { Coordinate(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude) }
        MainActor.assumeIsolated { answerFix(place) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated { answerFix(nil) }
    }
}
