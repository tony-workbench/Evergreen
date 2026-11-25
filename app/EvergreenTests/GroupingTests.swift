import Foundation
import Testing
@testable import Evergreen

/// Repeats are said once: like sessions and like memories become one item
/// with its days, and a chip never repeats its sentence.
@MainActor
struct GroupingTests {
    static var calendar: Calendar { BasisTests.calendar }

    /// A session on November `day` 2026 (the 23rd is a Monday).
    static func session(_ id: String, _ type: String, day: Int, hour: Int, minutes: Int = 40, reason: String, basedOn: [String] = []) -> WeekPlan.Session {
        let start = BasisTests.at(day, hour)
        return WeekPlan.Session(id: id, kind: "addWorkout", title: type, after: Slot(start: start, end: start.addingTimeInterval(Double(minutes) * 60), activityType: type),
                                reason: reason, basedOn: basedOn)
    }

    static let week: [WeekPlan.Session] = [
        session("tue", "Running", day: 24, hour: 7, reason: "Your usual Tuesday 7 AM run."),
        session("yoga", "Yoga", day: 26, hour: 12, minutes: 27, reason: "Kept short so this week stays close to your normal."),
        session("mon", "Running", day: 23, hour: 7, reason: "Your usual Monday 7 AM run."),
        session("wed", "Running", day: 25, hour: 7, reason: "Your usual Wednesday 7 AM run."),
        session("long", "Running", day: 29, hour: 7, minutes: 90, reason: "Your usual Sunday 7 AM run. It is your longest run of the week."),
        session("fri-late", "Running", day: 27, hour: 18, reason: "Your usual Friday 6 PM run."),
    ]

    @Test func likeSessionsOnDifferentDaysAreOneItemWithItsDays() {
        let groups = SuggestionGroup.groups(Self.week, calendar: Self.calendar)
        // Three weekday 7 AM runs are one item; the yoga, the evening run and the long run really differ.
        #expect(groups.map { $0.sessions.map(\.id) } == [["mon", "tue", "wed"], ["yoga"], ["fri-late"], ["long"]])
        #expect(groups[0].weekdays(Self.calendar) == [0, 1, 2])
        #expect(groups[0].sentence(Self.calendar) == "Your usual 7 AM run, 40 minutes.")
        #expect(groups[1].sentence(Self.calendar) == "Yoga, Thursday at noon. 27 minutes. Kept short so this week stays close to your normal.")
        #expect(groups[2].sentence(Self.calendar) == "Run, Friday at 6 PM. 40 minutes, as usual.")
        #expect(groups[3].sentence(Self.calendar) == "Long run, Sunday at 7. 90 minutes, as usual. It is your longest run of the week.")
    }

    @Test func noTwoItemsNextToEachOtherDifferOnlyByTheirWeekday() {
        // Whatever the week, once grouped no neighbouring lines read the same apart from the day.
        let weeks = [Self.week, Array(Self.week.prefix(1)), [],
                     (23...29).map { Self.session("d\($0)", "Running", day: $0, hour: 7, reason: "Your usual \(DayDots.names[($0 - 23) % 7]) 7 AM run.") }]
        for sessions in weeks {
            let lines = SuggestionGroup.groups(sessions, calendar: Self.calendar).map { SuggestionGroup.withoutWeekday($0.sentence(Self.calendar)) }
            for (line, next) in zip(lines, lines.dropFirst()) { #expect(line != next, "\(line)") }
            #expect(Set(lines).count == lines.count)
        }
        // A whole week of the same run is one line.
        #expect(SuggestionGroup.groups(weeks[3], calendar: Self.calendar).count == 1)
    }

    @Test func theStatementIsASentenceAndTheReasonIsNotSaidTwice() {
        let monday = Self.week[2]
        #expect(SuggestionWords.statement(monday, calendar: Self.calendar) == "Run, Monday at 7.")
        #expect(SuggestionWords.detail(monday) == "40 minutes, as usual.")
        #expect(SuggestionWords.at(BasisTests.at(23, 7, 30), Self.calendar) == "at 7:30" && SuggestionWords.at(BasisTests.at(23, 18), Self.calendar) == "at 6 PM")
        for text in [SuggestionWords.statement(monday, calendar: Self.calendar), SuggestionWords.detail(monday)] + SuggestionGroup.groups(Self.week, calendar: Self.calendar).map({ $0.sentence(Self.calendar) }) {
            #expect(!text.contains("·"), "\(text)")
        }
    }

    @Test func aChipStaysOnlyWhenItAddsWhatTheSentenceDoesNotSay() {
        let usual = Basis(id: "k1", source: .health, text: "You usually run Monday around 7 AM.", detail: "", key: "k1", isUsualTime: true)
        let load = Basis(id: "k3", source: .health, text: "This week’s training is 14% above your usual.", detail: "", key: "k3")
        let gap = Basis(id: "free", source: .calendar, text: "Between your 9 AM and 1 PM meetings", detail: "", key: nil)
        // "As usual" is already said, so the usual-time chip goes; the number and the calendar gap stay.
        #expect(Basis.chips([usual, load, gap], for: Self.week[2]).map(\.id) == ["k3", "free"])
        // A session whose sentence doesn't say it keeps the chip.
        #expect(Basis.chips([usual, load], for: Self.week[1]).map(\.id) == ["k1", "k3"])
    }

    @Test func usualTimesOnDifferentDaysAreOnePatternAndBodyNumbersAreFigures() {
        func slot(_ key: String, _ activity: String, _ weekday: Int, _ hour: Int) -> MemoryRow {
            PlanFakes.row(key, statement: "x", data: ["activity": .string(activity), "weekday": .number(Double(weekday)), "hour": .number(Double(hour)), "minutes": 40, "weeksSeen": 4, "weeksTotal": 4])
        }
        var stopped = slot("r-sat", "run", 5, 7)
        stopped.state = "rejected"
        let rows = [slot("r-mon", "run", 0, 7), slot("r-wed", "run", 2, 7), slot("r-sun", "long_run", 6, 7), slot("y-thu", "yoga", 3, 18), stopped,
                    PlanFakes.row("sleep", kind: "sleep", statement: "x", data: ["hours7d": 8.6, "hours28d": 7.2]),
                    PlanFakes.row("hr", kind: "resting_hr", statement: "x", data: ["bpm7d": 49, "bpm28d": 51]),
                    PlanFakes.load,
                    PlanFakes.row("mix", kind: "mix", statement: "Workouts by activity: running 20, yoga 2.", data: ["byActivity": ["run": 20]])]
        let split = MemoryPattern.split(rows)
        // The morning runs (a long run is a run) are one line with three days; the stopped Saturday isn't among them.
        #expect(split.patterns.map(\.sentence) == ["You usually run at 7 AM.", "You usually do yoga at 6 PM."])
        #expect(split.patterns[0].days.mapValues(\.key) == [0: "r-mon", 2: "r-wed", 6: "r-sun"])
        #expect(split.others.map(\.key) == ["sleep", "hr", "k3", "mix"])

        let figures = BodyFigure.figures(rows)
        #expect(figures.map(\.title) == ["Sleep", "Resting heart", "Training"])
        #expect(figures.map(\.value) == ["8.6 h", "49 bpm", "+14%"] && figures.map(\.usual) == ["usual 7.2 h", "usual 51", "against your usual"])
        // A row whose numbers can't be read gives no figure.
        #expect(BodyFigure.figures([PlanFakes.row("sleep", kind: "sleep", statement: "x", data: [:])]).isEmpty)
    }

    @Test func thePictureHasSevenDaysWithAddedAndSuggestedBlocksInTimeOrder() {
        let now = BasisTests.at(23, 6)
        let added = PlanItem(id: "p1", slot: Slot(start: BasisTests.at(23, 18), end: BasisTests.at(23, 19), activityType: "Yoga"))
        let days = WeekPicture.days(plan: [added], suggestions: Self.week, state: { _ in .added }, now: now, calendar: Self.calendar)
        #expect(days.count == 7)
        #expect(days[0].map(\.id) == ["mon", "p1"] && days[0].map(\.kind) == [.suggested, .added])
        #expect(days[0].map(\.time) == ["7", "6 PM"] && days[0].map(\.title) == ["Run", "Yoga"])
        #expect(days[5].isEmpty && days[6].map(\.id) == ["long"])
    }

    @Test func longestIsSaidOnlyWhenItIsStrictlyTheLongest() {
        let reason = "Your usual Sunday 7 AM run. It is your longest run of the week."
        // 40 minutes among 40-minute runs is not the longest; 90 among 40s is.
        #expect(Superlatives.checked(reason, minutes: 40, others: [40, 40, 40]) == "Your usual Sunday 7 AM run.")
        #expect(Superlatives.checked(reason, minutes: 90, others: [40, 40]) == reason)
        #expect(Superlatives.checked(reason, minutes: 40, others: []) == "Your usual Sunday 7 AM run.")
        #expect(Superlatives.checked("The shortest and easiest day.", minutes: 20, others: [20, 45]) == "")
        #expect(Superlatives.checked("Your easiest day.", minutes: 20, others: [30, 45]) == "Your easiest day.")
        #expect(Superlatives.checked("Kept short so this week stays close to your normal.", minutes: 27, others: [27]) == "Kept short so this week stays close to your normal.")

        // The week the app shows has the claim taken out where it isn't true.
        func session(_ day: String, _ minutes: Int, _ reason: String) -> PlanSession { PlanFakes.session(day, "07:00", .run, minutes, reason: reason) }
        let flat = WeekPlan(PlanAgent.Week(sessions: [session("2026-11-23", 40, "Your usual Monday 7 AM run."), session("2026-11-29", 40, reason)], source: .rules))
        #expect(flat.sessions.map(\.reason) == ["Your usual Monday 7 AM run.", "Your usual Sunday 7 AM run."])
        let real = WeekPlan(PlanAgent.Week(sessions: [session("2026-11-23", 40, "Your usual Monday 7 AM run."), session("2026-11-29", 90, reason)], source: .rules))
        #expect(real.sessions.last?.reason == reason)
    }

    @Test func theTimeMostBlocksShareIsSaidOnce() {
        func block(_ id: String, _ time: String) -> WeekPicture.Block { .init(id: id, kind: .suggested, title: "Run", time: time, start: Date()) }
        #expect(WeekPicture.commonTime([[block("a", "7")], [block("b", "7"), block("c", "6 PM")], []]) == "7")
        #expect(WeekPicture.commonTime([[block("a", "7")], [block("c", "6 PM")]]) == nil)
        #expect(PlainTime.withHalf("7") == "7 AM" && PlainTime.withHalf("6 PM") == "6 PM" && PlainTime.withHalf("noon") == "noon")
    }
}
