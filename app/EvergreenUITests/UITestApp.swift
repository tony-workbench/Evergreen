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
        // The next day at home can sit below the fold of the table.
        guard reveal(row, in: app) else { throw XCTSkip("This week's table has no day after today.") }
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
    static func audit(_ app: XCUIApplication, checksTextSize: Bool = true) throws {
        // The system draws the navigation bar's buttons ("Done", "Close") itself, on a see-through glass capsule: the
        // audit reads the glass as their background and their text size as fixed. On iOS 27's glass bar, measured on a
        // light-mode screenshot, the text stands about 15:1 against the capsule, and its size is the system's, so those
        // two readings on buttons inside the bar are not counted; re-check if the bar's style changes. Everything the
        // app draws is counted.
        // Every navigation bar on screen: a sheet's bar over the one below it.
        let barFrames = app.navigationBars.allElementsBoundByIndex.map(\.frame)
        // Today's page scrolls under its pinned bottom bar (Start and Ask): an element of the page under it is read
        // against the bar. The bar's own controls are still counted.
        let bottom = app.otherElements["today.bottomBar"]
        let bottomFrame = bottom.exists ? bottom.frame : .null
        let bottomOwn = ["today.start", "ask.field", "ask.send"]
        try app.performAccessibilityAudit { issue in
            guard let element = issue.element else { return false }
            let inBar = element.elementType == .button && barFrames.contains { $0.contains(element.frame) }
            if [.contrast, .dynamicType].contains(issue.auditType), inBar { return true }
            let underBottom = element.frame.intersects(bottomFrame) && !bottomOwn.contains(element.identifier)
            if issue.auditType == .contrast, underBottom { return true }
            if issue.auditType == .dynamicType, !checksTextSize { return true }
            // Said in the log so a failure names the element, not only the kind of problem; still a failure.
            print("Accessibility audit: \(issue.compactDescription) on \(element.debugDescription)")
            return false
        }
    }

    /// Swipes Today (or any page) up until `element` is on screen and can be tapped, for rows below the fold.
    @discardableResult
    static func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<maxScrolls {
            if element.waitForExistence(timeout: shortWait), element.isHittable { return true }
            app.swipeUp()
        }
        return element.waitForExistence(timeout: wait)
    }

    /// How many swipes a test may take to bring an element below the fold on screen.
    static let maxScrolls = 4
    /// A short look for an element already on screen, between swipes.
    static let shortWait: TimeInterval = 1
}
