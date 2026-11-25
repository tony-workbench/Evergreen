import Foundation

/// A proposed calendar block in a few words.
enum PlacementWords {
    /// "Run, Sunday 8:30–9:30 AM."; a rest day is "Rest day, Sunday."
    static func line(_ block: PreviewBlock) -> String {
        guard let start = block.start.date, let end = block.end.date else { return block.title }
        let weekday = start.formatted(.dateTime.weekday(.wide))
        if block.activity == .rest || block.allDay == true { return "\(block.title), \(weekday)." }
        return "\(block.title), \(weekday) \(Basis.span(start, end, calendar: .current))."
    }

    /// The badge on a block that isn't simply new.
    static func badge(_ block: PreviewBlock) -> String? {
        switch block.status {
        case "moved": "Moved"
        case "resized": "New length"
        case "cancelled": "Cancelled"
        default: nil
        }
    }
}
