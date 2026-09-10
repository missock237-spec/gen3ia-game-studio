// GEN3IA — bundle serveur pour Node SEA (build-windows.yml).
// SEA ne peut PAS résoudre node_modules au runtime : socket.io et ses
// dépendances doivent être INCLUS dans le bundle. Seules les dépendances
// optionnelles de ws (absentes du runner, requises dans un try/catch)
// restent externes pour ne pas casser esbuild.
import * as esbuild from 'esbuild'
import fs from 'fs'

const result = await esbuild.build({
  entryPoints: ['mini-services/game-server/index.ts'],
  bundle: true,
  minify: true,
  format: 'cjs',
  target: 'node20',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  external: ['bufferutil', 'utf-8-validate'], // optionnelles (try/catch dans ws)
  define: { 'process.env.NODE_ENV': '"production"' },
})

fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/gen3ia-server.cjs', result.outputFiles[0].text)
console.log(`SEA bundle: dist/gen3ia-server.cjs (${Math.round(result.outputFiles[0].text.length / 1024)} KB, socket.io inclus)`)
