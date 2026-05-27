import { useState, useEffect } from 'react'
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  X,
  Shield,
  ChevronRight,
  Zap,
  Sun,
  Moon,
  Puzzle,
  Search,
} from 'lucide-react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import type { SessionMeta } from '../types'
import { useTheme } from '../hooks/useTheme'
import { SettingsModal } from './SettingsModal'
import FileExplorer from './FileExplorer'

interface SidebarProps {
  sessions: SessionMeta[]
  currentSessionId: string
  isOpen: boolean
  onClose: () => void
  onNewSession: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  modeLabel: string
  onCycleMode: () => void
  config: { provider: string; model: string }
  onConfigChange: (cfg: { provider?: string; api_key?: string; base_url?: string; model?: string; workspace?: string }) => void
}

export function Sidebar({
  sessions,
  currentSessionId,
  isOpen,
  onClose,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  modeLabel,
  onCycleMode,
  config,
  onConfigChange,
}: SidebarProps) {
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  if (!isOpen) return null

  const btnHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'var(--bg-hover)'),
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'transparent'),
  }

  return (
    <div className="fixed inset-y-0 left-0 z-40 w-80 flex flex-col animate-slide-in-left"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-semibold text-sm tracking-wide" style={{ color: 'var(--text-primary)' }}>code-flash</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" {...btnHover}>
          <X size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-4 pt-4 pb-2 space-y-1">
        <RouterLink
          to="/"
          className={clsx(
            'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-all',
            location.pathname === '/' ? 'font-medium' : ''
          )}
          style={{
            background: location.pathname === '/' ? 'var(--accent-bg)' : 'transparent',
            color: location.pathname === '/' ? '#a78bfa' : 'var(--text-secondary)',
            border: location.pathname === '/' ? '1px solid var(--accent-border)' : '1px solid transparent',
          }}
          onMouseEnter={e => { if (location.pathname !== '/') e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { if (location.pathname !== '/') e.currentTarget.style.background = 'transparent' }}
        >
          <MessageSquare size={15} />
          <span>对话</span>
        </RouterLink>

        <RouterLink
          to="/skills"
          className={clsx(
            'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-all',
            location.pathname === '/skills' ? 'font-medium' : ''
          )}
          style={{
            background: location.pathname === '/skills' ? 'var(--accent-bg)' : 'transparent',
            color: location.pathname === '/skills' ? '#a78bfa' : 'var(--text-secondary)',
            border: location.pathname === '/skills' ? '1px solid var(--accent-border)' : '1px solid transparent',
          }}
          onMouseEnter={e => { if (location.pathname !== '/skills') e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { if (location.pathname !== '/skills') e.currentTarget.style.background = 'transparent' }}
        >
          <Puzzle size={15} />
          <span>技能</span>
        </RouterLink>
      </div>

      {/* New session */}
      <div className="px-4 pt-4 pb-2">
        <button onClick={onNewSession}
          className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/15 to-indigo-500/15 hover:from-violet-500/25 hover:to-indigo-500/25 text-violet-300 text-sm font-medium transition-all"
          style={{ border: '1px solid var(--accent-border)' }}>
          <Plus size={15} />
          新建会话
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-1">
        {sessions.map((s) => (
          <div key={s.session_id} onClick={() => onSelectSession(s.session_id)}
            className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-sm"
            style={{
              background: s.session_id === currentSessionId ? 'var(--bg-active)' : 'transparent',
              color: s.session_id === currentSessionId ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={e => { if (s.session_id !== currentSessionId) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { if (s.session_id !== currentSessionId) e.currentTarget.style.background = 'transparent' }}>
            <MessageSquare size={14} className="flex-shrink-0 opacity-60" />
            <span className="truncate flex-1 font-mono text-xs">{s.session_id}</span>
            <button onClick={(e) => { e.stopPropagation(); onDeleteSession(s.session_id) }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all hover:bg-red-500/20">
              <Trash2 size={12} className="text-red-400" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-center text-xs py-10" style={{ color: 'var(--text-faint)' }}>
            <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
            暂无会话
          </div>
        )}
      </div>

      {/* File Explorer */}
      {currentSessionId && (
        <div className="px-4 pb-2" style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
          <FileExplorer sessionId={currentSessionId} />
        </div>
      )}

      {/* Permission mode */}
      <div className="px-4 pb-2">
        <button onClick={onCycleMode}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm transition-all"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-active)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-hover)')}>
          <Shield size={14} className="text-amber-400" />
          <span style={{ color: 'var(--text-secondary)' }}>权限模式</span>
          <span className="ml-auto text-xs text-violet-300 font-mono px-2 py-0.5 rounded-md"
            style={{ background: 'var(--accent-bg)' }}>
            {modeLabel}
          </span>
        </button>
      </div>

      {/* Theme toggle + Settings */}
      <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
        {/* Theme switch */}
        <button onClick={toggleTheme}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm transition-all mb-1"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          {theme === 'dark' ? <Moon size={14} className="text-violet-400" /> : <Sun size={14} className="text-amber-400" />}
          <span>{theme === 'dark' ? '深色模式' : '浅色模式'}</span>
          <span className="ml-auto">
            <div className="relative w-10 h-5 rounded-full transition-colors"
              style={{ background: theme === 'dark' ? 'var(--accent)' : 'var(--border-strong)' }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: theme === 'dark' ? '22px' : '2px' }} />
            </div>
          </span>
        </button>

        {/* Settings toggle */}
        <button onClick={() => setShowSettingsModal(true)}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm transition-all"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <Settings size={14} />
          <span>模型设置</span>
          <ChevronRight size={14} className="ml-auto" style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        config={config}
        onConfigChange={onConfigChange}
      />
    </div>
  )
}
