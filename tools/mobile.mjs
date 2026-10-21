#!/usr/bin/env node
// Native shells share this generated copy of the standalone game. No npm packages required.
import { copyFile, mkdir, readFile, rm, access, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const webDirectory = join(root, 'mobile', 'web');

const signingFields = {
  keystore: 'IP_PLEASE_KEYSTORE',
  storePassword: 'IP_PLEASE_STORE_PASSWORD',
  keyAlias: 'IP_PLEASE_KEY_ALIAS',
  keyPassword: 'IP_PLEASE_KEY_PASSWORD',
};

export async function androidSigningEnvironment(env = process.env, home = homedir()) {
  const configPath = env.IP_PLEASE_SIGNING_CONFIG || join(home, '.config/ip-please-mobile/android-signing.json');
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || env.IP_PLEASE_SIGNING_CONFIG) {
      throw new Error('Cannot read Android signing configuration. Supply a readable JSON object using IP_PLEASE_SIGNING_CONFIG.');
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Android signing configuration must be a JSON object.');
  }
  const signing = Object.fromEntries(Object.entries(signingFields).map(([field, name]) => [name, env[name] ?? config[field]]));
  const missing = Object.entries(signing).filter(([, value]) => typeof value !== 'string' || !value.length).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Release signing is incomplete. Configure ~/.config/ip-please-mobile/android-signing.json or set: ${missing.join(', ')}. No unsigned or debug-signed release will be produced.`);
  }
  if (!isAbsolute(signing.IP_PLEASE_KEYSTORE)) throw new Error('IP_PLEASE_KEYSTORE must be an absolute path.');
  if (signing.IP_PLEASE_KEY_ALIAS.toLowerCase() === 'androiddebugkey') throw new Error('The Android debug key cannot sign a release. Supply a dedicated release key.');
  try {
    if (!(await stat(signing.IP_PLEASE_KEYSTORE)).isFile()) throw new Error('Not a file');
    await access(signing.IP_PLEASE_KEYSTORE, constants.R_OK);
  } catch {
    throw new Error('The Android release keystore must be a readable file.');
  }
  // Passwords reach Gradle only through its environment, never command arguments or logs.
  return { ...env, ...signing };
}

export async function archiveAndroidRelease(
  apkDirectory = join(root, 'mobile/android/app/build/outputs/apk/release'),
  output = join(root, 'build/releases'),
) {
  const metadata = JSON.parse(await readFile(join(apkDirectory, 'output-metadata.json'), 'utf8'));
  const [apk] = Array.isArray(metadata.elements) ? metadata.elements : [];
  if (metadata.variantName !== 'release' || metadata.artifactType?.type !== 'APK' || !Array.isArray(metadata.elements) || metadata.elements.length !== 1 ||
      !apk || apk.type !== 'SINGLE' || typeof apk.versionName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(apk.versionName) ||
      typeof apk.outputFile !== 'string' || basename(apk.outputFile) !== apk.outputFile ||
      !apk.outputFile.endsWith('.apk') || /unsigned|debug/i.test(apk.outputFile)) {
    throw new Error('Expected one signed release APK with a safe versionName in Android output metadata.');
  }
  const name = `IPPlease-${apk.versionName}-android.apk`;
  const data = await readFile(join(apkDirectory, apk.outputFile));
  const checksum = createHash('sha256').update(data).digest('hex');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, name), data);
  await writeFile(join(output, `${name}.sha256`), `${checksum}  ${name}\n`);
  return { apk: join(output, name), checksum: join(output, `${name}.sha256`) };
}

export async function webFiles() {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  if (!scripts.length || scripts.some((name) => !/^[\w-]+\.js$/.test(name))) {
    throw new Error('Mobile builds require local JavaScript files in index.html.');
  }
  return ['index.html', ...new Set(scripts), 'LICENSE', 'OFL-fusion-pixel.txt'];
}

export async function prepareWeb() {
  const files = await webFiles();
  // Fail before replacing a valid bundle if a source asset is missing.
  await Promise.all(files.map((name) => access(join(root, name))));
  await rm(webDirectory, { recursive: true, force: true });
  await mkdir(webDirectory, { recursive: true });
  await Promise.all(files.map((name) => copyFile(join(root, name), join(webDirectory, name))));
  return files;
}

function run(command, args, cwd, env = process.env) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => code === 0 ? ok() : fail(new Error(`${command} failed (${signal || code}).`)));
  });
}

async function androidEnvironment() {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) return process.env;
  const candidates = [join(homedir(), 'Library/Android/sdk'), '/opt/homebrew/share/android-commandlinetools'];
  for (const sdk of candidates) {
    try { await access(join(sdk, 'platforms')); return { ...process.env, ANDROID_HOME: sdk }; } catch { /* next SDK */ }
  }
  return process.env;
}

async function main() {
  const action = process.argv[2] || 'prepare';
  if (!['prepare', 'android', 'android-release', 'ios', 'ios-device'].includes(action)) {
    throw new Error('Usage: node tools/mobile.mjs [prepare|android|android-release|ios|ios-device]');
  }
  const signingEnv = action === 'android-release' ? await androidSigningEnvironment() : null;
  const files = await prepareWeb();
  console.log(`Prepared ${files.length} offline game files in mobile/web.`);
  if (action === 'android' || action === 'android-release') {
    const release = action === 'android-release';
    const tasks = release ? [':app:assembleRelease', ':app:lintRelease', '--console=plain'] : [':app:assembleDebug', ':app:lintDebug', '--console=plain'];
    const windows = process.platform === 'win32';
    await run(windows ? process.env.ComSpec || 'cmd.exe' : './gradlew',
      windows ? ['/d', '/s', '/c', 'gradlew.bat', ...tasks] : tasks,
      join(root, 'mobile/android'), { ...await androidEnvironment(), ...signingEnv });
    if (release) {
      const output = await archiveAndroidRelease();
      console.log(`APK: ${output.apk}\nSHA-256: ${output.checksum}`);
    } else {
      const output = join(root, 'build/mobile');
      await mkdir(output, { recursive: true });
      await copyFile(join(root, 'mobile/android/app/build/outputs/apk/debug/app-debug.apk'), join(output, 'IPPlease-debug.apk'));
      console.log('APK: build/mobile/IPPlease-debug.apk');
    }
  } else if (action === 'ios' || action === 'ios-device') {
    const device = action === 'ios-device';
    await run('xcodebuild', ['-project', 'mobile/ios/IPPlease.xcodeproj', '-scheme', 'IPPlease',
      '-configuration', device ? 'Release' : 'Debug', '-destination', device ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator',
      '-derivedDataPath', 'build/mobile/ios', 'CODE_SIGNING_ALLOWED=NO', 'build'], root);
    console.log(`App: build/mobile/ios/Build/Products/${device ? 'Release-iphoneos' : 'Debug-iphonesimulator'}/IPPlease.app`);
    if (device) console.log('Device build is unsigned; configure your Apple development team in Xcode to install or distribute.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
