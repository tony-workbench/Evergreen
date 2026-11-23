import Foundation
import Testing
@testable import Evergreen

/// The backend's technical wording, said plainly. Known shapes are rewritten;
/// anything else is shown as it came.
struct PlainWordsTests {
    @Test func reasonsFromTheBackendsRulesReadPlainly() {
        #expect(PlainWords.reason("89 min run: your usual Sun 06:00 slot (memory); long run.")
            == "Your usual Sunday 6 AM run. Your long run of the week.")
        #expect(PlainWords.reason("25 min yoga: trimmed to stay under your weekly load cap.")
            == "Kept short so this week stays close to your normal.")
        #expect(PlainWords.reason("37 min run: your usual Wed 18:00 slot (memory); trimmed to stay under your weekly load cap.")
            == "Your usual Wednesday 6 PM run. Kept short so this week stays close to your normal.")
        #expect(PlainWords.reason("40 min strength session: your usual Mon strength session.")
            == "Your usual Monday strength session.")
        #expect(PlainWords.reason("28 min run: taper: race in 8 days.") == "Shorter, because your race is in 8 days.")
        #expect(PlainWords.reason("36 min run: ease off: sleep down 42 min/night, resting HR up 3.5 bpm → easy.")
            == "Kept easy, because your sleep is down 42 minutes a night and your resting heart rate is up 3.5.")
        #expect(PlainWords.reason("60 min bike ride: long run; shoes at 97% → off the road.")
            == "Your long run of the week. Off the road while your shoes are worn out.")
        #expect(PlainWords.reason("30 min run: break-in run in the new pair; moved after a calendar conflict.")
            == "An easy run to break in your new shoes. Moved to after something on your calendar.")
        #expect(PlainWords.reason("45 min run: your usual Tue run; no free slot that day.")
            == "Your usual Tuesday run. Your day looks full, so this one may not fit.")
        #expect(PlainWords.reason("Race day. Rest and fuel.") == "Race day. Rest and fuel.")
    }

    @Test func keptShortIsSaidOnceInTheHeading() {
        let summary = "Your last 7 days carried 0.63× your usual training load, so this week is planned at 1917 (cap 1913). Readiness: normal."
        #expect(PlainWords.summary(summary, keptShort: true)
            == "A lighter week than usual, so there is room to build. Sessions are a little shorter, to stay close to your normal.")
        #expect(PlainWords.summary(summary, keptShort: false) == "A lighter week than usual, so there is room to build.")
        #expect(PlainWords.summary("Something else.", keptShort: true) == "Something else.")
    }

    @Test func aReasonThatDoesNotMatchIsShownAsIs() {
        let written = "Your taper for the race in 8 days keeps this run short."
        #expect(PlainWords.reason(written) == written)
        let unknown = "30 min run: your usual Tue run; a rule nobody has seen."
        #expect(PlainWords.reason(unknown) == unknown)
    }

    @Test func theWeeksSummarySaysHowItComparesWithoutNumbers() {
        #expect(PlainWords.summary("Your last 7 days carried 0.63× your usual training load, so this week is planned at 1917 (cap 1913). Readiness: normal.")
            == "A lighter week than usual, so there is room to build.")
        #expect(PlainWords.summary("Your last 7 days carried 1.0× your usual training load, so this week is planned at 1500 (cap 1650). Readiness: normal.")
            == "A week much like your usual, so this one keeps the rhythm.")
        #expect(PlainWords.summary("Your last 7 days carried 1.24× your usual training load, so this week is planned at 1513 (cap 1957). Readiness: ease off: sleep down 42 min/night. 1 long session moved off the road while your shoes are worn.")
            == "A bigger week than usual, so this one holds steady. One session is kept easy so you can recover. 1 long session moved off the road while your shoes are worn.")
        let other = "Your last 7 days carried None× your usual training load, so this week is planned at 0 (cap 0). Readiness: normal."
        #expect(PlainWords.summary(other) == other)
    }

    @Test func noTechnicalWordsSurviveAKnownReasonOrSummary() {
        let shown = [
            PlainWords.reason("89 min run: your usual Sun 06:00 slot (memory); trimmed to stay under your weekly load cap."),
            PlainWords.summary("Your last 7 days carried 0.63× your usual training load, so this week is planned at 1917 (cap 1913). Readiness: normal.", keptShort: true),
            PlainWords.extra("Your race is 9 days out; runbikecalc.com suggests it during taper. Optional, and it fits your weekly load."),
        ].joined(separator: " ").lowercased()
        for word in ["memory", "load cap", "cap ", "readiness", "planned at", "slot", "weekly load"] {
            #expect(!shown.contains(word), "\(word)")
        }
    }

    @Test func aSessionThePlanAlreadyCoversNamesTheDay() {
        let sunday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 22, hour: 6))!
        let run = Slot(start: sunday, end: sunday.addingTimeInterval(2700), activityType: "Running")
        #expect(PlainWords.alreadyPlanned(run).hasPrefix("You already have a run on "))
        let elliptical = Slot(start: sunday, end: sunday.addingTimeInterval(3600), activityType: "Elliptical")
        #expect(PlainWords.alreadyPlanned(elliptical).hasPrefix("You already have an elliptical session on "))
    }
}
