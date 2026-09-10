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
cat > "$WORK/gradle.properties" <<'EOF'
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=false
android.nonTransitiveRClass=true
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
def ksPath = System.getenv('GEN3IA_KEYSTORE_PATH')
def ksPass = System.getenv('GEN3IA_KEYSTORE_PASSWORD')
def kAlias = System.getenv('GEN3IA_KEY_ALIAS')
def kPass  = System.getenv('GEN3IA_KEY_PASSWORD')
if (ksPath && file(ksPath).exists()) {
  android.signingConfigs {
    release { storeFile file(ksPath); storePassword ksPass; keyAlias kAlias; keyPassword kPass }
  }
  android.buildTypes.release.signingConfig android.signingConfigs.release
}
dependencies { }
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
      const scenePath = fs.existsSync('scene-export.json') ? 'scene-export.json' : 'scripts/packaging/demo-scene.json';
      if (scenePath !== 'scene-export.json') console.warn('[android] WARN scene-export.json absent — scène de démonstration embarquée');
      const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      const payload = JSON.stringify({ scene, quality: 'balanced', version: '$VERSION' }).replace(/<\\/script/gi, '<\\/script');
      const html = '<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no"><style>html,body{margin:0;height:100%;overflow:hidden;background:#0d1117}canvas{display:block;touch-action:none}</style></head><body><canvas id=game></canvas><script>window.__GEN3IA_EXPORT__=' + payload + ';</script><script>' + r.outputFiles[0].text + '</script></body></html>';
      fs.writeFileSync('$WORK/app/src/main/assets/game.html', html);
      console.log('[android] game.html embarqué:', Math.round(html.length/1024), 'KB');
    });
  " || { echo "[android] ERREUR: esbuild/scene-export.json indisponible — placez-vous à la racine du projet GEN3IA" >&2; exit 1; }
fi

# 3. build gradle — cibles selon le profil
cd "$WORK"
run_gradle() { gradle "$@" --no-daemon -q || ./gradlew "$@" --no-daemon -q; }
case "$PROFILE" in
  debug)
    echo "[android] build assembleDebug…"; run_gradle assembleDebug ;;
  release)
    echo "[android] build assembleRelease…"; run_gradle assembleRelease ;;
  all)
    echo "[android] build assembleDebug + assembleRelease + bundleRelease (AAB)…"
    run_gradle assembleDebug assembleRelease bundleRelease ;;
  *)
    echo "[android] ERREUR: profil inconnu '$PROFILE' (debug|release|all)" >&2; exit 1 ;;
esac

# 4. copie des artefacts réellement produits
COPIED=0
for apk in $(find "$WORK/app/build/outputs/apk" -name "*.apk" 2>/dev/null); do
  BASE=$(echo "$apk" | grep -o -E "(debug|release)" | head -1)
  cp "$apk" "$DIST/gen3ia-android-$VERSION-$BASE.apk"; COPIED=$((COPIED+1))
  echo "[android] APK: gen3ia-android-$VERSION-$BASE.apk ($(du -h "$apk" | cut -f1))"
done
for aab in $(find "$WORK/app/build/outputs/bundle" -name "*.aab" 2>/dev/null); do
  cp "$aab" "$DIST/gen3ia-android-$VERSION-release.aab"; COPIED=$((COPIED+1))
  echo "[android] AAB: gen3ia-android-$VERSION-release.aab ($(du -h "$aab" | cut -f1))"
done
if [ "$COPIED" -eq 0 ]; then echo "[android] ERREUR: aucun APK/AAB produit" >&2; exit 1; fi
cd "$DIST" && sha256sum gen3ia-android-* > SHA256SUMS
echo "[android] OK → $COPIED artefact(s) dans $DIST"
