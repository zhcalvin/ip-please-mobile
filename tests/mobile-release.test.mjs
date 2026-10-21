import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidSigningEnvironment, archiveAndroidRelease } from '../tools/mobile.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'ipplease-release-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configDirectory = join(home, '.config/ip-please-mobile');
  await mkdir(configDirectory, { recursive: true });
  const configPath = join(configDirectory, 'android-signing.json');
  const keystore = join(home, 'release.jks');
  await writeFile(keystore, 'test keystore placeholder');
  const config = { keystore, storePassword: 'test-store-private', keyAlias: 'release', keyPassword: 'test-key-private' };
  return { home, configPath, keystore, config };
}

test('release signing fails closed without configuration or with partial configuration', async (t) => {
  const f = await fixture(t);
  await assert.rejects(androidSigningEnvironment({}, f.home), /Release signing is incomplete/);
  await writeFile(f.configPath, JSON.stringify({ keystore: f.keystore, keyAlias: 'release' }));
  await assert.rejects(androidSigningEnvironment({}, f.home), /IP_PLEASE_STORE_PASSWORD.*IP_PLEASE_KEY_PASSWORD/);
});

test('external configuration becomes environment values and explicit environment overrides win', async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, JSON.stringify(f.config));
  const env = await androidSigningEnvironment({ KEEP: 'value', IP_PLEASE_KEY_PASSWORD: 'override-private' }, f.home);
  assert.equal(env.KEEP, 'value');
  assert.equal(env.IP_PLEASE_KEYSTORE, f.keystore);
  assert.equal(env.IP_PLEASE_KEY_ALIAS, 'release');
  assert.equal(env.IP_PLEASE_STORE_PASSWORD === f.config.storePassword, true);
  assert.equal(env.IP_PLEASE_KEY_PASSWORD === 'override-private', true);
});

test('release signing supports CI environment values without a configuration file', async (t) => {
  const f = await fixture(t);
  const env = { IP_PLEASE_KEYSTORE: f.keystore, IP_PLEASE_STORE_PASSWORD: 'test-private', IP_PLEASE_KEY_ALIAS: 'release', IP_PLEASE_KEY_PASSWORD: 'test-private' };
  const result = await androidSigningEnvironment(env, f.home);
  assert.equal(result.IP_PLEASE_KEYSTORE, f.keystore);
  assert.equal(result.IP_PLEASE_KEY_PASSWORD === env.IP_PLEASE_KEY_PASSWORD, true);
});

test('malformed configuration and field validation never include secrets in errors', async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, '{"storePassword":"test-store-private", broken');
  await assert.rejects(androidSigningEnvironment({}, f.home), (error) => {
    assert.match(error.message, /Cannot read Android signing configuration/);
    assert.equal(error.message.includes('test-store-private'), false);
    return true;
  });
  await writeFile(f.configPath, JSON.stringify({ ...f.config, keyPassword: { secret: 'test-key-private' } }));
  await assert.rejects(androidSigningEnvironment({}, f.home), (error) => {
    assert.match(error.message, /IP_PLEASE_KEY_PASSWORD/);
    assert.equal(error.message.includes('test-key-private'), false);
    return true;
  });
});

test('an explicitly requested missing signing file cannot silently fall back', async (t) => {
  const f = await fixture(t);
  await assert.rejects(androidSigningEnvironment({ IP_PLEASE_SIGNING_CONFIG: join(f.home, 'missing.json') }, f.home), /Cannot read Android signing configuration/);
});

test('release signing rejects relative paths, missing keystores and the Android debug alias', async (t) => {
  const f = await fixture(t);
  for (const [change, expected] of [
    [{ keystore: 'relative.jks' }, /absolute path/],
    [{ keystore: join(f.home, 'missing.jks') }, /readable file/],
    [{ keyAlias: 'androiddebugkey' }, /debug key cannot sign a release/],
  ]) {
    await writeFile(f.configPath, JSON.stringify({ ...f.config, ...change }));
    await assert.rejects(androidSigningEnvironment({}, f.home), expected);
  }
});

test('release archive uses metadata version and creates a portable SHA-256 companion', async (t) => {
  const f = await fixture(t);
  const data = Buffer.from('test APK bytes');
  await writeFile(join(f.home, 'app-release.apk'), data);
  await writeFile(join(f.home, 'output-metadata.json'), JSON.stringify({
    artifactType: { type: 'APK' }, variantName: 'release',
    elements: [{ type: 'SINGLE', versionName: '2.3.4', outputFile: 'app-release.apk' }],
  }));
  const output = await archiveAndroidRelease(f.home, join(f.home, 'downloads'));
  assert.equal(output.apk, join(f.home, 'downloads/IPPlease-2.3.4-android.apk'));
  assert.deepEqual(await readFile(output.apk), data);
  assert.equal(await readFile(output.checksum, 'utf8'), `${createHash('sha256').update(data).digest('hex')}  IPPlease-2.3.4-android.apk\n`);
});

test('release archive rejects debug, unsigned, multiple or unsafe metadata outputs', async (t) => {
  const f = await fixture(t);
  const valid = { artifactType: { type: 'APK' }, variantName: 'release', elements: [{ type: 'SINGLE', versionName: '1.0.0', outputFile: 'app-release.apk' }] };
  for (const metadata of [
    { ...valid, variantName: 'debug' },
    { ...valid, elements: [{ ...valid.elements[0], outputFile: 'app-release-unsigned.apk' }] },
    { ...valid, elements: [...valid.elements, ...valid.elements] },
    { ...valid, elements: [{ ...valid.elements[0], outputFile: '../app-release.apk' }] },
    { ...valid, elements: [{ ...valid.elements[0], versionName: '../1.0.0' }] },
    { ...valid, elements: [{ ...valid.elements[0], versionName: undefined }] },
    { ...valid, elements: {} },
  ]) {
    await writeFile(join(f.home, 'output-metadata.json'), JSON.stringify(metadata));
    await assert.rejects(archiveAndroidRelease(f.home, join(f.home, 'downloads')), /Expected one signed release APK/);
  }
});
