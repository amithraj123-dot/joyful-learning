# Aeka for Android

Aeka Advisors India LLP · version 0.9.0 · package `in.aeka.workspace`

The Android app reads message notifications from WhatsApp, WhatsApp Business, LinkedIn, Gmail, SMS,
Microsoft Teams and Slack, sends them to the Aeka workspace for triage, and shows the workspace's
nudges ("Reply to Rahul Mehta, waiting 2 hours") as phone notifications. The workspace's own screens
open inside the app. A reply drafted in the workspace is sent only when you tap Send, through the
app's own notification Reply action while that notification is still on the phone; otherwise Aeka
opens the chat for you.

The contract between the phone and the workspace is `docs/ANDROID-PROTOCOL.md`.

## Project layout

| Path             | What it is                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`          | Plain Kotlin/JVM logic with unit tests: app ids, notification-to-message extraction, filters, chat keys, message ids, JSON, retry rules       |
| `app/`           | The Android app: notification reader, queue, sync client, nudges, WebView and the `window.AekaAndroid` bridge. No AndroidX or other libraries |
| `compile-check/` | Compiles the app's sources against the Android 15 framework jar (`android-all`) without the Android SDK                                       |
| `keystore/`      | The development signing key for debug builds (see "Signing")                                                                                  |

## Building

The APK is built by GitHub Actions (workflow "Aeka Workspace", job "Android app (tests and APK)") on
every push that touches `aeka-workspace/`. The job runs the core tests, builds the debug APK, runs
Android lint and uploads:

- `aeka-android-debug`: the debug APK, signed with the development key;
- `aeka-android-reports`: test and lint reports;
- `aeka-android-release`: a signed release APK, only when the release signing secrets are set.

On a machine with the Android SDK (Android Studio, or `ANDROID_HOME` set) and JDK 17 or later:

```sh
cd aeka-workspace/android
./gradlew :core:test :app:assembleDebug :app:lintDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Without the Android SDK, two checks still run:

```sh
gradle -PcoreOnly :core:test          # the core unit tests
gradle -p compile-check compileKotlin # the app's sources against android-all, warnings as errors
```

`-PcoreOnly` leaves the app module out, so the Android Gradle Plugin is not needed. To point a build
at another deployment of the workspace, add `-Paeka.workspaceOrigin=https://...` (an https origin).

## Installing (sideloading)

1. Open the latest successful run of the workflow in GitHub Actions and download the
   `aeka-android-debug` artefact. It is a ZIP file containing `app-debug.apk`.
2. Copy the APK to the phone (or download the artefact on the phone) and open it. Android asks once
   to allow installs from that source (Files, Chrome or Drive): allow it, then install.
3. With a USB cable and developer options on, `adb install -r app-debug.apk` does the same.

Later builds install over earlier ones and keep the sign-in, the pairing and the settings, because
every debug build is signed with the same development key. A release build is signed with a
different key, so moving from debug to release (or back) needs an uninstall first.

## Setting up on the phone

The workspace page explains each step and shows what is still missing; the app does no setup of its
own.

1. Open Aeka and sign in to the workspace.
2. In the workspace, Chats, Phone app: "Connect this phone". The app pairs itself.
3. Allow notification access for "Aeka message reader".
4. Allow notifications (for nudges) and set battery use to "Unrestricted".
5. In WhatsApp, keep notification previews on: Settings, Notifications, "Show preview". Without
   previews there is nothing to read, and the workspace says so.

### Restricted settings (Android 13 and later)

Android blocks notification access for apps installed from outside the Play Store until you allow
"restricted settings". If the notification access switch for Aeka is greyed out, or a "Restricted
setting" box appears:

1. Open Settings, Apps, Aeka (or, in the workspace, the button that opens "App info").
2. Tap the three-dot menu at the top right, then "Allow restricted settings", and confirm with your
   PIN or fingerprint.
3. Go back and switch notification access on.

On some phones the menu item appears only after you have tried to switch notification access on
once.

### Battery and background limits

The reader runs only while Android keeps Aeka's notification access connected. Battery savers on
several phones disconnect it after a while, and messages are then missed until Aeka is opened.

- **All phones:** Settings, Apps, Aeka, Battery: "Unrestricted" (the workspace button opens this
  request directly).
- **Xiaomi, Redmi and POCO (HyperOS, MIUI):** Settings, Apps, Manage apps, Aeka: switch "Autostart"
  on and set "Battery saver" to "No restrictions". In the recent apps screen, long-press Aeka and
  tap the lock.
- **Samsung (One UI):** Settings, Battery, Background usage limits: make sure Aeka is not in
  "Sleeping apps" or "Deep sleeping apps", and add it to "Never sleeping apps". Also set Apps, Aeka,
  Battery to "Unrestricted".
- **OnePlus, OPPO and realme (OxygenOS, ColorOS):** Settings, Apps, Aeka, Battery usage: switch on
  "Allow background activity" and "Allow auto launch". Under Battery, Advanced settings, switch off
  "Optimise battery use" for Aeka if it is listed.
- **vivo and iQOO:** Settings, Battery, Background power consumption management: Aeka, "Allow".

## Troubleshooting

- **Nothing reaches the workspace.** In the workspace, check that notification access shows as on.
  If it does and still nothing arrives, switch notification access off and on again (Settings,
  Notifications, Device and app notifications, or "Notification access"). Check the battery
  settings above.
- **WhatsApp shows "previews hidden".** Switch on "Show preview" in WhatsApp's notification
  settings. Muted chats post no notifications, so Aeka cannot see them.
- **"Send" says the chat is no longer live.** The WhatsApp notification for that chat has gone (it
  was opened, read on another device or swiped away), so there is no Reply action to use. Use "Open
  chat" instead and send the reply in WhatsApp.
- **"Connect this phone again".** The phone was disconnected in the workspace. Its queue and token
  have been deleted; ask the workspace for a new pairing code.
- **The workspace does not load.** Aeka shows a "Try again" screen when the phone is offline.
  Messages are still read and queued, and are sent when the phone is back online.

## Privacy

- Only the seven apps above are read, and only those switched on in the workspace. Outlook is not
  read (Aeka Mail reads the mailbox).
- Before anything leaves the phone, Aeka drops one-time passwords and verification codes, calls in
  progress, group summaries, ongoing notifications and the apps' own status notices.
- Message text is kept only in a private queue on the phone (`databases/queue.db`) until the
  workspace confirms receipt, and is never written to the system log.
- The device token is stored in the app's private storage, encrypted with a key held in the Android
  Keystore. It is never passed to the web page.
- Backup and device-to-device transfer are switched off, so the queue and token do not move to
  another phone.
- Aeka asks for no SMS, contacts or accessibility permission. It reads what the notifications show,
  nothing more.
- Notification Reply actions are used only when you tap Send in the workspace. No other action
  (such as "Mark as read") is ever triggered.
- Unpairing, or a disconnection in the workspace, deletes the token and everything queued.

## Signing

`keystore/aeka-debug.keystore` is a **development key**, checked in on purpose so that every debug
build, from CI or any machine, has the same signature and installs over the previous one. It is not
secret and must never be used to sign a release.

| Item                | Value                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Store and key type  | PKCS12, RSA 2048                                                                                  |
| Alias               | `androiddebugkey`                                                                                 |
| Passwords           | `android` (store and key)                                                                         |
| Certificate         | CN=Aeka Android Development (not for release), O=Aeka Advisors India LLP, C=IN; valid to 2056     |
| SHA-256 fingerprint | `A4:D7:29:FD:D5:7D:1E:1B:C1:DB:92:5F:02:2D:B7:EB:7F:55:99:EB:8E:7E:25:52:DA:E9:DE:DB:06:42:03:51` |

For release builds, add these repository secrets; when they are absent the release step is skipped:

| Secret                           | Content                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `AEKA_ANDROID_KEYSTORE`          | The release keystore, base64 encoded                           |
| `AEKA_ANDROID_KEYSTORE_PASSWORD` | The keystore password                                          |
| `AEKA_ANDROID_KEY_ALIAS`         | The key alias                                                  |
| `AEKA_ANDROID_KEY_PASSWORD`      | The key password (optional; defaults to the keystore password) |

To create a release key: `keytool -genkeypair -keystore aeka-release.keystore -alias aeka -keyalg RSA
-keysize 4096 -validity 10950`, then `base64 -w0 aeka-release.keystore` for the secret. Keep the
keystore and its password safe: updates to a release build must be signed with the same key.
