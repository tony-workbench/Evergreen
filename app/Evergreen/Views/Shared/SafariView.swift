import SafariServices
import SwiftUI

/// A web page inside the app (the store's or the gym's own page), in Safari's
/// own view: Evergreen sees nothing the person does there.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
