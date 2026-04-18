/**
 * /tasks — agency-wide daily inbox.
 *
 * This is the "what's on my plate across every client" surface. The same
 * TasksPanel is re-used on each client page (scoped by clientId); here it
 * renders unscoped so every open task from every client shows up in one
 * stream. Filters (status / priority / client / search) live inside the
 * panel itself so we don't have to duplicate query state at this layer.
 */

import { TasksPanel } from '@/components/tasks/TasksPanel'

export const dynamic = 'force-dynamic'

export default function TasksPage() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      <div className="mb-8">
        <h1 className="text-white font-bold text-3xl">Tasks</h1>
        <p className="text-white/40 text-sm mt-1">
          Your daily inbox — everything across every client, in one place.
        </p>
      </div>

      <TasksPanel />
    </div>
  )
}
