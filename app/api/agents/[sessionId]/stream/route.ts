/**
 * GET /api/agents/[sessionId]/stream
 *
 * Server-Sent Events (SSE) proxy for a running Managed Agent session.
 * The UI opens this endpoint after dispatching an agent to watch its
 * progress in real time.
 *
 * Events forwarded:
 *   - agent.message     — text output from the agent
 *   - agent.tool_use    — tool calls the agent is making (bash, curl, etc.)
 *   - agent.tool_result — results of tool calls
 *   - agent.done        — session finished
 *   - agent.error       — session errored
 *
 * The UI can use these to show a live activity feed in the modal or sidebar.
 *
 * Auth: same BOTS_DISPATCH_SECRET as the dispatch route, passed as
 * ?token=xxx query param (SSE doesn't support custom headers easily).
 */

import { streamManagedSession } from '@/lib/agents/dispatch-managed'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes — agents can run long

interface RouteParams {
  params: Promise<{ sessionId: string }>
}

export async function GET(
  req: Request,
  { params }: RouteParams,
) {
  const { sessionId } = await params

  // ── Auth: token from query string ──────────────────────────
  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')
  const secret = process.env.BOTS_DISPATCH_SECRET
  if (secret && token !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Stream from Managed Agent ──────────────────────────────
  try {
    const upstreamBody = await streamManagedSession(sessionId)

    // Transform upstream SSE into our own format, adding some
    // structure the UI can use to render a live activity feed
    const transform = new TransformStream({
      transform(chunk, controller) {
        // Pass through the raw SSE from Anthropic's streaming endpoint.
        // The UI-side EventSource parses the data: lines.
        controller.enqueue(chunk)
      },
      flush(controller) {
        // Send a final "done" event so the UI knows the stream ended
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"type":"stream.done"}\n\n'))
      },
    })

    const stream = upstreamBody.pipeThrough(transform)

    return new Response(stream, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      },
    })
  } catch (err) {
    console.error(`[agents/stream] Failed to stream session ${sessionId}:`, err)
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'stream failed',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
