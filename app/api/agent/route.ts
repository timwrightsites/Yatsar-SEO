import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildAhrefsContext } from '@/lib/ahrefs-context'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes — allows long agent responses

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN

// ── Strategy format instruction injected into agent context ────
const STRATEGY_SYSTEM_INSTRUCTION = `
IMPORTANT: When you define, propose, or finalize a strategy for a client — including tasks,
phases, or action items — you MUST include a structured block at the END of your response
using this exact format so it is saved to the dashboard automatically:

:::strategy
{
  "name": "Strategy Name Here",
  "description": "One-line summary of the strategy",
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to be done",
      "type": "content|technical|link|keyword|meta|other",
      "priority": "high|medium|low",
      "due_date": "YYYY-MM-DD or null",
      "assigned_agent": "agent name or null",
      "notes": "optional notes"
    }
  ]
}
:::

Rules for the :::strategy block:
- Only include it when a strategy or set of tasks has been agreed upon or finalized
- The JSON must be valid — no trailing commas, no comments
- "type" must be one of: content, technical, link, keyword, meta, other
- "priority" must be one of: high, medium, low
- "due_date" should be YYYY-MM-DD format or null
- Include as many tasks as needed
- This block will be parsed automatically — do NOT try to call any API yourself
`.trim()

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

  // ── 5a. Pull the client's domain so we can build Ahrefs context ──
  let clientDomain: string | null = null
  try {
    const { data: client } = await (supabase as any)
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .single()
    clientDomain = client?.domain ?? null
  } catch (err) {
    console.warn('[agent] Failed to load client domain for Ahrefs context:', err)
  }

  // ── 5b. Build Ahrefs context (cached, ~0 cost on warm cache) ──
  // This gives the strategist real visibility into the client's SEO state
  // (DR, top keywords, top pages, competitors) instead of guessing.
  // Returns '' if AHREFS_API_KEY is missing or any fetch fails — chat still works.
  let ahrefsContext = ''
  if (clientDomain) {
    ahrefsContext = await buildAhrefsContext({
      supabase,
      clientId,
      domain: clientDomain,
    })
  }

  // ── 5c. Assemble the system messages ──
  // Order matters: data context first (so the model has facts in working
  // memory), then formatting rules (so it knows how to emit tasks).
  const systemMessages: { role: string; content: string }[] = []
  if (ahrefsContext) {
    systemMessages.push({ role: 'system', content: ahrefsContext })
  }
  systemMessages.push({ role: 'system', content: STRATEGY_SYSTEM_INSTRUCTION })

  const augmentedMessages = [
    ...systemMessages,
    ...messages,
  ]

  // ── 6. Call OpenClaw with streaming ───────────────────────
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
        messages: augmentedMessages,
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

  // ── 7. Stream response back, accumulate for logging + strategy extraction ───
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

        // ── 8. Extract and save strategy if present ──────────
        await extractAndSaveStrategy(supabase, clientId, agentId, fullResponse)

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

// ── Helper: extract :::strategy block and write to Supabase ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractAndSaveStrategy(
  supabase: any,
  clientId: string,
  agentId: string,
  responseText: string,
) {
  // Look for :::strategy ... ::: block
  const match = responseText.match(/:::strategy\s*\n([\s\S]*?)\n:::/)
  if (!match) return // No strategy block — nothing to do

  let parsed: {
    name: string
    description?: string
    tasks?: {
      title: string
      description?: string
      type?: string
      priority?: string
      due_date?: string | null
      assigned_agent?: string | null
      notes?: string | null
    }[]
  }

  try {
    parsed = JSON.parse(match[1])
  } catch (err) {
    console.warn('[agent] Found :::strategy block but JSON was invalid:', err)
    return
  }

  if (!parsed.name) {
    console.warn('[agent] Strategy block missing "name" field — skipping')
    return
  }

  const validTypes = ['content', 'technical', 'link', 'keyword', 'meta', 'other']
  const validPriorities = ['high', 'medium', 'low']

  try {
    // 1. Create the strategy row
    const { data: strategy, error: stratErr } = await supabase
      .from('strategies')
      .insert({
        client_id: clientId,
        name: parsed.name,
        description: parsed.description || null,
      })
      .select('id')
      .single()

    if (stratErr || !strategy) {
      console.error('[agent] Failed to create strategy:', stratErr)
      return
    }

    console.log(`[agent] Created strategy "${parsed.name}" (${strategy.id}) for client ${clientId}`)

    // 2. Insert tasks if any
    if (parsed.tasks && parsed.tasks.length > 0) {
      const taskRows = parsed.tasks.map((t) => ({
        strategy_id: strategy.id,
        client_id: clientId,
        title: t.title,
        description: t.description || null,
        type: validTypes.includes(t.type || '') ? t.type : 'other',
        priority: validPriorities.includes(t.priority || '') ? t.priority : 'medium',
        due_date: t.due_date || null,
        assigned_agent: t.assigned_agent || agentId,
        notes: t.notes || null,
      }))

      const { data: insertedTasks, error: tasksErr } = await supabase
        .from('strategy_tasks')
        .insert(taskRows)
        .select('id, type')

      if (tasksErr) {
        console.error('[agent] Failed to insert strategy tasks:', tasksErr)
      } else {
        console.log(`[agent] Inserted ${(insertedTasks ?? []).length} tasks for strategy "${parsed.name}"`)

        // ── Auto-dispatch each new task to the bot system ──
        // Fire-and-forget — we don't await these so the chat response stays
        // snappy. The dispatch route writes its own bot_runs ledger entries
        // and updates strategy_task status as bots progress.
        if (insertedTasks?.length) {
          dispatchTasksInBackground(insertedTasks.map((t: { id: string }) => t.id))
        }
      }
    }
  } catch (err) {
    console.error('[agent] Unexpected error saving strategy:', err)
  }
}

// ── Helper: fire-and-forget bot dispatch for newly created tasks ──
// Calls our own /api/bots/dispatch route in the background. We don't
// await — the chat response should not be blocked by bot work, and the
// dispatcher writes its own bot_runs ledger entries.
function dispatchTasksInBackground(taskIds: string[]) {
  const baseUrl =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const secret = process.env.BOTS_DISPATCH_SECRET

  for (const taskId of taskIds) {
    fetch(`${baseUrl}/api/bots/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ taskId, triggerSource: 'task_created' }),
    }).catch(err => {
      console.warn(`[agent] Background dispatch failed for task ${taskId}:`, err)
    })
  }
}
