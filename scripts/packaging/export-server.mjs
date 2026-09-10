// GEN3IA — export serveur dédié pour CI (build-server.yml, build-linux.yml).
// dist/: server.js (lanceur), gen3ia-server.js (bundle esbuild), world.json
// (scène + config autoritaire), package.json, start.sh, Dockerfile, README.
// Usage: node scripts/packaging/export-server.mjs <version>
import * as esbuild from 'esbuild'
import fs from 'fs'

const version = process.argv[2] ?? '1.0.0'

let scene
if (fs.existsSync('scene-export.json')) {
  scene = JSON.parse(fs.readFileSync('scene-export.json', 'utf8'))
  console.log('scène: scene-export.json (projet synchronisé)')
} else {
  // Fallback honnête : scène de démonstration validée Zod, clairement signalée.
  scene = JSON.parse(fs.readFileSync('scripts/packaging/demo-scene.json', 'utf8'))
  console.warn('WARN scene-export.json absent — scène de démonstration utilisée')
}

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
// Lanceur : world.json est lu depuis le répertoire du serveur (CWD).
fs.writeFileSync('dist/server.js', `#!/usr/bin/env node\n// Lanceur GEN3IA — le bundle charge world.json depuis son répertoire.\nrequire('./gen3ia-server.js');\n`)
fs.writeFileSync('dist/world.json', JSON.stringify(world, null, 2))
fs.writeFileSync('dist/package.json', JSON.stringify({
  name: 'gen3ia-game-server', version, private: true,
  scripts: { start: 'node server.js' }, dependencies: { 'socket.io': '^4.8.3' },
  engines: { node: '>=20' },
}, null, 2))
fs.writeFileSync('dist/start.sh', `#!/usr/bin/env bash
# Lancement serveur dédié GEN3IA v\${version}
set -euo pipefail
cd "\$(dirname "\$0")"
if [ ! -d node_modules ]; then
  echo "[start.sh] Installation des dépendances…"
  npm install --omit=dev --no-audit --no-fund
fi
echo "[start.sh] Démarrage (socket.io :3003, stats :3103)…"
exec node server.js
`)
fs.chmodSync('dist/start.sh', 0o755)
fs.writeFileSync('dist/Dockerfile', `FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js gen3ia-server.js world.json ./
EXPOSE 3003 3103
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
  CMD wget -qO- http://localhost:3103/stats > /dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
`)
fs.writeFileSync('dist/README.md', `# GEN3IA serveur dédié v${version}

## Démarrage
\`\`\`bash
npm install
./start.sh        # ou : node server.js
\`\`\`

## Health
\`\`\`bash
curl http://localhost:3103/stats
\`\`\`

Socket.io :3003 · stats HTTP :3103 · monde : world.json
`)
console.log(`serveur dédié: dist/gen3ia-server.js (${Math.round(result.outputFiles[0].text.length / 1024)} KB)`)
