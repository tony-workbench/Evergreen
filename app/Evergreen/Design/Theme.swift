import CoreText
import SwiftUI

/// Tokens from DESIGN.md. The accent and the agent typeface belong to agent
/// actions only; everything else is neutral SF Pro with Dynamic Type. Colors
/// live in Assets.xcassets with their light and dark values.
enum Theme {
    // Colors
    static let surface = Color(.surface)
    static let card = Color(.card)
    static let text = Color(.text)
    static let textMuted = Color(.textMuted)
    static let accent = Color(.accent)
    static let onAccent = Color(.onAccent)
    static let rule = Color(.rule)
    /// The outline of a secondary button: at least 3:1 against the surface and cards, light and dark (6.1:1 and 7.5:1),
    /// where `rule` (about 1.2:1) is only for lines between rows.
    static let controlBorder = Color(.textMuted)
    static let borderWidth: CGFloat = 1
    static let success = Color(.success)
    static let warning = Color(.warning)

    // Spacing (8pt grid)
    /// Between a title and its line under it.
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32

    // Rows
    /// A line only read, never tapped (an activity line in Settings › Status).
    static let readRowHeight: CGFloat = 32
    /// A summary line inside a block that takes the tap as a whole (Settings › My rules), so shorter than a tap target.
    static let summaryRowHeight: CGFloat = 36

    // Radius
    static let radiusSmall: CGFloat = 8
    static let radiusButton: CGFloat = 12
    static let radiusCard: CGFloat = 20

    // Type (the agent's voice: see AgentFont)
    /// A page's own title in the agent's voice (scaled with Dynamic Type from the title style).
    static let pageTitleSize: CGFloat = 30
    /// Today's statement and the other heroes at Large Title size (scaled from the large title style).
    static let heroTitleSize: CGFloat = 34
    /// An agent card's headline (DESIGN.md: 24pt).
    static let cardTitleSize: CGFloat = 24
    /// A hero card's question ("Rain at 7 tomorrow…") and other two-line headlines.
    static let questionTitleSize: CGFloat = 22
    /// The tour's caption under each scene.
    static let captionTitleSize: CGFloat = 28
    /// A number read from across the room, like the rest countdown (scaled from the large title style).
    static let bigNumberSize: CGFloat = 64
    /// The one large number a screen states, like the minutes earned or a short break's time left (scaled from the
    /// large title style).
    static let statementSize: CGFloat = 56

    // Pressed
    /// A plain or outlined button dims to this while pressed; a filled one to `pressedFilledOpacity`.
    static let pressedOpacity: Double = 0.6
    static let pressedFilledOpacity: Double = 0.8
    static let agentFontName = "GeneralSans-Semibold"

    /// Whether General Sans is in the app. Read after `registerFonts()` runs at
    /// launch; until the font file is added, the agent's voice uses SF Pro Semibold.
    static let hasAgentFont: Bool = {
        let font = CTFontCreateWithName(agentFontName as CFString, 12, nil)
        return CTFontCopyPostScriptName(font) as String == agentFontName
    }()

    /// Registers any font files bundled in the app (drop GeneralSans-Semibold.otf
    /// into app/Evergreen/Resources/Fonts), so no Info.plist entry is needed.
    static func registerFonts() {
        let urls = ["otf", "ttf"].flatMap { Bundle.main.urls(forResourcesWithExtension: $0, subdirectory: nil) ?? [] }
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
