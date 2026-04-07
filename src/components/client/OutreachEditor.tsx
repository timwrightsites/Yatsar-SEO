'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useState, useCallback } from 'react'
import {
  Bold, Italic, List, ListOrdered, Undo, Redo,
  Check, X, Send, Loader2, ExternalLink, ChevronDown, ChevronUp,
  TrendingUp, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProspectWithDraft {
  id:                    string
  client_id:             string
  domain:                string
  domain_rating:         number | null
  domain_traffic:        number | null
  competitors_linking:   string[] | null
  competitor_link_count: number
  prospect_score:        number
  why:                   string | null
  contact_url:           string | null
  status:                string
  created_at:            string
  draft: {
    id:             string
    subject:        string
    body:           string
    tone:           string | null
    status:         string
    agent_notes:    string | null
    reviewer_notes: string | null
    created_at:     string
  } | null
}

interface Props {
  prospect: ProspectWithDraft
  onClose: () => void
  onProspectStatusChange: (id: string, status: string) => void
  onDraftStatusChange:    (prospectId: string, draftStatus: string) => void
}

type ActionState = 'idle' | 'saving' | 'approving' | 'rejecting' | 'marking_sent'

function ToolbarButton({
  onClick, active, title, children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded transition-all',
        active
          ? 'bg-white/15 text-white'
          : 'text-white/40 hover:text-white hover:bg-white/8'
      )}
    >
      {children}
    </button>
  )
}

export function OutreachEditor({
  prospect, onClose, onProspectStatusChange, onDraftStatusChange,
}: Props) {
  const [actionState, setActionState] = useState<ActionState>('idle')
  const [subject, setSubject]         = useState(prospect.draft?.subject ?? '')
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [showWhy, setShowWhy]         = useState(false)
  const [error, setError]             = useState('')

  const hasDraft = !!prospect.draft

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: hasDraft ? 'Edit the outreach email…' : 'No draft yet — write one here.',
      }),
    ],
    // Tiptap is happiest with HTML; if the bot saved plain text, wrap it in <p>.
    content: hasDraft ? toHtml(prospect.draft!.body) : '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[260px] text-white/80 leading-relaxed',
      },
    },
  })

  const wordCount = useCallback(() => {
    if (!editor) return 0
    const text = editor.getText()
    return text.trim() ? text.trim().split(/\s+/).length : 0
  }, [editor])

  async function saveDraft() {
    if (!editor || !prospect.draft) return
    setActionState('saving')
    await fetch(`/api/outreach-drafts/${prospect.draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body: editor.getHTML() }),
    })
    setActionState('idle')
  }

  async function handleDraftAction(status: 'approved' | 'rejected') {
    if (!editor || !prospect.draft) return
    setActionState(status === 'approved' ? 'approving' : 'rejecting')
    setError('')

    const res = await fetch(`/api/outreach-drafts/${prospect.draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        body: editor.getHTML(),
        status,
        reviewer_notes: reviewerNotes || null,
      }),
    })

    if (res.ok) {
      onDraftStatusChange(prospect.id, status)
      onClose()
    } else {
      setError('Something went wrong. Please try again.')
      setActionState('idle')
    }
  }

  async function markProspectSent() {
    if (!prospect.draft) return
    setActionState('marking_sent')
    setError('')

    // Mark the draft as sent + the prospect as contacted
    const [draftRes, prospectRes] = await Promise.all([
      fetch(`/api/outreach-drafts/${prospect.draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      }),
      fetch(`/api/link-prospects/${prospect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      }),
    ])

    if (draftRes.ok && prospectRes.ok) {
      onDraftStatusChange(prospect.id, 'sent')
      onProspectStatusChange(prospect.id, 'contacted')
      onClose()
    } else {
      setError('Failed to mark sent. Please try again.')
      setActionState('idle')
    }
  }

  const draftStatusColors: Record<string, string> = {
    pending_review: 'text-yellow-400',
    approved:       'text-[#22c55e]',
    sent:           'text-blue-400',
    rejected:       'text-red-400',
  }

  const draftStatusLabels: Record<string, string> = {
    pending_review: 'Needs Review',
    approved:       'Approved',
    sent:           'Sent',
    rejected:       'Rejected',
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-white/8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-white font-semibold text-lg leading-tight truncate">{prospect.domain}</h2>
              <a
                href={`https://${prospect.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/30 hover:text-white/70 transition-colors shrink-0"
                title="Open in new tab"
              >
                <ExternalLink size={13} />
              </a>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="flex items-center gap-1 text-white/30 text-xs">
                <TrendingUp size={11} />
                DR {prospect.domain_rating ?? '—'}
              </span>
              <span className="flex items-center gap-1 text-white/30 text-xs">
                <Link2 size={11} />
                {prospect.competitor_link_count} competitor{prospect.competitor_link_count === 1 ? '' : 's'}
              </span>
              <span className="text-white/30 text-xs">
                Score {prospect.prospect_score.toFixed(1)}
              </span>
              {hasDraft && (
                <span className={cn('text-xs font-medium', draftStatusColors[prospect.draft!.status] ?? 'text-white/40')}>
                  · {draftStatusLabels[prospect.draft!.status] ?? prospect.draft!.status}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Why this prospect (collapsible) */}
        {prospect.why && (
          <button
            onClick={() => setShowWhy(!showWhy)}
            className="flex items-center justify-between gap-2 px-6 py-2.5 bg-white/3 border-b border-white/5 text-left hover:bg-white/5 transition-colors"
          >
            <span className="text-white/40 text-xs font-medium">Why this prospect</span>
            {showWhy ? <ChevronUp size={12} className="text-white/30" /> : <ChevronDown size={12} className="text-white/30" />}
          </button>
        )}
        {prospect.why && showWhy && (
          <div className="px-6 py-3 bg-white/3 border-b border-white/5">
            <p className="text-white/50 text-xs leading-relaxed">{prospect.why}</p>
            {prospect.competitors_linking && prospect.competitors_linking.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {prospect.competitors_linking.map(c => (
                  <span key={c} className="text-[10px] bg-white/5 border border-white/8 text-white/50 px-2 py-0.5 rounded">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {hasDraft ? (
          <>
            {/* Subject line */}
            <div className="px-6 py-3 border-b border-white/8 flex items-center gap-3">
              <span className="text-white/30 text-xs font-medium uppercase tracking-wider shrink-0">Subject</span>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Email subject line"
                className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-white/20"
              />
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-0.5 px-4 py-2 border-b border-white/8 flex-wrap">
              <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()}     active={editor?.isActive('bold')}     title="Bold"><Bold size={13} /></ToolbarButton>
              <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()}   active={editor?.isActive('italic')}   title="Italic"><Italic size={13} /></ToolbarButton>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()}  active={editor?.isActive('bulletList')}  title="Bullet list"><List size={13} /></ToolbarButton>
              <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} title="Ordered list"><ListOrdered size={13} /></ToolbarButton>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} title="Undo"><Undo size={13} /></ToolbarButton>
              <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} title="Redo"><Redo size={13} /></ToolbarButton>
              <div className="flex-1" />
              <span className="text-white/20 text-[10px] mr-2">{wordCount()} words</span>
              <button
                onClick={saveDraft}
                disabled={actionState !== 'idle'}
                className="text-xs text-white/30 hover:text-white/60 transition-colors px-2 py-1"
              >
                {actionState === 'saving' ? 'Saving...' : 'Save'}
              </button>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <EditorContent editor={editor} />
            </div>

            {/* Reviewer notes + actions */}
            <div className="px-6 py-4 border-t border-white/8 flex flex-col gap-3">
              <textarea
                value={reviewerNotes}
                onChange={e => setReviewerNotes(e.target.value)}
                placeholder="Reviewer notes (optional)"
                rows={2}
                className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white/70 placeholder:text-white/20 outline-none focus:border-white/20 transition-colors resize-none"
              />

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors">
                  Close
                </button>
                <button
                  onClick={() => handleDraftAction('rejected')}
                  disabled={actionState !== 'idle'}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-all disabled:opacity-40"
                >
                  {actionState === 'rejecting' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                  Reject
                </button>
                <button
                  onClick={() => handleDraftAction('approved')}
                  disabled={actionState !== 'idle' || prospect.draft?.status === 'approved'}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-[#22c55e] border border-[#22c55e]/20 rounded-lg hover:bg-[#22c55e]/10 transition-all disabled:opacity-40"
                >
                  {actionState === 'approving' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Approve
                </button>
                <button
                  onClick={markProspectSent}
                  disabled={actionState !== 'idle'}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/10 transition-all disabled:opacity-40"
                >
                  {actionState === 'marking_sent' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Mark sent
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-3">
            <p className="text-white/30 text-sm">No outreach draft for this prospect yet.</p>
            <p className="text-white/20 text-xs text-center max-w-sm">
              The Link Bot couldn&apos;t generate a draft (likely an OpenClaw timeout). Re-trigger the link task or write one manually.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Wrap plain text in <p> so TipTap renders paragraphs correctly. If the body
// already looks like HTML, pass it through as-is.
function toHtml(body: string): string {
  if (/<\w+/.test(body)) return body
  return body
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('')
}
