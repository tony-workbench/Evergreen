import Foundation
import Testing
@testable import Evergreen

/// The bundle's brief on the phone: the names of its lines, the short lines
/// for the first screen, and the last 4 weeks as a grid of days.
struct MemoryBriefTests {
    static let full = MemoryBrief(lines: [
        .init(group: .routine, id: "workouts_per_week", key: "workouts_per_week", text: "Workouts: 6.5 a week (4-week average)."),
        .init(group: .routine, id: "usual_time", key: "slot:running:sun:06", text: "Running Sun 6 AM (3 of the last 4 weeks)."),
        .init(group: .routine, id: "usual_time", key: "slot:strength_training:mon:18", text: "Strength training Mon 6 PM (3 of the last 4 weeks)."),
        .init(group: .routine, id: "mix", key: "mix", text: "Mix over 4 weeks: Running 20, Strength training 4, Yoga 2."),
        .init(group: .routine, id: "recent_weeks", key: "recent_weeks", text: "Last 4 fully logged weeks: 6, 6, 7, 6 workouts."),
        .init(group: .body, id: "load", key: "load", text: "Load: 368 min in the last 7 days, 1.14× the 28-day weekly average."),
        .init(group: .body, id: "sleep", key: "sleep", text: "Average sleep: 8.7 h a night over 7 days (28-day average 8.5 h)."),
        .init(group: .body, id: "resting_hr", key: "resting_hr", text: "Resting heart rate: 49 bpm over 7 days (28-day average 48 bpm)."),
    ])

    @Test func eachLineIsSaidAsASentenceBuiltFromItsNumbers() {
        #expect(Self.full.lines.map(\.sentence) == [
            "You do about 6.5 workouts a week.",
            "You usually run Sunday around 6 AM.",
            "You usually do strength training Monday around 6 PM.",
            "In the last 4 weeks: 20 running, 4 strength training, 2 yoga.",
            "Your last 4 full weeks: 6, 6, 7, 6 workouts.",
            "This week's training is 14% above your usual.",
            "You sleep about 8.7 hours a night, close to your usual 8.5.",
            "Your resting heart rate is about 49, close to your usual 48.",
        ])
        // Nothing reads like a report.
        let shown = Self.full.lines.map(\.sentence).joined(separator: " ")
        for word in ["bpm", "28-day", "×", "Load:", "(", "min in"] { #expect(!shown.contains(word), "\(word)") }

        func line(_ id: String, _ text: String) -> String { MemoryBrief.Line(group: .body, id: id, key: id, text: text).sentence }
        #expect(line("load", "Load: 200 min in the last 7 days, 0.8× the 28-day weekly average.") == "This week's training is 20% below your usual.")
        #expect(line("load", "Load: 300 min in the last 7 days, 1.01× the 28-day weekly average.") == "This week's training is about your usual.")
        #expect(line("sleep", "Average sleep: 7 h a night over 7 days (28-day average 8.1 h).") == "You sleep about 7 hours a night, down from your usual 8.1.")
        #expect(line("resting_hr", "Resting heart rate: 55 bpm over 7 days (28-day average 50 bpm).") == "Your resting heart rate is about 55, up from your usual 50.")
        // A line it can't read is shown as it is sent.
        #expect(line("sleep", "Something new about sleep.") == "Something new about sleep.")
        #expect(line("thin", "9 days of data, fewer than 14.") == "I have 9 days of your workouts so far. Two weeks in, this fills up.")
    }

    @Test func linesAndStoppedEntriesHavePlainNames() {
        #expect(Self.full.lines.map(\.title) == ["Workouts per week", "Sunday 6 AM runs", "Monday 6 PM strength sessions", "Workouts by type",
                                                 "Recent weeks", "Training load", "Sleep", "Resting heart rate"])
        func line(_ text: String) -> MemoryBrief.Line { .init(group: .routine, id: "usual_time", key: "any key", text: text) }
        #expect(line("Yoga Wed 12 PM (4 of the last 4 weeks).").title == "Wednesday 12 PM yoga sessions")
        #expect(line("Running Sat 12 AM (2 of the last 4 weeks).").usualTime == UsualTime(line: "Running Sat 12 AM (")
            && line("Running Sat 12 AM (2 of the last 4 weeks).").usualTime?.hour == 0)
        #expect(Self.full.lines[5].usualTime == nil && Self.full.lines[1].usualTime?.weekday == 7)
        // What is stopped is named the same way, from its label.
        #expect(MemoryBrief.Stopped(key: "any key", label: "Running, Sunday 6 AM").title == "Sunday 6 AM runs")
        #expect(MemoryBrief.Stopped(key: "any key", label: "Strength training, Monday 6 PM").title == "Monday 6 PM strength sessions")
        #expect(MemoryBrief.Stopped(key: "sleep", label: "Sleep").title == "Sleep")
        #expect(MemoryBrief.Stopped(key: "mix", label: "Activity mix").title == "Workouts by type")
    }

    @Test func theBriefKnowsItsGroupsAndUsualDays() {
        #expect(Self.full.lines(.routine).count == 5)
        #expect(Self.full.lines(.body).map(\.key) == ["load", "sleep", "resting_hr"])
        #expect(Self.full.usualWeekdays == [1, 7])
        #expect(Self.full.thinDays == nil)
    }

    @Test func theFirstScreenGetsThreeShortLines() {
        let lines = Self.full.noticed
        #expect(lines == [
            "You usually run Sunday mornings.",
            "This week's training is 14% above your usual.",
            "You sleep about 8.7 hours a night.",
        ])
        #expect(lines.allSatisfy { $0.split(separator: " ").count <= 8 })
        // Without a usual time or sleep, it falls back to what there is.
        let some = MemoryBrief(lines: [Self.full.lines[0], .init(group: .body, id: "load", key: "load", text: "Load: 200 min in the last 7 days, 0.8× the 28-day weekly average.")])
        #expect(some.noticed == ["This week's training is 20% below your usual.", "You do about 6.5 workouts a week."])
    }

    /// The memory row for where the person trains, as the memory engine writes it (contract kind `training_place`).
    static let home = MemoryRow(memoryId: "mem_0009", key: "routine.training_place", slot: "routine.training_place", group: "routine",
                                kind: "training_place", statement: "You train at home, without gym equipment.",
                                data: ["place": "home", "gymWorkouts": 0, "weeks": 8], state: "saved", confidence: 0.5, since: "2026-11-17", updated: "2026-11-17")

    @Test func whereThePersonTrainsIsNoticedAndCanBeSaidNoTo() {
        let lines = Self.full.noticedLines(rows: [PlanFakes.load, Self.home])
        #expect(lines.map(\.text) == [
            "You usually run Sunday mornings.",
            "This week's training is 14% above your usual.",
            "You train at home, without gym equipment.",
        ])
        // Only that line carries a key, the one "Not true for me" rejects.
        #expect(lines.map(\.key) == [nil, nil, "routine.training_place"])
        #expect(lines.allSatisfy { $0.text.split(separator: " ").count <= 8 })
        // Without the row, or once it is rejected, the first screen is the brief's own lines, none of them answerable.
        var rejected = Self.home
        rejected.state = "rejected"
        #expect(Self.full.noticedLines(rows: [rejected]).map(\.text) == Self.full.noticed)
        #expect(Self.full.noticedLines(rows: []).allSatisfy { $0.key == nil })
        // With nothing else to say yet, it is said alone; a short history keeps its friendly version.
        #expect(MemoryBrief().noticedLines(rows: [Self.home]).map(\.text) == ["You train at home, without gym equipment."])
        let thin = MemoryBrief(lines: [.init(group: .routine, id: "thin", key: nil, text: "9 days of data, fewer than 14.")])
        #expect(thin.noticedLines(rows: [Self.home]).map(\.text) == thin.noticed)
    }

    @Test func eachNoticedLineKeepsItsIdentityWhenAnotherGoes() {
        let withPlace = Self.full.noticedLines(rows: [Self.home])
        #expect(withPlace.last?.id == Self.home.key)
        #expect(Set(withPlace.map(\.id)).count == withPlace.count)
        // Once the place is said no to, the lines that stay keep the identity they had.
        let without = Self.full.noticedLines(rows: [])
        for line in withPlace.dropLast() { #expect(without.first { $0.text == line.text }?.id == line.id) }
        // Two lines that read the same are still told apart.
        let twice = MemoryBrief.NoticedLine.plain(["Same words.", "Same words."])
        #expect(twice.map(\.id) == ["Same words.", "Same words.#1"] && twice.allSatisfy { $0.key == nil })
    }

    @Test func theMemoryListSaysWhereThePersonTrains() throws {
        #expect(RowWords.sentence(Self.home) == "You train at home, without gym equipment.")
        #expect(RowWords.title(Self.home) == "training at home")
        #expect(RowWords.support(Self.home).hasPrefix("No elliptical or stair-climber workouts in the last 8 weeks."))
        // It sits under the routine, as a sentence of its own with its key for "Stop".
        #expect(MemoryPattern.split([Self.home]).others == [Self.home])
        #expect(BodyFigure.figures([Self.home]).isEmpty)
        // A kind this code doesn't know is said as the row's own statement.
        var unknown = Self.home
        unknown.kind = "training_spot"
        unknown.statement = "Something the engine learned later."
        #expect(RowWords.sentence(unknown) == "Something the engine learned later.")
        #expect(MemoryBrief().noticedLines(rows: [unknown]).allSatisfy { $0.key == nil })
        // The contract's own example of the row decodes and is said the same way.
        let rows = try HandOffTests.load("memory-row", as: [MemoryRow].self)
        let example = try #require(rows.first { $0.kind == "training_place" })
        #expect(example.data == ["place": "home", "gymWorkouts": 0, "weeks": 8])
        #expect(RowWords.sentence(example) == "You train at home, without gym equipment.")
    }

    @Test func thinHistoryGetsAFriendlyVersion() {
        let thin = MemoryBrief(lines: [.init(group: .routine, id: "thin", key: nil, text: "9 days of data, fewer than 14.")])
        #expect(thin.thinDays == 9)
        #expect(thin.noticed.first == "I have 9 days of your workouts.")
        #expect(thin.noticed.count == 3)
        #expect(thin.noticed.allSatisfy { $0.split(separator: " ").count <= 8 })
        #expect(MemoryBrief().noticed.count == 3)
    }

    @Test func theLastFourWeeksAreAGridOfDays() {
        let person = PersonaFixture.load("jordan", storyDay: Fixture.storyDay, calendar: Fixture.calendar)
        // The story day is a Thursday, so the columns start on a Thursday too.
        let weeks = RecentWeeks(workouts: person.workouts, usualWeekdays: [7], today: Fixture.storyDay, calendar: Fixture.calendar)
        #expect(weeks.weeks.count == 4 && weeks.weeks.allSatisfy { $0.count == 7 })
        #expect(weeks.letters == ["T", "F", "S", "S", "M", "T", "W"])
        #expect(weeks.usualColumns == [3])
        #expect(weeks.workoutDays == Set(person.workouts.filter { $0.minutes >= 10 && $0.start >= Fixture.at(0, dayOffset: -28) }
            .map { Fixture.calendar.startOfDay(for: $0.start) }).count)
        // A short walk doesn't count, and neither does today.
        let short = [Fixture.workout("w", at: Fixture.at(9, dayOffset: -1), minutes: 5), Fixture.workout("t", at: Fixture.at(9), minutes: 30)]
        #expect(RecentWeeks(workouts: short, usualWeekdays: [], today: Fixture.storyDay, calendar: Fixture.calendar).workoutDays == 0)
    }
}
