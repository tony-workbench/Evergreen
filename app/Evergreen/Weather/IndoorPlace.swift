import MapKit

/// Somewhere indoors to train when it rains: a name, how far, and where, so
/// Maps can open it. No prices and nothing to buy.
struct IndoorPlace: Codable, Equatable, Sendable, Identifiable {
    /// Farther than this isn't "nearby".
    static let farthest = 5_000.0
    static let most = 3

    var name: String
    var coordinate: Coordinate
    var distanceMeters: Double

    var id: String { "\(name)|\(coordinate.latitude)|\(coordinate.longitude)" }

    /// "0.8 km"
    var distanceText: String {
        distanceMeters < 1000
            ? "\(Int((distanceMeters / 50).rounded() * 50)) m"
            : String(format: "%.1f km", distanceMeters / 1000)
    }

    /// For "Open in Maps".
    @MainActor var mapItem: MKMapItem {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)))
        item.name = name
        return item
    }

    /// The nearest three of what a search found, within 5 km, nearest first.
    static func nearest(_ found: [FoundPlace], to here: Coordinate) -> [IndoorPlace] {
        var seen = Set<String>()
        return found
            .map { IndoorPlace(name: $0.name, coordinate: $0.coordinate, distanceMeters: here.distance(to: $0.coordinate)) }
            .filter { $0.distanceMeters <= farthest && seen.insert($0.id).inserted }
            .sorted { $0.distanceMeters < $1.distanceMeters }
            .prefix(most)
            .map(\.self)
    }
}

/// One result of a place search.
struct FoundPlace: Equatable, Sendable {
    var name: String
    var coordinate: Coordinate
}

/// Finds gyms near a place. Tests hand in a fixed list.
@MainActor
protocol PlaceSearching: AnyObject {
    func gyms(near place: Coordinate) async -> [FoundPlace]
}

/// Apple Maps' own search, for "gym" around the person.
@MainActor
final class MapPlaceSearch: PlaceSearching {
    func gyms(near place: Coordinate) async -> [FoundPlace] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = "gym"
        request.resultTypes = .pointOfInterest
        request.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude),
            latitudinalMeters: IndoorPlace.farthest * 2, longitudinalMeters: IndoorPlace.farthest * 2
        )
        guard let answer = try? await MKLocalSearch(request: request).start() else { return [] }
        return answer.mapItems.compactMap { item in
            guard let name = item.name, !name.isEmpty else { return nil }
            let at = item.placemark.coordinate
            return FoundPlace(name: name, coordinate: Coordinate(latitude: at.latitude, longitude: at.longitude))
        }
    }
}
