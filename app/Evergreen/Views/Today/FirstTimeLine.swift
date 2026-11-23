import SwiftUI

/// One muted line under a card the first time its kind really happens
/// ("That's the first workout I've moved for you."), so the tour connects
/// to real life. Shown once: it is marked when it leaves the screen.
struct FirstTimeLine: View {
    let kind: FirstTimeKind

    @Environment(AppModel.self) private var model

    var body: some View {
        if let line = model.triggers.firstTimeLine(kind) {
            Text(line)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .onDisappear { model.triggers.markFirstTimeShown(kind) }
        }
    }
}
