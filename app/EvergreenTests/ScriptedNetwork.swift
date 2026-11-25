import Foundation
@testable import Evergreen

/// Stands in for the network for one `URLSession`: answers its requests from
/// a script, in order, and keeps what was sent. Each session has its own
/// script, so suites that run side by side don't share one. Nothing leaves the machine.
final class ScriptedNetwork: URLProtocol, @unchecked Sendable {
    struct Answer: Sendable {
        var status: Int
        var body: String

        /// A Gemini answer whose text is `text`.
        static func text(_ text: String) -> Answer {
            let body: JSONValue = ["candidates": [["content": ["role": "model", "parts": [["text": .string(text)]]], "finishReason": "STOP"]],
                                   "usageMetadata": ["promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15]]
            return Answer(status: 200, body: body.text)
        }

        /// A refusal with the API's error shape.
        static func error(_ status: Int, _ message: String) -> Answer {
            Answer(status: status, body: (["error": ["code": .number(Double(status)), "message": .string(message)]] as JSONValue).text)
        }
    }

    struct Sent: Sendable {
        var url: String
        var headers: [String: String]
        var body: String
    }

    /// One session's answers still to give, and the requests it has seen.
    final class Script: @unchecked Sendable {
        private let lock = NSLock()
        private var answers: [Answer]
        private var seen: [Sent] = []

        init(_ answers: [Answer]) { self.answers = answers }

        var requests: [Sent] { lock.withLock { seen } }
        /// More answers, after the ones already there.
        func then(_ more: [Answer]) { lock.withLock { answers += more } }

        fileprivate func next(for request: Sent) -> Answer? {
            lock.withLock {
                seen.append(request)
                return answers.isEmpty ? nil : answers.removeFirst()
            }
        }
    }

    private static let header = "X-Scripted-Network"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var scripts: [String: Script] = [:]

    static func session(_ answers: [Answer]) -> (session: URLSession, script: Script) {
        let script = Script(answers), id = UUID().uuidString
        lock.withLock { scripts[id] = script }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ScriptedNetwork.self]
        configuration.httpAdditionalHeaders = [header: id]
        return (URLSession(configuration: configuration), script)
    }

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
        let headers = request.allHTTPHeaderFields ?? [:]
        let script = Self.lock.withLock { Self.scripts[headers[Self.header] ?? ""] }
        let sent = Sent(url: request.url?.absoluteString ?? "", headers: headers.filter { $0.key != Self.header }, body: String(decoding: body, as: UTF8.self))
        guard let answer = script?.next(for: sent), let url = request.url,
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
