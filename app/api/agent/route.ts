import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildAhrefsContext } from '@/lib/ahrefs-context'
import { dispatchBotForTask } from '@/lib/bots/dispatch'

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
  "strategy_id": null,
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to be done",
      "type": "content|technical|link|keyword|meta|analytics|audit|geo|optimizer|alerter|reporter|other",
      "priority": "high|medium|low",
      "due_date": "YYYY-MM-DD or null",
      "assigned_agent": "agent name or null",
      "notes": "optional notes",
      "link_targets": [
        { "domain": "example.com", "angle": "why this site, what to pitch" }
      ]
    }
  ]
}
:::

Rules for the :::strategy block:
- Only include it when a strategy or set of tasks has been agreed upon or finalized
- The JSON must be valid — no trailing commas, no comments
- "type" must be one of: content, technical, link, keyword, meta, analytics, audit, geo, optimizer, alerter, reporter, other
- Types analytics | audit | keyword | geo | optimizer | alerter | reporter are dispatched to
  OpenClaw operational agents via the gateway bridge. They run autonomously and update
  bot_runs themselves. Use these types when the work is research-, crawl-, or reporting-heavy
  and would time out inside the dashboard's serverless lambda.
- "priority" must be one of: high, medium, low
- "due_date" should be YYYY-MM-DD format or null
- Include as many tasks as needed
- This block will be parsed automatically — do NOT try to call any API yourself

CRITICAL — Appending tasks to an existing strategy:
- When you want to ADD tasks to an existing strategy (e.g. the user says "add this to the
  current strategy", "also do X", "add a recurring analytics task"), set "strategy_id" to
  the ID of the existing strategy. You can see existing strategy IDs in the conversation
  context or prior :::strategy blocks.
- When "strategy_id" is set, the tasks are APPENDED to that strategy — no new row is created.
- When "strategy_id" is null or omitted, the system will STILL try to match by name against
  the client's most recent active strategy. If the name matches, tasks are appended.
- Only set "strategy_id" to null AND use a brand new name when you genuinely intend to start
  a completely new strategy.
- DEFAULT BEHAVIOR: When in doubt, APPEND to the existing active strategy rather than
  creating a new one. Most clients should have ONE active strategy at a time.

Link Bot modes:
- For a "link" type task, you can OPTIONALLY include a "link_targets" array
  when you want to hand-pick 10-15 prospects yourself (niche blogs, trade
  associations, podcasts, local directories, complementary services, guest
  post opportunities). Each target needs a "domain" and an "angle" — a short
  plain-English note on WHY this site and WHAT to pitch. The Link Bot will
  use your list instead of running Ahrefs gap analysis, research each one,
  and draft personalized outreach.
- If you OMIT "link_targets", the Link Bot falls back to automated Ahrefs
  link-gap analysis. This mode requires a client with meaningful backlink
  data (roughly DR 15+, 20+ referring domains). For early-stage clients,
  prefer the strategist-picked "link_targets" mode.
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
        // Returns task IDs that were inserted, so we can dispatch bots
        // for them BEFORE the stream closes (otherwise the lambda gets
        // frozen and any in-flight outbound work dies).
        const newTaskIds = await extractAndSaveStrategy(supabase, clientId, agentId, fullResponse)

        // ── 9. Dispatch bots for new tasks (in-process, awaited) ──
        // We call dispatchBotForTask directly instead of going over HTTP
        // to /api/bots/dispatch. This avoids fire-and-forget unreliability
        // on Vercel serverless and removes the BOTS_DISPATCH_SECRET round
        // trip entirely. Each dispatch writes its own bot_runs ledger entry.
        if (newTaskIds.length) {
          console.log(`[agent] Dispatching ${newTaskIds.length} bot(s) in-process for new tasks`)
          const dispatchResults = await Promise.allSettled(
            newTaskIds.map(taskId =>
              dispatchBotForTask({
                supabase,
                taskId,
                triggerSource: 'task_created',
              })
            )
          )
          for (const [i, r] of dispatchResults.entries()) {
            if (r.status === 'rejected') {
              console.error(`[agent] Bot dispatch failed for task ${newTaskIds[i]}:`, r.reason)
            } else {
              console.log(`[agent] Bot dispatch result for task ${newTaskIds[i]}:`, r.value)
            }
          }
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

// ── Helper: extract :::strategy block and write to Supabase ──
// Returns the IDs of newly inserted strategy_tasks so the caller can
// dispatch bots for them in-process before the stream closes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractAndSaveStrategy(
  supabase: any,
  clientId: string,
  agentId: string,
  responseText: string,
): Promise<string[]> {
  // Look for :::strategy ... ::: block
  const match = responseText.match(/:::strategy\s*\n([\s\S]*?)\n:::/)
  if (!match) return [] // No strategy block — nothing to do

  let parsed: {
    name: string
    description?: string
    strategy_id?: string | null
    tasks?: {
      title: string
      description?: string
      type?: string
      priority?: string
      due_date?: string | null
      assigned_agent?: string | null
      notes?: string | null
      // Strategist-provided hints that flow into strategy_tasks.metadata.
      // Bots read these to enter alternate execution modes.
      link_targets?: { domain: string; angle?: string }[]
      // Any other unknown keys also get dumped into metadata so we don't
      // have to bump the parser every time the prompt grows a new field.
      [key: string]: unknown
    }[]
  }

  try {
    parsed = JSON.parse(match[1])
  } catch (err) {
    console.warn('[agent] Found :::strategy block but JSON was invalid:', err)
    return []
  }

  if (!parsed.name) {
    console.warn('[agent] Strategy block missing "name" field — skipping')
    return []
  }

  const validTypes = [
    // inline bots
    'content', 'technical', 'link', 'meta', 'other',
    // gateway-spawned operational agents (routed via dispatch-gateway.ts)
    'analytics', 'audit', 'keyword', 'geo', 'optimizer', 'alerter', 'reporter',
  ]
  const validPriorities = ['high', 'medium', 'low']

  try {
    // ── 1. Resolve strategy: reuse existing or create new ──────────
    // Priority order:
    //   a) explicit strategy_id from the :::strategy block
    //   b) name-match against client's most recent active strategy
    //   c) fall back to creating a new row
    let strategyId: string | null = null

    // (a) Explicit ID provided by strategist
    if (parsed.strategy_id) {
      const { data: existing } = await supabase
        .from('strategies')
        .select('id')
        .eq('id', parsed.strategy_id)
        .eq('client_id', clientId)
        .single()

      if (existing) {
        strategyId = existing.id
        console.log(`[agent] Appending tasks to existing strategy ${strategyId} (explicit ID)`)
      }
    }

    // (b) Name match — look for an active strategy with the same name
    if (!strategyId) {
      const { data: nameMatch } = await supabase
        .from('strategies')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .ilike('name', parsed.name)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (nameMatch) {
        strategyId = nameMatch.id
        console.log(`[agent] Appending tasks to existing strategy ${strategyId} (name match: "${parsed.name}")`)
      }
    }

    // (b2) If no name match, try the most recent active strategy for this client
    //      This handles cases like "add this to the current strategy" where the
    //      strategist gives a slightly different name.
    if (!strategyId) {
      const { data: mostRecent } = await supabase
        .from('strategies')
        .select('id, name')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (mostRecent) {
        strategyId = mostRecent.id
        console.log(`[agent] Appending tasks to most recent active strategy ${strategyId} ("${mostRecent.name}")`)
        // Optionally update the description if the strategist provided a new one
        if (parsed.description) {
          await supabase
            .from('strategies')
            .update({ description: parsed.description, updated_at: new Date().toISOString() })
            .eq('id', strategyId)
        }
      }
    }

    // (c) No existing strategy found — create a new one
    if (!strategyId) {
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
        return []
      }
      strategyId = strategy.id
      console.log(`[agent] Created NEW strategy "${parsed.name}" (${strategyId}) for client ${clientId}`)
    }

    // 2. Insert tasks if any
    if (parsed.tasks && parsed.tasks.length > 0) {
      // Fields that map to their own columns — everything else becomes metadata
      const KNOWN_TASK_FIELDS = new Set([
        'title', 'description', 'type', 'priority',
        'due_date', 'assigned_agent', 'notes',
      ])

      const taskRows = parsed.tasks.map((t) => {
        // Collect any fields the strategist included that AREN'T column-mapped.
        // This is how link_targets (and any future per-task hints) flows through.
        const metadata: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(t)) {
          if (!KNOWN_TASK_FIELDS.has(k) && v !== undefined && v !== null) {
            metadata[k] = v
          }
        }

        return {
          strategy_id: strategyId,
          client_id: clientId,
          title: t.title,
          description: t.description || null,
          type: validTypes.includes(t.type || '') ? t.type : 'other',
          priority: validPriorities.includes(t.priority || '') ? t.priority : 'medium',
          due_date: t.due_date || null,
          assigned_agent: t.assigned_agent || agentId,
          notes: t.notes || null,
          metadata,
        }
      })

      const { data: insertedTasks, error: tasksErr } = await supabase
        .from('strategy_tasks')
        .insert(taskRows)
        .select('id, type')

      if (tasksErr) {
        console.error('[agent] Failed to insert strategy tasks:', tasksErr)
        return []
      }

      console.log(`[agent] Inserted ${(insertedTasks ?? []).length} tasks for strategy "${parsed.name}"`)
      return (insertedTasks ?? []).map((t: { id: string }) => t.id)
    }

    return []
  } catch (err) {
    console.error('[agent] Unexpected error saving strategy:', err)
    return []
  }
}
