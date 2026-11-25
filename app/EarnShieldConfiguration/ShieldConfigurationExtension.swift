import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen over a locked app: the free time left today and the time earned for it, a button to use some,
/// and, once nothing is left, "Unlock for 10 minutes" once a week.
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        screen(application.token.flatMap(EarnedTime.group(app:)))
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        screen(application.token.flatMap(EarnedTime.group(app:)) ?? category.token.flatMap(EarnedTime.group(category:)))
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        screen(webDomain.token.flatMap(EarnedTime.group(web:)))
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        screen(webDomain.token.flatMap(EarnedTime.group(web:)) ?? category.token.flatMap(EarnedTime.group(category:)))
    }

    private func screen(_ group: FunGroup?) -> ShieldConfiguration {
        guard let group else { return Self.unknownGroupScreen }
        let left = TimeLeft(group)
        let words = Self.words(left, group)
        return ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            icon: UIImage(systemName: "figure.run"),
            title: .init(text: words.title, color: .label),
            subtitle: .init(text: words.subtitle, color: .secondaryLabel),
            primaryButtonLabel: .init(text: left.minutes > 0 ? "Use \(min(left.minutes, EarnedTime.block)) min" : "Close", color: .white),
            primaryButtonBackgroundColor: Self.green,
            secondaryButtonLabel: Self.secondaryButton(left)
        )
    }

    // MARK: The words

    /// Evergreen's green, as red, green and blue, for the buttons.
    private static let greenParts: (red: CGFloat, green: CGFloat, blue: CGFloat) = (0.18, 0.45, 0.32)
    private static var green: UIColor { UIColor(red: greenParts.red, green: greenParts.green, blue: greenParts.blue, alpha: 1) }
    /// An app whose group can't be told: locked, with nothing to spend.
    private static var unknownGroupScreen: ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            icon: UIImage(systemName: "figure.run"),
            title: .init(text: "Locked by Evergreen", color: .label),
            subtitle: .init(text: "Work out to earn time for it.", color: .secondaryLabel),
            primaryButtonLabel: .init(text: "Close", color: .white),
            primaryButtonBackgroundColor: green
        )
    }

    /// The title and the line under it: free time left today, else time earned, else how to earn some.
    private static func words(_ left: TimeLeft, _ group: FunGroup) -> (title: String, subtitle: String) {
        if left.base > 0 { return baseWords(left, group) }
        if left.earned > 0 {
            return ("\(left.earned) min of \(group.noun) earned",
                    "Today's free time is used. Each unlock opens these apps for up to \(EarnedTime.block) minutes.")
        }
        return emptyWords(left, group)
    }

    private static func baseWords(_ left: TimeLeft, _ group: FunGroup) -> (title: String, subtitle: String) {
        let subtitle = left.earned > 0
            ? "Then \(left.earned) min earned from workouts. Each unlock opens up to \(EarnedTime.block) minutes."
            : "Each unlock opens up to \(EarnedTime.block) minutes. A \(TimeLeft.sampleWorkoutMinutes) minute workout earns \(left.perWorkout) more."
        return ("\(left.base) min of \(group.noun) left today", subtitle)
    }

    private static func emptyWords(_ left: TimeLeft, _ group: FunGroup) -> (title: String, subtitle: String) {
        let escape = left.escape ? " Once a week you can open them for \(EarnRules.escapeMinutes) minutes." : ""
        return ("Earn time with a workout",
                "Today's free time is used. A \(TimeLeft.sampleWorkoutMinutes) minute workout earns \(left.perWorkout) minutes of \(group.noun)." + escape)
    }

    /// "Not now" while there is time to use, the weekly "Unlock for 10 minutes" once there is none, else nothing.
    private static func secondaryButton(_ left: TimeLeft) -> ShieldConfiguration.Label? {
        if left.minutes > 0 { return .init(text: "Not now", color: green) }
        return left.escape ? .init(text: "Unlock for \(EarnRules.escapeMinutes) minutes", color: green) : nil
    }
}

/// What a group has left now: today's free minutes, earned minutes, whether the weekly escape is there, and what a
/// sample workout earns.
private struct TimeLeft {
    let base: Int
    let earned: Int
    let escape: Bool
    let perWorkout: Int
    var minutes: Int { base + earned }

    /// The workout the screen counts in: "A 20 minute workout earns …".
    static let sampleWorkoutMinutes = 20

    init(_ group: FunGroup) {
        base = EarnedTime.baseLeft(group)
        earned = EarnedTime.available(group)
        escape = base + earned == 0 && EarnedTime.escapeLeft()
        let sample = Double(Self.sampleWorkoutMinutes)
        perWorkout = Int((sample * EarnedTime.rate(group)).rounded())
    }
}
