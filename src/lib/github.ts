// GitHub integration — real REST API v3 client (repos, files, branches, workflows).
// Token comes from env (GITHUB_TOKEN) — never bundled to the browser.

const API = 'https://api.github.com'

export interface RepoInfo {
  fullName: string
  private: boolean
  htmlUrl: string
  defaultBranch: string
}

export class GitHubClient {
  constructor(private token: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let message = `GitHub API ${res.status}`
      try { message = JSON.parse(text).message ?? message } catch { /* keep */ }
      throw new Error(message)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  me(): Promise<{ login: string; name: string | null }> {
    return this.request('GET', '/user')
  }

  async createRepo(name: string, description: string, isPrivate = true): Promise<RepoInfo> {
    const r = await this.request<{ full_name: string; private: boolean; html_url: string; default_branch: string }>(
      'POST', '/user/repos', { name, description, private: isPrivate, auto_init: true },
    )
    return { fullName: r.full_name, private: r.private, htmlUrl: r.html_url, defaultBranch: r.default_branch }
  }

  getRepo(owner: string, repo: string): Promise<RepoInfo> {
    return this.request<{ full_name: string; private: boolean; html_url: string; default_branch: string }>(
      'GET', `/repos/${owner}/${repo}`,
    ).then((r) => ({ fullName: r.full_name, private: r.private, htmlUrl: r.html_url, defaultBranch: r.default_branch }))
  }

  async createBranch(owner: string, repo: string, from: string, branch: string): Promise<void> {
    const ref = await this.request<{ object: { sha: string } }>('GET', `/repos/${owner}/${repo}/git/ref/heads/${from}`)
    await this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`, sha: ref.object.sha,
    })
  }

  /** Create or update a single file (real commit). */
  async putFile(owner: string, repo: string, branch: string, path: string, content: string, message: string): Promise<string> {
    let sha: string | undefined
    try {
      const existing = await this.request<{ sha: string }>('GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`)
      sha = existing.sha
    } catch { /* file does not exist yet */ }
    const res = await this.request<{ commit: { sha: string } }>(
      'PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      { message, content: Buffer.from(content, 'utf8').toString('base64'), branch, ...(sha ? { sha } : {}) },
    )
    return res.commit.sha
  }

  listWorkflows(owner: string, repo: string): Promise<Array<{ id: number; name: string; path: string; state: string }>> {
    return this.request('GET', `/repos/${owner}/${repo}/actions/workflows`).then((r) => (r as { workflows: Array<{ id: number; name: string; path: string; state: string }> }).workflows)
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: Record<string, string>): Promise<void> {
    const res = await fetch(`${API}/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ref, inputs }),
    })
    if (!res.ok && res.status !== 204) {
      throw new Error(`workflow_dispatch failed: ${res.status}`)
    }
  }

  listRuns(owner: string, repo: string, workflowId: string, perPage = 5): Promise<Array<{
    id: number; status: string; conclusion: string | null; head_sha: string; created_at: string; html_url: string
  }>> {
    return this.request('GET', `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=${perPage}`)
      .then((r) => (r as { workflow_runs: Array<{ id: number; status: string; conclusion: string | null; head_sha: string; created_at: string; html_url: string }> }).workflow_runs)
  }

  getRun(owner: string, repo: string, runId: number): Promise<{ status: string; conclusion: string | null; html_url: string; logs_url: string }> {
    return this.request('GET', `/repos/${owner}/${repo}/actions/runs/${runId}`)
  }

  async getRunLogs(owner: string, repo: string, runId: number): Promise<string> {
    const res = await fetch(`${API}/repos/${owner}/${repo}/actions/runs/${runId}/logs`, {
      headers: this.headers(),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`logs fetch failed: ${res.status}`)
    return await res.text()
  }

  cancelRun(owner: string, repo: string, runId: number): Promise<void> {
    return this.request('POST', `/repos/${owner}/${repo}/actions/runs/${runId}/cancel`).then(() => undefined)
  }
}

export function getGitHubClient(): GitHubClient | null {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null
  return new GitHubClient(token)
}
