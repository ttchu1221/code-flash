import { Shield, Wrench, Check, X, ChevronRight } from 'lucide-react'
import type { PermissionRequest } from '../types'

interface PermissionModalProps {
  request: PermissionRequest
  onRespond: (approved: boolean, always: boolean) => void
}

export function PermissionModal({ request, onRespond }: PermissionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in"
      style={{ background: 'var(--shadow)' }}>
      <div className="rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl animate-slide-up"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', boxShadow: '0 25px 50px var(--shadow)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
            <Shield size={18} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>权限请求</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>工具需要你的批准才能执行</p>
          </div>
        </div>

        {/* Tool info */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
              <Wrench size={13} className="text-violet-400" />
            </div>
            <span className="font-mono text-sm text-violet-300 font-medium">{request.toolName}</span>
          </div>
          <div className="rounded-xl p-4 text-xs max-h-48 overflow-auto"
            style={{ background: 'var(--code-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <pre className="whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(request.input, null, 2)}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5">
          <button onClick={() => onRespond(false, false)}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-hover)')}>
            <X size={14} />
            拒绝
          </button>
          <button onClick={() => onRespond(true, false)}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white text-sm font-medium transition-all shadow-lg shadow-violet-500/20">
            <Check size={14} />
            允许
          </button>
          <button onClick={() => onRespond(true, true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.1)')}>
            <ChevronRight size={14} />
            始终允许
          </button>
        </div>
      </div>
    </div>
  )
}
