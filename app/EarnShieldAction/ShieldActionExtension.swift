import ManagedSettings

/// The buttons on the locked-app screen: use free or earned minutes, the weekly escape, or leave.
final class ShieldActionExtension: ShieldActionDelegate {
    override func handle(action: ShieldAction, for application: ApplicationToken,
                         completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action, EarnedTime.group(lockedApp: application)))
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken,
                         completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action, EarnedTime.group(web: webDomain)))
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken,
                         completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action, EarnedTime.group(category: category)))
    }

    /// The primary button uses minutes when there are some to use, today's free time first (it says "Close" otherwise).
    /// With nothing left, the second button is the weekly "Unlock for 10 minutes".
    private func respond(_ action: ShieldAction, _ group: FunGroup?) -> ShieldActionResponse {
        guard let group else { return .close }
        let usable = EarnedTime.usable(group)
        switch action {
        case .primaryButtonPressed where usable > 0:
            // `.defer` redraws the screen, which is gone once the group is open.
            return EarnedTime.unlock(group) == nil ? .close : .defer
        case .secondaryButtonPressed where usable == 0 && EarnedTime.escapeLeft():
            return EarnedTime.escape(group) == nil ? .close : .defer
        default:
            return .close
        }
    }
}
