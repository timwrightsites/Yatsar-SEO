/**
 * POST /api/agent/managed
 *
 * Chat-style interface to Managed Agents. Replaces the OpenClaw
 * /v1/chat/completions proxy with Anthropic's Managed Agents API.
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
 * The route:
 *   1. Creates a new session (or reuses one for multi-turn)
 *   2. Builds a context-rich user message (Ahrefs data, strategy instructions)
 *   3. Sends it to the managed agent
 *   4. Streams agent events back as SSE (text deltas)
 *   5. Extracts :::strategy blocks from the full response and saves tasks
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildAhrefsContext } from '@/lib/ahrefs-context'
import { buildMemoryContext, writeMemory, extractMemoryFromOutput } from '@/lib/client-memory'
import { dispatchBotForTask } from '@/lib/bots/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Chat agent → Managed Agent ID mapping ─────────────────────────────────
// Maps the chat dropdown agent keys to env-var-based Managed Agent IDs.
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

// ── Strategy format instruction (same as original route) ──────────────────
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

  // ── 2. Init Supabase ──────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

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

  // Build the user message with context
  const lastUserMessage = messages[messages.length - 1]?.content || ''
  const contextBlock = [
    memoryContext ? `\n\n${memoryContext}` : '',
    ahrefsContext ? `\n\n<seo_data>\n${ahrefsContext}\n</seo_data>` : '',
    `\n\n<instructions>\n${STRATEGY_SYSTEM_INSTRUCTION}\n</instructions>`,
  ].join('')

  // For multi-turn, only send the latest message (session has history)
  // For first turn, include full context
  const userContent = sessionId
    ? lastUserMessage
    : `${lastUserMessage}${contextBlock}`

  // ── 4. Create or reuse session ────────────────────────────
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'managed-agents-2026-04-01',
    'content-type': 'application/json',
  }

  try {
    if (!sessionId) {
      const sessionConfig: Record<string, unknown> = {
        agent: managedAgentId,
        environment_id: MANAGED_ENV_ID,
      }
      if (MANAGED_VAULT_ID) {
        sessionConfig.vault_ids = [MANAGED_VAULT_ID]
      }
      console.log('[agent/managed] Creating session:', JSON.stringify(sessionConfig))
      const createRes = await fetch('https://api.anthropic.com/v1/sessions?beta=true', {
        method: 'POST',
        headers,
        body: JSON.stringify(sessionConfig),
      })
      if (!createRes.ok) {
        const err = await createRes.text().catch(() => '')
        console.error('[agent/managed] Session creation failed:', createRes.status, err)
        return new Response(
          JSON.stringify({ error: `Session creation failed (${createRes.status})`, detail: err.slice(0, 500) }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }
      const session = await createRes.json()
      sessionId = session.id
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to create agent session', detail: err instanceof Error ? err.message : '' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 5. Send user message ──────────────────────────────────
  try {
    const sendRes = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events?beta=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: [{
          type: 'user.message',
          content: [{ type: 'text', text: userContent }],
        }],
      }),
    })
    if (!sendRes.ok) {
      const err = await sendRes.text().catch(() => '')
      return new Response(
        JSON.stringify({ error: `Send failed: ${sendRes.status}`, detail: err.slice(0, 500) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to send message', detail: err instanceof Error ? err.message : '' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── 6. Stream response back ───────────────────────────────
  const streamRes = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/stream?beta=true`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'managed-agents-2026-04-01',
      'Accept': 'text/event-stream',
    },
  })

  if (!streamRes.ok || !streamRes.body) {
    const err = await streamRes.text().catch(() => '')
    return new Response(
      JSON.stringify({ error: `Stream failed: ${streamRes.status}`, detail: err.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Transform the Managed Agent SSE into OpenAI-compatible SSE format
  // so the existing AgentPanel can parse it with minimal changes.
  //
  // Managed Agents event types (per docs):
  //   agent.message  — text content from the agent (content[].text)
  //   agent.tool_use — agent invoked a tool (name field)
  //   session.status_idle — agent finished processing
  let fullResponse = ''
  let sseBuffer = '' // Buffer for partial SSE lines across chunks

  const transform = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk)
      sseBuffer += text

      // Process complete lines only
      const lines = sseBuffer.split('\n')
      // Keep the last (potentially incomplete) line in the buffer
      sseBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          continue
        }

        try {
          const event = JSON.parse(raw)
          let textChunk = ''

          // agent.message — extract text from content blocks
          if (event.type === 'agent.message' && Array.isArray(event.content)) {
            for (const block of event.content) {
              if (block.type === 'text' && block.text) {
                textChunk += block.text
              }
            }
          }
          // agent.tool_use — show tool usage indicator
          else if (event.type === 'agent.tool_use') {
            const toolName = event.name || 'tool'
            textChunk = `\n🔧 *Using ${toolName}...*\n`
          }
          // session.status_idle — agent finished
          else if (event.type === 'session.status_idle') {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            continue
          }
          // Legacy format fallback — content_block_delta (just in case)
          else if (event.type === 'content_block_delta' && event.delta?.text) {
            textChunk = event.delta.text
          }
          else if (event.type === 'content_block_start' && event.content_block?.text) {
            textChunk = event.content_block.text
          }
          else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const toolName = event.content_block?.name || 'tool'
            textChunk = `\n🔧 *Using ${toolName}...*\n`
          }

          if (textChunk) {
            fullResponse += textChunk
            const sseData = JSON.stringify({
              choices: [{ delta: { content: textChunk } }],
              sessionId,
            })
            controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n\n`))
          }
        } catch {
          // Skip unparseable lines
        }
      }
    },
    async flush(controller) {
      // Send sessionId so the frontend can continue the conversation
      const meta = JSON.stringify({ sessionId, done: true })
      controller.enqueue(new TextEncoder().encode(`data: ${meta}\n\n`))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))

      // ── 7. Extract strategy and dispatch bots ─────────────
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

      // ── 8. Extract and save memory entries ─────────────────
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
    },
  })

  const stream = streamRes.body.pipeThrough(transform)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// ── Strategy extraction (copied from the original route) ─────────────────

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
    // Resolve strategy: reuse existing or create
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
