/**
 * Client Memory — shared context that all agents read and write.
 *
 * Two layers:
 *   1. Structured profile (client_knowledge_bases) — stable facts about the client
 *   2. Running memory log (client_memory) — evolving insights, decisions, findings
 *
 * Agents call `buildMemoryContext()` before responding to get a Markdown block
 * injected into their prompt. After completing a run, they call `writeMemory()`
 * to log what they learned.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

// ── READ: Build memory context for agent prompt injection ───────────────

export async function buildMemoryContext({
  supabase,
  clientId,
}: {
  supabase: Supabase
  clientId: string
}): Promise<string> {
  const sections: string[] = []

  // 1. Structured profile from client_knowledge_bases
  try {
    const { data: kb } = await supabase
      .from('client_knowledge_bases')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle()

    if (kb) {
      const profile: string[] = []
      if (kb.brand_voice) profile.push(`**Brand voice:** ${kb.brand_voice}`)
      if (kb.icp) profile.push(`**Ideal customer:** ${kb.icp}`)
      if (kb.services?.length) profile.push(`**Services:** ${kb.services.join(', ')}`)
      if (kb.locations?.length) profile.push(`**Locations:** ${kb.locations.join(', ')}`)
      if (kb.target_keywords?.length) profile.push(`**Target keywords:** ${kb.target_keywords.join(', ')}`)
      if (kb.competitor_domains?.length) profile.push(`**Competitors:** ${kb.competitor_domains.join(', ')}`)
      if (kb.link_targets?.length) profile.push(`**Link targets:** ${kb.link_targets.join(', ')}`)
      if (kb.tone_keywords?.length) profile.push(`**Tone:** ${kb.tone_keywords.join(', ')}`)
      if (kb.avoid_topics?.length) profile.push(`**Avoid:** ${kb.avoid_topics.join(', ')}`)
      if (kb.content_constraints) profile.push(`**Content constraints:** ${kb.content_constraints}`)
      if (kb.technical_notes) profile.push(`**Technical notes:** ${kb.technical_notes}`)
      if (kb.known_issues) profile.push(`**Known issues:** ${kb.known_issues}`)
      if (kb.wins) profile.push(`**Recent wins:** ${kb.wins}`)
      if (kb.active_campaigns) profile.push(`**Active campaigns:** ${kb.active_campaigns}`)
      if (kb.agent_instructions) profile.push(`**Custom instructions:** ${kb.agent_instructions}`)

      if (profile.length > 0) {
        sections.push(`## Client Profile\n${profile.join('\n')}`)
      }
    }
  } catch {
    // Non-fatal
  }

  // 2. Running memory log — pinned entries first, then recent
  try {
    // Always include all pinned entries
    const { data: pinned } = await supabase
      .from('client_memory')
      .select('agent, category, content, importance, created_at')
      .eq('client_id', clientId)
      .eq('pinned', true)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(20)

    // Recent non-pinned entries (last 30)
    const { data: recent } = await supabase
      .from('client_memory')
      .select('agent, category, content, importance, created_at')
      .eq('client_id', clientId)
      .eq('pinned', false)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(30)

    const entries = [
      ...(pinned ?? []).map((e: MemoryRow) => ({ ...e, _pinned: true })),
      ...(recent ?? []).map((e: MemoryRow) => ({ ...e, _pinned: false })),
    ]

    if (entries.length > 0) {
      const lines = entries.map((e: MemoryRow & { _pinned: boolean }) => {
        const pin = e._pinned ? ' 📌' : ''
        const imp = e.importance === 'high' ? ' ⚡' : ''
        const date = new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return `- [${date}] **${e.agent}** (${e.category})${pin}${imp}: ${e.content}`
      })
      sections.push(`## Agent Memory\n${lines.join('\n')}`)
    }
  } catch {
    // Non-fatal
  }

  if (sections.length === 0) return ''

  return `<client_memory>\n${sections.join('\n\n')}\n</client_memory>`
}

interface MemoryRow {
  agent: string
  category: string
  content: string
  importance: string
  created_at: string
}

// ── WRITE: Agent appends to memory after a run ──────────────────────────

export interface MemoryEntry {
  clientId: string
  agent: string
  category: 'insight' | 'decision' | 'finding' | 'issue' | 'win' | 'preference' | 'system'
  content: string
  importance?: 'low' | 'normal' | 'high'
  sourceRunId?: string
  metadata?: Record<string, unknown>
}

export async function writeMemory(
  supabase: Supabase,
  entry: MemoryEntry,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('client_memory')
      .insert({
        client_id: entry.clientId,
        agent: entry.agent,
        category: entry.category,
        content: entry.content,
        importance: entry.importance ?? 'normal',
        source_run_id: entry.sourceRunId ?? null,
        metadata: entry.metadata ?? {},
      })
      .select('id')
      .single()

    if (error) {
      console.error('[client-memory] Write failed:', error.message)
      return null
    }
    return data.id
  } catch (err) {
    console.error('[client-memory] Write error:', err)
    return null
  }
}

// ── WRITE: Auto-log a bot run completion ────────────────────────────────

export async function logRunToMemory(
  supabase: Supabase,
  opts: {
    clientId: string
    botType: string
    runId: string
    status: 'succeeded' | 'failed'
    summary: string
    noteworthy: boolean
  },
): Promise<void> {
  // Always log a system-level entry for the run
  await writeMemory(supabase, {
    clientId: opts.clientId,
    agent: opts.botType,
    category: 'system',
    content: opts.status === 'succeeded'
      ? `Completed run: ${opts.summary || 'no summary'}`
      : `Run failed: ${opts.summary || 'unknown error'}`,
    importance: 'low',
    sourceRunId: opts.runId,
  })

  // If the agent flagged something noteworthy, log it as an insight/finding
  if (opts.noteworthy && opts.summary) {
    await writeMemory(supabase, {
      clientId: opts.clientId,
      agent: opts.botType,
      category: opts.status === 'failed' ? 'issue' : 'finding',
      content: opts.summary,
      importance: 'high',
      sourceRunId: opts.runId,
    })
  }
}

// ── EXTRACT: Parse memory entries from agent output ─────────────────────
// Agents can include a :::memory block in their response to write entries

export function extractMemoryFromOutput(
  output: Record<string, unknown>,
  agentOutput?: string,
): Array<Omit<MemoryEntry, 'clientId'>> {
  const entries: Array<Omit<MemoryEntry, 'clientId'>> = []

  // Check for structured memory_entries in output
  if (Array.isArray(output.memory_entries)) {
    for (const e of output.memory_entries) {
      if (typeof e.content === 'string' && e.content.length > 0) {
        entries.push({
          agent: (e.agent as string) || 'unknown',
          category: e.category || 'insight',
          content: e.content,
          importance: e.importance || 'normal',
        })
      }
    }
  }

  // Check for :::memory blocks in raw text output
  const text = agentOutput || (typeof output.raw_output === 'string' ? output.raw_output : '')
  const memoryMatch = text.match(/:::memory\s*\n([\s\S]*?)\n:::/g)
  if (memoryMatch) {
    for (const block of memoryMatch) {
      const jsonStr = block.replace(/:::memory\s*\n/, '').replace(/\n:::/, '')
      try {
        const parsed = JSON.parse(jsonStr)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (typeof item.content === 'string') {
            entries.push({
              agent: item.agent || 'unknown',
              category: item.category || 'insight',
              content: item.content,
              importance: item.importance || 'normal',
            })
          }
        }
      } catch {
        // Not valid JSON — treat the whole block as a single insight
        entries.push({
          agent: 'unknown',
          category: 'insight',
          content: jsonStr.trim(),
          importance: 'normal',
        })
      }
    }
  }

  return entries
}
