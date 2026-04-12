/**
 * POST /api/agent/managed
 *
 * Chat-style interface to Managed Agents using the Anthropic TypeScript SDK.
 * The SDK handles all beta header negotiation automatically.
 *
 * Body: {
 *   clientId:   string
 *   messages:   { role: string; content: string }[]
 *   agentId:    string   — chat agent picker value (maps to a managed agent)
 *   sessionId?: string   — existing session to continue (multi-turn)
 * }
 *
 * Returns: SSE stream of agent text output.
 *
 * Flow:
 *   1. Creates a new session (or reuses one for multi-turn)
 *   2. Builds a context-rich user message (Ahrefs data, memory, strategy instructions)
 *   3. Opens the stream FIRST (per docs — avoid race condition)
 *   4. Sends the user message
 *   5. Streams agent events back as SSE (text deltas)
 *   6. After completion, extracts :::strategy blocks and :::memory blocks
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { buildAhrefsContext } from '@/lib/ahrefs-context'
import { buildMemoryContext, writeMemory, extractMemoryFromOutput } from '@/lib/client-memory'
import { dispatchBotForTask } from '@/lib/bots/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Chat agent → Managed Agent ID mapping ─────────────────────────────────
const CHAT_AGENT_MAP: Record<string, string> = {
  'keyword':    process.env.MANAGED_AGENT_ID_KEYWORD    || '',
  'content':    process.env.MANAGED_AGENT_ID_CONTENT    || '',
  'link':       process.env.MANAGED_AGENT_ID_LINK       || '',
  'technical':  process.env.MANAGED_AGENT_ID_TECHNICAL  || '',
  'audit':      process.env.MANAGED_AGENT_ID_AUDIT      || '',
  'analytics':  process.env.MANAGED_AGENT_ID_ANALYTICS  || '',
  'geo':        process.env.MANAGED_AGENT_ID_GEO        || '',
  'optimizer':  process.env.MANAGED_AGENT_ID_OPTIMIZER  || '',
  'alerter':    process.env.MANAGED_AGENT_ID_ALERTER    || '',
  'reporter':   process.env.MANAGED_AGENT_ID_REPORTER   || '',
}

const MANAGED_ENV_ID = process.env.MANAGED_ENVIRONMENT_ID || ''
const MANAGED_VAULT_ID = process.env.MANAGED_VAULT_ID || ''

// ── Strategy format instruction ──────────────────────────────────────────
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
- "priority" must be one of: high, medium, low
- "due_date" should be YYYY-MM-DD format or null
- Include as many tasks as needed
- This block will be parsed automatically — do NOT try to call any API yourself

CRITICAL — Appending tasks to an existing strategy:
- When you want to ADD tasks to an existing strategy, set "strategy_id" to the existing strategy ID.
- When "strategy_id" is null, the system will try to match by name against the client's most recent active strategy.
- DEFAULT BEHAVIOR: When in doubt, APPEND to the existing active strategy.
`.trim()

export async function POST(req: NextRequest) {
  // ── 1. Parse request ──────────────────────────────────────
  let clientId: string
  let messages: { role: string; content: string }[]
  let agentId: string
  let sessionId: string | null

  try {
    const body = await req.json()
    clientId  = body.clientId
    messages  = body.messages
    agentId   = body.agentId || 'keyword'
    sessionId = body.sessionId || null
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !MANAGED_ENV_ID) {
    return new Response(
      JSON.stringify({ error: 'Managed Agents not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!clientId || !messages?.length) {
    return new Response(
      JSON.stringify({ error: 'clientId and messages are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const managedAgentId = CHAT_AGENT_MAP[agentId]
  if (!managedAgentId) {
    return new Response(
      JSON.stringify({ error: `Unknown agent: ${agentId}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 2. Init Supabase + Anthropic SDK ──────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const anthropic = new Anthropic({ apiKey })

  // ── 3. Build context ──────────────────────────────────────
  let ahrefsContext = ''
  let memoryContext = ''
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .single()
    if (client?.domain) {
      ahrefsContext = await buildAhrefsContext({
        supabase,
        clientId,
        domain: client.domain,
      })
    }
  } catch {
    // Non-fatal
  }

  try {
    memoryContext = await buildMemoryContext({ supabase, clientId })
  } catch {
    // Non-fatal
  }

  const lastUserMessage = messages[messages.length - 1]?.content || ''
  const contextBlock = [
    memoryContext ? `\n\n${memoryContext}` : '',
    ahrefsContext ? `\n\n<seo_data>\n${ahrefsContext}\n</seo_data>` : '',
    `\n\n<instructions>\n${STRATEGY_SYSTEM_INSTRUCTION}\n</instructions>`,
  ].join('')

  const userContent = sessionId
    ? lastUserMessage
    : `${lastUserMessage}${contextBlock}`

  // ── 4. Create or reuse session (via SDK) ──────────────────
  try {
    if (!sessionId) {
      const sessionParams: Parameters<typeof anthropic.beta.sessions.create>[0] = {
        agent: managedAgentId,
        environment_id: MANAGED_ENV_ID,
      }
      if (MANAGED_VAULT_ID) {
        sessionParams.vault_ids = [MANAGED_VAULT_ID]
      }
      console.log('[agent/managed] Creating session via SDK:', JSON.stringify({
        agent: managedAgentId,
        environment_id: MANAGED_ENV_ID,
        vault_ids: MANAGED_VAULT_ID ? [MANAGED_VAULT_ID] : undefined,
      }))
      const session = await anthropic.beta.sessions.create(sessionParams)
      sessionId = session.id
      console.log('[agent/managed] Session created:', sessionId)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[agent/managed] Session creation failed:', errMsg)
    return new Response(
      JSON.stringify({ error: `Session creation failed`, detail: errMsg.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 4b. Create a bot_runs entry so this shows in Bot Runs tab ──
  const chatStartedAt = new Date().toISOString()
  let chatRunId: string | null = null
  try {
    const { data: runRow, error: runErr } = await supabase
      .from('bot_runs')
      .insert({
        client_id:      clientId,
        bot_type:       agentId,
        status:         'running',
        trigger_source: 'chat',
        input: {
          message: lastUserMessage.slice(0, 200),
          agent_id: managedAgentId,
          session_id: sessionId,
          dispatched_via: 'chat',
        },
        started_at: chatStartedAt,
      })
      .select('id')
      .single()
    if (runErr) {
      console.error('[agent/managed] bot_runs insert failed:', runErr.message, runErr.details)
    }
    if (runRow) {
      chatRunId = runRow.id
      console.log('[agent/managed] bot_run created:', chatRunId)
    }
  } catch (err) {
    console.error('[agent/managed] bot_runs insert exception:', err)
    // Non-fatal — chat still works even if bot_runs insert fails
  }

  // ── 5. Open stream FIRST, then send message (per docs) ────
  // "Only events emitted after the stream is opened are delivered,
  //  so open the stream before sending events to avoid a race condition."
  let sdkStream: Awaited<ReturnType<typeof anthropic.beta.sessions.events.stream>>
  try {
    sdkStream = await anthropic.beta.sessions.events.stream(sessionId!)
    console.log('[agent/managed] Stream opened for session:', sessionId)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[agent/managed] Stream open failed:', errMsg)
    return new Response(
      JSON.stringify({ error: `Stream failed`, detail: errMsg.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 6. Send user message ──────────────────────────────────
  try {
    await anthropic.beta.sessions.events.send(sessionId!, {
      events: [{
        type: 'user.message',
        content: [{ type: 'text', text: userContent }],
      }],
    })
    console.log('[agent/managed] User message sent')
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[agent/managed] Send failed:', errMsg)
    return new Response(
      JSON.stringify({ error: `Send failed`, detail: errMsg.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 7. Transform SDK stream → SSE for frontend ───────────
  let fullResponse = ''
  const encoder = new TextEncoder()
  const finalSessionId = sessionId

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of sdkStream) {
          let textChunk = ''

          if (event.type === 'agent.message') {
            for (const block of event.content) {
              if (block.type === 'text' && block.text) {
                textChunk += block.text
              }
            }
          } else if (event.type === 'agent.tool_use') {
            const toolName = event.name || 'tool'
            textChunk = `\n🔧 *Using ${toolName}...*\n`
          } else if (event.type === 'session.status_idle') {
            // Agent finished — flush final data and close
            const meta = JSON.stringify({ sessionId: finalSessionId, done: true })
            controller.enqueue(encoder.encode(`data: ${meta}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))

            // Post-stream processing (non-blocking)
            processAfterStream(supabase, clientId, agentId, fullResponse, chatRunId, chatStartedAt).catch(err =>
              console.error('[agent/managed] Post-stream processing error:', err),
            )

            controller.close()
            return
          } else if (event.type === 'session.status_terminated') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            // Mark as failed if terminated unexpectedly
            if (chatRunId) {
              supabase.from('bot_runs').update({
                status: 'failed',
                error_message: 'Session terminated',
                finished_at: new Date().toISOString(),
              }).eq('id', chatRunId).then(() => {})
            }
            controller.close()
            return
          }

          if (textChunk) {
            fullResponse += textChunk
            const sseData = JSON.stringify({
              choices: [{ delta: { content: textChunk } }],
              sessionId: finalSessionId,
            })
            controller.enqueue(encoder.encode(`data: ${sseData}\n\n`))
          }
        }

        // Stream ended without explicit idle event
        const meta = JSON.stringify({ sessionId: finalSessionId, done: true })
        controller.enqueue(encoder.encode(`data: ${meta}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))

        processAfterStream(supabase, clientId, agentId, fullResponse, chatRunId, chatStartedAt).catch(err =>
          console.error('[agent/managed] Post-stream processing error:', err),
        )

        controller.close()
      } catch (err) {
        console.error('[agent/managed] Stream iteration error:', err)
        const errMsg = err instanceof Error ? err.message : 'Stream error'
        const errData = JSON.stringify({ error: errMsg })
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// ── Post-stream processing ──────────────────────────────────────────────

async function processAfterStream(
  supabase: any,
  clientId: string,
  agentId: string,
  fullResponse: string,
  chatRunId: string | null,
  startedAt: string,
): Promise<void> {
  // Mark the bot_run as succeeded with a summary
  if (chatRunId) {
    const now = new Date().toISOString()
    const durationMs = new Date(now).getTime() - new Date(startedAt).getTime()
    // Build a short summary from the response
    const summaryText = fullResponse
      .replace(/\n🔧 \*Using .*?\*\n/g, '')  // strip tool indicators
      .replace(/:::strategy[\s\S]*?:::/g, '') // strip strategy blocks
      .replace(/:::memory[\s\S]*?:::/g, '')   // strip memory blocks
      .trim()
      .slice(0, 300)
    const summary = summaryText.length > 0
      ? (summaryText.length >= 300 ? summaryText + '…' : summaryText)
      : 'Chat completed'

    try {
      await supabase.from('bot_runs').update({
        status: 'succeeded',
        output: { summary, response_length: fullResponse.length, preview: summaryText.slice(0, 150) },
        finished_at: now,
        duration_ms: durationMs,
      }).eq('id', chatRunId)
    } catch (err) {
      console.error('[agent/managed] Failed to update bot_run:', err)
    }
  }

  // Extract strategy and dispatch bots
  try {
    const newTaskIds = await extractAndSaveStrategy(supabase, clientId, agentId, fullResponse)
    if (newTaskIds.length) {
      console.log(`[agent/managed] Dispatching ${newTaskIds.length} bot(s) for new tasks`)
      await Promise.allSettled(
        newTaskIds.map(tid => dispatchBotForTask({ supabase, taskId: tid, triggerSource: 'task_created' })),
      )
    }
  } catch (err) {
    console.error('[agent/managed] Strategy extraction failed:', err)
  }

  // Extract and save memory entries
  try {
    const memoryEntries = extractMemoryFromOutput({}, fullResponse)
    if (memoryEntries.length > 0) {
      await Promise.allSettled(
        memoryEntries.map(entry =>
          writeMemory(supabase, { ...entry, clientId, agent: entry.agent || agentId }),
        ),
      )
      console.log(`[agent/managed] Saved ${memoryEntries.length} memory entries`)
    }
  } catch (err) {
    console.error('[agent/managed] Memory extraction failed:', err)
  }
}

// ── Strategy extraction ─────────────────────────────────────────────────

async function extractAndSaveStrategy(
  supabase: any,
  clientId: string,
  agentId: string,
  responseText: string,
): Promise<string[]> {
  const match = responseText.match(/:::strategy\s*\n([\s\S]*?)\n:::/)
  if (!match) return []

  let parsed: any
  try {
    parsed = JSON.parse(match[1])
  } catch {
    console.warn('[agent/managed] Invalid :::strategy JSON')
    return []
  }

  if (!parsed.name) return []

  const validTypes = [
    'content', 'technical', 'link', 'meta', 'other',
    'analytics', 'audit', 'keyword', 'geo', 'optimizer', 'alerter', 'reporter',
  ]
  const validPriorities = ['high', 'medium', 'low']

  try {
    let strategyId: string | null = null

    if (parsed.strategy_id) {
      const { data } = await supabase.from('strategies').select('id')
        .eq('id', parsed.strategy_id).eq('client_id', clientId).single()
      if (data) strategyId = data.id
    }

    if (!strategyId) {
      const { data } = await supabase.from('strategies').select('id')
        .eq('client_id', clientId).eq('status', 'active')
        .ilike('name', parsed.name).order('created_at', { ascending: false })
        .limit(1).maybeSingle()
      if (data) strategyId = data.id
    }

    if (!strategyId) {
      const { data } = await supabase.from('strategies').select('id, name')
        .eq('client_id', clientId).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) strategyId = data.id
    }

    if (!strategyId) {
      const { data, error } = await supabase.from('strategies')
        .insert({ client_id: clientId, name: parsed.name, description: parsed.description || null })
        .select('id').single()
      if (error || !data) return []
      strategyId = data.id
    }

    if (parsed.tasks?.length) {
      const KNOWN_FIELDS = new Set(['title', 'description', 'type', 'priority', 'due_date', 'assigned_agent', 'notes'])
      const taskRows = parsed.tasks.map((t: any) => {
        const metadata: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(t)) {
          if (!KNOWN_FIELDS.has(k) && v !== undefined && v !== null) metadata[k] = v
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

      const { data: inserted, error } = await supabase
        .from('strategy_tasks').insert(taskRows).select('id')
      if (error) { console.error('[agent/managed] Task insert failed:', error); return [] }
      return (inserted ?? []).map((t: { id: string }) => t.id)
    }

    return []
  } catch (err) {
    console.error('[agent/managed] Strategy save error:', err)
    return []
  }
}
