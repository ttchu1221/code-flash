import { useState, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import { Loader2, Plus, Trash2, Save } from 'lucide-react'

interface MCPServer {
  name: string
  transport: 'stdio' | 'sse'
  command: string
  args: string[]
  url: string
  enabled: boolean
}

export function Settings() {
  const { theme } = useTheme()
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings/mcp')
        const data = await response.json()
        if (data.servers) {
          setServers(data.servers)
        }
      } catch (error) {
        console.error('加载设置失败:', error)
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  const handleAddServer = () => {
    setServers(prev => [...prev, {
      name: '',
      transport: 'stdio',
      command: '',
      args: [],
      url: '',
      enabled: true
    }])
  }

  const handleRemoveServer = (index: number) => {
    setServers(prev => prev.filter((_, i) => i !== index))
  }

  const handleChange = (index: number, field: keyof MCPServer, value: any) => {
    setServers(prev => prev.map((server, i) => 
      i === index ? { ...server, [field]: value } : server
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers })
      })
      const data = await response.json()
      if (data.success) {
        alert('保存成功')
      }
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-app)' }}>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>MCP 服务器配置</h1>
            <button 
              onClick={handleAddServer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
              style={{ 
                background: 'var(--accent-gradient)',
                color: 'white'
              }}
            >
              <Plus size={16} />
              添加服务器
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            <div className="space-y-4">
              {servers.map((server, index) => (
                <div 
                  key={index}
                  className="p-4 rounded-xl transition-all"
                  style={{ 
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={server.name}
                        onChange={e => handleChange(index, 'name', e.target.value)}
                        placeholder="服务器名称"
                        className="text-lg font-medium bg-transparent border-none outline-none"
                        style={{ color: 'var(--text-primary)' }}
                      />
                      <select
                        value={server.transport}
                        onChange={e => handleChange(index, 'transport', e.target.value)}
                        className="px-3 py-1 rounded-lg text-sm"
                        style={{ 
                          background: 'var(--bg-hover)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <option value="stdio">stdio</option>
                        <option value="sse">SSE</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={e => handleChange(index, 'enabled', e.target.checked)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>启用</span>
                      </label>
                      <button 
                        onClick={() => handleRemoveServer(index)}
                        className="p-2 rounded-lg transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 size={16} className="text-red-400" />
                      </button>
                    </div>
                  </div>

                  {server.transport === 'stdio' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>命令</label>
                        <input
                          type="text"
                          value={server.command}
                          onChange={e => handleChange(index, 'command', e.target.value)}
                          placeholder="例如: python"
                          className="w-full px-3 py-2 rounded-lg text-sm"
                          style={{ 
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)'
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>参数</label>
                        <input
                          type="text"
                          value={server.args.join(' ')}
                          onChange={e => handleChange(index, 'args', e.target.value.split(' ').filter(Boolean))}
                          placeholder="例如: -m server"
                          className="w-full px-3 py-2 rounded-lg text-sm"
                          style={{ 
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)'
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>URL</label>
                      <input
                        type="text"
                        value={server.url}
                        onChange={e => handleChange(index, 'url', e.target.value)}
                        placeholder="例如: http://localhost:8080"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ 
                          background: 'var(--bg-hover)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border)'
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}

              {servers.length === 0 && (
                <div 
                  className="text-center py-12 rounded-xl"
                  style={{ 
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)'
                  }}
                >
                  <p style={{ color: 'var(--text-muted)' }}>暂无配置的 MCP 服务器</p>
                  <button 
                    onClick={handleAddServer}
                    className="mt-4 text-sm underline"
                    style={{ color: 'var(--accent-from)' }}
                  >
                    点击添加第一个服务器
                  </button>
                </div>
              )}

              {servers.length > 0 && (
                <div className="flex justify-end pt-4">
                  <button 
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    style={{ 
                      background: 'var(--accent-gradient)',
                      color: 'white'
                    }}
                  >
                    {saving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Save size={16} />
                    )}
                    保存配置
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
