import { useState, useEffect } from 'react'
import { X, Check, ChevronDown, Cpu, Key, Link, FolderOpen } from 'lucide-react'
import clsx from 'clsx'

interface ModelConfig {
  id: string
  name: string
  baseUrl: string
  envKey: string
}

interface SavedSettings {
  saved_keys?: Record<string, string[]>
  masked_env?: Record<string, string>
  model_configs?: Record<string, ModelConfig[]>
  saved_base_urls?: string[]
  last_config?: { provider?: string; model?: string; base_url?: string }
}

const DEFAULT_PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-sonnet-4-6',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  openai: [
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o4-mini',
  ],
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  config: { provider: string; model: string }
  onConfigChange: (cfg: { provider?: string; api_key?: string; base_url?: string; model?: string; workspace?: string }) => void
}

export function SettingsModal({ isOpen, onClose, config, onConfigChange }: SettingsModalProps) {
  const [draftProvider, setDraftProvider] = useState(config.provider)
  const [draftModel, setDraftModel] = useState(config.model)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [workspaceDraft, setWorkspaceDraft] = useState('')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showKeyDropdown, setShowKeyDropdown] = useState(false)
  const [showUrlDropdown, setShowUrlDropdown] = useState(false)
  const [savedSettings, setSavedSettings] = useState<SavedSettings | null>(null)

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: SavedSettings) => {
        setSavedSettings(data)
        if (data.last_config?.provider) setDraftProvider(data.last_config.provider)
        if (data.last_config?.model) setDraftModel(data.last_config.model)
        if (data.last_config?.base_url) setBaseUrlDraft(data.last_config.base_url)
      })
      .catch(() => {})
  }, [isOpen])

  useEffect(() => {
    setDraftProvider(config.provider)
    setDraftModel(config.model)
  }, [config.provider, config.model])

  if (!isOpen) return null

  const settingsModels = savedSettings?.model_configs?.[draftProvider] || []
  const defaultModels = DEFAULT_PROVIDER_MODELS[draftProvider] || []
  const models = settingsModels.length > 0
    ? settingsModels.map(m => m.id)
    : defaultModels

  const currentEnvKeys = savedSettings?.saved_keys?.[draftProvider] || []
  const maskedEnv = savedSettings?.masked_env || {}
  const currentUrls = savedSettings?.saved_base_urls || []

  const handleProviderChange = (provider: string) => {
    setDraftProvider(provider)
    setApiKeyDraft('')
    setBaseUrlDraft('')
    const newSettingsModels = savedSettings?.model_configs?.[provider] || []
    const newDefaultModels = DEFAULT_PROVIDER_MODELS[provider] || []
    if (newSettingsModels.length > 0) {
      setDraftModel(newSettingsModels[0].id)
      setBaseUrlDraft(newSettingsModels[0].baseUrl || '')
    } else if (newDefaultModels.length > 0) {
      setDraftModel(newDefaultModels[0])
    }
  }

  const handleModelSelect = (model: string) => {
    setDraftModel(model); setCustomModel(''); setShowModelDropdown(false)
    const modelConfig = settingsModels.find(m => m.id === model)
    if (modelConfig?.baseUrl) setBaseUrlDraft(modelConfig.baseUrl)
  }

  const handleKeySelect = async (envKeyName: string) => {
    setShowKeyDropdown(false)
    try {
      const res = await fetch('/api/settings/get_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: draftProvider, env_key: envKeyName }),
      })
      const data = await res.json()
      if (data.key) setApiKeyDraft(data.key)
    } catch {}
  }

  const handleUrlSelect = (url: string) => {
    setBaseUrlDraft(url)
    setShowUrlDropdown(false)
  }

  const handleSave = () => {
    const cfg = {
      provider: draftProvider,
      model: customModel.trim() || draftModel,
      api_key: apiKeyDraft || undefined,
      base_url: baseUrlDraft || undefined,
      workspace: workspaceDraft.trim() || undefined,
    }
    onConfigChange(cfg)
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: cfg.provider,
        api_key: cfg.api_key || null,
        base_url: cfg.base_url || null,
        model: cfg.model || null,
        workspace: cfg.workspace || null,
      }),
    }).catch(() => {})
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in"
      style={{ background: 'var(--shadow)' }}>
      <div className="rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-slide-up max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', boxShadow: '0 25px 50px var(--shadow)' }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>模型设置</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/10">
            <X size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Provider */}
          <div>
            <label className="text-xs mb-2.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>
              Provider
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {['anthropic', 'openai'].map((p) => (
                <button key={p} onClick={() => handleProviderChange(p)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: draftProvider === p ? 'var(--accent-bg)' : 'var(--bg-hover)',
                    border: `1.5px solid ${draftProvider === p ? 'var(--accent-border)' : 'var(--border-strong)'}`,
                    color: draftProvider === p ? '#a78bfa' : 'var(--text-secondary)',
                  }}>
                  {draftProvider === p && <Check size={14} />}
                  {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          <div>
            <label className="text-xs mb-2.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>
              模型
            </label>
            <div className="relative">
              <button onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl text-sm transition-all"
                style={{ background: 'var(--bg-hover)', border: '1.5px solid var(--border-strong)', color: 'var(--text-primary)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu size={14} className="text-violet-400 flex-shrink-0" />
                  <span className="truncate font-mono text-xs">{draftModel || '选择模型...'}</span>
                </div>
                <ChevronDown size={14} className={clsx('transition-transform flex-shrink-0', showModelDropdown && 'rotate-180')}
                  style={{ color: 'var(--text-muted)' }} />
              </button>

              {showModelDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl overflow-hidden z-[60] max-h-56 overflow-y-auto animate-slide-up"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}>
                  {models.map((m) => (
                    <button key={m} onClick={() => handleModelSelect(m)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors"
                      style={{
                        background: draftModel === m ? 'var(--accent-bg)' : 'transparent',
                        color: draftModel === m ? '#a78bfa' : 'var(--text-primary)',
                      }}
                      onMouseEnter={e => { if (draftModel !== m) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (draftModel !== m) e.currentTarget.style.background = 'transparent' }}>
                      {draftModel === m && <Check size={13} className="text-violet-400 flex-shrink-0" />}
                      <span className={clsx('font-mono text-xs', draftModel !== m && 'ml-5')}>{m}</span>
                    </button>
                  ))}
                  <div className="p-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                    <input type="text" value={customModel}
                      onChange={(e) => { setCustomModel(e.target.value); if (e.target.value.trim()) setDraftModel(e.target.value.trim()) }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="自定义模型名称..."
                      className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none"
                      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="text-xs mb-2.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>
              Base URL
            </label>
            <div className="relative">
              <input type="text" value={baseUrlDraft} onChange={(e) => setBaseUrlDraft(e.target.value)}
                placeholder="留空则使用默认"
                className="w-full px-4 py-3 pr-10 rounded-xl text-sm focus:outline-none transition-colors"
                style={{ background: 'var(--bg-hover)', border: '1.5px solid var(--border-strong)', color: 'var(--text-primary)' }} />
              {currentUrls.length > 0 && (
                <button onClick={() => setShowUrlDropdown(!showUrlDropdown)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-white/10">
                  <Link size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
              {showUrlDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl overflow-hidden z-[60] max-h-48 overflow-y-auto animate-slide-up"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}>
                  <div className="px-4 py-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    已保存的 URL
                  </div>
                  {currentUrls.map((url) => (
                    <button key={url} onClick={() => handleUrlSelect(url)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/5">
                      <Link size={12} className="text-violet-400 flex-shrink-0" />
                      <span className="truncate font-mono text-xs">{url}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs mb-2.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>
              API Key
            </label>
            <div className="relative">
              <input type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="留空则使用环境变量"
                className="w-full px-4 py-3 pr-10 rounded-xl text-sm focus:outline-none transition-colors"
                style={{ background: 'var(--bg-hover)', border: '1.5px solid var(--border-strong)', color: 'var(--text-primary)' }} />
              {currentEnvKeys.length > 0 && (
                <button onClick={() => setShowKeyDropdown(!showKeyDropdown)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-white/10">
                  <Key size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
              {showKeyDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl overflow-hidden z-[60] max-h-48 overflow-y-auto animate-slide-up"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}>
                  <div className="px-4 py-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    已保存的 Key
                  </div>
                  {currentEnvKeys.map((envKeyName) => (
                    <button key={envKeyName} onClick={() => handleKeySelect(envKeyName)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/5">
                      <Key size={12} className="text-violet-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs block">{envKeyName}</span>
                        <span className="font-mono text-[10px] block opacity-50">{maskedEnv[envKeyName] || '***'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Workspace */}
          <div>
            <label className="text-xs mb-2.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>
              工作目录 (可选)
            </label>
            <div className="relative">
              <input type="text" value={workspaceDraft} onChange={(e) => setWorkspaceDraft(e.target.value)}
                placeholder="留空则使用隔离空间"
                className="w-full px-4 py-3 pl-10 rounded-xl text-sm focus:outline-none transition-colors"
                style={{ background: 'var(--bg-hover)', border: '1.5px solid var(--border-strong)', color: 'var(--text-primary)' }} />
              <FolderOpen size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-violet-400" />
            </div>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              💡 留空时每个会话使用独立隔离空间，保护隐私
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'var(--bg-hover)', border: '1.5px solid var(--border-strong)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-hover)')}>
              取消
            </button>
            <button onClick={handleSave}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 rounded-xl text-sm text-white font-medium transition-all shadow-lg shadow-violet-500/20">
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
