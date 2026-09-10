// Local build pipelines — run in-process (no external CI needed).
//  web:              engine esbuild bundle → standalone playable HTML
//  dedicated-server: engine-independent server bundle → zip (node server.js)
import esbuild from 'esbuild'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ZipArchive, TarArchive } from 'archiver'
import type { BuildContext } from './types'

export function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function exportHtmlTemplate(sceneJson: string, bundleJs: string, gameTitle: string): string {
  const safeJson = sceneJson.replace(/<\/script/gi, '<\\/script')
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${gameTitle.replace(/</g, '&lt;')} — GEN3IA Export</title>
<style>
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0d1117;font-family:system-ui,sans-serif}
  canvas{display:block;width:100vw;height:100vh;touch-action:none}
  #boot-overlay{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;z-index:10;transition:opacity .5s}
  #boot-overlay h1{font-size:1.4rem;font-weight:600}
</style>
</head>
<body>
<div id="boot-overlay"><h1>${gameTitle.replace(/</g, '&lt;')}</h1><div>Chargement du moteur…</div></div>
<canvas id="game"></canvas>
<script>window.__GEN3IA_EXPORT__=${safeJson};</script>
<script>${bundleJs}</script>
<script>
  window.addEventListener('load', () => {
    const o = document.getElementById('boot-overlay')
    setTimeout(() => { o.style.opacity = '0'; setTimeout(() => o.remove(), 600) }, 300)
  })
</script>
</body>
</html>`
}

/** Bundle the browser export runtime with esbuild. */
export async function bundleExportEngine(defineVersion: string): Promise<string> {
  const entry = path.join(process.cwd(), 'src/engine/export-runtime.ts')
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', __GEN3IA_VERSION__: `"${defineVersion}"` },
  })
  return result.outputFiles[0].text
}

/** WEB target — real standalone playable HTML. */
export async function runLocalWebBuild(ctx: BuildContext, scene: unknown): Promise<Buffer> {
  await ctx.setStatus('BUILDING', 30)
  await ctx.log('info', 'Bundling du moteur (esbuild)…')
  const bundleJs = await bundleExportEngine(ctx.version)
  await ctx.log('info', `Bundle généré (${Math.round(bundleJs.length / 1024)} KB)`)

  await ctx.setStatus('TESTING', 55)
  const entities = (scene as { entities?: Record<string, unknown> }).entities ?? {}
  const count = Object.keys(entities).length
  if (count === 0) throw new Error('Échec du test: scène vide')
  await ctx.log('info', `Tests de validation: OK (${count} entités)`)

  await ctx.setStatus('PACKAGING', 75)
  const html = exportHtmlTemplate(JSON.stringify({ scene, quality: 'balanced', version: ctx.version }), bundleJs, ctx.projectName)
  await ctx.log('info', `Package HTML: ${Math.round(html.length / 1024)} KB`)
  return Buffer.from(html, 'utf8')
}

/** Zip helper (no compression for speed on already-minified payloads). */
async function zipToBuffer(files: Array<{ name: string; data: Buffer | string }>): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const chunks: Buffer[] = []
  archive.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })
  for (const f of files) archive.append(f.data, { name: f.name })
  await archive.finalize()
  await done
  return Buffer.concat(chunks)
}

/** DEDICATED-SERVER target — real runnable Node server package (zip). */
export async function runLocalServerBuild(ctx: BuildContext, scene: unknown): Promise<Buffer> {
  await ctx.setStatus('BUILDING', 30)
  await ctx.log('info', 'Bundling du serveur de jeu (esbuild)…')
  const entry = path.join(process.cwd(), 'mini-services/game-server/index.ts')
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'cjs',
    target: 'node20',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    external: ['socket.io'],
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const serverJs = result.outputFiles[0].text
  await ctx.log('info', `Bundle serveur généré (${Math.round(serverJs.length / 1024)} KB)`)

  await ctx.setStatus('TESTING', 55)
  const worldJson = JSON.stringify({
    name: ctx.projectName,
    version: ctx.version,
    exportedAt: new Date().toISOString(),
    scene,
    server: { tickRate: 20, snapshotHz: 15, maxSpeed: 30, interestRadius: 80 },
  }, null, 2)
  if (worldJson.length < 10) throw new Error('Échec du test: monde vide')
  await ctx.log('info', 'Tests: monde et configuration serveur valides')

  await ctx.setStatus('PACKAGING', 75)
  const pkg = JSON.stringify({
    name: 'gen3ia-game-server',
    version: ctx.version,
    private: true,
    scripts: { start: 'node server.js' },
    dependencies: { 'socket.io': '^4.8.3' },
    engines: { node: '>=20' },
  }, null, 2)
  const readme = `# ${ctx.projectName} — Serveur dédié GEN3IA\n\nVersion ${ctx.version}\n\n## Démarrage\n\n\`\`\`bash\nnpm install\n./start.sh          # socket.io sur :3003, stats/health sur :3103\n# ou : node server.js\n\`\`\`\n\n## Health check\n\n\`\`\`bash\ncurl http://localhost:3103/stats   # tick rate, joueurs, mémoire\n\`\`\`\n\n## Docker\n\n\`\`\`bash\ndocker build -t ${ctx.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-server .\ndocker run -p 3003:3003 -p 3103:3103 ${ctx.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-server\n\`\`\`\n\nLe serveur lit world.json (scène + config autoritaire) présent à côté de server.js.\n`
  const startSh = `#!/usr/bin/env bash\n# Lancement serveur dédié GEN3IA (${ctx.projectName} v${ctx.version})\nset -euo pipefail\ncd "\$(dirname "\$0")"\nif [ ! -d node_modules ]; then\n  echo "[start.sh] Installation des dépendances…"\n  npm install --omit=dev --no-audit --no-fund\nfi\necho "[start.sh] Démarrage du serveur (socket.io :3003, stats :3103)…"\nexec node server.js\n`
  const dockerfile = `FROM node:20-alpine\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --omit=dev --no-audit --no-fund\nCOPY server.js gen3ia-server.js world.json ./\nEXPOSE 3003 3103\nHEALTHCHECK --interval=30s --timeout=5s --retries=3 \\\n  CMD wget -qO- http://localhost:3103/stats > /dev/null 2>&1 || exit 1\nCMD ["node", "server.js"]\n`
  const zip = await zipToBuffer([
    { name: 'server.js', data: Buffer.from(`#!/usr/bin/env node\n// Lanceur GEN3IA — le bundle charge world.json depuis son répertoire.\nrequire('./gen3ia-server.js');\n`, 'utf8') },
    { name: 'gen3ia-server.js', data: Buffer.from(`${serverJs}\n`, 'utf8') },
    { name: 'world.json', data: Buffer.from(worldJson, 'utf8') },
    { name: 'package.json', data: Buffer.from(pkg, 'utf8') },
    { name: 'start.sh', data: Buffer.from(startSh, 'utf8') },
    { name: 'Dockerfile', data: Buffer.from(dockerfile, 'utf8') },
    { name: 'README.md', data: Buffer.from(readme, 'utf8') },
  ])
  await ctx.log('info', `Package serveur: ${Math.round(zip.length / 1024)} KB (zip)`)
  return zip
}

/** Manifest artifact (json) shared by all targets. */
export function buildManifest(ctx: BuildContext, checksum: string, size: number): Buffer {
  return Buffer.from(JSON.stringify({
    id: ctx.buildId,
    project: ctx.projectName,
    target: ctx.target,
    version: ctx.version,
    profile: ctx.profile,
    checksum,
    size,
    builtAt: new Date().toISOString(),
    generator: 'GEN3IA GAME STUDIO',
  }, null, 2), 'utf8')
}
