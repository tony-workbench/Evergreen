import SwiftUI

/// Rain on an outdoor workout, in Today's hero: "Rain at 8:30 tomorrow.
/// Move to 2 PM, or go indoors?" Move asks the calendar for the dry time;
/// Indoors lists up to three gyms nearby with "Open in Maps"; on a day at home
/// with the afternoon wet, "Short breaks through the day" adds a few short
/// breaks instead; Keep leaves the workout where it is. Nothing is bought and nothing has a price.
struct RainCard: View {
    let ask: RainAsk
    var now = Date()
    let onMove: () -> Void
    let onKeep: () -> Void
    /// "Short breaks through the day"; shown only when the ask has breaks to add.
    var onSnacks: (() -> Void)?
    /// Starts with the places open (the tour and screenshots).
    var showsPlaces = false

    @State private var indoors = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }

    /// How long the gyms take to open.
    private static let openSeconds = 0.2

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(RainWords.headline(ask, now: now))
                .agentFont(Theme.questionTitleSize, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            Text(RainWords.detail(ask))
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
            if indoors || showsPlaces {
                ForEach(ask.places) { place in placeRow(place) }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.sm) { buttons }
                VStack(spacing: Theme.sm) { buttons }
            }
            .padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }

    /// One gym nearby: its name, how far, and "Open in Maps".
    @ViewBuilder private func placeRow(_ place: IndoorPlace) -> some View {
        Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
        HStack(spacing: Theme.sm) {
            VStack(alignment: .leading, spacing: Theme.xxs) {
                Text(place.name).font(.body).foregroundStyle(Theme.text)
                Text("\(place.distanceText) away").font(.footnote).foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: Theme.sm)
            Button("Open in Maps") { place.mapItem.openInMaps() }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.text)
                .frame(minHeight: TapTargetButtonStyle.minSide)
                .accessibilityLabel("Open \(place.name) in Maps")
                .accessibilityIdentifier("rain.openInMaps.\(place.name)")
        }
    }

    @ViewBuilder
    private var buttons: some View {
        if ask.intent != nil, ask.dryWindow != nil {
            Button("Move", action: onMove)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityHint("Moves it to the dry time")
                .accessibilityIdentifier("rain.move")
        }
        if !ask.places.isEmpty, !indoors, !showsPlaces { indoorsButton }
        if ask.snacks != nil, let onSnacks {
            Button("Short breaks through the day", action: onSnacks)
                .buttonStyle(GhostButtonStyle())
                .accessibilityHint("Adds a few short breaks through the afternoon instead")
                .accessibilityIdentifier("rain.snacks")
        }
        Button("Keep", action: onKeep)
            .buttonStyle(GhostButtonStyle())
            .accessibilityHint("Leaves the workout where it is")
            .accessibilityIdentifier("rain.keep")
    }

    private var indoorsButton: some View {
        Button("Indoors") { withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.openSeconds)) { indoors = true } }
            .buttonStyle(GhostButtonStyle())
            .accessibilityHint("Shows gyms nearby")
            .accessibilityIdentifier("rain.indoors")
    }
}
