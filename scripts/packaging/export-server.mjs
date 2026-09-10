// GEN3IA — export serveur dédié pour CI (build-server.yml).
// dist/: server.js (bundle), world.json (scène), package.json, README.
import * as esbuild from 'esbuild'
import fs from 'fs'

const version = process.argv[2] ?? '1.0.0'
const scene = JSON.parse(fs.readFileSync('scene-export.json', 'utf8'))

const result = await esbuild.build({
  entryPoints: ['mini-services/game-server/index.ts'],
  bundle: true, minify: true, format: 'cjs', target: 'node20',
  platform: 'node', write: false, logLevel: 'silent', external: ['socket.io'],
  define: { 'process.env.NODE_ENV': '"production"' },
})

const world = {
  name: 'GEN3IA world', version, exportedAt: new Date().toISOString(), scene,
  server: { tickRate: 20, snapshotHz: 15, maxSpeed: 30, interestRadius: 80 },
}
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/gen3ia-server.js', result.outputFiles[0].text)
fs.writeFileSync('dist/world.json', JSON.stringify(world, null, 2))
fs.writeFileSync('dist/package.json', JSON.stringify({
  name: 'gen3ia-game-server', version, private: true,
  scripts: { start: 'node server.js' }, dependencies: { 'socket.io': '^4.8.3' },
}, null, 2))
fs.writeFileSync('dist/README.md', `# GEN3IA serveur dédié v${version}\n\nnpm install && node server.js\n`)
console.log(`serveur dédié: dist/gen3ia-server.js (${Math.round(result.outputFiles[0].text.length / 1024)} KB)`)
