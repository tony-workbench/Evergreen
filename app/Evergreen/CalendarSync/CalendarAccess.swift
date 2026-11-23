/// Whether the app can keep the plan on the Evergreen calendar. Without
/// full access the plan stays in the app (design state table, Permissions row).
enum CalendarAccess: Equatable {
    case on
    /// Never asked: "Turn on Calendar" shows the system prompt.
    case notAsked
    /// Denied, restricted or write-only: "Turn on Calendar" opens Settings.
    case off
}
