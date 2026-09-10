// GEN3IA — export web autonome pour CI (build-web.yml).
// Génère dist/game.html : bundle moteur (esbuild) + scène du dépôt (scene-export.json).
// Usage: node scripts/packaging/export-web.mjs <version> <projectId?>
import * as esbuild from 'esbuild'
import fs from 'fs'

const version = process.argv[2] ?? '1.0.0'
const projectId = process.argv[3] ?? ''

let scene
if (fs.existsSync('scene-export.json')) {
  scene = JSON.parse(fs.readFileSync('scene-export.json', 'utf8'))
  console.log('scène: scene-export.json (projet synchronisé)')
} else {
  // Fallback honnête : scène de démonstration validée Zod, clairement signalée.
  scene = JSON.parse(fs.readFileSync('scripts/packaging/demo-scene.json', 'utf8'))
  console.warn('WARN scene-export.json absent — scène de démonstration utilisée (sync un projet depuis GEN3IA pour embarquer le vôtre)')
}

const result = await esbuild.build({
  entryPoints: ['src/engine/export-runtime.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const bundle = result.outputFiles[0].text

const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>GEN3IA Export v${version}</title>
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0d1117}canvas{display:block;touch-action:none}</style>
</head><body>
<canvas id="game"></canvas>
<script>window.__GEN3IA_EXPORT__=${JSON.stringify({ scene, quality: 'balanced', version }).replace(/<\/script/gi, '<\\/script')};</script>
<script>${bundle}</script>
</body></html>`

fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/game.html', html)
fs.writeFileSync('dist/manifest.json', JSON.stringify({
  version, projectId, target: 'web', builtAt: new Date().toISOString(),
  size: html.length, generator: 'GEN3IA GAME STUDIO CI',
}, null, 2))
console.log(`export web: dist/game.html (${Math.round(html.length / 1024)} KB)`)
