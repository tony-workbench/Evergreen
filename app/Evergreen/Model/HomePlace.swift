import Foundation

/// Where the person's home is, set once from the phone's own location ("Set my
/// current location as home"). It is kept with the rules on this phone and
/// never leaves it: only each day's "home" or "out" goes to the plan engine.
struct HomePlace: Codable, Equatable, Sendable {
    /// Within this many metres of home is at home.
    static let radiusMetres = 200.0
    static let metresPerKilometre = 1000.0
    /// A day the phone is this far from home when the app is opened becomes a day out.
    /// A straight line standing in for about half an hour's drive, so no route service is asked.
    static let defaultFarKilometres = 20.0

    var place: Coordinate

    func isHome(_ other: Coordinate) -> Bool {
        place.distance(to: other) <= Self.radiusMetres
    }

    func isFar(_ other: Coordinate, kilometres: Double) -> Bool {
        place.distance(to: other) >= kilometres * Self.metresPerKilometre
    }
}
