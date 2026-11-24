import XCTest

/// Launching Evergreen for a UI test on the `-uiTest home` seed (Background/UITestSeed.swift): a throwaway in-memory
/// store, rules on, nothing to train with, the usual rest weekdays, rain on the first training day and the next one out.
/// Nothing is read from or written to the device, and nothing reaches the network.
@MainActor
enum UITestApp {
    /// How long to wait for a screen: the week is worked out by the engine when the app opens.
    static let wait: TimeInterval = 15
    /// The text size for the large-text runs (the largest accessibility size).
    static let largestText = "UICTContentSizeCategoryAccessibilityXXXL"

    /// Starts the app on a seed (the home one unless asked), in English with a 24-hour clock so times read the same on
    /// every simulator. `extra` adds launch arguments, such as the debug ones in Views/Debug/UITestArguments.swift.
    static func launch(seed: String = "home", textSize: String? = nil, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTest", seed, "-AppleLanguages", "(en)", "-AppleLocale", "en_GB"]
        if let textSize { app.launchArguments += ["-UIPreferredContentSizeCategoryName", textSize] }
        app.launchArguments += extra
        app.launch()
        return app
    }

    /// The first day of this week's table other than today, as YYYY-MM-DD, read from the table's own rows.
    static func anotherDayThisWeek(_ app: XCUIApplication) throws -> String {
        let thisWeek = app.buttons["today.thisWeek"]
        XCTAssertTrue(thisWeek.waitForExistence(timeout: wait))
        thisWeek.tap()
        XCTAssertTrue(app.descendants(matching: .any)["week.table"].waitForExistence(timeout: wait))
        let prefix = "week.day."
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
        guard row.waitForExistence(timeout: wait) else { throw XCTSkip("This week's table has no day after today.") }
        return String(row.identifier.dropFirst(prefix.count))
    }

    /// Today with a home session to start. The seed's rest weekdays and the time of day decide whether today has one, so
    /// when it doesn't, My rules is opened and every rest weekday taken off; past the latest start (20:30) there is still
    /// none, and the test is skipped rather than failed.
    static func startButton(_ app: XCUIApplication) throws -> XCUIElement {
        let start = app.buttons["today.start"]
        if start.waitForExistence(timeout: wait) { return start }
        openMyRules(app)
        for day in 0..<7 {
            let chip = app.buttons["rules.restDay.\(day)"]
            if chip.exists, chip.isSelected { chip.tap() }
        }
        app.buttons["rules.done"].tap()
        app.buttons["settings.done"].tap()
        guard start.waitForExistence(timeout: wait) else {
            throw XCTSkip("Today has no home session at this hour (after the latest start, 20:30). Run before 20:00.")
        }
        return start
    }

    static func openMyRules(_ app: XCUIApplication) {
        let settings = app.buttons["today.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: wait))
        settings.tap()
        let rules = app.buttons["settings.myRules"]
        XCTAssertTrue(rules.waitForExistence(timeout: wait))
        rules.tap()
        XCTAssertTrue(app.buttons["rules.done"].waitForExistence(timeout: wait))
    }

    /// Goes through the whole workout: "Yes, I can" to a new movement, every set done, every rest skipped, until "Finish".
    static func doEverySet(_ app: XCUIApplication) -> XCUIElement {
        let finish = app.buttons["workout.finish"]
        for _ in 0..<maxSteps where !finish.exists {
            if app.buttons["workout.yesICan"].exists { app.buttons["workout.yesICan"].tap() }
            else if app.buttons["workout.skipRest"].exists { app.buttons["workout.skipRest"].tap() }
            else if app.buttons["workout.doneWithSet"].exists { app.buttons["workout.doneWithSet"].tap() }
            else if app.buttons["workout.skipUnreadable"].exists { app.buttons["workout.skipUnreadable"].tap() }
            else { _ = app.buttons["workout.doneWithSet"].waitForExistence(timeout: wait) }
        }
        return finish
    }

    /// Enough taps for five movements of up to four sets, each with a rest and a "Can you do one?".
    static let maxSteps = 60

    /// Runs Xcode's accessibility audit on the screen shown: labels, contrast, hit regions, Dynamic Type, clipped text.
    static func audit(_ app: XCUIApplication) throws {
        try app.performAccessibilityAudit()
    }
}
