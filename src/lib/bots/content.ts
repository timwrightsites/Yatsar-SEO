/**
 * Content Bot — generates an SEO content draft via the OpenClaw gateway.
 *
 * Picks up `strategy_tasks` of type='content' (also 'keyword' and 'meta',
 * which route here per `TASK_TYPE_TO_BOT`) and produces a complete article
 * draft tailored to the client's actual keyword landscape.
 *
 * Pipeline:
 *   1. Build a prompt that includes:
 *      - the standing order's scope (the agency's "voice" for content for
 *        this client — e.g. tone, length, structure)
 *      - the task title + description (the assignment from the strategist)
 *      - cached Ahrefs context (DR, top keywords, top pages, competitors)
 *        so the bot writes about gaps the client can actually win, not
 *        random topics from training data
 *   2. Call the OpenClaw gateway with the `writer-agent` operational agent
 *      (Anthropic Claude Sonnet 4.6 — tuned for long-form SEO writing).
 *      Override with CONTENT_BOT_AGENT_ID env var if you want a different
 *      agent for a specific deployment.
 *   3. Parse the response into title / slug / target_keyword / body and
 *      insert into `content_drafts` with status='pending_review'.
 *   4. Update the strategy_task to status='needs_approval', leave a short
 *      summary in `notes`, and point `output_ref` at the draft id.
 *   5. Insert an activity_log entry so the dashboard timeline reflects it.
 *
 * Failure modes:
 *   - Missing OpenClaw env  → escalated
 *   - Gateway non-200       → failed (full body in error_message)
 *   - Empty model output    → failed
 *   - Insert errors         → still return succeeded if the draft text was
 *     generated, but log loudly so we notice
 */

import { buildAhrefsContext } from '../ahrefs-context'
import type {
  BotExecutionResult,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
} from './types'

const GATEWAY_URL   = process.env.OPENCLAW_GATEWAY_URL
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN
const CONTENT_AGENT_ID = process.env.CONTENT_BOT_AGENT_ID || 'writer-agent'

interface ClientRow {
  id:            string
  name:          string
  domain:        string
  pagespeed_url: string | null
}

export interface ContentBotInput {
  supabase:      SupabaseClient
  client:        ClientRow
  task:          StrategyTask
  standingOrder: StandingOrder
}

export async function runContentBot({
  supabase, client, task, standingOrder,
}: ContentBotInput): Promise<BotExecutionResult> {
  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    return {
      status: 'escalated',
      error:  'OPENCLAW_GATEWAY_URL / OPENCLAW_GATEWAY_TOKEN not configured.',
    }
  }

  // ── 1. Pull cached Ahrefs context so the bot can write about gaps the
  // client can actually win. Empty string if Ahrefs is unavailable — the
  // bot still runs, just without keyword grounding.
  let ahrefsContext = ''
  try {
    ahrefsContext = await buildAhrefsContext({
      supabase,
      clientId: client.id,
      domain:   client.domain,
    })
  } catch (err) {
    console.warn('[content-bot] Ahrefs context unavailable:', err)
  }

  // ── 2. Compose the prompt
  const systemPrompt = buildSystemPrompt(client, standingOrder, ahrefsContext)
  const userPrompt   = buildUserPrompt(task)

  // ── 3. Call OpenClaw (non-streaming — we need the full response to parse)
  let raw: string
  try {
    raw = await callOpenClaw(systemPrompt, userPrompt)
  } catch (err) {
    return {
      status: 'failed',
      error:  err instanceof Error ? err.message : 'OpenClaw request failed',
    }
  }

  if (!raw || raw.trim().length < 50) {
    return {
      status: 'failed',
      error:  `Content Bot returned empty or too-short response (${raw?.length ?? 0} chars).`,
    }
  }

  // ── 4. Parse response into structured fields
  const draft = parseDraft(raw, task)

  // ── 5. Insert into content_drafts
  let draftId: string | null = null
  try {
    const { data, error } = await supabase
      .from('content_drafts')
      .insert({
        client_id:      client.id,
        title:          draft.title,
        slug:           draft.slug,
        target_keyword: draft.target_keyword,
        content:        draft.content,
        word_count:     draft.word_count,
        status:         'pending_review',
        agent_id:       CONTENT_AGENT_ID,
        agent_notes:    `Generated for strategy task: ${task.title}`,
      })
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (error) {
      console.error('[content-bot] Failed to insert content_draft:', error)
    } else {
      draftId = data?.id ?? null
    }
  } catch (err) {
    console.error('[content-bot] Unexpected content_draft insert error:', err)
  }

  // ── 6. Update strategy_task — leave a clean handoff for the human reviewer
  const summary = formatSummary(draft, draftId)
  try {
    await supabase
      .from('strategy_tasks')
      .update({
        notes:      summary,
        output_ref: draftId ? `content-bot:draft:${draftId}` : 'content-bot:draft',
        status:     'needs_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)
  } catch (err) {
    console.warn('[content-bot] Failed to update strategy_task:', err)
  }

  // ── 7. Activity log entry
  try {
    await supabase
      .from('activity_logs')
      .insert({
        client_id:  client.id,
        bot_type:   'content',
        event_type: 'draft_created',
        status:     'success',
        message:    `Content Bot drafted "${draft.title}" (${draft.word_count} words)`,
        metadata:   {
          task_id:        task.id,
          draft_id:       draftId,
          target_keyword: draft.target_keyword,
          word_count:     draft.word_count,
        },
      })
  } catch (err) {
    console.warn('[content-bot] Failed to insert activity_log:', err)
  }

  return {
    status:  'succeeded',
    summary,
    output:  {
      draft_id:       draftId,
      title:          draft.title,
      slug:           draft.slug,
      target_keyword: draft.target_keyword,
      word_count:     draft.word_count,
    },
  }
}

// ── Prompt construction ──────────────────────────────────────────────────

function buildSystemPrompt(
  client:        ClientRow,
  standingOrder: StandingOrder,
  ahrefsContext: string,
): string {
  const parts: string[] = []

  parts.push(
    `You are the Content Bot for an SEO agency. You write production-ready ` +
    `article drafts that the agency reviews and publishes on behalf of the client.`,
  )

  parts.push(`Client: ${client.name} (${client.domain})`)

  if (standingOrder.scope) {
    parts.push(`Standing order (how this client wants content done):\n${standingOrder.scope}`)
  }

  if (ahrefsContext) {
    parts.push(`Live SEO context for this client (use it to ground keyword choices):\n${ahrefsContext}`)
  }

  parts.push(
    `Output format — respond with ONLY this exact structure, no preamble:\n` +
    `\n` +
    `TITLE: <article headline, plain text, no markdown>\n` +
    `SLUG: <kebab-case-url-slug>\n` +
    `TARGET_KEYWORD: <primary keyword the article targets>\n` +
    `---\n` +
    `<full article body in Markdown — H2/H3 headings, paragraphs, lists, ` +
    `internal link suggestions written as [anchor text](#suggested-internal-link)>\n`,
  )

  parts.push(
    `Rules:\n` +
    `- Length: aim for 1,000–1,500 words unless the task specifies otherwise.\n` +
    `- Pick a target keyword from the Ahrefs context above when possible — ` +
    `prefer ones where the client is in striking distance (positions 4–20).\n` +
    `- Write in the client's voice; avoid generic SEO filler.\n` +
    `- Do NOT include a :::strategy block. You are not the strategist.\n` +
    `- Do NOT explain what you're doing. Just emit the formatted draft.`,
  )

  // ── GEO (Generative Engine Optimization) instructions ──────────────
  // If the Ahrefs context includes a "GEO visibility" section, the content
  // bot knows which keywords trigger AI Overviews and should structure the
  // article to maximize the chance of being cited in generative answers.
  if (ahrefsContext.includes('GEO (Generative Engine Optimization)')) {
    parts.push(
      `GEO optimization rules (apply ALWAYS when the target keyword appears ` +
      `in the "Keywords with AI Overviews" table above — and apply as a best ` +
      `practice even when it doesn't):\n` +
      `- Lead with a concise, self-contained answer (2–3 sentences) in the ` +
      `first paragraph that directly answers the search intent. AI models ` +
      `cite pages that give a clear answer early.\n` +
      `- Use question-style H2s (e.g. "What is…", "How does…", "Why should…") ` +
      `— these map to the queries AI Overviews synthesize answers from.\n` +
      `- Include a structured data hint block at the end of the article:\n` +
      `  \`\`\`\n` +
      `  <!-- Schema: FAQPage -->\n` +
      `  Q: <rephrase the H2 as a question>\n` +
      `  A: <1-2 sentence summary of that section>\n` +
      `  (repeat for each H2)\n` +
      `  \`\`\`\n` +
      `  The dev team uses this block to generate JSON-LD FAQ schema on publish.\n` +
      `- Add a "Key Takeaways" or "TL;DR" section near the top (after the ` +
      `intro) as a bulleted summary of the 3–5 main points — AI models ` +
      `extract these as citation-ready chunks.\n` +
      `- Where factual claims are made, add inline attribution markers like ` +
      `"[Source: BLS.gov]" or "[Per Ahrefs data]" — AI models prefer ` +
      `content that itself cites sources, because it signals factual grounding.\n` +
      `- Prefer comparison tables and definition lists over long paragraphs ` +
      `for any section that compares options, lists criteria, or defines terms.\n` +
      `- Avoid walls of text. Short paragraphs (2–4 sentences max), generous ` +
      `whitespace, and scannable formatting make the content easier for both ` +
      `humans and AI models to parse.`,
    )
  }

  return parts.join('\n\n')
}

function buildUserPrompt(task: StrategyTask): string {
  const parts: string[] = []
  parts.push(`Write the article for this assignment:`)
  parts.push(`Title: ${task.title}`)
  if (task.description) parts.push(`Description: ${task.description}`)
  parts.push(`Task type: ${task.type}`)
  return parts.join('\n')
}

// ── OpenClaw call (non-streaming) ────────────────────────────────────────

async function callOpenClaw(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: `openclaw/${CONTENT_AGENT_ID}`,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(110_000), // OpenClaw can be slow on long drafts
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenClaw ${res.status}: ${body.slice(0, 400)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    ''

  return typeof content === 'string' ? content : ''
}

// ── Response parsing ─────────────────────────────────────────────────────

interface ParsedDraft {
  title:          string
  slug:           string | null
  target_keyword: string | null
  content:        string
  word_count:     number
}

function parseDraft(raw: string, task: StrategyTask): ParsedDraft {
  // Pull out TITLE / SLUG / TARGET_KEYWORD lines from the header (everything
  // before the first '---' separator). Body is everything after.
  const sepIdx = raw.indexOf('\n---')
  const head   = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw
  const body   = sepIdx >= 0 ? raw.slice(sepIdx + 4).trim() : raw.trim()

  const titleMatch  = head.match(/TITLE:\s*(.+)/i)
  const slugMatch   = head.match(/SLUG:\s*([\w-]+)/i)
  const kwMatch     = head.match(/TARGET_KEYWORD:\s*(.+)/i)

  const title          = (titleMatch?.[1] ?? task.title).trim()
  const slug           = slugMatch?.[1]?.trim() ?? slugify(title)
  const target_keyword = kwMatch?.[1]?.trim() ?? null
  const content        = body.length > 0 ? body : raw.trim()
  const word_count     = content.split(/\s+/).filter(Boolean).length

  return { title, slug, target_keyword, content, word_count }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function formatSummary(draft: ParsedDraft, draftId: string | null): string {
  const lines: string[] = []
  lines.push(`**Content Bot drafted: ${draft.title}**`)
  lines.push('')
  if (draft.target_keyword) lines.push(`- Target keyword: \`${draft.target_keyword}\``)
  if (draft.slug)           lines.push(`- Suggested slug: \`/${draft.slug}\``)
  lines.push(`- Word count: ${draft.word_count}`)
  if (draftId) lines.push(`- Draft id: \`${draftId}\` (status: pending_review)`)
  lines.push('')
  lines.push(`Open the **Content Drafts** tab to review and approve.`)
  return lines.join('\n')
}
