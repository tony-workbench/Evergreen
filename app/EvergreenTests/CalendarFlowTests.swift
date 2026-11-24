import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// Sessions and typed requests going through the real calendar engine:
/// one tap when it simply fits, a preview to confirm otherwise, and nothing
/// written before the person confirms.
@MainActor
struct CalendarFlowTests {
    static let toCalendar = ScriptedModel.text(#"{"agent":"calendar"}"#)

    @Test(arguments: Clocks.all) func aSessionThatSimplyFitsIsAddedInOneTapAndCanBeUndone(now: Date) async throws {
        let model = try await EngineTests.model(now: now)
        try await model.loadWeekPlan()
        let session = try #require(model.topSuggestion)
        let before = model.plan.count

        await model.accept(session)
        #expect(model.placement == nil)
        #expect(model.suggestionState(session) == .added)
        let item = try #require(model.plan.first { $0.id == session.id })
        // The engine chose the time: the same day, no earlier than suggested.
        let suggested = try #require(session.after)
        #expect(model.calendar.isDate(item.slot.start, inSameDayAs: suggested.start) && item.slot.start >= suggested.start)
        #expect(item.slot.minutes == suggested.minutes && model.plan.count == before + 1)

        let action = try #require(model.appliedActions.last { $0.id == session.id })
        model.undo(action)
        #expect(!model.plan.contains { $0.id == session.id })
    }

    @Test(arguments: Clocks.all) func aPreviewThatMovesSomethingWaitsForConfirmAndNotNowWritesNothing(now: Date) async throws {
        let model = try await EngineTests.model(now: now)
        try await model.loadWeekPlan()
        let existing = try #require(model.plan.first { $0.slot.start > model.now })
        let zone = model.calendar.timeZone
        let later = existing.slot.start.addingTimeInterval(3600)
        let moved = PreviewBlock(id: existing.id, sessionId: existing.id, activity: ActivityKind(healthType: existing.slot.activityType), title: "Run",
                                 start: LocalTime(later, in: zone), end: LocalTime(later.addingTimeInterval(1800), in: zone), minutes: 30, status: "moved", reason: "Makes room.")
        let day = try #require(model.calendar.date(byAdding: .day, value: 5, to: model.calendar.startOfDay(for: model.now)))
        let start = try #require(model.calendar.date(bySettingHour: 15, minute: 0, second: 0, of: day))
        let new = PreviewBlock(id: "new-swim", sessionId: "s-new-swim", activity: .swim, title: "Swim", start: LocalTime(start, in: zone),
                               end: LocalTime(start.addingTimeInterval(2400), in: zone), minutes: 40, status: "new", reason: "Free then.")
        let result = CalendarResult(kind: "add", message: "Swim fits if your run moves an hour.", proposed: [new, moved])
        #expect(!result.isSimpleAdd)

        model.placement = Placement(sessionKey: nil, result: result)
        model.cancelPlacement()
        #expect(model.placement == nil && !model.plan.contains { $0.id == "s-new-swim" })
        #expect(model.plan.first { $0.id == existing.id }?.slot.start == existing.slot.start)

        model.placement = Placement(sessionKey: nil, result: result)
        await model.confirmPlacement()
        #expect(model.placement == nil)
        #expect(model.plan.first { $0.id == "s-new-swim" }?.slot.start == start)
        #expect(model.plan.first { $0.id == existing.id }?.slot.start == later)
    }

    @Test(arguments: Clocks.all) func aTypedRequestBecomesAnIntentAndAPreviewNotAWrite(now: Date) async throws {
        let model = try Self.seeded(now: now)
        model.askWithoutModel = false
        let tomorrow = try #require(model.calendar.date(byAdding: .day, value: 1, to: model.now))
        let day = LocalTime(tomorrow, in: model.calendar.timeZone).day
        // The first answer has a loose time and a made-up id; the exact problem goes back, and the second is right.
        let scripted = ScriptedModel([
            Self.toCalendar,
            ScriptedModel.text(#"{"kind":"move","targetWorkoutId":"the-run","day":"\#(day)","after":"half past six"}"#),
            ScriptedModel.text("```json\n" + #"{"kind":"add","activity":"swim","minutes":30,"day":"\#(day)","after":"6ish","title":""}"# + "\n```"),
        ])
        model.scriptedModel = scripted
        let before = model.plan

        await model.askEvergreen("Find me 30 minutes to swim tomorrow around 6ish")
        let block = try #require(model.placement?.result.proposed.first)
        #expect(block.activity == .swim && block.minutes == 30 && block.start.day == day && block.status == "new")
        // "6ish" became 18:00 through the time mapper, and the engine placed it no earlier.
        #expect(block.start.clock >= "18:00")
        // The preview is the answer; nothing is on the plan yet, and no fallback was needed.
        #expect(model.ask == .idle && model.plan == before && model.fallbacks.isEmpty)

        let requests = await scripted.requests
        #expect(requests.count == 3 && requests[1].tools.isEmpty)
        // The model was asked for JSON in the engine's own schema, with the planned workouts by id and today's date.
        #expect(requests[1].answerSchema?["properties"]?["kind"] != nil && requests[1].effort == "low")
        #expect(before.allSatisfy { requests[1].system.contains("id \($0.id)") } && requests[1].system.contains("\(LocalTime(model.now, in: model.calendar.timeZone).day) ") && requests[1].system.contains("(tomorrow)"))
        #expect(requests[2].messages.last?["content"]?.string?.contains("targetWorkoutId \"the-run\" is not one of the planned workouts' ids") == true)

        await model.confirmPlacement()
        #expect(model.placement == nil && model.plan.count == before.count + 1)
        #expect(model.plan.contains { $0.slot.activityType == "Swimming" })
    }

    @Test(arguments: Clocks.all) func whenTheModelKeepsGettingItWrongTheEnginesRulesReadTheSentence(now: Date) async throws {
        let model = try Self.seeded(now: now)
        model.askWithoutModel = false
        let bad = ScriptedModel.text(#"{"kind":"delete_everything"}"#)
        let scripted = ScriptedModel([bad, bad])
        model.scriptedModel = scripted
        await model.askEvergreen("Cancel tomorrow’s run")
        // A planned workout named with a cancel verb is the calendar's without asking the model to sort it; then two tries (one repair),
        // and code reads the sentence itself: the right workout is proposed for cancelling, and the fallback is counted.
        #expect(await scripted.requests.count == 2 && model.fallbacks == ["calendar": 1])
        let block = try #require(model.placement?.result.proposed.first)
        #expect(block.status == "cancelled" && block.activity == .run && model.plan.count == 1)
    }

    @Test(arguments: Clocks.all) func whenTheModelCannotBeReachedTheSentenceIsStillSortedAndRead(now: Date) async throws {
        let model = try Self.seeded(now: now)
        model.askWithoutModel = false
        model.scriptedModel = ScriptedModel([.failure(.unreachable), .failure(.unreachable)])
        await model.askEvergreen("Move tomorrow’s run to the afternoon")
        #expect(model.fallbacks == ["calendar": 1])
        #expect(model.placement?.result.proposed.first?.status == "moved")
    }

    @Test func looseTimesAreMappedOnlyByTheTestedMapper() {
        for (said, clock) in [("6ish", "18:00"), ("half past six", "18:30"), ("7pm", "19:00"), ("7:15 am", "07:15"), ("quarter to 8 in the morning", "07:45"),
                              ("noon", "12:00"), ("18:30", "18:30"), ("around 6 in the morning", "06:00"), ("9", "09:00"), ("10.30", "10:30"), ("midnight", "00:00")] {
            #expect(TimeWords.clock(said) == clock, "\(said)")
        }
        #expect(TimeWords.clock("whenever") == nil && TimeWords.clock("25:99") == nil)
    }

    @Test(arguments: Clocks.all) func planMyWeekPlansAgainAndPointsAtTheSuggestions(now: Date) async throws {
        let model = try await EngineTests.model(now: now)
        // The week's model call fails, so the rules' week is shown.
        model.scriptedModel = ScriptedModel([ScriptedModel.text(#"{"agent":"week"}"#)])
        await model.askEvergreen("Plan my week")
        guard case .answer(agent: .week, let text) = model.ask else {
            Issue.record("Expected the week's answer, got \(model.ask)")
            return
        }
        #expect(text.contains("below") && model.weekPlan?.fromRules == true && !model.openSuggestions.isEmpty)
    }

    @Test(arguments: Clocks.all) func aQuestionAboutTheWeekIsAnsweredFromTheWeekAndMemory(now: Date) async throws {
        let model = try await EngineTests.model(now: now)
        try await model.loadWeekPlan()
        let scripted = ScriptedModel([
            ScriptedModel.text(#"{"agent":"plan"}"#), ScriptedModel.call("suggested_week"), ScriptedModel.call("week_limits", [:], id: "call_2"),
            ScriptedModel.text("Wednesday is your usual run."),
        ])
        model.scriptedModel = scripted
        await model.askEvergreen("Why Wednesday?")
        #expect(model.ask == .answer(agent: .plan, text: "Wednesday is your usual run."))
        let requests = await scripted.requests
        let week = try #require(requests[2].messages.last?["content"]?.array?.first?["content"]?.string)
        // Plain sentences, with no keys or brackets in them.
        let firstSuggested = try #require(model.weekPlan?.sessions.first { $0.after != nil })
        #expect(week.contains("Suggested:") && !week.contains("[") && !week.contains("mem:"))
        #expect(week.contains(SuggestionWords.statement(firstSuggested, calendar: model.calendar)))
        let numbers = try #require(requests[3].messages.last?["content"]?.array?.first?["content"]?.string)
        #expect(numbers.contains("- Plan from today") && !numbers.contains("{"))
    }

    // MARK: Sentences read by the calendar engine's own rules (the scripted AI)

    /// Four weeks of 7 AM runs behind the person and tomorrow's 7 AM run on the plan, with the clock stopped at `now`,
    /// answering without a model.
    static func seeded(now: Date = Clocks.morning) throws -> AppModel {
        let rig = try AppRig(.init(now: now, history: AppRig.runs(days: 28, before: now)))
        try rig.plan(.run, id: "ui-test-run", day: 1, hour: 7)
        rig.model.askWithoutModel = true
        return rig.model
    }

    @Test(arguments: Clocks.all) func aTypedAddIsWhatIsPreviewed(now: Date) async throws {
        let model = try Self.seeded(now: now)
        await model.askEvergreen("Find me 30 minutes to walk tomorrow evening")
        let block = try #require(model.placement?.result.proposed.first)
        let tomorrow = LocalTime(try #require(model.calendar.date(byAdding: .day, value: 1, to: model.now)), in: model.calendar.timeZone).day
        #expect(block.activity == .walk && block.minutes == 30 && block.status == "new" && block.start.day == tomorrow)
        #expect(block.start.clock >= "17:00" && model.plan.count == 1)
    }

    @Test(arguments: Clocks.all) func aTypedMoveMovesThatWorkout(now: Date) async throws {
        let model = try Self.seeded(now: now)
        let run = try #require(model.plan.first)
        await model.askEvergreen("Move tomorrow’s run to the afternoon")
        let block = try #require(model.placement?.result.proposed.first)
        #expect(block.activity == .run && block.status == "moved" && block.minutes == run.slot.minutes)
        #expect(block.start.clock >= "12:00" && block.start.clock < "18:00")
        // Still where it was until confirmed; then it is at the new time.
        #expect(model.plan.first?.slot.start == run.slot.start)
        await model.confirmPlacement()
        #expect(model.plan.count == 1 && model.plan.first?.slot.start == block.start.date)
    }

    @Test(arguments: Clocks.all) func aTypedResizeChangesItsLength(now: Date) async throws {
        let model = try Self.seeded(now: now)
        await model.askEvergreen("Shorten tomorrow’s run to 20 minutes")
        let block = try #require(model.placement?.result.proposed.first)
        #expect(block.activity == .run && block.status == "resized" && block.minutes == 20)
    }

    @Test(arguments: Clocks.all) func aTypedCancelTakesItOffOnlyAfterConfirm(now: Date) async throws {
        let model = try Self.seeded(now: now)
        await model.askEvergreen("Cancel tomorrow’s run")
        let block = try #require(model.placement?.result.proposed.first)
        #expect(block.activity == .run && block.status == "cancelled" && model.plan.count == 1)
        await model.confirmPlacement()
        #expect(model.plan.isEmpty && model.placement == nil)
    }

    @Test(arguments: Clocks.all) func withoutAModelPlanAndMemorySentencesAreAnsweredFromTheWeekAndTheTable(now: Date) async throws {
        let model = try await EngineTests.model(now: now)
        model.askWithoutModel = true
        await model.askEvergreen("What do you remember about me?")
        guard case .answer(agent: .memory, let remembered) = model.ask else { Issue.record("no memory answer: \(model.ask)"); return }
        #expect(model.remembered.prefix(3).allSatisfy { remembered.contains($0.text) } && !model.remembered.isEmpty)
        await model.askEvergreen("Why this week?")
        guard case .answer(agent: .plan, let why) = model.ask else { Issue.record("no plan answer: \(model.ask)"); return }
        #expect(why.contains(SuggestionWords.headline(try #require(model.topSuggestion))))
    }

    @Test func whatTheSentencePlainlySaysFillsWhatTheModelLeftEmpty() {
        let today = "2026-11-23"   // a Monday
        func facts(_ sentence: String, moving: Bool = false) -> SentenceFacts { SentenceFacts(sentence, today: today, moving: moving) }
        #expect(facts("add a 30 min walk tomorrow morning") == SentenceFacts("", today: today).with(day: "2026-11-24", partOfDay: "morning", minutes: 30))
        #expect(facts("yoga thursday around half past six").after == "18:30" && facts("yoga thursday around half past six").day == "2026-11-26")
        #expect(facts("schedule strength for friday at 6ish").after == "18:00" && facts("schedule strength for friday at 6ish").day == "2026-11-27")
        let climbing = facts("I want to go climbing on Saturday afternoon for an hour")
        #expect(climbing.day == "2026-11-28" && climbing.minutes == 60 && climbing.partOfDay == "afternoon")
        #expect(facts("book a 20 minute stretch tonite").day == today && facts("book a 20 minute stretch tonite").minutes == 20)
        #expect(facts("add an easy run after 7pm today").after == "19:00" && facts("add an easy run after 7pm today").day == today)
        // A move: the day is where it goes, not where it is.
        #expect(facts("Move tomorrow's run to the afternoon", moving: true).day == nil && facts("Move tomorrow's run to the afternoon", moving: true).partOfDay == "afternoon")
        #expect(facts("move sundays long run to saturday", moving: true).day == "2026-11-28")
        #expect(facts("shift strength to friday", moving: true).day == "2026-11-27")
        #expect(facts("reschedule the long run to after 10", moving: true).after == "10:00")
        #expect(facts("tomorow run later pls, like 6pm", moving: true).after == "18:00")
        #expect(facts("can the gym session on thursday be in the morning instead", moving: true).partOfDay == "morning")
        // Lengths and distances.
        #expect(facts("Shorten tomorrow's run to 20 minutes").minutes == 20 && facts("make the long run an hour").minutes == 60)
        #expect(facts("I only have 30 min for the gym on thursday").minutes == 30 && facts("extend tomorrows run to 50 mins").minutes == 50)
        #expect(facts("I'm racing a 10k on December 6").distanceKm == 10 && facts("i have a half marathon on dec 13th").distanceKm == 21.1)
        // A time isn't read out of a length or a distance.
        #expect(facts("add a 30 min walk").after == nil && facts("racing a 10k").after == nil && facts("find time to run").day == nil)

        // Filling never changes what the model gave, and only fills what belongs to the kind.
        let given = CalendarIntent(kind: "add", activity: .yoga, day: "2026-11-25", after: "07:00")
        #expect(facts("yoga thursday around half past six").filling(given) == given)
        #expect(facts("add a 30 min walk tomorrow morning").filling(CalendarIntent(kind: "add", activity: .walk))
            == CalendarIntent(kind: "add", activity: .walk, minutes: 30, day: "2026-11-24", partOfDay: "morning"))
        #expect(facts("skip the gym thursday").filling(CalendarIntent(kind: "cancel", targetWorkoutId: "w")) == CalendarIntent(kind: "cancel", targetWorkoutId: "w"))
        #expect(facts("I'm racing a 10k on December 6").filling(CalendarIntent(kind: "race", raceDate: "2026-12-06")).distanceKm == 10)
    }

    @Test func theModelIsAskedToAnswerEveryFieldAndEmptyAnswersAreTakenOut() async throws {
        let schema = await AppModel.calendarBundle.call("calendarIntentSchema")
        let agent = CalendarAgent(model: ScriptedModel([]), modelId: AIModels.standard, schema: schema, now: LocalTime("2026-11-23T09:00:00-08:00")!,
                                  planned: [("w-run", .run, LocalTime("2026-11-24T07:00:00-08:00")!, 40)])
        let asked = agent.askSchema
        let names = Set(schema["properties"]?.object?.keys.map(\.self) ?? [])
        #expect(Set(asked["required"]?.array?.compactMap(\.string) ?? []) == names.union(["more"]) && names.count >= 8)
        #expect(asked["properties"]?["activity"]?["enum"]?.array?.contains("none") == true)
        #expect(asked["properties"]?["minutes"]?["description"]?.string?.hasSuffix("Answer 0 when the sentence doesn't say.") == true)
        #expect(agent.system.contains("2026-11-24 Tuesday (tomorrow)") && agent.system.contains("2026-11-29 Sunday"))
        // Every field answered, most of them as empty: what is left is the intent, and it fits the engine's schema.
        let answer = #"{"kind":"move","activity":"none","title":"","minutes":0,"sessionId":"","targetWorkoutId":"w-run","day":"","after":"like 6pm","before":"","partOfDay":"none","raceDate":"","distanceKm":0}"#
        let read = agent.read(answer)
        #expect(read.0 == CalendarIntent(kind: "move", targetWorkoutId: "w-run", after: "18:00") && read.1 == nil)
    }

    // MARK: What a real person would lose

    @Test(arguments: Clocks.all) func whatWasAddedIsStillThereTheNextDay(now: Date) async throws {
        let rig = try AppRig(.init(now: now, history: AppRig.runs(days: 28, before: now)))
        let model = rig.model
        let run = try rig.plan(.run, id: "ui-test-run", day: 1, hour: 7)
        // A workout for three days after that, added today.
        try rig.plan(.yoga, id: "thu", day: 4, hour: 7, minutes: 30)
        // The app is opened again the next day: the same store, a new model.
        try rig.container.mainContext.save()
        let tomorrow = now.addingTimeInterval(86_400), today = model.storyDay
        let next = AppModel(context: rig.container.mainContext, setup: AppModel.Setup(
            memory: nil, health: HealthHistory(), calendar: Fixture.calendar, clock: { tomorrow },
            calendarSync: RecordingCalendar(access: .off), healthReader: ScriptedHealth()))
        #expect(next.storyDay == Fixture.calendar.startOfDay(for: tomorrow) && next.storyDay > today)
        #expect(next.plan.map(\.id).contains("thu") && next.plan.map(\.id).contains(run.id))
        #expect(next.appliedActions.count == model.appliedActions.count)
    }

    @Test(arguments: Clocks.all) func aConfirmedCancelRemovesTheWorkoutEvenAfterAMoveAndAResizeKeepsItsNewLength(now: Date) async throws {
        let model = try Self.seeded(now: now)
        let run = try #require(model.plan.first)
        let zone = model.calendar.timeZone
        func block(_ status: String, start: Date, minutes: Int) -> PreviewBlock {
            PreviewBlock(id: run.id, sessionId: run.id, activity: .run, title: "Run", start: LocalTime(start, in: zone),
                         end: LocalTime(start.addingTimeInterval(Double(minutes) * 60), in: zone), minutes: minutes, status: status, reason: "x")
        }
        // "Make it 20 minutes" saves 20 minutes, not the old length.
        #expect(model.write([block("resized", start: run.slot.start, minutes: 20)]))
        #expect(model.plan.first?.slot.minutes == 20 && model.plan.first?.slot.start == run.slot.start)
        // Moved, then cancelled: it is gone, not back at its old time.
        let later = run.slot.start.addingTimeInterval(6 * 3600)
        #expect(model.write([block("moved", start: later, minutes: 20)]))
        #expect(model.plan.first?.slot.start == later)
        #expect(model.write([block("cancelled", start: later, minutes: 20)]))
        #expect(model.plan.isEmpty)
    }

    @Test func aCancelSentenceFillsTheKindAndTargetTheModelLeftEmpty() async throws {
        let schema = await AppModel.calendarBundle.call("calendarIntentSchema")
        let planned: [(id: String, activity: ActivityKind, start: LocalTime, minutes: Int)] = [
            ("w-run", .run, LocalTime("2026-11-24T07:00:00-08:00")!, 40), ("w-gym", .strength, LocalTime("2026-11-26T18:00:00-08:00")!, 45),
            ("w-long", .longRun, LocalTime("2026-11-29T08:30:00-08:00")!, 90),
        ]
        let agent = CalendarAgent(model: ScriptedModel([]), modelId: AIModels.standard, schema: schema, now: LocalTime("2026-11-23T09:00:00-08:00")!, planned: planned)
        let empty = #"{"kind":"none","activity":"none","title":"","minutes":0,"sessionId":"","targetWorkoutId":"","day":"","after":"","before":"","partOfDay":"none","raceDate":"","distanceKm":0}"#
        #expect(agent.read(empty, sentence: "drop sunday's long run").0 == CalendarIntent(kind: "cancel", targetWorkoutId: "w-long"))
        #expect(agent.read(empty, sentence: "cancel tomorrow's run and add yoga on friday").0 == CalendarIntent(kind: "cancel", targetWorkoutId: "w-run"))
        #expect(agent.read(empty, sentence: "skip the gym thursday").0 == CalendarIntent(kind: "cancel", targetWorkoutId: "w-gym"))
        // Two runs fit "the run": no guess is made, and the problem goes back to the model.
        #expect(agent.read(empty, sentence: "cancel the run").0 == nil)
        // A value the model gave is never replaced.
        let given = #"{"kind":"cancel","targetWorkoutId":"w-gym"}"#
        #expect(agent.read(given, sentence: "drop sunday's long run").0 == CalendarIntent(kind: "cancel", targetWorkoutId: "w-gym"))
    }

    @Test func eachSessionIsWrittenAtTheOffsetOfItsOwnDay() throws {
        // The week of the US clock change: Saturday is still summer time, Sunday is not.
        let zone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let agent = PlanAgent(model: ScriptedModel([]), modelId: AIModels.standard, rules: CapRules(), rows: [], now: Clocks.morning, timeZone: zone)
        let answer = #"{"sessions":[{"day":"2026-10-31","start":"07:00","activity":"run","minutes":30,"intensity":"easy","reason":"x","basedOn":[]},{"day":"2026-11-01","start":"07:00","activity":"run","minutes":30,"intensity":"easy","reason":"x","basedOn":[]}],"summary":"x"}"#
        let sessions = try #require(agent.plan(in: answer)?.sessions)
        #expect(sessions.map(\.start.text) == ["2026-10-31T07:00:00-07:00", "2026-11-01T07:00:00-08:00"])
    }

    @Test func aDayOutsideTheWeekOrAPastRaceGoesBackAndTwoRequestsAreFlagged() async throws {
        let schema = await AppModel.calendarBundle.call("calendarIntentSchema")
        let wrongDay = ScriptedModel.text(#"{"kind":"add","activity":"yoga","day":"2026-12-25","more":false}"#)
        let pastRace = ScriptedModel.text(#"{"kind":"race","raceDate":"2026-11-01","more":false}"#)
        let two = ScriptedModel.text(#"{"kind":"add","activity":"yoga","day":"2026-11-27","more":true}"#)
        let model = ScriptedModel([wrongDay, two])
        let agent = CalendarAgent(model: model, modelId: AIModels.standard, schema: schema, now: LocalTime("2026-11-23T09:00:00-08:00")!, planned: [])
        let read = await agent.intent(for: "add yoga on friday and a swim on sunday")
        #expect(read.intent == CalendarIntent(kind: "add", activity: .yoga, day: "2026-11-27") && read.source == .model(repairs: 1) && read.more)
        let requests = await model.requests
        #expect(requests[1].messages.last?["content"]?.string?.contains("day 2026-12-25 is not one of the next seven days") == true)
        #expect(agent.dateProblem(try #require(agent.read(#"{"kind":"race","raceDate":"2026-11-01"}"#).0))?.contains("raceDate 2026-11-01 is not in the future") == true)
        _ = pastRace
        // The examples, which never change, come before the dates, which do.
        let system = agent.system
        let examples = try #require(system.range(of: "Examples, for a Monday")), dates = try #require(system.range(of: "Dates:"))
        #expect(examples.lowerBound < dates.lowerBound)
    }

    @Test func cancelAndMoveSentencesThatNameAPlannedWorkoutAreReadByCode() async throws {
        let schema = await AppModel.calendarBundle.call("calendarIntentSchema")
        let down = ScriptedModel { _ in ModelReply(stopReason: "refusal", content: []) }
        let seen = CalendarAgent(model: down, modelId: AIModels.standard, schema: schema, now: LocalTime("2026-11-23T09:00:00-08:00")!, planned: [
            ("w-run", .run, LocalTime("2026-11-24T07:00:00-08:00")!, 40), ("w-gym", .strength, LocalTime("2026-11-26T18:00:00-08:00")!, 45),
            ("w-long", .longRun, LocalTime("2026-11-29T08:30:00-08:00")!, 90)])
        let other = CalendarAgent(model: down, modelId: AIModels.standard, schema: schema, now: LocalTime("2026-12-03T10:00:00-08:00")!, planned: [
            ("p-swim", .swim, LocalTime("2026-12-04T06:30:00-08:00")!, 45), ("p-ride", .ride, LocalTime("2026-12-05T09:00:00-08:00")!, 120),
            ("p-yoga", .yoga, LocalTime("2026-12-07T19:00:00-08:00")!, 60)])
        let router = Router(model: down, modelId: AIModels.standard)
        // With no model at all: the sentence is the calendar's, and the intent is read from the verb and the workout it names.
        for (agent, sentence, intent) in [
            (seen, "shift strength to friday", CalendarIntent(kind: "move", targetWorkoutId: "w-gym", day: "2026-11-27")),
            (seen, "i cant do the run tomorrow, take it off", CalendarIntent(kind: "cancel", targetWorkoutId: "w-run")),
            (other, "not doing yoga on Monday after all", CalendarIntent(kind: "cancel", targetWorkoutId: "p-yoga")),
            (other, "ditch the saturday ride, weather looks awful", CalendarIntent(kind: "cancel", targetWorkoutId: "p-ride")),
            (other, "remove tomorrow's swim from my plan", CalendarIntent(kind: "cancel", targetWorkoutId: "p-swim")),
            (other, "bump the ride to Sunday", CalendarIntent(kind: "move", targetWorkoutId: "p-ride", day: "2026-12-06")),
            (other, "slide tomorrows swim to lunchtime", CalendarIntent(kind: "move", targetWorkoutId: "p-swim", partOfDay: "afternoon")),
        ] {
            let said = " " + sentence.lowercased() + " "
            let sorted = try await router.sort(sentence, memoryCommand: false, namesPlannedWorkout: agent.target(in: said) != nil)
            #expect(sorted.kind == .calendar && !sorted.fellBack, "\(sentence)")
            let read = await agent.intent(for: sentence)
            #expect(read.intent == intent && read.source == .rules, "\(sentence): \(String(describing: read.intent))")
        }
        // Nothing is guessed: no workout named, or a move with nowhere to go, is left to the model or the engine.
        #expect(seen.codeIntent("cancel everything") == nil && seen.codeIntent("move the long run") == nil && seen.codeIntent("add yoga on friday") == nil)
        #expect(Router.byWords("ditch the saturday ride") == .calendar && Router.byWords("write a poem") == AgentKind.none)
    }
}


extension SentenceFacts {
    func with(day: String? = nil, partOfDay: String? = nil, after: String? = nil, minutes: Int? = nil) -> SentenceFacts {
        var copy = self
        copy.day = day; copy.partOfDay = partOfDay; copy.after = after; copy.minutes = minutes
        return copy
    }
}