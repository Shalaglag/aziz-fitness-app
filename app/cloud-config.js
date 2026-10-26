/* Firebase web config for the app's own website (see modules/cloud-store/README.md).
 * These values identify the Firebase project; they are not secrets. Access is limited by the
 * Firestore rules in firestore.rules (each signed-in person reads and writes only their own data).
 * Left empty, the app runs without sign-in and saves on the device only. */
window.FITNESS_CLOUD_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};
