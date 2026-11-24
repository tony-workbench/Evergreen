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
        let green = UIColor(red: 0.18, green: 0.45, blue: 0.32, alpha: 1)
        guard let group else {
            return ShieldConfiguration(
                backgroundBlurStyle: .systemMaterial,
                icon: UIImage(systemName: "figure.run"),
                title: .init(text: "Locked by Evergreen", color: .label),
                subtitle: .init(text: "Work out to earn time for it.", color: .secondaryLabel),
                primaryButtonLabel: .init(text: "Close", color: .white),
                primaryButtonBackgroundColor: green
            )
        }
        let base = EarnedTime.baseLeft(group)
        let earned = EarnedTime.available(group)
        let minutes = base + earned
        let escape = minutes == 0 && EarnedTime.escapeLeft()
        let perWorkout = Int((20 * EarnedTime.rate(group)).rounded())
        let title: String
        let subtitle: String
        if base > 0 {
            title = "\(base) min of \(group.noun) left today"
            subtitle = earned > 0
                ? "Then \(earned) min earned from workouts. Each unlock opens up to \(EarnedTime.block) minutes."
                : "Each unlock opens up to \(EarnedTime.block) minutes. A 20 minute workout earns \(perWorkout) more."
        } else if earned > 0 {
            title = "\(earned) min of \(group.noun) earned"
            subtitle = "Today's free time is used. Each unlock opens these apps for up to \(EarnedTime.block) minutes."
        } else {
            title = "Earn time with a workout"
            subtitle = "Today's free time is used. A 20 minute workout earns \(perWorkout) minutes of \(group.noun)."
                + (escape ? " Once a week you can open them for \(EarnRules.escapeMinutes) minutes." : "")
        }
        let secondary: ShieldConfiguration.Label? = minutes > 0 ? .init(text: "Not now", color: green)
            : escape ? .init(text: "Unlock for \(EarnRules.escapeMinutes) minutes", color: green) : nil
        return ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            icon: UIImage(systemName: "figure.run"),
            title: .init(text: title, color: .label),
            subtitle: .init(text: subtitle, color: .secondaryLabel),
            primaryButtonLabel: .init(text: minutes > 0 ? "Use \(min(minutes, EarnedTime.block)) min" : "Close", color: .white),
            primaryButtonBackgroundColor: green,
            secondaryButtonLabel: secondary
        )
    }
}
