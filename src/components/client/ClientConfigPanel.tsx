'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function ClientConfigPanel({
  clientId,
  gscProperty: initialGsc,
  pagespeedUrl: initialPs,
}: {
  clientId: string
  gscProperty: string
  pagespeedUrl: string
}) {
  const [gsc, setGsc] = useState(initialGsc)
  const [ps, setPs]   = useState(initialPs)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

  async function save() {
    setState('saving')
    setError('')

    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gsc_property: gsc, pagespeed_url: ps }),
    })

    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setError(d.error ?? 'Save failed')
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    } else {
      setState('saved')
      setTimeout(() => setState('idle'), 2500)
      // Reload to show new panels
      window.location.reload()
    }
  }

  return (
    <div className="bg-[#141414] border border-white/8 rounded-xl p-5 flex flex-col gap-4">
      <div>
        <label className="block text-white/40 text-xs mb-1.5 font-medium">
          GSC Property URL
        </label>
        <input
          value={gsc}
          onChange={e => setGsc(e.target.value)}
          placeholder="sc-domain:yourdomain.com  or  https://www.yourdomain.com/"
          className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-colors"
        />
        <p className="text-white/20 text-[11px] mt-1">
          Find this in GSC → Property selector. Use <code className="text-white/40">sc-domain:example.com</code> for domain properties.
        </p>
      </div>

      <div>
        <label className="block text-white/40 text-xs mb-1.5 font-medium">
          PageSpeed URL
        </label>
        <input
          value={ps}
          onChange={e => setPs(e.target.value)}
          placeholder="https://www.yourdomain.com"
          className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={state === 'saving' || state === 'saved'}
          className={
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ' +
            (state === 'saved'
              ? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/20'
              : 'bg-white text-black hover:bg-white/90')
          }
        >
          {state === 'saving' && <Loader2 size={14} className="animate-spin" />}
          {state === 'saved'  && <Check size={14} />}
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
