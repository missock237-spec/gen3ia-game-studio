import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit, rateLimit } from '@/lib/api-utils'
import { getGitHubClient } from '@/lib/github'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-repo'), name: z.string().min(1).max(80).regex(/^[\w.-]+$/), isPrivate: z.boolean().default(true) }),
  z.object({ action: z.literal('commit') }),
  z.object({ action: z.literal('dispatch-build'), platform: z.string().default('web') }),
])

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const project = await db.project.findUnique({
      where: { id },
      select: { githubRepo: true, githubBranch: true, lastCommitSha: true },
    })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')
    const gh = getGitHubClient()
    let connected = false
    let login: string | null = null
    let runs: unknown[] = []
    if (gh) {
      connected = true
      try { login = (await gh.me()).login } catch { connected = false }
      if (project.githubRepo && connected) {
        try {
          const [owner, name] = project.githubRepo.split('/')
          runs = await gh.listRuns(owner, name, 'build-web.yml', 5).catch(() => [])
        } catch { runs = [] }
      }
    }
    return NextResponse.json({
      serverTokenConfigured: Boolean(gh),
      connected,
      login,
      repo: project.githubRepo,
      branch: project.githubBranch,
      lastCommitSha: project.lastCommitSha,
      recentRuns: runs,
    })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'OWNER')
    const rl = rateLimit(`github:${user.id}`, 10, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', 'Trop d\'appels GitHub')

    const gh = getGitHubClient()
    if (!gh) return apiError(501, 'GITHUB_NOT_CONFIGURED', 'GITHUB_TOKEN n\'est pas configuré sur le serveur')

    const body = actionSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Action invalide')

    const project = await db.project.findUnique({ where: { id } })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')

    if (body.data.action === 'create-repo') {
      const repo = await gh.createRepo(body.data.name, `GEN3IA GAME STUDIO — ${project.name}`, body.data.isPrivate)
      await db.project.update({ where: { id }, data: { githubRepo: repo.fullName, githubBranch: repo.defaultBranch } })
      await audit('github.create_repo', user.id, id, { repo: repo.fullName })
      return NextResponse.json({ repo })
    }

    if (!project.githubRepo) return apiError(400, 'NO_REPO', 'Connectez d\'abord un dépôt GitHub')
    const [owner, name] = project.githubRepo.split('/')

    if (body.data.action === 'commit') {
      // Commit the scene + scripts as JSON artifacts into the repo
      const sceneJson = project.sceneData || '{}'
      const commitDate = new Date().toISOString()
      let sha = await gh.putFile(owner, name, project.githubBranch || 'main', 'game/scene.json', JSON.stringify(JSON.parse(sceneJson), null, 2), `GEN3IA: scene sync ${commitDate}`)
      const scripts = await db.scriptFile.findMany({ where: { projectId: id } })
      for (const s of scripts) {
        sha = await gh.putFile(owner, name, project.githubBranch || 'main', `game/scripts/${s.path.replace(/^\/+/, '')}`, s.content, `GEN3IA: script ${s.path}`)
      }
      // workflows
      for (const wf of WORKFLOW_FILES) {
        sha = await gh.putFile(owner, name, project.githubBranch || 'main', wf.path, wf.content, `GEN3IA: workflow ${wf.path}`)
      }
      await db.project.update({ where: { id }, data: { lastCommitSha: sha } })
      await audit('github.commit', user.id, id, { sha, scripts: scripts.length })
      return NextResponse.json({ ok: true, sha, committedFiles: 1 + scripts.length + WORKFLOW_FILES.length })
    }

    // dispatch-build
    const workflows = await gh.listWorkflows(owner, name)
    const wf = workflows.find((w) => w.path.includes('build-web.yml'))
    if (!wf) return apiError(400, 'WORKFLOW_MISSING', 'build-web.yml absent — commitez d\'abord le projet')
    await gh.dispatchWorkflow(owner, name, String(wf.id), project.githubBranch || 'main', {
      projectId: id, commitSha: project.lastCommitSha ?? 'HEAD', platform: body.data.platform,
      configuration: 'release', buildProfile: 'release', artifactDestination: 'game-export',
    })
    await audit('github.dispatch', user.id, id, { workflow: wf.name })
    return NextResponse.json({ ok: true, workflow: wf.name })
  } catch (e) {
    return handleApiError(e)
  }
}

// Generated GitHub Actions workflows (real, dispatched via workflow_dispatch)
const WORKFLOW_FILES = [
  {
    path: '.github/workflows/build-web.yml',
    content: `name: Build Web
on:
  workflow_dispatch:
    inputs:
      projectId:
        description: 'GEN3IA project id'
        required: true
      commitSha:
        description: 'Commit SHA'
        required: false
      platform:
        description: 'Target platform'
        default: 'web'
      configuration:
        description: 'Configuration'
        default: 'release'
      buildProfile:
        description: 'Build profile'
        default: 'release'
      artifactDestination:
        description: 'Artifact destination'
        default: 'game-export'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Package game export
        run: |
          mkdir -p \${{ github.event.inputs.artifactDestination }}
          cp -r game/* \${{ github.event.inputs.artifactDestination }}/ || true
          echo "projectId=\${{ github.event.inputs.projectId }}" > \${{ github.event.inputs.artifactDestination }}/build-info.txt
          echo "platform=\${{ github.event.inputs.platform }}" >> \${{ github.event.inputs.artifactDestination }}/build-info.txt
      - uses: actions/upload-artifact@v4
        with:
          name: game-web-\${{ github.event.inputs.projectId }}
          path: \${{ github.event.inputs.artifactDestination }}/
`,
  },
]
