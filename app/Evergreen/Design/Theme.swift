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
    static let success = Color(.success)
    static let warning = Color(.warning)

    // Spacing (8pt grid)
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32

    // Radius
    static let radiusSmall: CGFloat = 8
    static let radiusButton: CGFloat = 12
    static let radiusCard: CGFloat = 20

    // Type (the agent's voice: see AgentFont)
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
