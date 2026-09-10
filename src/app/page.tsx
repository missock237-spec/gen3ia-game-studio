'use client'
// GEN3IA GAME STUDIO — entry point (single-page editor).
import dynamic from 'next/dynamic'

const EditorShell = dynamic(() => import('@/components/editor/EditorShell'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f16]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p className="text-xs text-gray-500">GEN3IA GAME STUDIO — initialisation…</p>
      </div>
    </div>
  ),
})

export default function Home() {
  return <EditorShell />
}
