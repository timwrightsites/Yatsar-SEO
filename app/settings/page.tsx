'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { AgencySettings } from '@/types/database'
import { Eye, EyeOff, Check, Loader2, Key, User, Lock } from 'lucide-react'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'


function Section({ title, icon: Icon, children }: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#141414] border border-white/8 rounded-xl p-6">
      <div className="flex items-center gap-2.5 mb-6">
        <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">
          <Icon size={14} className="text-white/50" />
        </div>
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Input({ label, type = 'text', value, onChange, placeholder, readOnly, rightSlot }: {
  label: string
  type?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  rightSlot?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-white/40 text-xs mb-1.5 font-medium">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={
            'w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white ' +
            'placeholder:text-white/20 outline-none focus:border-white/20 transition-colors ' +
            (readOnly ? 'opacity-50 cursor-not-allowed' : '')
          }
        />
        {rightSlot && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
        )}
      </div>
    </div>
  )
}

function SaveButton({ state, onClick, label = 'Save changes' }: {
  state: SaveState
  onClick: () => void
  label?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={state === 'saving' || state === 'saved'}
      className={
        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ' +
        (state === 'saved'
          ? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/20'
          : state === 'error'
          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : 'bg-white text-black hover:bg-white/90')
      }
    >
      {state === 'saving' && <Loader2 size={14} className="animate-spin" />}
      {state === 'saved' && <Check size={14} />}
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Failed — try again' : label}
    </button>
  )
}

export default function SettingsPage() {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // Profile
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [profileState, setProfileState] = useState<SaveState>('idle')

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordState, setPasswordState] = useState<SaveState>('idle')
  const [passwordError, setPasswordError] = useState('')

  // API Keys
  const [gscKey, setGscKey] = useState('')
  const [pagespeedKey, setPagespeedKey] = useState('')
  const [showGsc, setShowGsc] = useState(false)
  const [showPagespeed, setShowPagespeed] = useState(false)
  const [apiState, setApiState] = useState<SaveState>('idle')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')

      const { data } = await db
        .from('agency_settings')
        .select('*')
        .eq('user_id', user.id)
        .single() as { data: AgencySettings | null; error: unknown }

      if (data) {
        setDisplayName(data.display_name ?? '')
        setGscKey(data.gsc_api_key ?? '')
        setPagespeedKey(data.pagespeed_api_key ?? '')
      }
    }
    load()
  }, [])

  async function saveProfile() {
    setProfileState('saving')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await db
      .from('agency_settings')
      .upsert({ user_id: user.id, display_name: displayName }, { onConflict: 'user_id' })

    setProfileState(error ? 'error' : 'saved')
    if (!error) setTimeout(() => setProfileState('idle'), 2500)
  }

  async function savePassword() {
    setPasswordError('')
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setPasswordState('saving')

    // Re-authenticate with current password first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })

    if (signInError) {
      setPasswordError('Current password is incorrect.')
      setPasswordState('error')
      setTimeout(() => setPasswordState('idle'), 2500)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
      setPasswordState('error')
      setTimeout(() => setPasswordState('idle'), 2500)
    } else {
      setPasswordState('saved')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordState('idle'), 2500)
    }
  }

  async function saveApiKeys() {
    setApiState('saving')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await db
      .from('agency_settings')
      .upsert(
        { user_id: user.id, gsc_api_key: gscKey, pagespeed_api_key: pagespeedKey },
        { onConflict: 'user_id' }
      )

    setApiState(error ? 'error' : 'saved')
    if (!error) setTimeout(() => setApiState('idle'), 2500)
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8 max-w-2xl">
      <h1 className="text-white font-bold text-4xl mb-8">Settings</h1>

      <div className="flex flex-col gap-4">

        {/* ── Profile ── */}
        <Section title="Profile" icon={User}>
          <div className="flex flex-col gap-4">
            <Input
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Your name"
            />
            <Input
              label="Email"
              value={email}
              readOnly
              placeholder="you@example.com"
            />
            <div className="flex items-center justify-between pt-1">
              <p className="text-white/25 text-xs">Email changes require re-verification.</p>
              <SaveButton state={profileState} onClick={saveProfile} />
            </div>
          </div>
        </Section>

        {/* ── Password ── */}
        <Section title="Change Password" icon={Lock}>
          <div className="flex flex-col gap-4">
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="••••••••"
            />
            <Input
              label="New password"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={setNewPassword}
              placeholder="Min. 8 characters"
              rightSlot={
                <button onClick={() => setShowNew(v => !v)} className="text-white/30 hover:text-white/60 transition-colors">
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
            <Input
              label="Confirm new password"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Repeat new password"
              rightSlot={
                <button onClick={() => setShowConfirm(v => !v)} className="text-white/30 hover:text-white/60 transition-colors">
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
            {passwordError && (
              <p className="text-red-400 text-xs">{passwordError}</p>
            )}
            <div className="flex justify-end pt-1">
              <SaveButton state={passwordState} onClick={savePassword} label="Update password" />
            </div>
          </div>
        </Section>

        {/* ── API Keys ── */}
        <Section title="API Keys" icon={Key}>
          <div className="flex flex-col gap-4">
            <div className="bg-[#22c55e]/5 border border-[#22c55e]/10 rounded-lg px-4 py-3">
              <p className="text-[#22c55e]/80 text-xs leading-relaxed">
                These keys are stored securely and used to pull live data into your dashboard. They're never exposed client-side.
              </p>
            </div>
            <Input
              label="Google Search Console API Key"
              type={showGsc ? 'text' : 'password'}
              value={gscKey}
              onChange={setGscKey}
              placeholder="AIza…"
              rightSlot={
                <button onClick={() => setShowGsc(v => !v)} className="text-white/30 hover:text-white/60 transition-colors">
                  {showGsc ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
            <Input
              label="PageSpeed Insights API Key"
              type={showPagespeed ? 'text' : 'password'}
              value={pagespeedKey}
              onChange={setPagespeedKey}
              placeholder="AIza…"
              rightSlot={
                <button onClick={() => setShowPagespeed(v => !v)} className="text-white/30 hover:text-white/60 transition-colors">
                  {showPagespeed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
            <div className="flex items-center justify-between pt-1">
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-white/25 text-xs hover:text-white/50 transition-colors underline underline-offset-2"
              >
                Get a Google API key →
              </a>
              <SaveButton state={apiState} onClick={saveApiKeys} label="Save keys" />
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
