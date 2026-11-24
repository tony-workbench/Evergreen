import XCTest

/// The key paths end to end (plugin mobile-testing: critical journeys): Today → Start → every set → Finish; skipping
/// today and taking it back; picking a time in the week table; My rules saying what is wrong. Needs a simulator.
final class KeyPathUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testStartDoEverySetAndFinish() throws {
        let app = UITestApp.launch()
        try UITestApp.startButton(app).tap()
        XCTAssertTrue(app.staticTexts["workout.movementName"].waitForExistence(timeout: UITestApp.wait)
                      || app.buttons["workout.yesICan"].waitForExistence(timeout: UITestApp.wait))
        let finish = UITestApp.doEverySet(app)
        XCTAssertTrue(finish.waitForExistence(timeout: UITestApp.wait), "Every set done should end on the finish page")
        finish.tap()
        XCTAssertTrue(app.staticTexts["today.done"].waitForExistence(timeout: UITestApp.wait), "Today should say the workout is done")
        XCTAssertFalse(app.buttons["today.start"].exists, "Start goes once the workout is done")
    }

    @MainActor
    func testTooHardSaysWhatItDid() throws {
        let app = UITestApp.launch()
        try UITestApp.startButton(app).tap()
        if app.buttons["workout.yesICan"].waitForExistence(timeout: UITestApp.wait) { app.buttons["workout.yesICan"].tap() }
        let tooHard = app.buttons["workout.tooHard"]
        XCTAssertTrue(tooHard.waitForExistence(timeout: UITestApp.wait))
        tooHard.tap()
        XCTAssertTrue(app.staticTexts["workout.note"].waitForExistence(timeout: UITestApp.wait), "Too hard says what it changed")
    }

    @MainActor
    func testSkipTodayAndTakeItBack() throws {
        let app = UITestApp.launch()
        _ = try UITestApp.startButton(app)
        app.buttons["today.notNow"].tap()
        let notToday = app.buttons["Not today"]
        XCTAssertTrue(notToday.waitForExistence(timeout: UITestApp.wait))
        notToday.tap()
        let back = app.buttons["today.unskip"]
        XCTAssertTrue(back.waitForExistence(timeout: UITestApp.wait), "A skipped day offers to train after all")
        XCTAssertFalse(app.buttons["today.start"].exists, "A skipped day has nothing to start")
        back.tap()
        XCTAssertTrue(app.buttons["today.start"].waitForExistence(timeout: UITestApp.wait), "Taking the skip back brings Start back")
    }

    @MainActor
    func testPickATimeInTheWeekTable() throws {
        let app = UITestApp.launch()
        let week = app.buttons["today.thisWeek"]
        XCTAssertTrue(week.waitForExistence(timeout: UITestApp.wait))
        week.tap()
        XCTAssertTrue(app.collectionViews["week.table"].waitForExistence(timeout: UITestApp.wait))
        let picker = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'week.pick.'")).firstMatch
        guard picker.waitForExistence(timeout: UITestApp.wait) else {
            throw XCTSkip("No day this week has more than one time to pick from at this hour.")
        }
        picker.tap()
        let only = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Only at'")).firstMatch
        XCTAssertTrue(only.waitForExistence(timeout: UITestApp.wait))
        let label = only.label
        only.tap()
        XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: UITestApp.wait), "The day shows only the time picked")
    }

    @MainActor
    func testMyRulesSaysWhatIsWrongAtOnce() throws {
        let app = UITestApp.launch()
        UITestApp.openMyRules(app)
        let latest = app.datePickers["rules.latestStart"]
        XCTAssertTrue(latest.waitForExistence(timeout: UITestApp.wait))
        latest.tap()
        // The seed's hours start at 12:00; a latest start of 09:00 crosses them.
        let hour = app.pickerWheels.element(boundBy: 0)
        XCTAssertTrue(hour.waitForExistence(timeout: UITestApp.wait))
        hour.adjust(toPickerWheelValue: "09")
        // Closes the time picker by tapping above it.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        let problem = app.staticTexts.matching(identifier: "rules.problem").firstMatch
        XCTAssertTrue(problem.waitForExistence(timeout: UITestApp.wait), "The crossed hours are said beside them")
        XCTAssertFalse(app.buttons["rules.done"].isEnabled, "Done waits until the rules make sense")
    }
}
