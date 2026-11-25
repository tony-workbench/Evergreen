import Foundation

/// Where a forecast comes from. Tests hand in recorded answers.
protocol ForecastProviding: Sendable {
    func forecast(at place: Coordinate, now: Date) async throws -> Forecast
}

/// Open-Meteo's free forecast: no key, no account. Only the place, rounded to
/// about a kilometre, is sent.
struct ForecastClient: ForecastProviding {
    static let endpoint = "https://api.open-meteo.com/v1/forecast"

    /// Keeps nothing on disk: no cache, no cookies.
    private static let session = URLSession(configuration: .ephemeral)

    /// Fetches a URL's body; the network in the app, a recorded answer in tests.
    var fetch: @Sendable (URL) async throws -> Data = { url in
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        let (data, response) = try await Self.session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    static func url(for place: Coordinate) -> URL? {
        let place = place.rounded
        var parts = URLComponents(string: endpoint)
        parts?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.2f", place.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.2f", place.longitude)),
            URLQueryItem(name: "hourly", value: "precipitation_probability,precipitation"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "forecast_days", value: "3"),
        ]
        return parts?.url
    }

    func forecast(at place: Coordinate, now: Date) async throws -> Forecast {
        guard let url = Self.url(for: place) else { throw URLError(.badURL) }
        return try Forecast(openMeteo: try await fetch(url), fetchedAt: now, place: place.rounded)
    }
}
