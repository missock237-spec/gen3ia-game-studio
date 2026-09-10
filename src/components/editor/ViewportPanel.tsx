'use client'
// 3D Viewport — real editor camera, gizmos, selection, play runtime integration.
import { useEffect, useRef, useCallback } from 'react'
import { useEditor } from '@/stores/editor-store'
import { EngineRenderer } from '@/engine/renderer'
import { GameRuntime } from '@/engine/runtime'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  MousePointer2, Move, RotateCw, Maximize, Play, Pause, Square, Redo2, Undo2,
  Focus, Frame, Grid3X3, Camera, Gamepad2, Eye,
} from 'lucide-react'

type ResolveFn = (assetId: string) => { url: string; mimeType: string; name: string } | undefined

function assetUrlOf(id: string): string {
  const pid = useEditor.getState().projectId
  return pid ? `/api/projects/${pid}/assets/${id}/blob` : ''
}
function resolveAssetGlobal(assetId: string) {
  const a = useEditor.getState().assets.find((x) => x.id === assetId)
  if (!a) return undefined
  return { url: assetUrlOf(a.id), mimeType: a.mimeType, name: a.name }
}

export default function ViewportPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<EngineRenderer | null>(null)
  const runtimeRef = useRef<GameRuntime | null>(null)

  const doc = useEditor((s) => s.doc)
  const docVersion = useEditor((s) => s.docVersion)
  const selection = useEditor((s) => s.selection)
  const projectId = useEditor((s) => s.projectId)
  const tool = useEditor((s) => s.tool)
  const snap = useEditor((s) => s.snap)
  const cameraMode = useEditor((s) => s.cameraMode)
  const quality = useEditor((s) => s.quality)
  const gridVisible = useEditor((s) => s.gridVisible)
  const runtimeState = useEditor((s) => s.runtimeState)

  // ── init renderer + runtime ──
  useEffect(() => {
    if (!canvasRef.current || !doc) return
    const isMobile = window.innerWidth < 768
    const renderer = new EngineRenderer(canvasRef.current, {
      deviceKind: isMobile ? 'mobile' : 'desktop',
      onStats: (s) => useEditor.getState().setStats(s),
      onLog: (level, msg) => useEditor.getState().addLog(level, msg),
    })
    rendererRef.current = renderer
    renderer.setDocument(doc, resolveAssetGlobal)

    // globals for the multiplayer panel (remote avatars) and runtime helpers
    ;(window as unknown as { __GEN3IA_SCENE__?: unknown }).__GEN3IA_SCENE__ = renderer.scene
    ;(window as unknown as { __GEN3IA_CAMERA__?: unknown }).__GEN3IA_CAMERA__ = renderer.camera

    const runtime = new GameRuntime(renderer, doc, {
      getAssetUrl: (id) => assetUrlOf(id),
      log: (level, msg) => useEditor.getState().addLog(level, msg),
      onStateChange: (s) => useEditor.getState().setRuntimeState(s),
      onStats: (s) => useEditor.getState().setRuntimeStats(s),
    })
    runtimeRef.current = runtime
    renderer.frameHooks.add((dt) => runtime.tick(dt))

    void renderer.sync()

    return () => {
      runtime.dispose()
      renderer.dispose()
      rendererRef.current = null
      runtimeRef.current = null
    }
     
  }, [doc])

  // asset resolver
  const assets = useEditor((s) => s.assets)
  const assetMap = useRef(new Map<string, string>())
  useEffect(() => {
    const map = new Map<string, string>()
    for (const a of assets) map.set(a.id, assetUrlOf(a.id))
    assetMap.current = map
    if (rendererRef.current && useEditor.getState().doc) {
      rendererRef.current.setDocument(useEditor.getState().doc!, resolveAssetGlobal)
      void rendererRef.current.sync()
    }
  }, [assets])

  // ── sync on doc change ──
  useEffect(() => {
    if (rendererRef.current && doc) void rendererRef.current.sync()
  }, [docVersion, doc])

  // selection → renderer
  useEffect(() => {
    rendererRef.current?.setSelection(selection)
  }, [selection])

  // tools
  useEffect(() => { rendererRef.current?.setTool(tool) }, [tool])
  useEffect(() => { rendererRef.current?.setSnap(snap) }, [snap])
  useEffect(() => { rendererRef.current?.setQuality(quality) }, [quality])
  useEffect(() => { rendererRef.current?.setCameraMode(cameraMode) }, [cameraMode])
  useEffect(() => { rendererRef.current?.gridVisible(gridVisible) }, [gridVisible])

  // ── pointer selection ──
  const pointerDown = useRef<{ x: number; y: number; button: number; shift: boolean } | null>(null)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDown.current = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey }
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const p = pointerDown.current
    pointerDown.current = null
    if (!p || !rendererRef.current) return
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (moved > 6 || p.button !== 0) return // drag or right-click → camera op
    if (rendererRef.current.cameraMode() === 'fps') return
    const id = rendererRef.current.pick(e.clientX, e.clientY)
    useEditor.getState().selectEntity(id, p.shift)
  }, [])

  const play = () => runtimeRef.current?.play()
  const pause = () => runtimeRef.current?.pause()
  const stop = () => runtimeRef.current?.stop()
  const step = () => runtimeRef.current?.step()
  const restart = () => runtimeRef.current?.restart()

  const stats = useEditor((s) => s.stats)

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0d1117]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />

      {/* top-left tool bar */}
      <TooltipProvider delayDuration={200}>
        <div className="absolute left-2 top-2 flex flex-wrap gap-1 rounded-lg bg-black/60 p-1 backdrop-blur-sm">
          <ToolBtn active={tool === 'translate'} onClick={() => useEditor.getState().setTool('translate')} label="Déplacer (gizmo)"><Move className="h-4 w-4" /></ToolBtn>
          <ToolBtn active={tool === 'rotate'} onClick={() => useEditor.getState().setTool('rotate')} label="Rotation"><RotateCw className="h-4 w-4" /></ToolBtn>
          <ToolBtn active={tool === 'scale'} onClick={() => useEditor.getState().setTool('scale')} label="Échelle"><Maximize className="h-4 w-4" /></ToolBtn>
          <ToolBtn active={snap} onClick={() => useEditor.getState().setSnap(!snap)} label="Snapping (0.5m / 15°)"><Grid3X3 className="h-4 w-4" /></ToolBtn>
          <ToolBtn active={gridVisible} onClick={() => useEditor.getState().setGridVisible(!gridVisible)} label="Grille & axes"><Eye className="h-4 w-4" /></ToolBtn>
          <ToolBtn
            active={cameraMode === 'fps'}
            onClick={() => useEditor.getState().setCameraMode(cameraMode === 'fps' ? 'orbit' : 'fps')}
            label="Caméra FPS (clic pour verrouiller, Échap pour sortir)"
          >
            <Gamepad2 className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn onClick={() => rendererRef.current?.focusSelected()} label="Focus sélection (Centrer caméra)"><Focus className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => rendererRef.current?.frameSelected()} label="Frame sélection (Zoom)"><Frame className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => { const s = useEditor.getState(); if (s.doc?.canUndo()) { s.doc.undo(); s.bumpVersion(); s.markDirty() } }} label="Annuler (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => { const s = useEditor.getState(); if (s.doc?.canRedo()) { s.doc.redo(); s.bumpVersion(); s.markDirty() } }} label="Rétablir (Ctrl+Y)"><Redo2 className="h-4 w-4" /></ToolBtn>
        </div>

        {/* play controls */}
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1 rounded-lg bg-black/60 p-1 backdrop-blur-sm">
          {runtimeState !== 'playing' && (
            <ToolBtn onClick={play} label="PLAY — lance physique + scripts + IA" highlight>
              <Play className="h-4 w-4 text-green-400" />
            </ToolBtn>
          )}
          {runtimeState === 'playing' && (
            <ToolBtn onClick={pause} label="PAUSE"><Pause className="h-4 w-4 text-yellow-400" /></ToolBtn>
          )}
          {(runtimeState === 'playing' || runtimeState === 'paused') && (
            <ToolBtn onClick={stop} label="STOP — restaure la scène"><Square className="h-4 w-4 text-red-400" /></ToolBtn>
          )}
          <ToolBtn onClick={step} label="STEP — avance d'une frame"><StepIcon /></ToolBtn>
          <ToolBtn onClick={restart} label="RESTART"><Redo2 className="h-4 w-4" /></ToolBtn>
          <span className={`mx-1 self-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            runtimeState === 'playing' ? 'bg-green-500/20 text-green-400' :
            runtimeState === 'paused' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
          }`}>
            {runtimeState}
          </span>
        </div>

        {/* stats overlay */}
        <div className="pointer-events-none absolute right-2 top-2 rounded-lg bg-black/60 px-3 py-2 text-right font-mono text-[10px] leading-4 text-gray-300 backdrop-blur-sm">
          <div><span className="text-gray-500">FPS</span> {stats?.fps ?? '—'}</div>
          <div><span className="text-gray-500">Draws</span> {stats?.drawCalls ?? '—'}</div>
          <div><span className="text-gray-500">Tris</span> {stats?.triangles?.toLocaleString() ?? '—'}</div>
          <div><span className="text-gray-500">Qualité</span> {quality}</div>
        </div>

        {/* camera mode hint */}
        {cameraMode === 'fps' && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1.5 text-xs text-gray-300">
            <Camera className="mr-1 inline h-3 w-3" />
            FPS — WASD/ZQSD pour bouger · souris pour regarder · Échap pour quitter
          </div>
        )}
      </TooltipProvider>
      {/* hidden deps to satisfy hooks lint for projectId/assets subscriptions */}
      <span hidden data-project={projectId} data-assets={assets.length} />
    </div>
  )
}

function StepIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M4 5h3v14H4zM8 5l10 7-10 7z" /></svg>
  )
}

function ToolBtn({ children, onClick, label, active, highlight }: {
  children: React.ReactNode; onClick: () => void; label: string; active?: boolean; highlight?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className={`h-8 w-8 ${active ? 'bg-amber-500/25 text-amber-300' : 'text-gray-300 hover:text-white'} ${highlight ? 'ring-1 ring-green-500/50' : ''}`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  )
}
