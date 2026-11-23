import Foundation

/// A short time as people say it.
enum PlainTime {
    /// "7" becomes "7 AM"; "6 PM" and "noon" stay as they are.
    static func withHalf(_ time: String) -> String {
        time.hasSuffix("PM") || time == "noon" ? time : "\(time) AM"
    }
}
