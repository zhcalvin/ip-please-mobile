<p align="center">
  <img src="media/logo.png" width="160" alt="Game emblem">
</p>

<h1 align="center">IP, PLEASE Mobile</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b><br>
  Android / iOS / WeChat Mini Game · Offline play · Landscape touch controls
</p>

A mobile port of the open-source game **[IP, PLEASE](https://github.com/ip-please/ip-please.github.io)**. The original game, story, pixel art, music and sound effects come from the upstream project. This repository adds native Android / iOS projects, a WeChat Mini Game, mobile adaptations and build tools.

- **This mobile port**: [zhcalvin/ip-please-mobile](https://github.com/zhcalvin/ip-please-mobile)
- **Release page**: [GitHub Releases](https://github.com/zhcalvin/ip-please-mobile/releases)
- **Play online**: [IP, PLEASE in your browser](https://momoyu.ltd/play/ip-please/)
- **More games**: [Momoyu arcade](https://momoyu.ltd/) — including Mario, The Simpsons and GTA.
- **Original source**: [ip-please/ip-please.github.io](https://github.com/ip-please/ip-please.github.io)
- **Original browser game**: [ip-please.github.io](https://ip-please.github.io)
- **Original copyright holder**: ctnyanya, credited in [LICENSE](LICENSE)

## Gameplay preview

<p align="center">
  <img src="media/gameplay-en.gif" width="960" alt="Day 2 gameplay from the original game: inspect documents, test a traveler and stamp their papers">
  <br>
  <sub>Day 2 gameplay · Animation from the original project</sub>
</p>

## Screenshots

These five screenshots were captured on a Huawei DBY-W09 Android tablet on October 21, 2026, while running this mobile port.

<p align="center">
  <img src="media/screenshots/android-tablet-01.jpg" width="960" alt="IP, PLEASE title screen on an Android tablet">
  <br>
  <sub>Title screen</sub>
</p>

| Daily newspaper | Border checkpoint |
|:---:|:---:|
| ![Daily newspaper announcing the border opening](media/screenshots/android-tablet-02.jpg) | ![Calling and greeting the first traveler](media/screenshots/android-tablet-03.jpg) |
| **Rules and document inspection** | **Stamp controls** |
| ![Checking the entry rules against a device entry card](media/screenshots/android-tablet-04.jpg) | ![Opening the stamp tray to approve or deny entry](media/screenshots/android-tablet-05.jpg) |

Original, unedited images are included in [`media/screenshots/`](media/screenshots/).

## Game and mobile features

Play as Claude, an inspector at the Ministry of Alignment's UTC+8 checkpoint. Compare IP addresses, timezones, languages and documents to uncover disguised travelers.

- The original six-day story, two endings and roughly 30-minute playthrough.
- Simplified Chinese and English, selected at startup.
- Call a traveler → drag documents onto the desk → inspect → stamp → return documents.
- Native Android WebView and iOS WKWebView shells sharing the same game code, without third-party runtime libraries.
- Bundled game assets for offline play, landscape touch controls, proportional scaling and safe-area layout.
- Game time and audio pause while the app is in the background.
- Original daily save checkpoints remain local to the device. After exiting or being terminated, the current day restarts from the last saved checkpoint.

## Build and install

Common requirement: Node.js 20+. No `npm install` needed. See the [mobile build guide](mobile/README.md) for full setup and signing instructions.

### Android

Requires JDK 17+, Android SDK Platform 35 and Build Tools 35.0.0. Supports Android 8.0+.

```bash
node tools/mobile.mjs android          # Debug APK and Android Lint
node tools/mobile.mjs android-release  # Signed release APK and Android Lint
```

- Debug APK: `build/mobile/IPPlease-debug.apk`.
- Release APK: `build/releases/IPPlease-1.0.0-android.apk`, with a `.sha256` checksum file.
- Release builds require your own signing configuration; keys and passwords are excluded from the open-source repository.
- Upload the signed APK and checksum to GitHub Releases or your own website for distribution.

Install the debug APK:

```bash
adb install -r build/mobile/IPPlease-debug.apk
adb shell am start -n io.github.ipplease.game/.MainActivity
```

### iOS

Requires macOS and Xcode. Supports iOS 15+, with iPhone and iPad projects.

```bash
node tools/mobile.mjs ios          # Simulator app
node tools/mobile.mjs ios-device   # Unsigned device app
```

Open `mobile/ios/IPPlease.xcodeproj` and configure your Apple development team and signing to install on a device or distribute through TestFlight / the App Store.

### WeChat Mini Game: 揪起你的盖头来

The independent [`wechat/`](wechat/README.md) project uses native WeChat Canvas and includes a national leaderboard, optional daily-report sharing, and an official Game Club entry. Advertising is currently disabled.

```bash
node wechat/tools/build.mjs
```

Import `wechat/minigame/` into WeChat DevTools as a **Mini Game**, using AppID `wx2484d6db995ed6b2`. Add `https://api.momoyu.ltd` to the Mini Game's allowed request domains and verify the Game Club entry on a physical WeChat device. Generated files are excluded from Git, so build before importing. See the [WeChat guide](wechat/README.md) for ranking rules, deployment and release checks.

### Browser

The root directory remains a standalone static game. Open `index.html` directly to play offline, or serve it locally:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Files

| Path | Contents |
|---|---|
| `mobile/android/` | Native Android project and Gradle Wrapper |
| `mobile/ios/` | Native iOS project, shared scheme and UI smoke test |
| `mobile/README.md` | Build environment, signing, installation and save behavior |
| `wechat/` | WeChat Mini Game client, national leaderboard and isolated deployment configuration |
| `tools/mobile.mjs` | Offline asset staging, native builds and Android release packaging |
| `tests/` | Regression tests for mobile input, lifecycle and build behavior |
| `index.html` / `main.js` | Page, input, scene switching and main loop |
| `booth.js` / `docs.js` | Checkpoint, documents, stamps and inspection tools |
| `events.js` / `screens.js` | Events, intro, newspaper, summary, saves and endings |
| `data.js` / `i18n.js` / `en.js` | Story, language selection and English translation |
| `gfx.js` / `sfx.js` / `assets.js` | Pixel drawing, synthesized audio and generated assets |
| `media/screenshots/` | Android tablet screenshots |
| `tools/pp/` / `tools/assets/` | Upstream asset-generation tools and pixel fonts |

`mobile/web/`, `build/` and native build outputs are generated files and excluded from Git.

## Development and validation

```bash
node --test tests/*.test.mjs
node tools/check_en.js
```

Validation includes core gameplay on an Android emulator, installation and launch on a Huawei tablet, iOS simulator smoke tests, and an unsigned iOS device build. Physical iOS installation has not been tested.

### Editing and rebuilding assets

After changing game text or pixel assets, use the upstream tools to regenerate assets and glyphs:

```bash
pip install -r tools/requirements.txt
python3 tools/build_assets.py
```

Keep matching Chinese keys in `en.js` updated. `tools/mobile.mjs` stages the root game files before each native build so there is only one game implementation to maintain.

## Credits and license

- Based on [IP, PLEASE](https://github.com/ip-please/ip-please.github.io) by ctnyanya. The original copyright notice is preserved, with the scope of the mobile port described above.
- The original game pays tribute to Lucas Pope's *Papers, Please*. Art, music and sound effects are generated by code. Its fictional satire concerns region-based blocking and disguises, not any ethnicity or group.
- Code is released under the [MIT License](LICENSE).
- [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) uses the [SIL Open Font License 1.1](OFL-fusion-pixel.txt).
- For the original game's mod and contribution guidelines, see its [CONTRIBUTING.md](https://github.com/ip-please/ip-please.github.io/blob/main/CONTRIBUTING.md#english).
