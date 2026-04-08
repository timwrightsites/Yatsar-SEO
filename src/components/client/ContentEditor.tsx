'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { marked } from 'marked'
import { useState, useCallback } from 'react'
import {
  Bold, Italic, Heading2, Heading3, List, ListOrdered,
  Quote, Undo, Redo, Check, X, Loader2, ChevronDown, ChevronUp
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Draft {
  id: string
  title: string
  target_keyword: string | null
  word_count: number | null
  status: string
  agent_notes: string | null
  content: string | null
  created_at: string
}

interface Props {
  draft: Draft
  onClose: () => void
  onStatusChange: (id: string, status: string) => void
}

type ActionState = 'idle' | 'saving' | 'approving' | 'rejecting'

// ── Initial content loader ─────────────────────────────────────
// The Content Bot saves raw Markdown to content_drafts.content. The human
// reviewer edits in TipTap (which works in HTML), and on save we write the
// HTML back. So the stored value can be EITHER markdown (first load, bot
// output) or HTML (after the first save). We detect which one we're looking
// at and convert markdown → HTML before feeding TipTap. An empty string is
// treated as empty doc.
function loadInitialContent(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trimStart()
  // If it already looks like HTML (leading tag), pass through as-is.
  if (trimmed.startsWith('<')) return raw
  // Otherwise parse as markdown. `marked` is synchronous when not using
  // async extensions, so we cast the return to string.
  try {
    return marked.parse(raw, { async: false }) as string
  } catch {
    // If parsing dies for any reason, fall back to raw so the user still
    // sees their content rather than an empty editor.
    return raw
  }
}

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

export function ContentEditor({ draft, onClose, onStatusChange }: Props) {
  const [actionState, setActionState]     = useState<ActionState>('idle')
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [showNotes, setShowNotes]         = useState(false)
  const [error, setError]                 = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Content will appear here...' }),
      Typography,
    ],
    content: loadInitialContent(draft.content),
    editorProps: {
      attributes: {
        class: 'tiptap-content max-w-none focus:outline-none min-h-[400px] text-white/80 leading-relaxed',
      },
    },
  })

  const countWords = useCallback(() => {
    if (!editor) return 0
    const text = editor.getText()
    return text.trim() ? text.trim().split(/\s+/).length : 0
  }, [editor])

  async function saveContent() {
    if (!editor) return
    setActionState('saving')
    await fetch(`/api/content-drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.getHTML(), word_count: countWords() }),
    })
    setActionState('idle')
  }

  async function handleAction(status: 'approved' | 'rejected') {
    if (!editor) return
    setActionState(status === 'approved' ? 'approving' : 'rejecting')
    setError('')

    const res = await fetch(`/api/content-drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: editor.getHTML(),
        word_count: countWords(),
        status,
        reviewer_notes: reviewerNotes || null,
      }),
    })

    if (res.ok) {
      onStatusChange(draft.id, status)
      onClose()
    } else {
      setError('Something went wrong. Please try again.')
      setActionState('idle')
    }
  }

  const statusColors: Record<string, string> = {
    pending_review: 'text-yellow-400',
    approved:       'text-[#22c55e]',
    rejected:       'text-red-400',
    published:      'text-blue-400',
  }

  const statusLabels: Record<string, string> = {
    pending_review: 'Needs Review',
    approved:       'Approved',
    rejected:       'Rejected',
    published:      'Published',
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-white/8">
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-lg leading-tight truncate">{draft.title}</h2>
            <div className="flex items-center gap-3 mt-1">
              {draft.target_keyword && (
                <span className="text-white/30 text-xs">keyword: {draft.target_keyword}</span>
              )}
              <span className={cn('text-xs font-medium', statusColors[draft.status] ?? 'text-white/40')}>
                {statusLabels[draft.status] ?? draft.status}
              </span>
              <span className="text-white/20 text-xs">{countWords()} words</span>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Agent notes (collapsible) */}
        {draft.agent_notes && (
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="flex items-center justify-between gap-2 px-6 py-2.5 bg-white/3 border-b border-white/5 text-left hover:bg-white/5 transition-colors"
          >
            <span className="text-white/40 text-xs font-medium">Agent notes</span>
            {showNotes ? <ChevronUp size={12} className="text-white/30" /> : <ChevronDown size={12} className="text-white/30" />}
          </button>
        )}
        {draft.agent_notes && showNotes && (
          <div className="px-6 py-3 bg-white/3 border-b border-white/5">
            <p className="text-white/40 text-xs leading-relaxed">{draft.agent_notes}</p>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-4 py-2 border-b border-white/8 flex-wrap">
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} title="Bold">
            <Bold size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} title="Italic">
            <Italic size={13} />
          </ToolbarButton>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive('heading', { level: 2 })} title="Heading 2">
            <Heading2 size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive('heading', { level: 3 })} title="Heading 3">
            <Heading3 size={13} />
          </ToolbarButton>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} title="Bullet list">
            <List size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} title="Ordered list">
            <ListOrdered size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} title="Quote">
            <Quote size={13} />
          </ToolbarButton>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} title="Undo">
            <Undo size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} title="Redo">
            <Redo size={13} />
          </ToolbarButton>
          <div className="flex-1" />
          <button
            onClick={saveContent}
            disabled={actionState !== 'idle'}
            className="text-xs text-white/30 hover:text-white/60 transition-colors px-2 py-1"
          >
            {actionState === 'saving' ? 'Saving...' : 'Save draft'}
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
            placeholder="Reviewer notes (optional) — sent back to agent if rejected"
            rows={2}
            className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white/70 placeholder:text-white/20 outline-none focus:border-white/20 transition-colors resize-none"
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => handleAction('rejected')}
              disabled={actionState !== 'idle'}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-all disabled:opacity-40"
            >
              {actionState === 'rejecting'
                ? <Loader2 size={13} className="animate-spin" />
                : <X size={13} />
              }
              Reject
            </button>
            <button
              onClick={() => handleAction('approved')}
              disabled={actionState !== 'idle'}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-[#22c55e] border border-[#22c55e]/20 rounded-lg hover:bg-[#22c55e]/10 transition-all disabled:opacity-40"
            >
              {actionState === 'approving'
                ? <Loader2 size={13} className="animate-spin" />
                : <Check size={13} />
              }
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
