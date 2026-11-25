import SwiftUI

/// On "What I remember" before there is anything to remember: what will
/// show up here once there are two weeks of workouts, so the sheet says
/// what it is for.
struct MemoryComingSection: View {
    private static let lines = [
        "The days and times you usually train",
        "How much you do in a normal week",
        "How you sleep and recover",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What will show up here")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            Rectangle().fill(Theme.rule).frame(height: 1)
            ForEach(Self.lines, id: \.self) { line in
                Text(line)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            Text("Worked out on this phone from Apple Health. You can stop or forget any line.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.sm)
        }
    }
}
