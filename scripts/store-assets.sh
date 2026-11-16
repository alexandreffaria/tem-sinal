#!/usr/bin/env bash
# Renders the Play Store images into store/ (see store/README.md): the app screens with
# StoreScreensTest on the JVM, then the map, the frames, the icon and the feature graphic in
# headless Chrome. Needs what scripts/check.sh needs, Google Chrome (or CHROME naming another
# Chromium) and the internet, for the background map and the font.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME=$(find "$HOME/.local/share/jdks" -maxdepth 1 -name 'jdk-17*' 2>/dev/null | sort | tail -1)
  export JAVA_HOME
fi
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}

screens=$(mktemp -d)
trap 'rm -rf "$screens"' EXIT

./gradlew testDebugUnitTest --tests '*.StoreScreensTest' --rerun -PstoreScreens="$screens"
(cd map && npm ci --silent)
node store/render.mjs "$screens"
echo "Wrote the store images into store/"
