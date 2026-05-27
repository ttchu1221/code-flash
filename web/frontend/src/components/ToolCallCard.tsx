import { useState } from 'react'
import {
  ChevronDown,
  FileEdit,
  FilePlus2,
  FileSearch,
  Terminal,
  Search,
  FolderSearch,
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Cog,
} from 'lucide-react'
import clsx from 'clsx'
import type { ToolCall } from '../types'

const TOOL_ICONS: Record<string, typeof FileEdit> = {
  Edit: FileEdit, Write: FilePlus2, Read: FileSearch, Bash: Terminal,
  Grep: Search, Glob: FolderSearch, AskUserQuestion: MessageSquare,
  EnterPlanMode: Cog, ExitPlanMode: Cog, TodoWrite: FileEdit, TodoUpdate: FileEdit,
}

const TOOL_COLORS: Record<string, { text: string; bg: string }> = {
  Edit:    { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  Write:   { text: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  Read:    { text: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
  Bash:    { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  Grep:    { text: '#c084fc', bg: 'rgba(192,132,252,0.1)' },
  Glob:    { text: '#c084fc', bg: 'rgba(192,132,252,0.1)' },
  AskUserQuestion: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  EnterPlanMode: { text: '#22d3ee', bg: 'rgba(34,211,238,0.1)' },
  ExitPlanMode:  { text: '#22d3ee', bg: 'rgba(34,211,238,0.1)' },
  TodoWrite: { text: '#f472b6', bg: 'rgba(244,114,182,0.1)' },
  TodoUpdate:{ text: '#f472b6', bg: 'rgba(244,114,182,0.1)' },
}

const DEFAULT_COLOR = { text: '#94a3b8', bg: 'rgba(148,163,184,0.08)' }

interface ToolCallCardProps {
  tool: ToolCall
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = TOOL_ICONS[tool.name] || Terminal
  const color = TOOL_COLORS[tool.name] || DEFAULT_COLOR

  const statusIcon = {
    pending:   <Loader2 size={13} className="animate-spin" style={{ color: '#fbbf24' }} />,
    executing: <Loader2 size={13} className="animate-spin" style={{ color: '#60a5fa' }} />,
    done:      <CheckCircle2 size={13} style={{ color: '#34d399' }} />,
    denied:    <XCircle size={13} style={{ color: '#f87171' }} />,
  }[tool.status]

  const inputPreview = () => {
    const entries = Object.entries(tool.input)
    if (entries.length === 0) return ''
    const [key, val] = entries[0]
    const str = typeof val === 'string' ? val : JSON.stringify(val)
    return `${key}: ${str.slice(0, 80)}${str.length > 80 ? '…' : ''}`
  }

  return (
    <div className="my-1 animate-fade-in">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-left text-sm transition-all group"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-active)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: color.bg }}>
          <Icon size={13} style={{ color: color.text }} />
        </div>
        <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>{tool.name}</span>
        {tool.activity && <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }}>{tool.activity}</span>}
        {!tool.activity && inputPreview() && <span className="text-xs truncate flex-1" style={{ color: 'var(--text-faint)' }}>{inputPreview()}</span>}
        <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {statusIcon}
          <ChevronDown size={13} className={clsx('transition-transform duration-200', expanded && 'rotate-180')}
            style={{ color: 'var(--text-faint)' }} />
        </span>
      </button>

      {expanded && (
        <div className="ml-3 mt-1 p-3 rounded-xl text-xs animate-slide-up"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
          <div className="mb-3">
            <span className="font-medium uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>输入</span>
            <pre className="mt-1.5 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all leading-relaxed"
              style={{ background: 'var(--code-bg)', color: 'var(--text-secondary)' }}>
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.result && (
            <div>
              <span className="font-medium uppercase tracking-wider text-[10px]"
                style={{ color: tool.isError ? '#f87171' : 'var(--text-muted)' }}>
                {tool.isError ? '错误' : '结果'}
              </span>
              <pre className="mt-1.5 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed"
                style={{
                  background: tool.isError ? 'rgba(239,68,68,0.06)' : 'var(--code-bg)',
                  color: tool.isError ? '#fca5a5' : 'var(--text-secondary)',
                  border: `1px solid ${tool.isError ? 'rgba(239,68,68,0.12)' : 'var(--border)'}`,
                }}>
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
