import AppKit
let W = 854, H = 480
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let sh = NSShadow(); sh.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.5); sh.shadowBlurRadius = 8; sh.shadowOffset = NSSize(width: 0, height: -2)
let p = NSMutableParagraphStyle(); p.alignment = .center
func draw(_ s: String, _ size: CGFloat, _ weight: NSFont.Weight, _ y: CGFloat) {
  let a: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: NSColor.white, .shadow: sh, .paragraphStyle: p]
  NSAttributedString(string: s, attributes: a).draw(in: NSRect(x: 566, y: y, width: 270, height: size * 1.4))
}
draw("Evergreen", 40, .semibold, 250)
draw("It finds the time.", 19, .regular, 220)
NSGraphicsContext.current?.flushGraphics()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "title3.png"))
