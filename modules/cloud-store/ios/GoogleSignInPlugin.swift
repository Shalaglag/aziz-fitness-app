// Sign in with Google on iPhone (modules/cloud-store/ios/GoogleSignInPlugin.swift; copied into ios/App/App/,
// a test checks the copies match). Same JS interface as the Android plugin (GoogleSignInPlugin.kt):
//   GoogleSignIn.signIn({ clientId }) -> { idToken }   errors: "cancelled", "not-set-up", "failed"
// clientId is the iOS OAuth client ID (FITNESS_CLOUD_CONFIG.googleIosClientId). No Google SDK: Apple's
// ASWebAuthenticationSession shows Google's own sign-in page, then the code is swapped for an ID token with
// PKCE (iOS OAuth clients have no secret). The ID token signs the same Firebase account in (cloud-store.js).
import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit

@objc(GoogleSignInPlugin)
public class GoogleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "GoogleSignInPlugin"
    public let jsName = "GoogleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]
    private var session: ASWebAuthenticationSession?
    private let suffix = ".apps.googleusercontent.com"

    @objc func signIn(_ call: CAPPluginCall) {
        let clientId = (call.getString("clientId") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard clientId.hasSuffix(suffix), clientId.count > suffix.count else {
            call.reject("No iOS client ID for Google sign-in", "not-set-up")
            return
        }
        let scheme = "com.googleusercontent.apps." + String(clientId.dropLast(suffix.count))
        let redirect = scheme + ":/oauth2redirect"
        let verifier = randomString(64)
        let state = randomString(24)
        var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        c.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge(verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "prompt", value: "select_account")
        ]
        guard let url = c.url else { call.reject("Bad sign-in address", "failed"); return }

        DispatchQueue.main.async {
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.session = nil
                if let err = error as? ASWebAuthenticationSessionError, err.code == .canceledLogin {
                    call.reject("Sign-in cancelled", "cancelled"); return
                }
                guard error == nil, let callback = callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems else {
                    call.reject(error?.localizedDescription ?? "Google sign-in failed", "failed"); return
                }
                let value = { (n: String) in items.first(where: { $0.name == n })?.value }
                if value("error") == "access_denied" { call.reject("Sign-in cancelled", "cancelled"); return }
                guard value("state") == state, let code = value("code") else {
                    call.reject("Google sign-in failed", "failed"); return
                }
                self?.exchange(code: code, clientId: clientId, redirect: redirect, verifier: verifier, call: call)
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            if !s.start() { self.session = nil; call.reject("Couldn't open Google sign-in", "failed") }
        }
    }

    private func exchange(code: String, clientId: String, redirect: String, verifier: String, call: CAPPluginCall) {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let form = ["code": code, "client_id": clientId, "redirect_uri": redirect,
                    "grant_type": "authorization_code", "code_verifier": verifier]
        req.httpBody = form.map { "\($0.key)=\(encode($0.value))" }.joined(separator: "&").data(using: .utf8)
        URLSession.shared.dataTask(with: req) { data, _, error in
            guard error == nil, let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let idToken = json["id_token"] as? String else {
                call.reject(error?.localizedDescription ?? "Google didn't return a sign-in token", "failed"); return
            }
            call.resolve(["idToken": idToken])
        }.resume()
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    private func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return String(bytes.map { chars[Int($0) % chars.count] })
    }
    private func challenge(_ verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    private func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}
