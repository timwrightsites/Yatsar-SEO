'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Field {
  label: string
  key: string
  placeholder: string
  type?: string
  required?: boolean
  hint?: string
}

const FIELDS: Field[] = [
  { label: 'Business Name',     key: 'name',              placeholder: 'Acme Corp',             required: true },
  { label: 'Domain',            key: 'domain',            placeholder: 'acmecorp.com',           required: true, hint: 'No https:// or www' },
  { label: 'Industry',          key: 'industry',          placeholder: 'SaaS, Legal, E-commerce…' },
  { label: 'Monthly Retainer',  key: 'monthly_retainer',  placeholder: '2500',                  type: 'number' },
  { label: 'GSC Property',      key: 'gsc_property',      placeholder: 'sc-domain:acmecorp.com', hint: 'Optional — can add later' },
  { label: 'PageSpeed URL',     key: 'pagespeed_url',     placeholder: 'https://www.acmecorp.com', hint: 'Optional — can add later' },
]

export function AddClientModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submit() {
    if (!form.name?.trim() || !form.domain?.trim()) {
      setError('Business name and domain are required.')
      return
    }
    setSaving(true)
    setError('')

    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        domain: form.domain.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, ''),
        industry: form.industry?.trim() || null,
        monthly_retainer: form.monthly_retainer ? Number(form.monthly_retainer) : null,
        gsc_property: form.gsc_property?.trim() || null,
        pagespeed_url: form.pagespeed_url?.trim() || null,
        status: 'active',
      }),
    })

    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setError(d.error ?? 'Something went wrong.')
      setSaving(false)
      return
    }

    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/8">
          <h2 className="text-white font-bold text-lg">Add Client</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {FIELDS.map(({ label, key, placeholder, type, required, hint }) => (
            <div key={key}>
              <label className="block text-white/40 text-xs font-medium mb-1.5">
                {label}{required && <span className="text-[#22c55e] ml-0.5">*</span>}
              </label>
              <input
                type={type ?? 'text'}
                value={form[key] ?? ''}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-colors"
              />
              {hint && <p className="text-white/20 text-[11px] mt-1">{hint}</p>}
            </div>
          ))}

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-5 py-2 rounded-lg hover:bg-white/90 transition-all disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Adding…' : 'Add Client'}
          </button>
        </div>
      </div>
    </div>
  )
}
