import FamilyControls
import Foundation
import os

/// What the screens decide, kept out of the views so it can be tested: changing an answer in My rules (the rest-day
/// chips, the time pickers, the steppers' ranges, the problems shown under a section, importing a profile, the movements
/// by what they work) or "How you train", finishing or skipping "How you train", the first-setup permission rows, saying
/// the fresh start once, what "What I remember" shows, Today's other suggestions and older "Not now" lines, the
/// suggestion card's chips, when the week table works the week out again and how it names a past day, and the few
/// counts and lists the Settings screens show.

// MARK: Rules answers

/// One of the session lengths "How you train" offers.
struct SessionLength: Equatable, Sendable {
    let min: Int
    let max: Int

    /// "20–25 min".
    var words: String { "\(min)–\(max) min" }
}

extension UserRules {
    /// The lengths "How you train" offers, shortest first.
    static let lengthChoices = [SessionLength(min: 15, max: 20), SessionLength(min: 20, max: 25), SessionLength(min: 30, max: 40)]
    /// The usual one (20–25 minutes), shown for lengths set somewhere else.
    static let usualLengthChoice = 1

    /// Which of `lengthChoices` the rules hold; setting one sets both ends of the session.
    var lengthChoice: Int {
        get { Self.lengthChoices.firstIndex { $0.min == sessionMin && $0.max == sessionMax } ?? Self.usualLengthChoice }
        set {
            guard Self.lengthChoices.indices.contains(newValue) else { return }
            sessionMin = Self.lengthChoices[newValue].min
            sessionMax = Self.lengthChoices[newValue].max
        }
    }

    /// Turns one thing to train with on or off, keeping the list in the order the screens show it.
    mutating func setEquipment(_ thing: Equipment, on: Bool) {
        equipment = Equipment.allCases.filter { $0 == thing ? on : equipment.contains($0) }
    }

    /// Leaves a movement out for good, or takes it back. Each movement is listed once.
    mutating func setLeftOut(_ id: String, _ leftOut: Bool) {
        avoid.removeAll { $0 == id }
        if leftOut { avoid.append(id) }
    }

    /// A rest-weekday chip tapped: the day goes if it was there and comes in if it wasn't, keeping Monday first.
    static func toggling(_ day: Int, in days: [Int]) -> [Int] {
        days.contains(day) ? days.filter { $0 != day } : (days + [day]).sorted()
    }

    /// What a time picker shows for a time that can't be read: noon.
    static let unreadableClockMinutes = 12 * ClockUnits.minutesPerHour

    /// An "HH:MM" answer as that time on `day`, for a time picker; noon when it can't be read.
    static func date(ofClock clock: String, on day: Date, calendar: Calendar) -> Date {
        let total = Self.minutes(clock) ?? Self.unreadableClockMinutes
        let hour = total / ClockUnits.minutesPerHour, minute = total % ClockUnits.minutesPerHour
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
    }

    /// A time picked as the "HH:MM" answer the rules keep.
    static func clock(of date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// What the "Shortest" stepper allows: from the shortest session the rules take up to the longest answer.
    var shortestRange: ClosedRange<Int> { Self.shortestSession...max(Self.shortestSession, sessionMax) }

    /// What the "Longest" stepper allows: from the shortest answer up to the longest session the rules take.
    var longestRange: ClosedRange<Int> { min(sessionMin, Self.longestSession)...Self.longestSession }

    /// Whether the person trains with this thing.
    func has(_ thing: Equipment) -> Bool { equipment.contains(thing) }

    /// Whether a movement is left out for good.
    func isLeftOut(_ id: String) -> Bool { avoid.contains(id) }

    /// The problems with the answers that a section shows under itself, in the rules' own order.
    func shownProblems(_ kinds: [Problem]) -> [Problem] {
        problems.filter { kinds.contains($0) }
    }

    /// My rules › Movements: how many are left out and how many can't be done yet, or "All open".
    var movementsSummary: String {
        let cannot = movements.values.filter { $0 == .cannot }.count
        let said = [avoid.isEmpty ? nil : "\(avoid.count) left out", cannot == 0 ? nil : "\(cannot) can’t do yet"].compactMap { $0 }
        return said.isEmpty ? "All open" : said.joined(separator: " · ")
    }
}

extension AppModel {
    /// "Continue" on "How you train": at home, the answers become the rules and turn them on; "somewhere else" leaves
    /// them as they were (off), so the week keeps being built from the days the person already trains.
    func answerHowYouTrain(_ rules: UserRules, atHome: Bool) {
        guard atHome else { return }
        var answered = rules
        answered.isOn = true
        keepRules(answered)
    }

    /// "Skip" on "How you train": the usual rules, on, which Settings › My rules can change.
    func skipHowYouTrain() {
        var usual = UserRules()
        usual.isOn = true
        keepRules(usual)
    }

    /// Keeps the rules without planning again: during the first setup the week is planned once setup is done.
    private func keepRules(_ rules: UserRules) {
        userRules = rules
        rules.save(to: settings)
    }

    /// My rules › Movements: the movements of the library that work one pattern ("lower_push", "core" …), in library order.
    func movements(working pattern: String) -> [Movement] {
        movements.filter { $0.pattern == pattern }
    }

    /// "Import a profile…": the file picked, read and taken into `rules`; nil when nothing was picked.
    func importProfile(from picked: Result<URL, Error>, onto rules: UserRules) -> ProfileImport? {
        guard case .success(let url) = picked else { return nil }
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return .problem(ProfileImport.unreadable) }
        return importProfile(data, onto: rules)
    }

    /// A profile's answers taken into `rules`. Every movement it names has to be in the library, which is read when
    /// My rules opens.
    func importProfile(_ data: Data, onto rules: UserRules) -> ProfileImport {
        do {
            return .imported(try rules.importing(data, library: Set(movements.map(\.id))))
        } catch UserRules.ImportError.outOfRange {
            return .problem(ProfileImport.outOfRange)
        } catch {
            return .problem(ProfileImport.unreadable)
        }
    }
}

/// How "Import a profile…" ended: the rules with the profile's answers in them, or what to say, with nothing changed.
enum ProfileImport: Equatable, Sendable {
    case imported(UserRules)
    case problem(String)

    static let outOfRange = "That profile has a value I can’t use, so nothing was changed."
    static let unreadable = "That file couldn’t be read as a profile, so nothing was changed."
}

extension AppModel {
    // MARK: Fresh start

    /// Set once the person has read that the saved plan couldn't be read and a fresh one began.
    static let freshStartSaidKey = "fresh_start_said"

    /// "OK" on that line: it goes, and isn't said again.
    func dismissFreshStartNotice() {
        startedFreshNotice = false
        settings.set(true, forKey: Self.freshStartSaidKey)
    }
}

// MARK: The week table

/// The last five characters of a YYYY-MM-DD day ("MM-DD"), how the week table names a date.
private let monthAndDayLength = 5

extension HomeWeek.Day {
    /// "Tuesday 12-01", the way the week table names a day that isn't today.
    var title: String { "\(weekday) \(day.suffix(monthAndDayLength))" }
}

extension AppModel.EarlierDay {
    /// "Monday 11-30", the way the week table's rows name a day; the day itself when it can't be read.
    var title: String { Self.title(day) }

    static func title(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        // The app's words are English, so the weekday is too, whatever the phone's language.
        calendar.locale = Locale(identifier: "en_US_POSIX")
        guard parts.count == ClockUnits.dayKeyParts, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else {
            return iso
        }
        return calendar.weekdaySymbols[calendar.component(.weekday, from: date) - 1] + " " + String(iso.suffix(monthAndDayLength))
    }
}

// MARK: First-setup permissions

/// The permissions the first setup asks for, in the order the page shows them.
enum SetupPermission: String, CaseIterable, Sendable {
    case calendar, health, notifications, screenTime
}

/// Where one permission stands on the first-setup page.
enum PermissionState: Equatable, Sendable {
    /// Not asked yet: "Allow".
    case ask
    /// Asked, with no way to tell the answer (Apple Health never says): shown as allowed.
    case asked
    case on
    case off

    init(on: Bool, asked: Bool) {
        self = on ? .on : asked ? .off : .ask
    }
}

extension AppModel {
    /// Where a permission stands. `asked` holds the rows the person has tapped on this page, for the ones the system
    /// can't be asked about (Apple Health) or doesn't report at once.
    func permissionState(_ permission: SetupPermission, asked: Set<SetupPermission>) -> PermissionState {
        if Self.fakesPermissionAnswers { return asked.contains(permission) ? .on : .ask }
        switch permission {
        case .calendar:
            return PermissionState(on: calendarAccess == .on, asked: calendarAccess != .notAsked)
        case .health:
            return asked.contains(.health) ? .asked : .ask
        case .notifications:
            return PermissionState(on: notificationAccess == .on, asked: notificationAccess != .notAsked)
        case .screenTime:
            let status = AuthorizationCenter.shared.authorizationStatus
            return PermissionState(on: status == .approved, asked: status == .denied)
        }
    }

    /// Shows the system's prompt for a permission. Screen Time is the same authorization "Earned screen time" asks for;
    /// nothing is locked until that is turned on. A "no" never blocks the app.
    func askPermission(_ permission: SetupPermission) async {
        if Self.fakesPermissionAnswers { return }
        switch permission {
        case .calendar: await requestCalendarAccess()
        case .health: await Permissions.requestHealth()
        case .notifications: await requestNotificationAccess()
        case .screenTime:
            do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) } catch {
                Logger.model.failed("Screen Time couldn't be asked for", error)
            }
        }
    }

    /// Debug UI tests only (`-uiFakePermissions`): every "Allow" answers yes at once, with no system prompt.
    static var fakesPermissionAnswers: Bool {
        #if DEBUG
        return UITestArguments.fakesPermissions()
        #else
        return false
        #endif
    }
}

// MARK: What I remember

/// One sentence on "What I remember", with the row behind it when it can be stopped.
struct MemorySentence: Equatable, Identifiable, Sendable {
    var key: String?
    var text: String

    /// The row's key, or the words for a line that can't be stopped.
    var id: String { key ?? text }
}

/// What one group of "What I remember" shows: patterns with their days, the body's figures, and the other sentences.
struct MemoryGroupShown {
    var patterns: [MemoryPattern]
    var figures: [BodyFigure]
    var sentences: [MemorySentence]

    var isEmpty: Bool { patterns.isEmpty && figures.isEmpty && sentences.isEmpty }
}

extension AppModel {
    /// Sleep, resting heart rate and load are the body's, whatever group their row carries.
    static let memoryBodyKinds = ["sleep", "resting_hr", "load"]

    /// What a group shows from the usable rows. A row shown as a body figure isn't said again as a sentence; before
    /// there is a table at all, the brief's own lines stand in.
    func memoryShown(_ group: MemoryBrief.Group) -> MemoryGroupShown {
        let usable = memoryRows.filter(\.isUsable)
        let rows = usable.filter { (Self.memoryBodyKinds.contains($0.kind) || $0.group == "body") == (group == .body) }
        let split = MemoryPattern.split(rows)
        let figures = group == .body ? BodyFigure.figures(rows) : []
        let sentences: [MemorySentence] = usable.isEmpty
            ? memoryBrief.lines(group).map { MemorySentence(key: $0.key, text: $0.id == "thin" ? thinMemoryWords : $0.sentence) }
            : split.others.filter { row in !figures.contains { $0.key == row.key } }.map { MemorySentence(key: $0.key, text: RowWords.sentence($0)) }
        return MemoryGroupShown(patterns: split.patterns, figures: figures, sentences: sentences)
    }

    /// The thin-history line, with the same count of days as Today gives.
    var thinMemoryWords: String {
        let days = historyDepth.days
        return "I have \(days) \(days == 1 ? "day" : "days") of your workouts so far. Two weeks in, this fills up."
    }

    /// What an empty group says.
    func memoryEmptyWords(_ group: MemoryBrief.Group) -> String {
        if memoryState.everythingForgotten { return "I’m not remembering this." }
        return group == .routine
            ? "Nothing here. I learn this from your workouts."
            : "Nothing here. I need a few nights of sleep and resting heart rate."
    }
}

// MARK: Today

extension AppModel {
    /// Today's suggestion lines beyond the one said at the top (`except`) and those already past. When every open
    /// suggestion is the same thing on different days, the picture and "Add all" already say it, so there are none.
    func otherSuggestionGroups(except: WeekPlan.Session?) -> [SuggestionGroup] {
        let open = openSuggestions.filter { $0.id != except?.id && ($0.after?.start ?? .distantPast) > now }
        let kinds = SuggestionGroup.groups(openSuggestions, calendar: calendar).count
        return kinds > 1 ? SuggestionGroup.groups(open, calendar: calendar) : []
    }

    /// The older "Not now" lines whose session is still in the week, one for each answer, by key; the last one has its
    /// own line on Today.
    var olderStopNotes: [StopNote] {
        let notes = (weekPlan?.sessions ?? []).compactMap { stopNote(for: $0) }.filter { $0.answerKey != lastDecline?.answerKey }
        return Set(notes.map(\.answerKey)).sorted().compactMap { key in
            notes.first { $0.answerKey == key }.map { StopNote(text: $0.text, answerKey: $0.answerKey) }
        }
    }

    /// The suggestion card's chips: what the suggestion stands on, at most `Basis.mostOnCard` of them.
    func cardChips(for session: WeekPlan.Session) -> [Basis] {
        Array(Basis.chips(bases(for: session), for: session).prefix(Basis.mostOnCard))
    }

    /// "Add all" under the week's picture: with the AI connected, and more than one suggestion to add.
    var offersAddAll: Bool { aiConnected && openSuggestions.count > 1 }

    /// Whether a run is on the plan, which is when Today asks about running shoes.
    var hasRunOnPlan: Bool { plan.contains { $0.slot.activityType == "Running" } }
}

extension SuggestionGroup {
    /// Whether the group holds more than one session: it then shows its days and counts them on its buttons.
    var isSeveral: Bool { sessions.count > 1 }
    /// "Add 3", or "Add" for one.
    var addLabel: String { isSeveral ? "Add \(sessions.count)" : "Add" }
    /// "Not now, all 3", or "Not now" for one.
    var notNowLabel: String { isSeveral ? "Not now, all \(sessions.count)" : "Not now" }
    var addHint: String { "Adds \(sessions.count == 1 ? "it" : "them") to your plan and calendar" }
}

extension Basis {
    /// The suggestion card shows this many chips at most; the rest are under "Why".
    static let mostOnCard = 2
}

extension CalendarResult {
    /// The proposed blocks other than the one the card leads with.
    func otherProposals(than lead: PreviewBlock?) -> [PreviewBlock] {
        proposed.filter { $0.id != lead?.id }
    }
}

extension RainSnacks {
    /// "3 breaks of 10 minutes at 1:00 PM, 3:00 PM, 5:00 PM, to stand in for a walk. …", under the rain card's question.
    var offerDetail: String {
        "\(blocks.count) breaks of \(minutes) minutes at \(blocks.map { $0.start.clock }.joined(separator: ", ")), to stand in for a walk. Your strength session stays as it is."
    }
}

extension AppModel {
    /// When a short break of `minutes` that started at `start` ends.
    nonisolated static func breakEnd(from start: Date, minutes: Int) -> Date {
        start.addingTimeInterval(TimeInterval(minutes) * ClockUnits.minute)
    }
}

// MARK: The week table's network

extension AppModel {
    /// The week table says it is offline: the last load stood on the rules' content because the AI couldn't be
    /// reached, or the phone has no network.
    func weekIsOffline(online: Bool) -> Bool {
        homeWeekLoad == .offline || !online
    }

    /// Whether the week table works the week out again: the phone just came back online (not when the table opens,
    /// which loads it anyway) and the week isn't already being worked out.
    func reloadsWeek(wasOnline: Bool?, online: Bool) -> Bool {
        wasOnline == false && online && homeWeekLoad != .loading
    }
}

// MARK: Settings

extension AppModel {
    /// How often a step fell back to its rules because the AI couldn't do it, all steps together.
    var fallbackCount: Int { fallbacks.values.reduce(0, +) }

    /// The models to pick from: the account's own, and the one chosen now even when the account doesn't list it.
    func modelChoices(keeping chosen: String) -> [String] {
        Array(Set(aiModels + [chosen])).sorted()
    }

    /// Whether Evergreen may read where the phone is, asked of the injected location (not the device's directly).
    var locationAllowed: Bool {
        deviceLocation(Self.farAccuracyMetres).permission == .allowed
    }
}
