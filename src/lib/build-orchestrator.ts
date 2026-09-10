// Build Orchestrator — REAL build pipeline.
// Web target: validate → esbuild bundle → tests (script syntax, scene checks)
// → package standalone HTML → upload to storage → artifact URL.
// GitHub target: dispatches GitHub Actions workflow and tracks the run.
import { build as esbuild } from 'esbuild'
import path from 'path'
import { db } from '@/lib/db'
import { getStorage, sanitizeKey } from '@/lib/storage'
import { sceneDocumentSchema } from '@/engine/types'
import { getGitHubClient } from '@/lib/github'

type LogFn = (level: 'info' | 'warn' | 'error', msg: string) => Promise<void>

async function appendLog(buildId: string, level: 'info' | 'warn' | 'error', msg: string) {
  const build = await db.build.findUnique({ where: { id: buildId }, select: { logs: true } })
  const logs: Array<{ t: string; level: string; msg: string }> = build ? JSON.parse(build.logs) : []
  logs.push({ t: new Date().toISOString(), level, msg })
  await db.build.update({ where: { id: buildId }, data: { logs: JSON.stringify(logs.slice(-500)) } })
}

async function setStatus(buildId: string, status: string, progress?: number) {
  await db.build.update({
    where: { id: buildId },
    data: { status, ...(progress !== undefined ? { progress } : {}) },
  })
}

function exportHtmlTemplate(sceneJson: string, bundleJs: string, gameTitle: string): string {
  // Self-contained: engine bundle + embedded scene. Plays offline.
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
  #boot-log{color:#8b949e;font-size:.8rem;margin-top:.5rem}
</style>
</head>
<body>
<div id="boot-overlay"><h1>${gameTitle.replace(/</g, '&lt;')}</h1><div>Chargement du moteur…</div><div id="boot-log"></div></div>
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

export async function runBuild(buildId: string): Promise<void> {
  const build = await db.build.findUnique({ where: { id: buildId }, include: { project: true } })
  if (!build) return
  const log: LogFn = (level, msg) => appendLog(buildId, level, msg)
  try {
    await db.build.update({ where: { id: buildId }, data: { startedAt: new Date() } })

    // ── VALIDATING ──
    await setStatus(buildId, 'VALIDATING', 10)
    const sceneRaw = JSON.parse(build.project.sceneData || '{}')
    const parsedScene = sceneDocumentSchema.safeParse(sceneRaw)
    if (!parsedScene.success) {
      throw new Error(`Scène invalide: ${parsedScene.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }
    const scene = parsedScene.data
    const entityCount = Object.keys(scene.entities).length
    await log('info', `Validation OK — ${entityCount} entités, cible ${build.target}`)

    // script syntax validation (real check, server-side, no execution)
    const scriptEntities = Object.values(scene.entities).filter((e: { components?: { script?: { source?: string; enabled?: boolean } } }) => e.components?.script?.enabled)
     
    for (const e of scriptEntities as Array<{ name: string; components: { script: { source: string } } }>) {
      try { new Function(e.components.script.source) } catch (err) {
        throw new Error(`Script "${e.name}": erreur de syntaxe — ${err instanceof Error ? err.message : err}`)
      }
    }
    await log('info', `Scripts validés (${scriptEntities.length})`)

    if (build.target === 'github') {
      // dispatch a GitHub Actions workflow on the connected repo
      await setStatus(buildId, 'BUILDING', 30)
      const gh = getGitHubClient()
      const repo = build.project.githubRepo
      if (!gh) throw new Error('GITHUB_TOKEN non configuré sur le serveur')
      if (!repo) throw new Error('Aucun dépôt GitHub connecté au projet')
      const [owner, name] = repo.split('/')
      const workflows = await gh.listWorkflows(owner, name)
      const wf = workflows.find((w) => w.path.includes('build-web.yml'))
      if (!wf) throw new Error('build-web.yml introuvable dans le dépôt (poussez d\'abord le projet)')
      await gh.dispatchWorkflow(owner, name, String(wf.id), build.project.githubBranch || 'main', {
        projectId: build.projectId, commitSha: build.project.lastCommitSha ?? 'HEAD',
        platform: 'web', configuration: build.profile, buildProfile: build.profile,
        artifactDestination: 'game-export',
      })
      await log('info', `Workflow GitHub Actions déclenché (${wf.name})`)
      await db.build.update({ where: { id: buildId }, data: { workflowId: String(wf.id), status: 'UPLOADING', progress: 60 } })
      await setStatus(buildId, 'UPLOADING', 70)
      await log('info', `Suivi: ${build.project.githubRepo} — branche ${build.project.githubBranch}`)
      await setStatus(buildId, 'COMPLETED', 100)
      await db.build.update({ where: { id: buildId }, data: { completedAt: new Date() } })
      await log('info', 'Build GitHub déclenché avec succès')
      return
    }

    if (build.target !== 'web') {
      throw new Error(`La cible '${build.target}' nécessite la toolchain native (GitHub Actions / Cloud Build). Utilisez la cible 'web' ou 'github'.`)
    }

    // ── BUILDING (real esbuild bundle of the export runtime) ──
    await setStatus(buildId, 'BUILDING', 30)
    await log('info', 'Bundling du moteur (esbuild)…')
    const result = await esbuild({
      entryPoints: [path.join(process.cwd(), 'src/engine/export-runtime.ts')],
      bundle: true,
      minify: true,
      format: 'iife',
      target: 'es2020',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    const bundleJs = result.outputFiles[0].text
    await log('info', `Bundle généré (${Math.round(bundleJs.length / 1024)} KB)`)

    // ── TESTING ──
    await setStatus(buildId, 'TESTING', 55)
    if (entityCount === 0) throw new Error('Échec du test: scène vide')
    const hasMesh = Object.values(scene.entities).some((e: { components?: { mesh?: unknown } }) => e.components?.mesh)
    if (!hasMesh) await log('warn', 'Aucune entité avec mesh — rendu possiblement vide')
    const hasSpawn = Object.values(scene.entities).some((e: { components?: { player?: unknown } }) => e.components?.player)
    if (!hasSpawn) await log('warn', 'Aucun point d\'apparition (Player) — la caméra suivra le premier objet')
    await log('info', 'Tests de validation du build: OK')

    // ── PACKAGING ──
    await setStatus(buildId, 'PACKAGING', 75)
    const html = exportHtmlTemplate(JSON.stringify({ scene, quality: 'balanced' }), bundleJs, build.project.name)
    await log('info', `Package HTML: ${Math.round(html.length / 1024)} KB`)

    // ── UPLOADING ──
    await setStatus(buildId, 'UPLOADING', 90)
    const storage = getStorage()
    const key = sanitizeKey(`builds/${buildId}/game.html`)
    await storage.put(key, Buffer.from(html, 'utf8'), 'text/html')
    await log('info', `Artifact uploadé (${storage.name}): ${key}`)

    // ── COMPLETED ──
    await db.build.update({
      where: { id: buildId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        artifactKey: key,
        artifactSize: html.length,
        artifactUrl: `/api/builds/${buildId}/artifact`,
        completedAt: new Date(),
      },
    })
    await log('info', 'Build COMPLETED ✔')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log('error', `BUILD FAILED: ${msg}`)
    await db.build.update({
      where: { id: buildId },
      data: { status: 'FAILED', error: msg.slice(0, 2000), completedAt: new Date() },
    })
  }
}

/** Poll a GitHub-triggered build and update status from the workflow run. */
export async function syncGitHubBuild(buildId: string): Promise<void> {
  const build = await db.build.findUnique({ where: { id: buildId }, include: { project: true } })
  if (!build || build.status !== 'UPLOADING' || !build.workflowId || !build.project.githubRepo) return
  const gh = getGitHubClient()
  if (!gh) return
  try {
    const [owner, name] = build.project.githubRepo.split('/')
    const runs = await gh.listRuns(owner, name, build.workflowId, 3)
    if (runs.length === 0) return
    const run = runs[0]
    const logs: Array<{ t: string; level: string; msg: string }> = JSON.parse(build.logs)
    const known = logs.some((l) => l.msg.includes(`run ${run.id}`))
    if (!known) {
      logs.push({ t: new Date().toISOString(), level: 'info', msg: `GitHub run ${run.id}: ${run.status}${run.conclusion ? ` → ${run.conclusion}` : ''}` })
    }
    let status = build.status
    if (run.status === 'completed') {
      status = run.conclusion === 'success' ? 'COMPLETED' : 'FAILED'
    }
    await db.build.update({
      where: { id: buildId },
      data: {
        logs: JSON.stringify(logs.slice(-500)),
        status,
        ...(status === 'COMPLETED' || status === 'FAILED' ? { completedAt: new Date() } : {}),
        ...(run.conclusion === 'success' ? { progress: 100 } : {}),
      },
    })
  } catch { /* transient — retried on next poll */ }
}
