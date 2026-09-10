// GitHub Actions provider — dispatches target-specific workflows and tracks the
// run until completion, then downloads the produced artifact (zip) from GitHub.
import { getGitHubClient } from '@/lib/github'
import type { BuildContext, CloudBuildProvider, ProviderLaunchResult } from '../types'

const WORKFLOW_BY_TARGET: Record<string, string> = {
  web: 'build-web.yml',
  android: 'build-android.yml',
  windows: 'build-windows.yml',
  linux: 'build-linux.yml',
  'dedicated-server': 'build-server.yml',
}

interface ArtifactRef { id: number; name: string; size_in_bytes: number; archive_download_url: string }

async function ghFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
}

export const gitHubActionsProvider: CloudBuildProvider = {
  id: 'github-actions',
  label: 'GitHub Actions',
  available() { return Boolean(process.env.GITHUB_TOKEN) },
  unavailableReason() { return process.env.GITHUB_TOKEN ? null : 'GITHUB_TOKEN non configuré sur le serveur' },

  async launch(ctx: BuildContext): Promise<ProviderLaunchResult> {
    const gh = getGitHubClient()
    if (!gh) throw new Error(this.unavailableReason() ?? 'GitHub indisponible')
    if (!ctx.githubRepo) throw new Error('Aucun dépôt GitHub connecté au projet (onglet GitHub)')
    const [owner, name] = ctx.githubRepo.split('/')
    const wanted = WORKFLOW_BY_TARGET[ctx.target]
    if (!wanted) throw new Error(`Cible '${ctx.target}' sans workflow GitHub défini`)
    const workflows = await gh.listWorkflows(owner, name)
    const wf = workflows.find((w) => w.path.endsWith(wanted))
    if (!wf) {
      throw new Error(`${wanted} introuvable dans ${ctx.githubRepo}. Poussez le projet (onglet GitHub → Synchroniser) pour installer les workflows de build.`)
    }
    await gh.dispatchWorkflow(owner, name, String(wf.id), ctx.githubBranch || 'main', {
      projectId: ctx.projectId,
      version: ctx.version,
      buildProfile: ctx.profile,
      artifactName: `gen3ia-${ctx.target}-${ctx.version}`,
    })
    await ctx.log('info', `Workflow ${wf.name} déclenché sur ${ctx.githubRepo}@${ctx.githubBranch}`)
    // resolve the created run id via the run list (most recent dispatched for this sha/workflow)
    await new Promise((r) => setTimeout(r, 2500))
    const runs = await gh.listRuns(owner, name, String(wf.id), 1)
    const runId = runs[0]?.id
    if (runId) await ctx.log('info', `Run GitHub suivi: ${runs[0].html_url}`)
    return { externalId: String(runId ?? wf.id), externalUrl: runs[0]?.html_url }
  },

  async poll(ctx: BuildContext, externalId: string) {
    const gh = getGitHubClient()
    if (!gh || !ctx.githubRepo) return { status: 'BUILDING' as const, progress: 50, done: false, failed: false }
    const [owner, name] = ctx.githubRepo.split('/')
    const token = process.env.GITHUB_TOKEN ?? ''
    const res = await ghFetch(token, `/repos/${owner}/${name}/actions/runs/${externalId}`)
    if (res.status === 404) {
      // externalId may still be the workflow id — fall back to latest run of that workflow
      const runs = await gh.listRuns(owner, name, externalId, 1)
      if (!runs[0]) return { status: 'BUILDING' as const, progress: 30, done: false, failed: false }
      return mapRun(ctx, owner, name, token, runs[0].id, runs[0].status, runs[0].conclusion)
    }
    if (!res.ok) throw new Error(`GitHub poll failed: ${res.status}`)
    const run = (await res.json()) as { id: number; status: string; conclusion: string | null; html_url: string }
    return mapRun(ctx, owner, name, token, run.id, run.status, run.conclusion)
  },

  async cancel(_ctx, externalId: string) {
    const gh = getGitHubClient()
    if (!gh || !_ctx.githubRepo) return
    const [owner, name] = _ctx.githubRepo.split('/')
    await gh.cancelRun(owner, name, Number(externalId)).catch(() => { /* already finished */ })
  },
}

async function mapRun(
  ctx: BuildContext, owner: string, name: string, token: string,
  runId: number, status: string, conclusion: string | null,
): Promise<{ status: Parameters<BuildContext['setStatus']>[0]; progress: number; done: boolean; failed: boolean; error?: string; logLine?: string }> {
  const done = status === 'completed'
  const failed = done && conclusion !== 'success'
  let statusOut: Parameters<BuildContext['setStatus']>[0] = done ? (failed ? 'FAILED' : 'COMPLETED') : 'BUILDING'
  let progress = done ? 100 : 40

  // On success, download the produced artifact (zip) and store it.
  if (done && !failed) {
    try {
      const listRes = await ghFetch(token, `/repos/${owner}/${name}/actions/runs/${runId}/artifacts`)
      if (listRes.ok) {
        const arts = ((await listRes.json()) as { artifacts: ArtifactRef[] }).artifacts
          .filter((a) => a.name.startsWith('gen3ia-'))
        if (arts.length > 0) {
          const a = arts[0]
          await ctx.setStatus('UPLOADING', 90)
          await ctx.log('info', `Artifact GitHub: ${a.name} (${Math.round(a.size_in_bytes / 1024)} KB) — téléchargement…`)
          const dl = await ghFetch(token, `/repos/${owner}/${name}/actions/artifacts/${a.id}/zip`)
          if (dl.ok) {
            const buf = Buffer.from(await dl.arrayBuffer())
            await ctx.storeArtifact({
              fileName: `${a.name}.zip`,
              mimeType: 'application/zip',
              data: buf,
            })
            await ctx.log('info', `Artifact stocké et vérifié (sha256)`)
          } else {
            await ctx.log('warn', `Téléchargement artifact impossible (${dl.status}) — build réussi côté GitHub`)
          }
        } else {
          await ctx.log('warn', 'Aucun artifact gen3ia-* publié par le workflow')
        }
      }
    } catch (e) {
      await ctx.log('warn', `Récupération artifact: ${e instanceof Error ? e.message : e}`)
    }
    void statusOut; void progress
    statusOut = done ? (failed ? 'FAILED' : 'COMPLETED') : 'BUILDING'
    progress = 100
  }
  return {
    status: statusOut,
    progress,
    done,
    failed,
    error: failed ? `GitHub Actions: conclusion=${conclusion}` : undefined,
    logLine: `GitHub run ${runId}: ${status}${conclusion ? ` → ${conclusion}` : ''}`,
  }
}
