// Build system — shared types & contracts.
// Providers: local | google-cloud-build | github-actions
// Targets:   web | android | windows | linux | dedicated-server | github(legacy)

export type BuildStatus =
  | 'QUEUED' | 'PREPARING' | 'BUILDING' | 'TESTING' | 'PACKAGING'
  | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export type BuildTarget = 'web' | 'android' | 'windows' | 'linux' | 'dedicated-server' | 'github'
export type BuildProviderId = 'local' | 'google-cloud-build' | 'github-actions'

export class BuildCancelledError extends Error {
  constructor() { super('Build annulé par l\'utilisateur') }
}

export class BuildTimeoutError extends Error {
  constructor() { super('Délai global du build dépassé (timeout)') }
}

export interface BuildContext {
  buildId: string
  projectId: string
  projectName: string
  target: BuildTarget
  profile: 'debug' | 'release'
  version: string
  githubRepo: string | null
  githubBranch: string
  /** scène validée du projet (injectée par l'orchestrateur après PREPARING) */
  sceneData: unknown
  /** push a log line (persisted, visible live in the UI) */
  log(level: 'info' | 'warn' | 'error', msg: string): Promise<void>
  /** update build status + progress */
  setStatus(status: BuildStatus, progress?: number): Promise<void>
  /** true if the user asked to cancel (checked between phases) */
  isCancelRequested(): Promise<boolean>
  /** global deadline — throws BuildTimeoutError when passed */
  assertNotTimedOut(): Promise<void>
  /** persist a produced artifact (storage + checksum + DB row) */
  storeArtifact(opts: {
    fileName: string
    mimeType: string
    data: Buffer
    kind?: 'primary' | 'symbols' | 'manifest'
  }): Promise<{ id: string; checksum: string; size: number; storageKey: string }>
}

export interface ProviderLaunchResult {
  externalId: string
  externalUrl?: string
}

/** A cloud build provider launches builds remotely and reports their progress. */
export interface CloudBuildProvider {
  readonly id: BuildProviderId
  readonly label: string
  /** true when the environment variables required to call its API are present */
  available(): boolean
  /** human readable reason when not available */
  unavailableReason(): string | null
  launch(ctx: BuildContext): Promise<ProviderLaunchResult>
  /** map remote state to local build state */
  poll(ctx: BuildContext, externalId: string): Promise<{
    status: BuildStatus
    progress: number
    done: boolean
    failed: boolean
    error?: string
    logLine?: string
  }>
  cancel?(ctx: BuildContext, externalId: string): Promise<void>
}

/** Required env vars — used to explain clearly why a provider is unavailable. */
export function requiredEnvForProvider(id: BuildProviderId): string[] {
  switch (id) {
    case 'google-cloud-build':
      return ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_REGION', 'GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_CREDENTIALS', 'GCS_BUILD_BUCKET']
    case 'github-actions':
      return ['GITHUB_TOKEN']
    default:
      return []
  }
}
