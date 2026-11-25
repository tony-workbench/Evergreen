import Foundation
import Testing
@testable import Evergreen

/// Rain on an outdoor workout, from recorded Open-Meteo answers (San
/// Francisco, 21 to 23 November 2026; the wet ones are that answer with the
/// 22nd made wet). No network.
@MainActor
struct RainCheckTests {
    let cal = Fixture.calendar
    let now = TriggerRig.evening

    @Test func theRecordedAnswerDecodesToLocalHours() throws {
        let forecast = try TriggerRig.forecast("open-meteo-recorded-dry.json")
        #expect(forecast.hours.count == 72)
        // "2026-11-21T00:00" with utc_offset_seconds -28800 is midnight in San Francisco.
        #expect(forecast.hours.first?.start == TriggerRig.date(21, 0))
        #expect(forecast.hours.last?.start == TriggerRig.date(23, 23))
        #expect(forecast.hours(from: TriggerRig.date(22, 8), to: TriggerRig.date(22, 9, 30)).map(\.start)
            == [TriggerRig.date(22, 8), TriggerRig.date(22, 9)])
    }

    @Test func anHourWithoutAProbabilityIsLeftOut() throws {
        let json = #"{"utc_offset_seconds":0,"hourly":{"time":["2026-11-22T08:00","2026-11-22T09:00"],"precipitation_probability":[null,70]}}"#
        let forecast = try Forecast(openMeteo: Data(json.utf8), fetchedAt: now, place: TriggerRig.here)
        #expect(forecast.hours.map(\.probability) == [70])
        #expect(forecast.hours.first?.millimeters == 0)
    }

    @Test func aDryDayAsksNothing() throws {
        let asks = RainCheck.asks(plan: [TriggerRig.session()], forecast: try TriggerRig.forecast("open-meteo-recorded-dry.json"),
                                  busy: [], now: now, calendar: cal)
        #expect(asks.isEmpty)
    }

    @Test func aWetSessionOnAWetDayAsksWithNoWindow() throws {
        let asks = RainCheck.asks(plan: [TriggerRig.session()], forecast: try TriggerRig.forecast("open-meteo-wet-all-day.json"),
                                  busy: [], now: now, calendar: cal)
        let ask = try #require(asks.first)
        #expect(asks.count == 1)
        #expect(ask.session.id == "plan-me-2026-11-22-running")
        #expect(ask.wetHours.map(\.start) == [TriggerRig.date(22, 8)])
        #expect(ask.worstProbability == 80)
        #expect(ask.dryWindow == nil && ask.intent == nil)
        #expect(ask.key == "rain|plan-me-2026-11-22-running|2026-11-22")
    }

    @Test func aWetMorningWithADryAfternoonOffersTheMove() throws {
        let asks = RainCheck.asks(plan: [TriggerRig.session()], forecast: try TriggerRig.forecast("open-meteo-wet-morning.json"),
                                  busy: [], now: now, calendar: cal)
        let ask = try #require(asks.first)
        #expect(ask.worstProbability == 85)
        #expect(ask.dryWindow == DateInterval(start: TriggerRig.date(22, 12), end: TriggerRig.date(22, 22)))
        // The calendar engine picks the exact time inside the window.
        #expect(ask.intent == CalendarIntent(kind: "move", targetWorkoutId: "plan-me-2026-11-22-running",
                                             day: "2026-11-22", after: "12:00", before: "22:00"))
    }

    @Test func theWindowGoesAroundBusyTimesAndOtherWorkouts() throws {
        let forecast = try TriggerRig.forecast("open-meteo-wet-morning.json")
        let run = TriggerRig.session()
        // Noon to 12:30 is free but too short for an hour's run; lunch runs to 1:30.
        let lunch = [Fixture.busy(TriggerRig.date(22, 12, 30), TriggerRig.date(22, 13, 30))]
        #expect(RainCheck.dryWindow(for: run, plan: [run], forecast: forecast, busy: lunch, now: now, calendar: cal)
            == DateInterval(start: TriggerRig.date(22, 13, 30), end: TriggerRig.date(22, 22)))
        // Another workout that afternoon ends the window where it starts.
        let yoga = TriggerRig.session("yoga", type: "Yoga", hour: 15)
        #expect(RainCheck.dryWindow(for: run, plan: [run, yoga], forecast: forecast, busy: lunch, now: now, calendar: cal)
            == DateInterval(start: TriggerRig.date(22, 13, 30), end: TriggerRig.date(22, 15)))
        // Busy all afternoon and evening: nothing to offer.
        let full = [Fixture.busy(TriggerRig.date(22, 11), TriggerRig.date(22, 21, 30))]
        #expect(RainCheck.dryWindow(for: run, plan: [run], forecast: forecast, busy: full, now: now, calendar: cal) == nil)
    }

    @Test func theWindowNeverStartsInThePast() throws {
        let forecast = try TriggerRig.forecast("open-meteo-wet-morning.json")
        let evening = TriggerRig.session("walk", type: "Walking", hour: 11, minutes: 30)
        // At 2:10 PM on the day, the window starts half an hour from now, not at noon.
        let window = RainCheck.dryWindow(for: evening, plan: [evening], forecast: forecast, busy: [],
                                         now: TriggerRig.date(22, 14, 10), calendar: cal)
        #expect(window?.start == TriggerRig.date(22, 14, 40))
    }

    @Test func onlyOutdoorWorkoutsInTheNextTwoDaysAreChecked() throws {
        let plan = [
            TriggerRig.session("run"), TriggerRig.session("ride", type: "Cycling", hour: 9), TriggerRig.session("walk", type: "Walking", hour: 10),
            TriggerRig.session("strength", type: "FunctionalStrengthTraining", hour: 7),
            TriggerRig.session("yoga", type: "Yoga", hour: 11),
            TriggerRig.session("treadmill", hour: 6, place: "Gym"),
            TriggerRig.session("past", day: 21, hour: 18),
            TriggerRig.session("later", day: 23, hour: 21),   // 49 hours away
        ]
        #expect(RainCheck.outdoorSessions(plan, now: now).map(\.id) == ["run", "ride", "walk"])
        let asks = RainCheck.asks(plan: plan, forecast: try TriggerRig.forecast("open-meteo-wet-morning.json"), busy: [], now: now, calendar: cal)
        #expect(asks.map(\.session.id) == ["run", "ride", "walk"])
    }

    @Test func aChanceUnderSixtyIsNotRain() throws {
        var forecast = try TriggerRig.forecast("open-meteo-recorded-dry.json")
        let eight = try #require(forecast.hours.firstIndex { $0.start == TriggerRig.date(22, 8) })
        forecast.hours[eight].probability = 59
        #expect(RainCheck.asks(plan: [TriggerRig.session()], forecast: forecast, busy: [], now: now, calendar: cal).isEmpty)
        forecast.hours[eight].probability = 60
        #expect(RainCheck.asks(plan: [TriggerRig.session()], forecast: forecast, busy: [], now: now, calendar: cal).count == 1)
    }

    // MARK: Places

    @Test func theNearestThreePlacesWithinFiveKilometres() {
        let places = IndoorPlace.nearest(FakePlaces.five + [FakePlaces.five[1]], to: TriggerRig.here)
        #expect(places.map(\.name) == ["Nearest", "Second Nearest", "Third Nearest"])
        #expect(places.allSatisfy { $0.distanceMeters <= 5_000 })
        #expect(places[0].distanceMeters > 300 && places[0].distanceMeters < 600)
        #expect(places[0].distanceText.hasSuffix(" m") && places[2].distanceText.hasSuffix(" km"))
        #expect(places[0].mapItem.name == "Nearest")
        #expect(IndoorPlace.nearest([], to: TriggerRig.here).isEmpty)
    }

    // MARK: The request and its cache

    @Test func theRequestCarriesOnlyARoundedPlaceAndNoKey() throws {
        let url = try #require(ForecastClient.url(for: TriggerRig.here))
        #expect(url.absoluteString == "https://api.open-meteo.com/v1/forecast?latitude=37.77&longitude=-122.42&hourly=precipitation_probability,precipitation&timezone=auto&forecast_days=3")
    }

    @Test func aForecastIsKeptForAnHour() async throws {
        let data = try PersonaFixture.data("open-meteo-recorded-dry.json")
        let log = FetchLog()
        let store = MemoryTriggerStore()
        let client = ForecastClient(fetch: { url in
            await log.add(url)
            return data
        })
        let cache = ForecastCache(source: client, store: store)
        let first = try await cache.forecast(at: TriggerRig.here, now: now)
        _ = try await cache.forecast(at: TriggerRig.here, now: now.addingTimeInterval(59 * 60))
        #expect(await log.urls.count == 1)
        // A relaunch reads the same store.
        _ = try await ForecastCache(source: client, store: store).forecast(at: TriggerRig.here, now: now.addingTimeInterval(30 * 60))
        #expect(await log.urls.count == 1)
        let later = try await cache.forecast(at: TriggerRig.here, now: now.addingTimeInterval(60 * 60))
        #expect(await log.urls.count == 2)
        #expect(later.fetchedAt == now.addingTimeInterval(60 * 60) && first.hours == later.hours)
        // Somewhere else is a new forecast.
        _ = try await cache.forecast(at: Coordinate(latitude: 40.71, longitude: -74.0), now: now.addingTimeInterval(61 * 60))
        #expect(await log.urls.count == 3)
    }
}
