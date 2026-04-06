import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes — allows long agent responses

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN

export async function POST(req: NextRequest) {
  // ── 1. Parse request body safely ──────────────────────────
  let clientId: string
  let messages: { role: string; content: string }[]
  let agentId: string

  try {
    const body = await req.json()
    clientId = body.clientId
    messages = body.messages
    agentId = body.agentId || 'seo-co-strategist'
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Invalid or oversized request body',
        detail: 'Your message may be too long. Try shortening your input or starting a new conversation.',
      }),
      { status: 413, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 2. Validate env + required fields ─────────────────────
  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'OpenClaw gateway not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!clientId || !messages?.length) {
    return new Response(
      JSON.stringify({ error: 'clientId and messages are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 3. Init Supabase ──────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const prompt = messages[messages.length - 1]?.content || ''

  // ── 4. Log task start (non-blocking — won't kill the request) ──
  let taskId: string | null = null
  try {
    const { data: task } = await (supabase as any)
      .from('agent_tasks')
      .insert({ client_id: clientId, agent_id: agentId, prompt, status: 'running' })
      .select('id')
      .single()
    taskId = task?.id ?? null
  } catch (err) {
    // Log but don't block — the chat should still work even if task logging fails
    console.warn('[agent] Failed to log task start:', err)
  }

  // ── 5. Call OpenClaw with streaming ───────────────────────
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw/${agentId}`,
        messages,
        stream: true,
      }),
    })
  } catch {
    await updateTaskStatus(supabase, taskId, 'error')
    return new Response(
      JSON.stringify({ error: 'Failed to reach OpenClaw gateway' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!upstreamRes.ok) {
    const errorBody = await upstreamRes.text().catch(() => 'Unknown error')
    await updateTaskStatus(supabase, taskId, 'error')
    return new Response(
      JSON.stringify({
        error: 'Agent request failed',
        detail: `Upstream returned ${upstreamRes.status}: ${errorBody.slice(0, 500)}`,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 6. Stream response back, accumulate for logging ───────
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body!.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ''

      let chunkCount = 0
      let rawBytes = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunkCount++
          rawBytes += value.byteLength
          const chunk = decoder.decode(value, { stream: true })
          controller.enqueue(new TextEncoder().encode(chunk))

          // Log first few chunks for debugging empty responses
          if (chunkCount <= 3) {
            console.log(`[agent] Chunk #${chunkCount} (${value.byteLength} bytes):`, chunk.slice(0, 300))
          }

          // Accumulate response text from SSE chunks
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6))
                // Try multiple response formats (OpenAI-style delta, or full message)
                const content =
                  data.choices?.[0]?.delta?.content ||
                  data.choices?.[0]?.message?.content ||
                  data.choices?.[0]?.text ||
                  ''
                fullResponse += content
              } catch {
                // Skip malformed SSE chunks
              }
            }
          }
        }

        console.log(`[agent] Stream complete: ${chunkCount} chunks, ${rawBytes} bytes, response length: ${fullResponse.length}`)

        // Mark task complete with full response
        if (taskId) {
          await (supabase as any)
            .from('agent_tasks')
            .update({
              status: 'completed',
              response: fullResponse,
              completed_at: new Date().toISOString(),
            })
            .eq('id', taskId)
        }
      } catch (err) {
        console.error('[agent] Stream error:', err)
        await updateTaskStatus(supabase, taskId, 'error')
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ── Helper: safe task status update ───────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateTaskStatus(
  supabase: any,
  taskId: string | null,
  status: 'completed' | 'error'
) {
  if (!taskId) return
  try {
    await supabase
      .from('agent_tasks')
      .update({ status, completed_at: new Date().toISOString() })
      .eq('id', taskId)
  } catch (err) {
    console.warn('[agent] Failed to update task status:', err)
  }
}
