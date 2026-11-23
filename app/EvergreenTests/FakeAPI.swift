import Foundation

/// Stands in for the network: answers every request of a session from a
/// script and keeps the requests. Nothing leaves the machine.
final class FakeAPI: URLProtocol, @unchecked Sendable {
    struct Answer { var status: Int; var body: String }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var answers: [Answer] = []
    nonisolated(unsafe) private static var seen: [(request: URLRequest, body: Data)] = []

    /// A session that only ever reaches this class, answering in order.
    static func session(_ script: [Answer]) -> URLSession {
        lock.withLock {
            answers = script
            seen = []
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeAPI.self]
        return URLSession(configuration: configuration)
    }

    static var requests: [(request: URLRequest, body: Data)] { lock.withLock { seen } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                body.append(buffer, count: count)
            }
            stream.close()
        }
        let answer: Answer? = Self.lock.withLock {
            Self.seen.append((request, body))
            return Self.answers.isEmpty ? nil : Self.answers.removeFirst()
        }
        guard let answer, let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
