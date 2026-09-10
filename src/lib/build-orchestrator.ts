// Build Orchestrator — real multi-provider, multi-target pipeline.
//
// Targets & providers:
//   web               → local pipeline (esbuild → standalone HTML)   [always available]
//   dedicated-server  → local pipeline (server bundle → zip)          [always available]
//   android/windows/linux → google-cloud-build if configured, else github-actions, else honest error
//   github (legacy)   → github-actions web workflow
//
// Guarantees: full status machine (QUEUED…COMPLETED/FAILED/CANCELLED),
// user cancellation, global timeout, retries, artifact registry (checksum).
import crypto from 'crypto'
import { db } from '@/lib/db'
import { getStorage, sanitizeKey } from '@/lib/storage'
import { sceneDocumentSchema } from '@/engine/types'
import {
  BuildCancelledError, BuildTimeoutError,
  type BuildContext, type BuildTarget, type CloudBuildProvider,
} from '@/lib/build/types'
import { runLocalWebBuild, runLocalServerBuild, buildManifest, sha256 } from '@/lib/build/local'
import { googleCloudBuildProvider } from '@/lib/build/providers/google-cloud-build'
import { gitHubActionsProvider } from '@/lib/build/providers/github-actions'

type LogLevel = 'info' | 'warn' | 'error'
const GLOBAL_TIMEOUT_MS = 60 * 60 * 1000 // 1 h

// ─────────────────────────── logs / status ───────────────────────────

async function appendLog(buildId: string, level: LogLevel, msg: string) {
  const build = await db.build.findUnique({ where: { id: buildId }, select: { logs: true } })
  const logs: Array<{ t: string; level: string; msg: string }> = build ? JSON.parse(build.logs) : []
  logs.push({ t: new Date().toISOString(), level, msg })
  await db.build.update({ where: { id: buildId }, data: { logs: JSON.stringify(logs.slice(-800)) } })
}

async function setStatus(buildId: string, status: string, progress?: number) {
  await db.build.update({
    where: { id: buildId },
    data: { status, ...(progress !== undefined ? { progress } : {}) },
  })
}

// ─────────────────────────── context factory ───────────────────────────

function makeContext(b: {
  id: string; projectId: string; target: string; profile: string; version: string
  project: { name: string; githubRepo: string | null; githubBranch: string }
  timeoutAt: Date | null
}, sceneData?: unknown): BuildContext {
  const buildId = b.id
  const ctx: BuildContext = {
    buildId,
    projectId: b.projectId,
    projectName: b.project.name,
    target: b.target as BuildTarget,
    profile: (b.profile === 'debug' ? 'debug' : 'release'),
    version: b.version,
    githubRepo: b.project.githubRepo,
    githubBranch: b.project.githubBranch,
    sceneData: sceneData ?? null,
    log: (level, msg) => appendLog(buildId, level, msg),
    setStatus: (status, progress) => setStatus(buildId, status, progress),
    isCancelRequested: async () => {
      const row = await db.build.findUnique({ where: { id: buildId }, select: { cancelRequested: true, status: true } })
      return Boolean(row?.cancelRequested) || row?.status === 'CANCELLED'
    },
    assertNotTimedOut: async () => {
      const row = await db.build.findUnique({ where: { id: buildId }, select: { timeoutAt: true } })
      if (row?.timeoutAt && Date.now() > row.timeoutAt.getTime()) throw new BuildTimeoutError()
    },
    storeArtifact: async ({ fileName, mimeType, data, kind }) => {
      const checksum = sha256(data)
      const storage = getStorage()
      const key = sanitizeKey(`builds/${buildId}/artifacts/${fileName}`)
      await storage.put(key, data, mimeType)
      const row = await db.buildArtifact.create({
        data: {
          projectId: b.projectId, buildId, target: ctx.target, version: ctx.version,
          kind: kind ?? 'primary', fileName, mimeType,
          size: data.length, checksum, storageKey: key, provider: storage.name,
          status: 'READY',
        },
      })
      await db.build.update({
        where: { id: buildId },
        data: { artifactKey: key, artifactSize: data.length, artifactUrl: `/api/builds/${buildId}/artifact` },
      })
      await ctx.log('info', `Artifact enregistré: ${fileName} (${Math.round(data.length / 1024)} KB, sha256 ${checksum.slice(0, 12)}…, ${storage.name})`)
      return { id: row.id, checksum, size: data.length, storageKey: key }
    },
  }
  return ctx
}

// ─────────────────────────── provider selection ───────────────────────────

function providersForTarget(target: BuildTarget): CloudBuildProvider[] {
  const all = [googleCloudBuildProvider, gitHubActionsProvider]
  if (target === 'github') return [gitHubActionsProvider]
  return all
}

function pickProvider(target: BuildTarget): { provider: CloudBuildProvider } | { error: string } {
  for (const p of providersForTarget(target)) {
    if (p.available()) return { provider: p }
  }
  const reasons = providersForTarget(target)
    .map((p) => `— ${p.label}: ${p.unavailableReason()}`)
    .join('\n')
  return {
    error: `Aucun fournisseur cloud disponible pour la cible '${target}'. Cette cible exige une chaîne de compilation native distante (Android SDK/Gradle, toolchain Windows…).\nConfigurez l'un des fournisseurs :\n${reasons}\nLa cible 'web' et le 'dedicated-server' restent disponibles localement.`,
  }
}

// ─────────────────────────── scene validation (shared) ───────────────────────────

async function loadValidatedScene(projectId: string, log: (l: LogLevel, m: string) => Promise<void>) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { sceneData: true } })
  const sceneRaw = JSON.parse(project?.sceneData || '{}')
  const parsed = sceneDocumentSchema.safeParse(sceneRaw)
  if (!parsed.success) {
    throw new Error(`Scène invalide: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const scriptEntities = Object.values(parsed.data.entities)
    .filter((e) => (e as { components?: { script?: { source?: string; enabled?: boolean } } }).components?.script?.enabled) as
    Array<{ name: string; components: { script: { source: string } } }>
  for (const e of scriptEntities) {
    try { new Function(e.components.script.source) } catch (err) {
      throw new Error(`Script "${e.name}": erreur de syntaxe — ${err instanceof Error ? err.message : err}`)
    }
  }
  await log('info', `Validation OK — ${Object.keys(parsed.data.entities).length} entités, ${scriptEntities.length} script(s)`)
  return parsed.data
}

// ─────────────────────────── main entry ───────────────────────────

export async function runBuild(buildId: string): Promise<void> {
  const build = await db.build.findUnique({ where: { id: buildId }, include: { project: true } })
  if (!build) return
  const ctx = makeContext(build)
  try {
    const timeoutAt = new Date(Date.now() + GLOBAL_TIMEOUT_MS)
    await db.build.update({
      where: { id: buildId },
      data: { startedAt: new Date(), timeoutAt, attempt: { increment: 1 } },
    })
    if (await ctx.isCancelRequested()) throw new BuildCancelledError()

    // ── PREPARING — scene + script validation (all targets) ──
    await ctx.setStatus('PREPARING', 10)
    const scene = await loadValidatedScene(build.projectId, ctx.log)
    ctx.sceneData = scene // injecté pour les providers distants (tarball GCB)
    await ctx.assertNotTimedOut()

    const target = build.target as BuildTarget

    // ── local pipelines (web / dedicated-server) ──
    if (target === 'web' || target === 'dedicated-server') {
      const data = target === 'web'
        ? await runLocalWebBuild(ctx, scene)
        : await runLocalServerBuild(ctx, scene)
      await ctx.assertNotTimedOut()
      if (await ctx.isCancelRequested()) throw new BuildCancelledError()

      await ctx.setStatus('UPLOADING', 90)
      const fileName = target === 'web'
        ? `gen3ia-web-${ctx.version}.html`
        : `gen3ia-server-${ctx.version}.zip`
      const stored = await ctx.storeArtifact({
        fileName,
        mimeType: target === 'web' ? 'text/html' : 'application/zip',
        data,
      })
      // manifest artifact (checksum traceability)
      await ctx.storeArtifact({
        fileName: 'manifest.json', mimeType: 'application/json',
        data: buildManifest(ctx, stored.checksum, stored.size), kind: 'manifest',
      })
      await ctx.setStatus('COMPLETED', 100)
      await db.build.update({ where: { id: buildId }, data: { completedAt: new Date() } })
      await ctx.log('info', 'Build COMPLETED ✔')
      return
    }

    // ── cloud pipelines (android / windows / linux / github) ──
    const picked = pickProvider(target === 'github' ? 'github' : target)
    if ('error' in picked) throw new Error(picked.error)
    const provider = picked.provider
    await db.build.update({ where: { id: buildId }, data: { provider: provider.id } })
    await ctx.log('info', `Fournisseur de build: ${provider.label}`)

    await ctx.setStatus('BUILDING', 30)
    const launched = await provider.launch(ctx)
    await db.build.update({
      where: { id: buildId },
      data: { workflowId: launched.externalId, externalUrl: launched.externalUrl ?? null, status: 'BUILDING' },
    })
    await ctx.log('info', `Build distant lancé (id ${launched.externalId}). Le suivi se fait automatiquement (polling).`)
  } catch (e) {
    if (e instanceof BuildCancelledError || (await db.build.findUnique({ where: { id: buildId }, select: { cancelRequested: true } }))?.cancelRequested) {
      await ctx.log('warn', 'Build CANCELLED')
      await db.build.update({
        where: { id: buildId },
        data: { status: 'CANCELLED', error: 'Annulé par l\'utilisateur', completedAt: new Date() },
      })
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    await ctx.log('error', `BUILD FAILED: ${msg}`)
    await db.build.update({
      where: { id: buildId },
      data: { status: 'FAILED', error: msg.slice(0, 2000), completedAt: new Date() },
    })
  }
}

// ─────────────────────────── cloud sync (polling) ───────────────────────────

const inFlight = new Set<string>()

/** Poll one cloud build and update its local state. Safe to call concurrently. */
export async function syncBuild(buildId: string): Promise<void> {
  if (inFlight.has(buildId)) return
  inFlight.add(buildId)
  try {
    const build = await db.build.findUnique({ where: { id: buildId }, include: { project: true } })
    if (!build) return
    if (!['BUILDING', 'TESTING', 'PACKAGING', 'UPLOADING', 'QUEUED', 'PREPARING'].includes(build.status)) return
    if (!build.workflowId) return
    const provider = providersForTarget(build.target as BuildTarget)
      .find((p) => p.id === build.provider)
    if (!provider || !provider.available()) return

    const ctx = makeContext(build)
    const state = await provider.poll(ctx, build.workflowId)
    if (state.logLine) {
      const logs: Array<{ t: string; level: string; msg: string }> = JSON.parse(build.logs)
      if (!logs.some((l) => l.msg === state.logLine)) await appendLog(buildId, 'info', state.logLine)
    }
    if (state.done) {
      await db.build.update({
        where: { id: buildId },
        data: {
          status: state.failed ? 'FAILED' : 'COMPLETED',
          progress: state.progress,
          error: state.error ?? null,
          completedAt: new Date(),
        },
      })
      await appendLog(buildId, state.failed ? 'error' : 'info', state.failed ? `BUILD FAILED: ${state.error ?? 'échec distant'}` : 'Build COMPLETED ✔ (distant)')
    } else {
      await db.build.update({ where: { id: buildId }, data: { status: state.status, progress: state.progress } })
    }
  } catch { /* transient — retried on next poll */ } finally {
    inFlight.delete(buildId)
  }
}

/** Poll all in-progress cloud builds (called from GET /builds). */
export async function syncAllActiveBuilds(projectId: string): Promise<void> {
  const active = await db.build.findMany({
    where: {
      projectId,
      status: { in: ['BUILDING', 'TESTING', 'PACKAGING', 'UPLOADING'] },
      provider: { not: 'local' },
      workflowId: { not: null },
    },
    select: { id: true },
    take: 5,
  })
  await Promise.allSettled(active.map((b) => syncBuild(b.id)))
}

// ─────────────────────────── cancellation ───────────────────────────

export async function requestCancel(buildId: string): Promise<{ ok: boolean; message: string }> {
  const build = await db.build.findUnique({ where: { id: buildId } })
  if (!build) return { ok: false, message: 'Build introuvable' }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(build.status)) {
    return { ok: false, message: `Build déjà terminé (${build.status})` }
  }
  await db.build.update({ where: { id: buildId }, data: { cancelRequested: true } })
  await appendLog(buildId, 'warn', 'Annulation demandée…')
  if (build.workflowId && build.provider !== 'local') {
    const provider = providersForTarget(build.target as BuildTarget).find((p) => p.id === build.provider)
    const ctxBuild = build as unknown as Parameters<typeof makeContext>[0]
    const ctx = makeContext(ctxBuild)
    await provider?.cancel?.(ctx, build.workflowId).catch(() => { /* best effort */ })
  }
  return { ok: true, message: 'Annulation enregistrée — les étapes locales s\'arrêtent à la prochaine vérification, le build distant reçoit un cancel.' }
}

export { sha256 }
export function hashOf(data: Buffer): string { return crypto.createHash('sha256').update(data).digest('hex') }
