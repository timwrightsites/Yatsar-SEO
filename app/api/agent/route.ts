import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN

export async function POST(req: NextRequest) {
  const { clientId, messages, agentId = 'seo-co-strategist' } = await req.json()

  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    return new Response(JSON.stringify({ error: 'OpenClaw gateway not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!clientId || !messages?.length) {
    return new Response(JSON.stringify({ error: 'clientId and messages are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const prompt = messages[messages.length - 1]?.content || ''

  // Log task start
  const { data: task } = await (supabase as any)
    .from('agent_tasks')
    .insert({ client_id: clientId, agent_id: agentId, prompt, status: 'running' })
    .select()
    .single()

  // Call OpenClaw with streaming
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
    await (supabase as any)
      .from('agent_tasks')
      .update({ status: 'error' })
      .eq('id', task?.id)
    return new Response(JSON.stringify({ error: 'Failed to reach OpenClaw gateway' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!upstreamRes.ok) {
    await (supabase as any)
      .from('agent_tasks')
      .update({ status: 'error' })
      .eq('id', task?.id)
    return new Response(JSON.stringify({ error: 'Agent request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Stream response back, accumulate for logging
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body!.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          controller.enqueue(new TextEncoder().encode(chunk))

          // Accumulate response text from SSE chunks
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6))
                fullResponse += data.choices?.[0]?.delta?.content || ''
              } catch {}
            }
          }
        }

        // Mark task complete with full response
        if (task?.id) {
          await (supabase as any)
            .from('agent_tasks')
            .update({
              status: 'completed',
              response: fullResponse,
              completed_at: new Date().toISOString(),
            })
            .eq('id', task.id)
        }
      } catch {
        if (task?.id) {
          await (supabase as any)
            .from('agent_tasks')
            .update({ status: 'error' })
            .eq('id', task.id)
        }
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
