import XCTest

/// Accessibility (plugin mobile-testing §7): Xcode's audit on Today, the workout page, the week table and My rules, in
/// light and dark, and the key path again at the largest accessibility text size. Needs a simulator.
///
/// Reduce Motion can't be switched on from a UI test: check it by hand with Settings › Accessibility › Motion › Reduce
/// Motion on, then the onboarding lines ("What I noticed") and the cards on Today appear without moving.
final class AccessibilityUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testAuditTodayWorkoutWeekAndRules() throws {
        XCUIDevice.shared.appearance = .light
        try auditEveryScreen(UITestApp.launch(), checksTextSize: true)
    }

    @MainActor
    func testAuditInDark() throws {
        XCUIDevice.shared.appearance = .dark
        defer { XCUIDevice.shared.appearance = .light }
        try auditEveryScreen(UITestApp.launch(), checksTextSize: false)
    }

    @MainActor
    func testKeyPathAtTheLargestTextSize() throws {
        let app = UITestApp.launch(textSize: UITestApp.largestText)
        // The week table first, at the largest size.
        XCTAssertTrue(UITestApp.reveal(app.buttons["today.thisWeek"], in: app))
        app.buttons["today.thisWeek"].tap()
        XCTAssertTrue(app.collectionViews["week.table"].waitForExistence(timeout: UITestApp.wait))
        try UITestApp.audit(app)
        app.buttons["week.done"].tap()
        UITestApp.openMyRules(app)
        try UITestApp.audit(app)
        app.buttons["rules.cancel"].tap()
        app.buttons["settings.done"].tap()
        try UITestApp.startButton(app).tap()
        // At the largest sizes the page's smaller actions stand one under another and are still all there.
        if app.buttons["workout.yesICan"].waitForExistence(timeout: UITestApp.wait) { app.buttons["workout.yesICan"].tap() }
        for id in ["workout.tooHard", "workout.swap", "workout.skip", "workout.doneWithSet"] {
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: UITestApp.wait), "\(id) is there at the largest text size")
        }
        try UITestApp.audit(app)
        let finish = UITestApp.doEverySet(app)
        XCTAssertTrue(finish.waitForExistence(timeout: UITestApp.wait))
        try UITestApp.audit(app)
        finish.tap()
        // At the largest text size the done line sits below the fold of Today.
        XCTAssertTrue(UITestApp.reveal(app.staticTexts["today.done"], in: app))
    }

    @MainActor
    func testRestCountdownReadsTheSecondsLeft() throws {
        let app = UITestApp.launch()
        try UITestApp.startButton(app).tap()
        if app.buttons["workout.yesICan"].waitForExistence(timeout: UITestApp.wait) { app.buttons["workout.yesICan"].tap() }
        let done = app.buttons["workout.doneWithSet"]
        XCTAssertTrue(done.waitForExistence(timeout: UITestApp.wait))
        done.tap()
        let rest = app.staticTexts["workout.restLeft"]
        guard rest.waitForExistence(timeout: UITestApp.wait) else { throw XCTSkip("The first movement had one set: no rest.") }
        XCTAssertEqual(rest.label, "Rest left")
        XCTAssertTrue((rest.value as? String)?.contains("second") == true, "VoiceOver reads the seconds left as the value")
    }

    /// Today, then the week table, then My rules, then the workout page, each audited at the default text size. The light
    /// run checks text size too; the dark run checks what changes with the appearance (contrast), since text size doesn't.
    @MainActor
    private func auditEveryScreen(_ app: XCUIApplication, checksTextSize: Bool) throws {
        XCTAssertTrue(app.buttons["today.thisWeek"].waitForExistence(timeout: UITestApp.wait))
        try UITestApp.audit(app, checksTextSize: checksTextSize)
        app.buttons["today.thisWeek"].tap()
        XCTAssertTrue(app.collectionViews["week.table"].waitForExistence(timeout: UITestApp.wait))
        // The table's and the rules' text size is checked at the largest size (testKeyPathAtTheLargestTextSize): at the
        // default size the audit reads one-line rows and footers of a list as only partly scaling.
        try UITestApp.audit(app, checksTextSize: false)
        app.buttons["week.done"].tap()
        UITestApp.openMyRules(app)
        try UITestApp.audit(app, checksTextSize: false)
        app.buttons["rules.cancel"].tap()
        app.buttons["settings.done"].tap()
        try UITestApp.startButton(app).tap()
        XCTAssertTrue(app.buttons["workout.close"].waitForExistence(timeout: UITestApp.wait))
        try UITestApp.audit(app, checksTextSize: checksTextSize)
    }
}
