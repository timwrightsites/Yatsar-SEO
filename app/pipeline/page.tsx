/**
 * /pipeline — agency-wide kanban of open tasks, grouped by status.
 *
 * Columns:  To do → In progress → Needs approval → Blocked → Done
 * Drop a card into a different column to change its status. Optimistic
 * updates with rollback on PATCH error.
 *
 * The board itself is a client component (PipelineBoard) — this page
 * is only a thin shell so we can keep the header consistent with the
 * rest of the app's top-level routes (/tasks, /review-queue, etc.).
 */

import { PipelineBoard } from '@/components/pipeline/PipelineBoard'

export const dynamic = 'force-dynamic'

export default function PipelinePage() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      <div className="mb-6">
        <h1 className="text-white font-bold text-3xl">Pipeline</h1>
        <p className="text-white/40 text-sm mt-1">
          Drag cards between columns to move work forward. Filter by client or priority to narrow the board.
        </p>
      </div>

      <PipelineBoard />
    </div>
  )
}
