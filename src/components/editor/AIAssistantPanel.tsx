'use client'
// AI GAME ASSISTANT — chat + structured scene commands with diff preview & approval.
import { useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import type { SceneCommand } from '@/engine/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Bot, Check, Loader2, Send, Sparkles, X } from 'lucide-react'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  commands?: SceneCommand[]
  applied?: boolean
  provider?: string
}

const EXAMPLES = [
  'Ajoute 5 arbres (cônes verts) autour de la place',
  'Crée un mur de 6 blocs de pierre',
  'Ajoute un garde PNJ agressif qui patrouille',
  'Ajoute une fontaine de particules dorées',
  'Ajoute une torche lumineuse orange',
]

export default function AIAssistantPanel() {
  const projectId = useEditor((s) => s.projectId)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<SceneCommand[] | null>(null)

  const sceneSummary = (): string => {
    const doc = useEditor.getState().doc
    if (!doc) return 'Scène vide'
    return doc.summary()
  }

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    setMessages((m) => [...m, { role: 'user', text }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-project-id': projectId ?? '' },
        body: JSON.stringify({ message: text, sceneSummary: sceneSummary(), mode: 'command' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'assistant', text: `Erreur: ${data.error?.message ?? res.status}` }])
      } else {
        setMessages((m) => [...m, {
          role: 'assistant',
          text: data.reply ?? '',
          commands: data.commands ?? [],
          provider: data.provider,
        }])
        if (data.commands?.length) setPending(data.commands)
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Erreur réseau: ${e instanceof Error ? e.message : e}` }])
    } finally {
      setLoading(false)
    }
  }

  const applyCommands = (cmds: SceneCommand[]) => {
    const s = useEditor.getState()
    const doc = s.doc
    if (!doc) return
    let applied = 0
    for (const cmd of cmds) {
      switch (cmd.op) {
        case 'addEntity': {
          const components: Record<string, unknown> = {}
          const raw = (cmd.entity as { components?: Record<string, unknown> }).components ?? {}
          // normalize mesh defaults
          for (const [k, v] of Object.entries(raw)) components[k] = v
          if (components.mesh && !components.material) components.material = { color: '#8fbc6f', metalness: 0.05, roughness: 0.8, emissive: '#000000', emissiveIntensity: 0, opacity: 1, wireframe: false, doubleSided: false }
          doc.createEntity(String(cmd.entity.name), null, components as never)
          applied++
          break
        }
        case 'modifyEntity': {
          const target = doc.get(cmd.entityId)
          if (target) {
            for (const [k, v] of Object.entries(cmd.patch)) {
              if (k === 'transform' || doc.get(cmd.entityId)?.components[k as never]) {
                const comp = (target.components as Record<string, unknown>)[k]
                if (comp) Object.assign(comp, v as object)
                else (target.components as Record<string, unknown>)[k] = v
              }
            }
            applied++
          }
          break
        }
        case 'deleteEntity': {
          if (doc.deleteEntity(cmd.entityId)) applied++
          break
        }
        case 'duplicateEntity': {
          doc.duplicateEntity(cmd.entityId, cmd.count ?? 1)
          applied++
          break
        }
        case 'setEnvironment': {
          doc.setEnvironment(cmd.environment as never)
          applied++
          break
        }
      }
    }
    s.bumpVersion()
    s.markDirty()
    setMessages((m) => [...m, { role: 'assistant', text: `✔ ${applied} commande(s) appliquée(s) à la scène.`, applied: true }])
    setPending(null)
    s.addLog('info', `IA: ${applied} modifications de scène appliquées`)
  }

  const describe = (c: SceneCommand): string => {
    switch (c.op) {
      case 'addEntity': return `Créer « ${c.entity.name} »`
      case 'modifyEntity': return `Modifier l'entité ${c.entityId}`
      case 'deleteEntity': return `Supprimer l'entité ${c.entityId}`
      case 'duplicateEntity': return `Dupliquer ${c.entityId} ×${c.count ?? 1}`
      case 'setEnvironment': return 'Modifier l\'environnement'
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-gray-800 px-3 py-1.5">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">AI Game Assistant</span>
        <Badge variant="outline" className="ml-auto text-[9px] text-gray-500">commandes structurées → validation → approbation</Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3 text-xs">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-gray-400"><Bot className="h-4 w-4" /> Décrivez ce que vous voulez créer — l&apos;IA génère des commandes structurées que vous approuvez.</p>
              <div className="flex flex-wrap gap-1">
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => void send(ex)} className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] text-gray-300 hover:bg-gray-700">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`rounded-lg p-2 ${m.role === 'user' ? 'ml-6 bg-sky-500/10 text-sky-100' : 'mr-2 bg-gray-800/60 text-gray-200'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.commands && m.commands.length > 0 && !m.applied && (
                <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">Modifications proposées ({m.commands.length}) — approbation requise</p>
                  <ul className="space-y-0.5">
                    {m.commands.slice(0, 12).map((c, j) => <li key={j} className="text-gray-300">• {describe(c)}</li>)}
                    {m.commands.length > 12 && <li className="text-gray-500">… +{m.commands.length - 12} autres</li>}
                  </ul>
                </div>
              )}
              {m.provider && <span className="mt-1 block text-[9px] text-gray-600">via {m.provider}</span>}
            </div>
          ))}
          {loading && <div className="flex items-center gap-2 text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> L&apos;IA réfléchit…</div>}
        </div>
      </ScrollArea>

      {/* approval bar */}
      {pending && (
        <div className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <Button size="sm" className="h-7 bg-green-600 hover:bg-green-500" onClick={() => applyCommands(pending)}>
            <Check className="mr-1 h-3.5 w-3.5" /> Appliquer ({pending.length})
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPending(null)}>
            <X className="mr-1 h-3.5 w-3.5" /> Rejeter
          </Button>
        </div>
      )}

      <form
        className="flex gap-2 border-t border-gray-800 p-2"
        onSubmit={(e) => { e.preventDefault(); void send(input) }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Ex: "Crée un cimetière avec 10 pierres tombales"'
          className="h-9 bg-gray-900 text-xs"
          disabled={loading}
        />
        <Button type="submit" size="icon" className="h-9 w-9" disabled={loading || !input.trim()} aria-label="Envoyer">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
