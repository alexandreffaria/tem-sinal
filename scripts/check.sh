#!/usr/bin/env bash
# Every check a pull request must pass, run on the current checkout. CI runs this same script.
# Usage: scripts/check.sh [base ref, default origin/main]
#
# Uses JAVA_HOME and ANDROID_HOME when set. Otherwise it uses, and installs on first run without
# root, JDK 17 in ~/.local/share/jdks and the Android SDK in ~/Android/Sdk.
set -euo pipefail

base=${1:-origin/main}
root=$(git rev-parse --show-toplevel)
cd "$root"

# Files that must never be committed: keystores, keys, app bundles, logs, .env files.
# -z prints paths raw and NUL-terminated, so no name is quoted or split.
list=$(mktemp)
trap 'rm -f "$list"' EXIT
git diff -z --name-only --find-renames --find-copies --diff-filter=ACR "$base...HEAD" > "$list"
bad=$(grep -ziE '\.(jks|keystore|p12|b64|pem|p8|key|aab|apk|log)$|play-account\.json$|(^|/)\.env' "$list" | tr '\0' '\n' || true)
if [ -n "$bad" ]; then
  echo "These files must not be committed:"
  echo "$bad"
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ]; then
  jdks="$HOME/.local/share/jdks"
  JAVA_HOME=$(find "$jdks" -maxdepth 1 -name 'jdk-17*' 2>/dev/null | sort | tail -1)
  if [ -z "$JAVA_HOME" ]; then
    echo "Installing JDK 17 in $jdks"
    mkdir -p "$jdks"
    curl -fsSL "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" \
      | tar -xz -C "$jdks"
    JAVA_HOME=$(find "$jdks" -maxdepth 1 -name 'jdk-17*' | sort | tail -1)
  fi
  export JAVA_HOME
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
  sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if [ ! -x "$sdkmanager" ]; then
    echo "Installing the Android command-line tools in $ANDROID_HOME"
    zip=$(mktemp)
    curl -fsSL -o "$zip" https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    unzip -q -d "$ANDROID_HOME/cmdline-tools" "$zip"
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -f "$zip"
  fi
  if [ ! -d "$ANDROID_HOME/platforms/android-35" ]; then
    yes | JAVA_HOME="$JAVA_HOME" "$sdkmanager" --licenses > /dev/null || true
    JAVA_HOME="$JAVA_HOME" "$sdkmanager" "platforms;android-35" "build-tools;35.0.0" > /dev/null
  fi
fi

./gradlew lintDebug testDebugUnitTest assembleDebug

echo "scripts/check.sh passed on $(git rev-parse --short HEAD)"
