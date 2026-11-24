import SwiftUI

/// Under the hero, once the person has rules: "I'm going out today", or, on a
/// day out, what that means with a way back. A rest weekday shows nothing.
struct GoingOutRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.userRules.isOn, model.dayKinds[model.todayISO] != .rest {
            HStack(alignment: .firstTextBaseline) {
                if model.isGoingOutToday {
                    Text("Today is a day out, so there’s no workout and no reminder.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.sm)
                    Button("I’m home") { Task { await model.setGoingOut(false) } }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.text)
                        .frame(minWidth: 44, minHeight: 44)
                } else {
                    Button("I’m going out today") { Task { await model.setGoingOut(true) } }
                        .font(.body)
                        .foregroundStyle(Theme.accent)
                        .frame(minHeight: 44)
                    Spacer()
                }
            }
        }
    }
}
