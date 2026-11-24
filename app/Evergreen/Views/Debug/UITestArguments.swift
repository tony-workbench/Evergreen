#if DEBUG
import Foundation

/// Debug builds only, and only on a seeded launch (`-uiTest <name>`, Background/UITestSeed.swift): the launch arguments
/// UI tests use to reach a state without the device's own answers. A normal launch takes none of them.
///
///   -uiFakePermissions             the first-setup "Allow" buttons answer yes at once, with no system prompt
///   -uiTestRoute session           opens today's workout page, as "Start" on a reminder does
///   -uiTestRoute week:YYYY-MM-DD   opens the week table on that day, as a reminder for another day does
///   -uiOfflineFor <seconds>        the phone counts as offline for that long after launch, then online
///   -reduceMotion                  screens move as with Reduce Motion on
@MainActor
enum UITestArguments {
    static let fakePermissionsFlag = "-uiFakePermissions"
    static let routeFlag = "-uiTestRoute"
    static let offlineForFlag = "-uiOfflineFor"
    static let reduceMotionFlag = "-reduceMotion"
    static let screenFlag = "-uiScreen"
    static let askFlag = "-uiAsk"
    static let noKeyFlag = "-uiNoKey"
    static let answersFlag = "-uiAnswers"
    /// The words a yes-or-no launch argument takes as yes, as UserDefaults reads them.
    private static let yesWords: Set<String> = ["YES", "yes", "true", "1"]
    /// What `-uiTestRoute` says before a day.
    static let weekPrefix = "week:"

    static func fakesPermissions(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        seeded(arguments) && arguments.contains(fakePermissionsFlag)
    }

    static func reducesMotion(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        seeded(arguments) && arguments.contains(reduceMotionFlag)
    }

    /// Whether this is a seeded launch (`-uiTest <name>`); a normal launch takes none of these arguments.
    static func isSeeded(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        seeded(arguments)
    }

    /// The screen `-uiScreen` opens without tapping (DebugLaunch.Screen names them).
    static func screen(in arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
        seeded(arguments) ? value(after: screenFlag, in: arguments) : nil
    }

    /// The sentence `-uiAsk` asks Evergreen.
    static func question(in arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
        seeded(arguments) ? value(after: askFlag, in: arguments) : nil
    }

    /// `-uiNoKey YES`: stay without an AI key, to see the connect card.
    static func staysWithoutKey(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        says(noKeyFlag, in: arguments)
    }

    /// `-uiAnswers YES`: add the top suggestion and say not now to the next.
    static func answersSuggestions(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        says(answersFlag, in: arguments)
    }

    /// Where `-uiTestRoute` asks the screens to go, as a reminder's tap would.
    static func route(in arguments: [String] = ProcessInfo.processInfo.arguments) -> WorkoutRoute? {
        guard seeded(arguments), let value = value(after: routeFlag, in: arguments) else { return nil }
        if value == "session" { return .session }
        guard value.hasPrefix(weekPrefix) else { return nil }
        let day = String(value.dropFirst(weekPrefix.count))
        return isDay(day) ? .week(day: day) : nil
    }

    /// How long the phone counts as offline after launch; nil keeps the real network status.
    static func offlineSeconds(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Double? {
        guard seeded(arguments), let value = value(after: offlineForFlag, in: arguments), let seconds = Double(value), seconds > 0 else {
            return nil
        }
        return seconds
    }

    private static func says(_ flag: String, in arguments: [String]) -> Bool {
        guard seeded(arguments), let value = value(after: flag, in: arguments) else { return false }
        return yesWords.contains(value)
    }

    private static func seeded(_ arguments: [String]) -> Bool {
        UITestSeed.name(in: arguments) != nil
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    /// "YYYY-MM-DD": four, two and two digits.
    private static let dayPartLengths = [4, 2, 2]

    private static func isDay(_ text: String) -> Bool {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        return parts.map(\.count) == dayPartLengths && parts.allSatisfy { $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }
    }
}
#endif
