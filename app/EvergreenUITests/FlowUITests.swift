import XCTest

/// The flows a review asked to see on a simulator: the first-setup permissions, coming in from a reminder, the week
/// table going offline and back, and "What I noticed" with Reduce Motion. Each uses a debug launch argument
/// (Views/Debug/UITestArguments.swift), so no system prompt, real network or system setting is needed.
final class FlowUITests: XCTestCase {
    /// How long the phone counts as offline after the week table first asks (`-uiOfflineFor`).
    private static let offlineSeconds = 20

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: Permissions

    /// Every row is there and its Allow answers; "I’m ready" closes the page. `-uiFakePermissions` answers yes with no
    /// system prompt; the monitor answers one anyway, should a real prompt come up on the next tap.
    @MainActor
    func testEveryPermissionRowCanBeAllowed() throws {
        answerSystemPrompts()
        let app = UITestApp.launch(extra: ["-uiScreen", "permissions", "-uiFakePermissions"])
        let any = app.descendants(matching: .any)
        for permission in ["calendar", "health", "notifications", "screenTime"] {
            XCTAssertTrue(any["permissions.row.\(permission)"].waitForExistence(timeout: UITestApp.wait), "\(permission) has a row")
            let allow = app.buttons["permissions.allow.\(permission)"]
            XCTAssertTrue(allow.waitForExistence(timeout: UITestApp.wait) && allow.isHittable, "\(permission) can be allowed")
            allow.tap()
            XCTAssertTrue(any["permissions.allowed.\(permission)"].waitForExistence(timeout: UITestApp.wait),
                          "\(permission) says Allowed once answered")
        }
        let ready = app.buttons["permissions.ready"]
        XCTAssertTrue(ready.isHittable)
        ready.tap()
        XCTAssertTrue(ready.waitForNonExistence(timeout: UITestApp.wait), "I’m ready closes the page")
    }

    /// Says yes to a real system permission prompt, should one come up.
    @MainActor
    private func answerSystemPrompts() {
        addUIInterruptionMonitor(withDescription: "A system permission prompt") { alert in
            for answer in ["Allow", "Allow Full Access", "Continue", "OK"] where alert.buttons[answer].exists {
                alert.buttons[answer].tap()
                return true
            }
            return false
        }
    }

    // MARK: From a reminder

    /// "Start" on today's reminder opens the workout page.
    @MainActor
    func testTodaysReminderOpensTheWorkoutPage() throws {
        let app = UITestApp.launch(extra: ["-uiTestRoute", "session"])
        XCTAssertTrue(app.buttons["workout.close"].waitForExistence(timeout: UITestApp.wait * 2), "The workout page opens")
    }

    /// A reminder for another day opens the week table on that day.
    @MainActor
    func testAnotherDaysReminderOpensTheWeekOnThatDay() throws {
        let day = try UITestApp.anotherDayThisWeek(UITestApp.launch())
        let app = UITestApp.launch(extra: ["-uiTestRoute", "week:\(day)"])
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["week.preview.\(day)"].waitForExistence(timeout: UITestApp.wait * 2), "\(day) opens on its own")
        app.buttons["week.preview.done"].tap()
        XCTAssertTrue(any["week.table"].waitForExistence(timeout: UITestApp.wait), "The week table is under it")
    }

    // MARK: Offline, then online

    /// Offline, the week table says so; back online, the line goes and the week is worked out again.
    @MainActor
    func testTheWeekSaysOfflineThenReloadsOnline() throws {
        let app = UITestApp.launch(extra: ["-uiOfflineFor", "\(Self.offlineSeconds)"])
        let thisWeek = app.buttons["today.thisWeek"]
        XCTAssertTrue(thisWeek.waitForExistence(timeout: UITestApp.wait))
        thisWeek.tap()
        let any = app.descendants(matching: .any)
        let offline = any["offline.line"]
        XCTAssertTrue(offline.waitForExistence(timeout: UITestApp.wait), "Offline is said")
        XCTAssertTrue(offline.waitForNonExistence(timeout: TimeInterval(Self.offlineSeconds) + UITestApp.wait * 2),
                      "Back online, the offline line goes")
        XCTAssertTrue(any["week.table"].waitForExistence(timeout: UITestApp.wait), "The week is worked out again")
        let day = any.matching(NSPredicate(format: "identifier == %@ OR identifier BEGINSWITH %@", "week.today", "week.day.")).firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: UITestApp.wait), "with its days")
    }

    // MARK: Reduce Motion

    /// With Reduce Motion (`-reduceMotion`, the same switch as the system setting), the lines appear as soon as they are
    /// read, with no fade, and "See my week" can be tapped at once. XCUITest waits for animations to settle, so the short
    /// wait here is the check; the switch itself is unit-tested (ViewLogicTests).
    @MainActor
    func testNoticedLinesAppearAtOnceWithReduceMotion() throws {
        let app = UITestApp.launch(seed: "runner", extra: ["-uiScreen", "noticed", "-reduceMotion"])
        let any = app.descendants(matching: .any)
        let reading = any["noticed.reading"]
        let weeks = any["noticed.weeks"]
        XCTAssertTrue(reading.waitForExistence(timeout: UITestApp.wait) || weeks.exists, "What I noticed opens")
        XCTAssertTrue(reading.waitForNonExistence(timeout: UITestApp.wait), "The weeks are read")
        XCTAssertTrue(weeks.waitForExistence(timeout: 1), "The weeks show at once")
        XCTAssertTrue(any["noticed.line.0"].waitForExistence(timeout: 1), "and the lines with them")
        let seeMyWeek = app.buttons["noticed.seeMyWeek"]
        XCTAssertTrue(seeMyWeek.isEnabled && seeMyWeek.isHittable)
        seeMyWeek.tap()
        XCTAssertTrue(seeMyWeek.waitForNonExistence(timeout: UITestApp.wait))
    }
}
