/* Firebase web config for the app's own website (see modules/cloud-store/README.md).
 * These values identify the Firebase project; they are not secrets. Access is limited by the
 * Firestore rules in firestore.rules (each signed-in person reads and writes only their own data).
 * Firebase project: aziz-fitness (Spark plan). Empty values = no sign-in, device-only storage. */
window.FITNESS_CLOUD_CONFIG = {
  apiKey: "AIzaSyB1xvB49LW6gyXM1U7Q1NIO3cKYDkNO_a8",
  authDomain: "aziz-fitness.firebaseapp.com",
  projectId: "aziz-fitness",
  appId: "1:323272267870:web:ff4fd558a826bd36d6fccf",
  // "Continue with Google" in the Android app: the Web client ID shown under Firebase console → Authentication →
  // Sign-in method → Google → Web SDK configuration (…apps.googleusercontent.com). Empty = the Google button
  // says it isn't switched on yet; email sign-in keeps working. Not a secret (docs/GOOGLE-SIGN-IN.md).
  googleClientId: "323272267870-3msmnmomuj6l9k89kkegq4vu2qv7ev70.apps.googleusercontent.com"
};
