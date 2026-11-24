import Foundation

/// A place on the map, in degrees.
struct Coordinate: Codable, Hashable, Sendable {
    var latitude: Double
    var longitude: Double

    /// To two decimals, about a kilometre: all the forecast needs, and all that is sent or kept.
    var rounded: Coordinate {
        Coordinate(latitude: (latitude * 100).rounded() / 100, longitude: (longitude * 100).rounded() / 100)
    }

    /// Metres to another place, along the earth's surface.
    func distance(to other: Coordinate) -> Double {
        let radius = 6_371_000.0
        let lat1 = latitude * .pi / 180, lat2 = other.latitude * .pi / 180
        let dLat = lat2 - lat1, dLon = (other.longitude - longitude) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
