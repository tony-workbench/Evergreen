enum CalendarSyncError: Error {
    /// No iCloud or on-phone calendar account to put the calendar in.
    case noSource
}
