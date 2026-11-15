import UIKit
import Capacitor

// The app's own native plugins (not npm packages) are registered here; Main.storyboard uses this class.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GoogleSignInPlugin())
    }
}
