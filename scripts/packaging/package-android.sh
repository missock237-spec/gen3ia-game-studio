#!/usr/bin/env bash
# GEN3IA — packaging Android réel : génère un projet Gradle minimal (WebView
# plein écran chargeant l'export HTML du jeu) et produit un APK signé debug.
# Usage: package-android.sh <version> <profile>   (ex: 1.0.0 release)
set -euo pipefail
VERSION="${1:-1.0.0}"
PROFILE="${2:-release}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
DIST="$ROOT/dist"
mkdir -p "$DIST"

echo "[android] génération du projet Gradle (v$VERSION, $PROFILE)…"
# 1. projet Android minimal
PKG="com/gen3ia/game"
mkdir -p "$WORK/app/src/main/java/$PKG" "$WORK/app/src/main/assets" "$WORK/app/src/main/res/values" "$WORK/app/src/main/res/xml" "$WORK/app/src/main/res/drawable"

cat > "$WORK/settings.gradle" <<'EOF'
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "GEN3IA-Game"
include ':app'
EOF
cat > "$WORK/build.gradle" <<'EOF'
plugins { id 'com.android.application' version '8.5.2' apply false }
EOF
cat > "$WORK/app/build.gradle" <<EOF
plugins { id 'com.android.application' }
android {
  namespace 'com.gen3ia.game'
  compileSdk 34
  defaultConfig {
    applicationId "com.gen3ia.game"
    minSdk 24
    targetSdk 34
    versionCode 1
    versionName "$VERSION"
  }
  buildTypes {
    release { minifyEnabled false }
  }
}
dependencies { implementation 'androidx.appcompat:appcompat:1.7.0' }
EOF
cat > "$WORK/app/src/main/AndroidManifest.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="GEN3IA Game" android:usesCleartextTraffic="true">
    <activity android:name=".MainActivity" android:exported="true"
      android:screenOrientation="sensorLandscape"
      android:configChanges="orientation|screenSize|keyboardHidden">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
EOF
cat > "$WORK/app/src/main/java/$PKG/MainActivity.java" <<'EOF'
package com.gen3ia.game;
import android.app.Activity; import android.os.Bundle; import android.webkit.WebView; import android.webkit.WebViewClient;
import android.view.View;
public class MainActivity extends Activity {
  private WebView wv;
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    wv = new WebView(this);
    wv.getSettings().setJavaScriptEnabled(true);
    wv.getSettings().setDomStorageEnabled(true);
    wv.setWebViewClient(new WebViewClient());
    wv.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
    setContentView(wv);
    wv.loadUrl("file:///android_asset/game.html");
  }
  @Override public void onBackPressed() { if (wv.canGoBack()) wv.goBack(); else super.onBackPressed(); }
}
EOF
echo '<?xml version="1.0" encoding="utf-8"?><resources><style name="AppTheme" parent="@android:style/Theme.Black.NoTitleBar.Fullscreen"/></resources>' > "$WORK/app/src/main/res/values/styles.xml"

# 2. export web du jeu (bundle moteur + scène) si non présent
if [ ! -f "$WORK/app/src/main/assets/game.html" ]; then
  echo "[android] génération de l'export web embarqué…"
  node -e "
    const esbuild = require('esbuild');
    esbuild.build({
      entryPoints: ['src/engine/export-runtime.ts'],
      bundle: true, minify: true, format: 'iife', target: 'es2020',
      platform: 'browser', write: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '\"production\"' },
    }).then(r => {
      const fs = require('fs');
      const scene = JSON.parse(fs.readFileSync('scene-export.json', 'utf8'));
      const html = '<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1,user-scalable=no\"><style>html,body{margin:0;height:100%;overflow:hidden;background:#0d1117}canvas{display:block;touch-action:none}</style></head><body><canvas id=game></canvas><script>window.__GEN3IA_EXPORT__=' + JSON.stringify(scene) + ';</script><script>' + r.outputFiles[0].text + '</script></body></html>';
      fs.writeFileSync('$WORK/app/src/main/assets/game.html', html);
      console.log('[android] game.html embarqué:', Math.round(html.length/1024), 'KB');
    });
  " || { echo "[android] ERREUR: esbuild/scene-export.json indisponible — placez-vous à la racine du projet GEN3IA" >&2; exit 1; }
fi

# 3. build gradle
echo "[android] build Gradle assemble$([ "$PROFILE" = "debug" ] && echo Debug || echo Release)…"
cd "$WORK"
gradle assemble$([ "$PROFILE" = "debug" ] && echo Debug || echo Release) --no-daemon -q \
  || ./gradlew assemble$([ "$PROFILE" = "debug" ] && echo Debug || echo Release) --no-daemon -q

# 4. copie de l'APK
APK=$(find "$WORK/app/build/outputs/apk" -name "*.apk" | head -1)
if [ -z "$APK" ]; then echo "[android] ERREUR: aucun APK produit" >&2; exit 1; fi
cp "$APK" "$DIST/gen3ia-android-$VERSION-$PROFILE.apk"
sha256sum "$DIST/gen3ia-android-$VERSION-$PROFILE.apk" > "$DIST/SHA256SUMS"
echo "[android] OK → $DIST/gen3ia-android-$VERSION-$PROFILE.apk"
