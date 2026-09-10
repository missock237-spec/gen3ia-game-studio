'use client'
// Console panel — real logs from runtime, scripts, AI, assets, builds.
import { useEffect, useRef } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trash2, Terminal } from 'lucide-react'

export default function ConsolePanel() {
  const logs = useEditor((s) => s.logs)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-1">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500">
          <Terminal className="h-3 w-3" /> Console ({logs.length})
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => useEditor.getState().clearLogs()} aria-label="Vider la console">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="max-h-full overflow-y-auto p-2 font-mono text-[11px] leading-4">
          {logs.length === 0 && <p className="text-gray-600">— console vide —</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="shrink-0 text-gray-600">{new Date(l.t).toLocaleTimeString()}</span>
              <span className={
                l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'
              }>{l.msg}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
