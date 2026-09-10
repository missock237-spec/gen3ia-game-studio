import { NextResponse } from 'next/server'
import { getAIManager } from '@/lib/ai'
import { getGitHubClient } from '@/lib/github'
import { getStorage } from '@/lib/storage'

export async function GET() {
  const ai = getAIManager()
  const storage = getStorage()
  return NextResponse.json({
    ai: {
      providers: ai.list(),
      note: 'z-ai actif par défaut · huggingface actif quand HF_TOKEN est configuré',
    },
    github: { tokenConfigured: Boolean(getGitHubClient()) },
    storage: {
      provider: storage.name,
      note: 'r2 actif quand les variables CLOUDFLARE_* sont configurées',
    },
  })
}
