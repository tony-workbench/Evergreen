import SwiftUI

/// One basis of a suggestion as a chip: a small source icon (heart for
/// Health, calendar for the calendar) and the fact in a few words.
struct BasisChip: View {
    let basis: Basis

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: basis.source.symbol)
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.accent)
                .accessibilityHidden(true)
            Text(basis.text)
                .font(.footnote)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .overlay { RoundedRectangle(cornerRadius: Theme.radiusSmall).stroke(Theme.rule, lineWidth: 1) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(basis.text). \(basis.source.spoken)")
    }
}
