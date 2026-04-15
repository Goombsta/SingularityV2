"""
Patches the Tauri-generated app/build.gradle.kts to inject a release signingConfig.
Reads keystore credentials from environment variables:
  KEYSTORE_PATH, ANDROID_STORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
Usage: python3 scripts/patch_signing.py <path/to/app/build.gradle.kts>
"""
import sys
import os

APP = sys.argv[1]
app = open(APP).read()

kp = os.environ["KEYSTORE_PATH"]
sp = os.environ["ANDROID_STORE_PASSWORD"]
ka = os.environ["ANDROID_KEY_ALIAS"]
kpass = os.environ["ANDROID_KEY_PASSWORD"]

# Build the signingConfigs block
signing_block = (
    'signingConfigs {\n'
    '    create("release") {\n'
    '        storeFile = file("' + kp + '")\n'
    '        storePassword = "' + sp + '"\n'
    '        keyAlias = "' + ka + '"\n'
    '        keyPassword = "' + kpass + '"\n'
    '    }\n'
    '}\n'
)

# Inject signingConfigs before the android { block
if 'signingConfigs' not in app:
    app = app.replace('android {', signing_block + 'android {')
    print("signingConfigs block added")

# Wire signingConfig into the release build type
if 'signingConfig = signingConfigs' not in app:
    app = app.replace(
        'getByName("release") {\n            isDebuggable = false',
        'getByName("release") {\n            isDebuggable = false\n            signingConfig = signingConfigs.getByName("release")'
    )
    print("release signingConfig wired up")

open(APP, "w").write(app)
print("Done")
