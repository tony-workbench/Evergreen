import Foundation

/// The one closed list of activities every agent and the app share. The
/// names shown to the person are made here and nowhere else.
enum ActivityKind: String, Codable, CaseIterable, Sendable {
    case run
    case longRun = "long_run"
    case walk, strength, yoga, ride, swim, stretch, rest, elliptical
    /// Something outside the list; its name is in the memory row's `data.label`.
    case other

    /// The name on screen.
    var displayName: String {
        switch self {
        case .run: "Run"
        case .longRun: "Long run"
        case .walk: "Walk"
        case .strength: "Strength"
        case .yoga: "Yoga"
        case .ride: "Ride"
        case .swim: "Swim"
        case .stretch: "Stretch"
        case .rest: "Rest day"
        case .elliptical: "Elliptical"
        case .other: "Workout"
        }
    }

    /// The activity of an Apple Health workout type ("Running"), as in `contract/src/adapt.mjs`; `other` when the list has none for it.
    init(healthType: String) {
        let type = healthType.lowercased()
        switch type {
        case "running": self = .run
        case "walking", "hiking": self = .walk
        case "yoga", "pilates": self = .yoga
        case "cycling": self = .ride
        case "swimming": self = .swim
        case "elliptical": self = .elliptical
        case "rest": self = .rest
        case "flexibility", "cooldown", "preparationandrecovery": self = .stretch
        default:
            self = type.hasSuffix("strengthtraining") ? .strength : .other
        }
    }

    /// The Apple Health workout type the app's plan and calendar use for it.
    var healthType: String {
        switch self {
        case .run, .longRun: "Running"
        case .walk: "Walking"
        case .strength: "TraditionalStrengthTraining"
        case .yoga: "Yoga"
        case .ride: "Cycling"
        case .swim: "Swimming"
        case .stretch: "Flexibility"
        case .elliptical: "Elliptical"
        case .rest: "Rest"
        case .other: "Other"
        }
    }

    /// What Health records it as: a long run is recorded as a run.
    var recordedAs: ActivityKind { self == .longRun ? .run : self }
}
