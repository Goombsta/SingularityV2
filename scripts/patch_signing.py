"""
Patches the Tauri-generated app/build.gradle.kts to inject a release signingConfig.
Reads keystore credentials from environment variables, preferring the
TAURI_ANDROID_* names (as used in the repo's .env), falling back to the
unprefixed names (as used in legacy CI secrets):
  TAURI_ANDROID_KEYSTORE_PATH     | KEYSTORE_PATH
  TAURI_ANDROID_KEYSTORE_PASSWORD | ANDROID_STORE_PASSWORD
  TAURI_ANDROID_KEY_ALIAS         | ANDROID_KEY_ALIAS
  TAURI_ANDROID_KEY_PASSWORD      | ANDROID_KEY_PASSWORD
Usage: python3 scripts/patch_signing.py <path/to/app/build.gradle.kts>
"""
import sys
import os

APP = sys.argv[1]
app = open(APP).read()

def _env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    raise KeyError(f"none of {names} set in environment")

kp = _env("TAURI_ANDROID_KEYSTORE_PATH", "KEYSTORE_PATH")
sp = _env("TAURI_ANDROID_KEYSTORE_PASSWORD", "ANDROID_STORE_PASSWORD")
ka = _env("TAURI_ANDROID_KEY_ALIAS", "ANDROID_KEY_ALIAS")
kpass = _env("TAURI_ANDROID_KEY_PASSWORD", "ANDROID_KEY_PASSWORD")

# signingConfigs must live INSIDE the android { } block in Kotlin DSL.
# Inject it right after "android {" on its own line.
signing_block = (
    '\n    signingConfigs {\n'
    '        create("release") {\n'
    '            storeFile = file("' + kp + '")\n'
    '            storePassword = "' + sp + '"\n'
    '            keyAlias = "' + ka + '"\n'
    '            keyPassword = "' + kpass + '"\n'
    '        }\n'
    '    }\n'
)

if 'signingConfigs' not in app:
    # Insert right after the "android {" opening line
    app = app.replace('android {\n', 'android {' + signing_block, 1)
    print("signingConfigs block added inside android { }")

# Wire signingConfig into the release build type. We anchor on the opening
# line `getByName("release") {` (plus whatever indentation it has) and inject
# a `signingConfig = ...` line right after it. This is resilient to the
# contents of the release block — matches whether or not `isDebuggable =
# false`, `isMinifyEnabled = true`, etc. is present.
if 'signingConfig = signingConfigs' not in app:
    import re
    pattern = re.compile(r'(getByName\("release"\) \{\n)(\s+)')
    def _inject(m: "re.Match[str]") -> str:
        return m.group(1) + m.group(2) + 'signingConfig = signingConfigs.getByName("release")\n' + m.group(2)
    new_app, n = pattern.subn(_inject, app, count=1)
    if n == 0:
        print("ERROR: could not find release block to wire signingConfig into", file=sys.stderr)
        sys.exit(1)
    app = new_app
    print("release signingConfig wired up")

open(APP, "w").write(app)
print("Done")
