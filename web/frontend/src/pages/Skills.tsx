import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search,
  Download,
  Trash2,
  Check,
  Puzzle,
  Zap,
  Package,
  PanelLeft,
  Loader2,
  ChevronDown,
  X,
  Globe,
  Star,
  ExternalLink,
} from 'lucide-react'
import clsx from 'clsx'
import { useTheme } from '../hooks/useTheme'
import { Sidebar } from '../components/Sidebar'
import type { SessionMeta } from '../types'

/* ---------- Types ---------- */

interface LocalSkill {
  id: string
  name: string
  description: string
  category: string
  type: 'plugin' | 'markdown' | 'unknown'
  emoji: string
}

interface MarketplaceSkill {
  id: string
  name: string
  author: string
  description: string
  githubUrl: string
  skillUrl: string
  stars: number
  updatedAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

type TabKey = 'local' | 'marketplace' | 'installed'

/* ---------- Component ---------- */

export function Skills() {
  const { theme } = useTheme()

  // -- Tab --
  const [activeTab, setActiveTab] = useState<TabKey>('local')

  // -- Local skills --
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)

  // -- Marketplace --
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([])
  const [mpPagination, setMpPagination] = useState<Pagination | null>(null)
  const [mpPage, setMpPage] = useState(1)
  const [mpSort, setMpSort] = useState<'stars' | 'recent'>('stars')
  const [mpSortOpen, setMpSortOpen] = useState(false)

  // -- Common --
  const [searchQuery, setSearchQuery] = useState('')
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [currentSessionId, setCurrentSessionId] = useState('')
  const [config, setConfig] = useState({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef<HTMLDivElement>(null)

  /* ---------- Load local skills ---------- */
  const loadLocalSkills = useCallback(async (q = '', category = '') => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (category) params.set('category', category)
      const res = await fetch(`/api/skills?${params}`)
      const data = await res.json()
      setLocalSkills(data.skills || [])
      if (data.categories) setCategories(data.categories)
    } catch (e) {
      console.error('Failed to load local skills:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /* ---------- Load marketplace ---------- */
  const loadMarketplace = useCallback(async (q = '', page = 1, sortBy = 'stars') => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
      })
      if (q) params.set('q', q)
      const res = await fetch(`/api/skills/marketplace?${params}`)
      const data = await res.json()
      setMarketplaceSkills(data.skills || [])
      setMpPagination(data.pagination || null)
    } catch (e) {
      console.error('Failed to load marketplace:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /* ---------- Load installed ---------- */
  const loadInstalled = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/installed?session_id=${currentSessionId || 'default'}`)
      const data = await res.json()
      const ids = new Set<string>((data.skills || []).map((s: LocalSkill) => s.id))
      setInstalledIds(ids)
    } catch (e) {
      console.error('Failed to load installed skills:', e)
    }
  }, [currentSessionId])

  /* ---------- Init ---------- */
  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(data => {
        if (data.sessions) {
          setSessions(data.sessions)
          if (data.sessions.length > 0) setCurrentSessionId(data.sessions[0].session_id)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (currentSessionId) loadInstalled()
  }, [currentSessionId, loadInstalled])

  /* ---------- Tab switch ---------- */
  useEffect(() => {
    if (activeTab === 'local') {
      loadLocalSkills(searchQuery, selectedCategory)
    } else if (activeTab === 'marketplace') {
      loadMarketplace(searchQuery, mpPage, mpSort)
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Search debounce ---------- */
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      if (activeTab === 'local') {
        loadLocalSkills(searchQuery, selectedCategory)
      } else if (activeTab === 'marketplace') {
        setMpPage(1)
        loadMarketplace(searchQuery, 1, mpSort)
      }
    }, 400)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, activeTab, selectedCategory, mpSort]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Category filter ---------- */
  useEffect(() => {
    if (activeTab === 'local') {
      loadLocalSkills(searchQuery, selectedCategory)
    }
  }, [selectedCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Install handlers ---------- */
  const handleInstallLocal = async (skillId: string) => {
    setInstalling(prev => new Set(prev).add(skillId))
    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId, session_id: currentSessionId || 'default' }),
      })
      const data = await res.json()
      if (data.success) setInstalledIds(prev => new Set(prev).add(skillId))
    } catch (e) {
      console.error('Install failed:', e)
    } finally {
      setInstalling(prev => { const n = new Set(prev); n.delete(skillId); return n })
    }
  }

  const handleInstallMarketplace = async (skill: MarketplaceSkill) => {
    const key = `mp:${skill.id}`
    setInstalling(prev => new Set(prev).add(key))
    try {
      const res = await fetch('/api/skills/install_from_marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skill.name,
          githubUrl: skill.githubUrl,
          description: skill.description,
          session_id: currentSessionId || 'default',
        }),
      })
      const data = await res.json()
      if (data.success) setInstalledIds(prev => new Set(prev).add(key))
    } catch (e) {
      console.error('Marketplace install failed:', e)
    } finally {
      setInstalling(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const handleUninstall = async (skillId: string) => {
    setInstalling(prev => new Set(prev).add(skillId))
    try {
      const res = await fetch('/api/skills/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId, session_id: currentSessionId || 'default' }),
      })
      const data = await res.json()
      if (data.success) setInstalledIds(prev => { const n = new Set(prev); n.delete(skillId); return n })
    } catch (e) {
      console.error('Uninstall failed:', e)
    } finally {
      setInstalling(prev => { const n = new Set(prev); n.delete(skillId); return n })
    }
  }

  /* ---------- Helpers ---------- */
  const installedCount = installedIds.size

  const formatDate = (ts: string) => {
    try {
      const d = new Date(parseInt(ts) * 1000)
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  /* ---------- Render skill card ---------- */
  const renderLocalSkill = (skill: LocalSkill) => {
    const isInstalled = installedIds.has(skill.id)
    const isBusy = installing.has(skill.id)
    return (
      <div key={skill.id}
        className="flex items-start p-4 rounded-xl transition-all group"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent-border)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center mr-4 text-xl" style={{ background: 'var(--bg-hover)' }}>
          {skill.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{skill.name}</h3>
            <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded-full"
              style={{ background: skill.type === 'plugin' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)', color: skill.type === 'plugin' ? '#a78bfa' : '#60a5fa' }}>
              {skill.type === 'plugin' ? '插件' : skill.type === 'markdown' ? '技能' : '其他'}
            </span>
          </div>
          <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: 'var(--text-muted)' }}>
            {skill.description || `${skill.category} 分类下的技能`}
          </p>
          <span className="text-xs mt-1 inline-block" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>{skill.category}</span>
        </div>
        <div className="flex-shrink-0 ml-3">
          {isBusy ? (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
          ) : isInstalled ? (
            <button onClick={() => handleUninstall(skill.id)} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(239,68,68,0.1)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              title="卸载"><Trash2 size={16} className="text-red-400" /></button>
          ) : (
            <button onClick={() => handleInstallLocal(skill.id)} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(34,197,94,0.1)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
              title="安装"><Download size={16} className="text-green-400" /></button>
          )}
        </div>
      </div>
    )
  }

  const renderMarketplaceSkill = (skill: MarketplaceSkill) => {
    const key = `mp:${skill.id}`
    const isInstalled = installedIds.has(key)
    const isBusy = installing.has(key)
    return (
      <div key={skill.id}
        className="flex items-start p-4 rounded-xl transition-all group"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent-border)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center mr-4" style={{ background: 'var(--bg-hover)' }}>
          <Globe size={20} style={{ color: 'var(--text-muted)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{skill.name}</h3>
            {skill.stars > 0 && (
              <span className="flex items-center gap-0.5 text-xs" style={{ color: '#f59e0b' }}>
                <Star size={12} fill="currentColor" /> {skill.stars}
              </span>
            )}
          </div>
          <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: 'var(--text-muted)' }}>
            {skill.description || '暂无描述'}
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>by {skill.author}</span>
            {skill.updatedAt && <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>{formatDate(skill.updatedAt)}</span>}
            <a href={skill.skillUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs flex items-center gap-0.5 hover:underline" style={{ color: 'var(--accent-from)' }}>
              <ExternalLink size={10} /> 详情
            </a>
          </div>
        </div>
        <div className="flex-shrink-0 ml-3">
          {isBusy ? (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
          ) : isInstalled ? (
            <button onClick={() => handleUninstall(key)} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(34,197,94,0.1)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
              title="已安装，点击卸载">
              <Check size={16} className="text-green-400" />
            </button>
          ) : (
            <button onClick={() => handleInstallMarketplace(skill)} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(34,197,94,0.1)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
              title="安装到工作空间"><Download size={16} className="text-green-400" /></button>
          )}
        </div>
      </div>
    )
  }

  /* ---------- Tab config ---------- */
  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'marketplace', label: '在线市场', icon: <Globe size={14} /> },
    { key: 'local', label: '本地技能', icon: <Package size={14} /> },
    { key: 'installed', label: '已安装', icon: <Check size={14} /> },
  ]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-app)' }}>
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewSession={() => {}}
        onSelectSession={() => {}}
        onDeleteSession={() => {}}
        modeLabel="建议"
        onCycleMode={() => {}}
        config={config}
        onConfigChange={(cfg) => {
          if (cfg.provider) setConfig(prev => ({ ...prev, provider: cfg.provider! }))
          if (cfg.model) setConfig(prev => ({ ...prev, model: cfg.model! }))
        }}
      />

      <div className={clsx('flex-1 flex flex-col min-w-0 transition-all duration-300', sidebarOpen ? 'ml-80' : 'ml-0')}>
        {/* Top bar */}
        <div className="flex items-center h-14 px-6 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg transition-colors mr-3"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <PanelLeft size={18} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>技能中心</h1>
          <span className="text-xs ml-3" style={{ color: 'var(--text-muted)' }}>
            浏览、搜索并安装技能到你的工作空间
          </span>
        </div>

        <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-5 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                style={{
                  background: activeTab === tab.key ? 'var(--accent-gradient)' : 'transparent',
                  color: activeTab === tab.key ? 'white' : 'var(--text-secondary)',
                }}>
                {tab.icon}
                {tab.label}
                {tab.key === 'installed' && installedCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full" style={{ background: activeTab === 'installed' ? 'rgba(255,255,255,0.25)' : 'var(--bg-hover)' }}>
                    {installedCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search + filters bar */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="text"
                placeholder={activeTab === 'marketplace' ? '在 skillsmp.com 搜索技能...' : '搜索技能名称或描述...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm focus:outline-none transition-colors"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/10">
                  <X size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>

            {/* Category filter (local mode) */}
            {activeTab === 'local' && (
              <div className="relative">
                <button onClick={() => setCategoryOpen(!categoryOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: selectedCategory ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  <span className="max-w-[120px] truncate">{selectedCategory || '全部分类'}</span>
                  <ChevronDown size={14} />
                </button>
                {categoryOpen && (
                  <div className="absolute right-0 top-full mt-1 w-56 max-h-80 overflow-y-auto rounded-xl shadow-xl z-50 py-1"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <button onClick={() => { setSelectedCategory(''); setCategoryOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-black/5"
                      style={{ color: !selectedCategory ? 'var(--accent-from)' : 'var(--text-primary)' }}>全部分类</button>
                    {categories.map(cat => (
                      <button key={cat} onClick={() => { setSelectedCategory(cat); setCategoryOpen(false) }}
                        className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-black/5"
                        style={{ color: selectedCategory === cat ? 'var(--accent-from)' : 'var(--text-primary)' }}>{cat}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sort (marketplace mode) */}
            {activeTab === 'marketplace' && (
              <div className="relative">
                <button onClick={() => setMpSortOpen(!mpSortOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {mpSort === 'stars' ? '⭐ 最热门' : '🕐 最新'}
                  <ChevronDown size={14} />
                </button>
                {mpSortOpen && (
                  <div className="absolute right-0 top-full mt-1 w-40 rounded-xl shadow-xl z-50 py-1"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <button onClick={() => { setMpSort('stars'); setMpSortOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-black/5"
                      style={{ color: mpSort === 'stars' ? 'var(--accent-from)' : 'var(--text-primary)' }}>⭐ 最热门</button>
                    <button onClick={() => { setMpSort('recent'); setMpSortOpen(false) }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-black/5"
                      style={{ color: mpSort === 'recent' ? 'var(--accent-from)' : 'var(--text-primary)' }}>🕐 最新</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            {activeTab === 'marketplace' && mpPagination && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <Globe size={14} className="text-blue-500" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  在线: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{mpPagination.total.toLocaleString()}</span> 个技能
                </span>
              </div>
            )}
            {activeTab === 'local' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <Zap size={14} className="text-amber-500" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  本地: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{localSkills.length}</span> 个技能
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <Puzzle size={14} className="text-violet-500" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                已安装: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{installedCount}</span>
              </span>
            </div>
            {selectedCategory && activeTab === 'local' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  分类: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedCategory}</span>
                </span>
                <button onClick={() => setSelectedCategory('')}><X size={12} style={{ color: 'var(--text-muted)' }} /></button>
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
              <span className="ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                {activeTab === 'marketplace' ? '正在搜索在线市场...' : '加载中...'}
              </span>
            </div>
          )}

          {/* Skills list */}
          {!loading && (
            <>
              {/* Marketplace */}
              {activeTab === 'marketplace' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {marketplaceSkills.map(renderMarketplaceSkill)}
                </div>
              )}

              {/* Local */}
              {activeTab === 'local' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {localSkills.map(renderLocalSkill)}
                </div>
              )}

              {/* Installed */}
              {activeTab === 'installed' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {localSkills.filter(s => installedIds.has(s.id)).map(renderLocalSkill)}
                  {/* Also show marketplace-installed */}
                  {marketplaceSkills.filter(s => installedIds.has(`mp:${s.id}`)).map(renderMarketplaceSkill)}
                </div>
              )}

              {/* Pagination (marketplace) */}
              {activeTab === 'marketplace' && mpPagination && mpPagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <button
                    disabled={!mpPagination.hasPrev}
                    onClick={() => { const p = mpPage - 1; setMpPage(p); loadMarketplace(searchQuery, p, mpSort) }}
                    className="px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-30"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    上一页
                  </button>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    第 {mpPagination.page} / {mpPagination.totalPages} 页
                  </span>
                  <button
                    disabled={!mpPagination.hasNext}
                    onClick={() => { const p = mpPage + 1; setMpPage(p); loadMarketplace(searchQuery, p, mpSort) }}
                    className="px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-30"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    下一页
                  </button>
                </div>
              )}

              {/* Empty */}
              {((activeTab === 'marketplace' && marketplaceSkills.length === 0) ||
                (activeTab === 'local' && localSkills.length === 0) ||
                (activeTab === 'installed' && installedCount === 0)) && (
                <div className="text-center py-16">
                  <Puzzle size={48} className="mx-auto mb-4 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {activeTab === 'installed' ? '暂未安装任何技能' : activeTab === 'marketplace' ? '未找到匹配的技能，换个关键词试试' : '未找到匹配的本地技能'}
                  </p>
                  {activeTab === 'installed' && (
                    <button onClick={() => setActiveTab('marketplace')} className="mt-3 text-sm underline" style={{ color: 'var(--accent-from)' }}>
                      去在线市场发现技能
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Click outside overlays */}
      {(categoryOpen || mpSortOpen) && (
        <div className="fixed inset-0 z-40" onClick={() => { setCategoryOpen(false); setMpSortOpen(false) }} />
      )}
    </div>
  )
}
