import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen over a locked app: how much time the person has earned for it, and a button to use some.
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
        let minutes = EarnedTime.available(group)
        let title = minutes > 0 ? "\(minutes) min of \(group.noun) earned" : "Earn time with a workout"
        let rate = EarnedTime.rate(group)
        let perWorkout = Int((20 * rate).rounded())
        let subtitle = minutes > 0
            ? "Each unlock opens these apps for up to \(EarnedTime.block) minutes."
            : "A 20 minute workout earns \(perWorkout) minutes of \(group.noun)."
        return ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            icon: UIImage(systemName: "figure.run"),
            title: .init(text: title, color: .label),
            subtitle: .init(text: subtitle, color: .secondaryLabel),
            primaryButtonLabel: .init(text: minutes > 0 ? "Use \(min(minutes, EarnedTime.block)) min" : "Close", color: .white),
            primaryButtonBackgroundColor: green,
            secondaryButtonLabel: minutes > 0 ? .init(text: "Not now", color: green) : nil
        )
    }
}
