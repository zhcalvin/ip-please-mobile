# Android / iOS

游戏继续使用仓库根目录的 Canvas、剧本、双语翻译和合成音效。Android 使用系统 WebView，iOS 使用系统 WKWebView；没有新增游戏引擎或第三方运行库。两个客户端均从安装包读取游戏资源，禁止加载远程页面。

原生工程默认使用应用标识 `io.github.ipplease.game`，版本 `1.0.0`。首次发布时确定应用标识并配置自己的签名；发布后保持应用标识和签名一致。

## 构建环境

- 公共：Node.js 20+，无需 `npm install`。
- Android：JDK 17+、Android SDK Platform 35 / Build Tools 35.0.0；最低 Android 8.0。工程内提供 Gradle Wrapper，首次构建需要下载 Gradle / Android 构建插件，游戏本身运行不需要网络。通过 `ANDROID_HOME` 指定 SDK，或在 Android Studio 配置 SDK。
- iOS：macOS、Xcode 和相应 iOS SDK；最低 iOS 15，支持 iPhone 和 iPad。

## Android

在仓库根目录执行：

```bash
node tools/mobile.mjs android
adb install -r build/mobile/IPPlease-debug.apk
adb shell am start -n io.github.ipplease.game/.MainActivity
```

命令会同步游戏资源、编译 APK、运行 Android Lint，并将结果复制到 `build/mobile/IPPlease-debug.apk`。这是使用调试签名的安装包。

也可先执行 `node tools/mobile.mjs prepare`，再用 Android Studio 打开 `mobile/android`。每次修改根目录游戏代码后，需要重新执行同步命令再构建。

### Android 正式发布包

GitHub Releases 和个人网站可直接分发签名后的 APK。先在仓库外准备专用发布密钥，可按 [Android 官方签名文档](https://developer.android.com/studio/publish/app-signing) 在 Android Studio 中创建。

默认从 `~/.config/ip-please-mobile/android-signing.json` 读取以下配置。`keystore` 必须是绝对路径；示例值需替换成自己的密钥信息：

```json
{
  "keystore": "/absolute/path/to/release.jks",
  "storePassword": "YOUR_STORE_PASSWORD",
  "keyAlias": "ip-please-release",
  "keyPassword": "YOUR_KEY_PASSWORD"
}
```

也可用 `IP_PLEASE_SIGNING_CONFIG` 指定其他 JSON 文件。CI 可从秘密变量注入 `IP_PLEASE_KEYSTORE`、`IP_PLEASE_STORE_PASSWORD`、`IP_PLEASE_KEY_ALIAS`、`IP_PLEASE_KEY_PASSWORD`，这些环境变量优先于 JSON 中对应字段。密码只通过子进程环境传给 Gradle，不会拼接到命令参数。

```bash
node tools/mobile.mjs android-release
```

此命令同步离线资源、运行 `assembleRelease` 和 `lintRelease`，输出：

- `build/releases/IPPlease-1.0.0-android.apk`
- `build/releases/IPPlease-1.0.0-android.apk.sha256`

文件名中的版本号自动取自 Android 构建结果。APK 使用发布签名且关闭调试；缺失或不完整的签名配置会中止构建，不会退回调试签名或输出未签名包。可将 APK 和校验文件一起上传到 GitHub Releases 或自己的网站。下载后在二者所在目录执行校验：

```bash
shasum -a 256 -c IPPlease-1.0.0-android.apk.sha256
```

后续版本修改 `mobile/android/app/build.gradle` 中的 `versionName`，并递增 `versionCode`。同一应用后续升级必须使用同一发布密钥；请备份密钥和配置，并将配置、密钥文件权限设为仅自己可读。它们不得提交 Git 或随 APK 公开。发布签名和此前调试包不同，不能直接覆盖调试安装；卸载会清除本地存档，请先自行处理需要保留的进度。

## iOS

```bash
node tools/mobile.mjs ios
node tools/mobile.mjs ios-device
```

模拟器输出：`build/mobile/ios/Build/Products/Debug-iphonesimulator/IPPlease.app`。

未签名真机输出：`build/mobile/ios/Build/Products/Release-iphoneos/IPPlease.app`。它不能直接作为可安装 IPA 使用。

真机安装：先执行 `node tools/mobile.mjs prepare`，再打开 `mobile/ios/IPPlease.xcodeproj`，选择 `IPPlease` target，在 **Signing & Capabilities** 中选择自己的 Team / Bundle Identifier，选择连接的设备后运行。App Store / TestFlight 分发需要相应开发者账号及签名配置，再在 Xcode 中 Archive / Distribute。

iPhone 在首次点击后启动音效与循环背景音乐，“声音”按钮同时控制两者。前台音频使用播放会话，可在系统静音开关打开时发声；切后台会暂停，返回后先解除 WebKit 媒体暂停再恢复游戏音频。左下桌铃用于叫下一位，右下章程、X 光和检查按钮采用更大的高对比文字与点击区域。

可将模拟器 App 安装到已经启动的模拟器：

```bash
xcrun simctl install booted build/mobile/ios/Build/Products/Debug-iphonesimulator/IPPlease.app
xcrun simctl launch booted io.github.ipplease.game
```

## 游玩与存档

- 强制横屏，保留原有点按、拖证件和双语选择；画面按比例缩放并避开安全区。
- 原生客户端隐藏网页全屏按钮；系统返回键会在 Android 上提示退出。
- 切到后台时暂停游戏计时和音频，回来后继续；被系统中断的拖拽会回到原位置。
- 沿用原版的每日自动存档。后台保活期间可继续当天进度；退出或被系统终止后，从上次保存的日期重新开始当天。
- 存档和语言设置仅保存在当前 App 的设备数据中，卸载会清除，不与网页版或另一台设备同步。
- `mobile/web/` 是构建生成目录，不要手改。构建包含 MIT 和像素字体 OFL 许可。

## 验证

```bash
node --test tests/mobile*.test.mjs
node tools/check_en.js
git diff --check
```

Android 调试构建包含 `lintDebug`，发布构建包含 `lintRelease`。iOS 工程带有 `IPPleaseUITests`，可从 Xcode 运行，或指定本机模拟器：

```bash
xcodebuild -project mobile/ios/IPPlease.xcodeproj -scheme IPPlease \
  -destination 'platform=iOS Simulator,name=IPPlease-iPhone' \
  -derivedDataPath build/mobile/ios CODE_SIGNING_ALLOWED=NO test
```

## English

Run commands from the repository root. `node tools/mobile.mjs android` builds and lints the debug APK. `node tools/mobile.mjs ios` builds the simulator app; `ios-device` builds an unsigned device app. Open `mobile/android` in Android Studio or `mobile/ios/IPPlease.xcodeproj` in Xcode after running `node tools/mobile.mjs prepare`. Both native shells package the same offline game without third-party runtime dependencies. iOS device installation/distribution requires your own Apple signing configuration. Saves remain local and keep the original daily checkpoint behavior; backgrounding pauses game time and audio.

For a distributable Android APK, configure your dedicated release keystore in `~/.config/ip-please-mobile/android-signing.json` (fields: `keystore`, `storePassword`, `keyAlias`, `keyPassword`; the keystore path must be absolute), or use `IP_PLEASE_SIGNING_CONFIG` to select another JSON file. The `IP_PLEASE_KEYSTORE`, `IP_PLEASE_STORE_PASSWORD`, `IP_PLEASE_KEY_ALIAS`, and `IP_PLEASE_KEY_PASSWORD` environment variables override individual fields and support CI secrets. Keep keys and credentials outside Git and back them up securely.

Run `node tools/mobile.mjs android-release` to build and lint the signed, non-debuggable release. It fails if signing is unavailable and never falls back to a debug key. Upload `build/releases/IPPlease-<version>-android.apk` and its `.sha256` companion to GitHub Releases or your website; the filename uses the actual Android version. Increment `versionCode` and update `versionName` in `mobile/android/app/build.gradle` for future releases, keeping the same application ID and signing key. A release cannot replace the existing debug-signed app; uninstalling the debug app deletes its local saves.
