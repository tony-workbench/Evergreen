import ManagedSettings

/// The buttons on the locked-app screen: use earned minutes, or leave.
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

    /// The primary button uses minutes when there are some to use (it says "Close" otherwise).
    private func respond(_ action: ShieldAction, _ group: FunGroup?) -> ShieldActionResponse {
        guard action == .primaryButtonPressed, let group, EarnedTime.available(group) > 0 else { return .close }
        // `.defer` redraws the screen, which is gone once the group is open.
        return EarnedTime.unlock(group) == nil ? .close : .defer
    }
}
