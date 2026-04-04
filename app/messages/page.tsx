import { createClient } from '@/lib/supabase-server'
import { ChatInterface } from '@/components/chat/ChatInterface'
import type { Client } from '@/types/database'

export default async function MessagesPage() {
  const supabase = await createClient()
  const db = supabase as any

  const { data: clients } = await db
    .from('clients')
    .select('id, name, domain, industry, status')
    .eq('status', 'active')
    .order('name') as Promise<{ data: Pick<Client, 'id' | 'name' | 'domain' | 'industry' | 'status'>[] | null }>

  return <ChatInterface clients={clients ?? []} />
}
