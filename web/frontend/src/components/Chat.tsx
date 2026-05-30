import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Send,
  Loader2,
  StopCircle,
  PanelLeft,
  Zap,
  ArrowDown,
  Sparkles,
  Wifi,
  WifiOff,
  RefreshCw,
  Minimize2,
} from 'lucide-react'
import clsx from 'clsx'
import type { ChatMessage, ToolCall, PermissionRequest, SessionMeta, WSEvent } from '../types'
import { useWebSocket } from '../hooks/useWebSocket'
import { useTheme } from '../hooks/useTheme'
import { MessageBubble } from './MessageBubble'
import { PermissionModal } from './PermissionModal'
import { Sidebar } from './Sidebar'
import { CommandInput, type CommandInputHandle, type ActiveSkill } from './CommandInput'

let _msgId = 0
const newId = () => `msg-${++_msgId}-${Date.now()}`

export function Chat() {
  const { theme } = useTheme()
  const [sessionId, setSessionId] = useState(() => `web-${Date.now()}`)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [pendingTools, setPendingTools] = useState<ToolCall[]>([])
  const [permissionReq, setPermissionReq] = useState<PermissionRequest | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessions] = useState<SessionMeta[]>([])
  const [modeLabel, setModeLabel] = useState('Default')
  const [config, setConfig] = useState({ provider: 'anthropic', model: '' })
  const [autoScroll, setAutoScroll] = useState(true)
  const [inputFocused, setInputFocused] = useState(false)
  const [activeSkills, setActiveSkills] = useState<ActiveSkill[]>([])
  const [inputTokens, setInputTokens] = useState(0)
  const [isCompacting, setIsCompacting] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<CommandInputHandle>(null)

  const streamingTextRef = useRef('')
  const currentAssistantIdRef = useRef<string | null>(null)
  const pendingToolsRef = useRef<ToolCall[]>([])

  const scrollToBottom = useCallback(() => {
    if (autoScroll) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [autoScroll])

  useEffect(() => { scrollToBottom() }, [messages, streamingText, pendingTools, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }, [])

  const handleEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'text':
        streamingTextRef.current += event.content
        setStreamingText(streamingTextRef.current)
        break
      case 'tool_call': {
        const tc: ToolCall = {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: event.name, input: event.input, activity: event.activity, status: 'pending',
        }
        pendingToolsRef.current = [...pendingToolsRef.current, tc]
        setPendingTools([...pendingToolsRef.current])
        break
      }
      case 'tool_executing':
        pendingToolsRef.current = pendingToolsRef.current.map((t) =>
          t.name === event.name && JSON.stringify(t.input) === JSON.stringify(event.input)
            ? { ...t, status: 'executing' as const } : t)
        setPendingTools([...pendingToolsRef.current])
        break
      case 'tool_result':
        pendingToolsRef.current = pendingToolsRef.current.map((t) =>
          t.name === event.name && JSON.stringify(t.input) === JSON.stringify(event.input)
            ? { ...t, status: 'done' as const, result: event.content, isError: event.is_error } : t)
        setPendingTools([...pendingToolsRef.current])
        break
      case 'waiting': {
        const text = streamingTextRef.current
        const tools = [...pendingToolsRef.current]
        if (text || tools.length > 0) {
          const id = currentAssistantIdRef.current || newId()
          setMessages((prev) => {
            const exists = prev.findIndex((m) => m.id === id)
            const msg: ChatMessage = { id, role: 'assistant', content: text, toolCalls: tools, timestamp: Date.now() }
            if (exists >= 0) { const next = [...prev]; next[exists] = msg; return next }
            return [...prev, msg]
          })
        }
        streamingTextRef.current = ''; setStreamingText('')
        pendingToolsRef.current = []; setPendingTools([])
        currentAssistantIdRef.current = newId()
        break
      }
      case 'error':
        setMessages((prev) => [...prev, { id: newId(), role: 'system', content: `⚠️ ${event.content}`, timestamp: Date.now() }])
        break
      case 'system':
        setMessages((prev) => [...prev, { id: newId(), role: 'system', content: event.content, timestamp: Date.now() }])
        break
      case 'usage':
        setInputTokens(event.input_tokens)
        break
      case 'compact_done': {
        setIsCompacting(false)
        const label = event.auto ? '🔄 自动压缩完成' : '✅ 压缩完成'
        setMessages((prev) => [...prev, {
          id: newId(), role: 'system',
          content: `${label}: ${event.pre_tokens.toLocaleString()} → ${event.post_tokens.toLocaleString()} tokens ` +
            `(${event.pre_messages} → ${event.post_messages} 条消息)`,
          timestamp: Date.now(),
        }])
        break
      }
      case 'done': {
        const finalText = streamingTextRef.current
        const finalTools = [...pendingToolsRef.current]
        if (finalText || finalTools.length > 0) {
          const id = currentAssistantIdRef.current || newId()
          setMessages((prev) => {
            const exists = prev.findIndex((m) => m.id === id)
            const msg: ChatMessage = { id, role: 'assistant', content: finalText, toolCalls: finalTools, timestamp: Date.now() }
            if (exists >= 0) { const next = [...prev]; next[exists] = msg; return next }
            return [...prev, msg]
          })
        }
        streamingTextRef.current = ''; setStreamingText('')
        pendingToolsRef.current = []; setPendingTools([])
        currentAssistantIdRef.current = null; setIsStreaming(false)
        break
      }
    }
  }, [])

  const handlePermissionRequest = useCallback((req: PermissionRequest) => { setPermissionReq(req) }, [])

  const ws = useWebSocket({ sessionId, onEvent: handleEvent, onPermissionRequest: handlePermissionRequest })
  const { sendCompact } = ws

  useEffect(() => {
    ws.connect()
    fetch('/api/config').then((r) => r.json()).then(setConfig).catch(() => {})
    return () => ws.disconnect()
  }, [sessionId])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isStreaming) return

    // Build enriched message: prepend active skills content
    let enrichedText = text
    if (activeSkills.length > 0) {
      const skillsContext = activeSkills.map(s =>
        `[技能: ${s.name}]\n${s.content}`
      ).join('\n\n---\n\n')
      enrichedText = `${skillsContext}\n\n---\n\n${text}`
    }

    // Display the user's original message (not the enriched one)
    const displayText = activeSkills.length > 0
      ? `${activeSkills.map(s => `${s.emoji} ${s.name}`).join(' ')}\n${text}`
      : text

    // Auto-reconnect if disconnected
    if (ws.state !== 'connected') {
      ws.connect()
      setMessages((prev) => [...prev, { id: newId(), role: 'system', content: '⚡ 正在重新连接...', timestamp: Date.now() }])
      setTimeout(() => {
        const sent = ws.sendMessage(enrichedText)
        if (!sent) {
          setMessages((prev) => [...prev, { id: newId(), role: 'system', content: '⚠️ 连接失败，请检查服务器是否运行中', timestamp: Date.now() }])
          setIsStreaming(false)
        } else {
          setMessages((prev) => [...prev, { id: newId(), role: 'user', content: displayText, timestamp: Date.now() }])
          setIsStreaming(true)
        }
      }, 1000)
      setInput('')
      setActiveSkills([])
      return
    }

    setMessages((prev) => [...prev, { id: newId(), role: 'user', content: displayText, timestamp: Date.now() }])
    streamingTextRef.current = ''; setStreamingText('')
    pendingToolsRef.current = []; setPendingTools([])
    currentAssistantIdRef.current = newId(); setIsStreaming(true); setInput('')
    setActiveSkills([])
    const sent = ws.sendMessage(enrichedText)
    if (!sent) {
      setMessages((prev) => [...prev, { id: newId(), role: 'system', content: '⚠️ 发送失败，连接已断开', timestamp: Date.now() }])
      setIsStreaming(false)
    }
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.resetHeight() }, 50)
  }, [input, isStreaming, ws, activeSkills])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handlePermission = useCallback((approved: boolean, always: boolean) => {
    if (permissionReq) {
      ws.sendPermissionResponse(permissionReq.id, approved, always)
      if (!approved) {
        pendingToolsRef.current = pendingToolsRef.current.map((t) =>
          t.status === 'pending' ? { ...t, status: 'denied' as const } : t)
        setPendingTools([...pendingToolsRef.current])
      }
      setPermissionReq(null)
    }
  }, [permissionReq, ws])

  const handleAbort = useCallback(() => {
    ws.abort(); setIsStreaming(false)
    streamingTextRef.current = ''; setStreamingText('')
    pendingToolsRef.current = []; setPendingTools([])
  }, [ws])

  const handleCompact = useCallback(() => {
    if (isStreaming || isCompacting) return
    setIsCompacting(true)
    sendCompact()
  }, [isStreaming, isCompacting, sendCompact])

  const handleNewSession = useCallback(() => {
    ws.disconnect()
    const nid = `web-${Date.now()}`
    setSessionId(nid); setMessages([]); setStreamingText(''); setPendingTools([])
    setIsStreaming(false); streamingTextRef.current = ''
    pendingToolsRef.current = []; currentAssistantIdRef.current = null; setSidebarOpen(false)
  }, [ws])

  const handleCycleMode = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/cycle_mode`, { method: 'POST' })
      const data = await res.json()
      if (data.mode_label) setModeLabel(data.mode_label)
    } catch {}
  }, [sessionId])

  const handleConfigChange = useCallback(
    async (cfg: { provider?: string; api_key?: string; base_url?: string; model?: string; workspace?: string }) => {
      try {
        const res = await fetch('/api/init', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
        })
        const data = await res.json()
        setConfig({ provider: data.provider, model: data.model })
        handleNewSession()
      } catch {}
    }, [handleNewSession])

  const displayMessages = [...messages]
  if (isStreaming && (streamingText || pendingTools.length > 0)) {
    const streamMsg: ChatMessage = {
      id: currentAssistantIdRef.current || newId(), role: 'assistant',
      content: streamingText, toolCalls: pendingTools, timestamp: Date.now(),
    }
    const exists = displayMessages.findIndex((m) => m.id === streamMsg.id)
    if (exists >= 0) displayMessages[exists] = streamMsg
    else displayMessages.push(streamMsg)
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <Sidebar
        sessions={sessions} currentSessionId={sessionId} isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)} onNewSession={handleNewSession}
        onSelectSession={() => setSidebarOpen(false)}
        onDeleteSession={async (id) => { await fetch(`/api/sessions/${id}`, { method: 'DELETE' }) }}
        modeLabel={modeLabel} onCycleMode={handleCycleMode}
        config={config} onConfigChange={handleConfigChange}
      />

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 backdrop-blur-sm animate-fade-in"
          style={{ background: 'var(--shadow)' }} onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3 glass"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-xl transition-all" style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <PanelLeft size={17} />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Zap size={12} className="text-white" />
              </div>
              <span className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                code-flash
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              {config.model || '未设置'}
            </span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg text-violet-400/80"
              style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
              {modeLabel}
            </span>
            <div className="flex items-center gap-2">
              {ws.state === 'connected' ? (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                  <Wifi size={12} className="text-emerald-400" />
                </div>
              ) : ws.state === 'connecting' ? (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                  <RefreshCw size={12} className="text-amber-400 animate-spin" />
                </div>
              ) : (
                <button onClick={() => ws.connect()}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors hover:bg-red-500/10"
                  style={{ color: '#f87171' }} title="点击重新连接">
                  <WifiOff size={12} />
                  <span>断开</span>
                </button>
              )}
              <div className={clsx(
                'w-2 h-2 rounded-full transition-colors',
                isStreaming ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.4)]' :
                  ws.state === 'connected' ? 'bg-emerald-400/50' : 'bg-red-400/50'
              )} />
            </div>
          </div>
        </header>

        {/* Messages */}
        <div ref={chatContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-5">
            {displayMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center">
                <div className="relative mb-6">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center"
                    style={{ border: '1px solid var(--accent-border)' }}>
                    <Sparkles size={32} className="text-violet-400" />
                  </div>
                  <div className="absolute -inset-4 bg-violet-500/5 rounded-3xl blur-xl -z-10" />
                </div>
                <h2 className="text-xl font-semibold mb-2">
                  <span className="text-gradient">code-flash</span>
                </h2>
                <p className="text-sm max-w-sm mb-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  AI 编程助手 · 文件读写 · 代码搜索 · Shell 命令 · 智能规划
                </p>
                {/* API Key 配置提示 */}
                <div className="mb-6 px-4 py-3 rounded-xl text-sm max-w-lg w-full"
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <p className="flex items-center gap-2">
                    <span>💡</span>
                    <span>首次使用请在侧边栏「设置」中配置 API Key</span>
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
                  {[
                    { icon: '📂', text: '列出项目中的 Python 文件' },
                    { icon: '🔍', text: '解释 engine.py 的工具循环' },
                    { icon: '⚡', text: '帮我写一个 FastAPI 接口' },
                    { icon: '🧪', text: '运行测试并修复错误' },
                  ].map((s) => (
                    <button key={s.text}
                      onClick={() => { setInput(s.text); inputRef.current?.focus() }}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-all group"
                      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-active)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                      <span className="text-base">{s.icon}</span>
                      <span className="group-hover:opacity-80 transition-opacity">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {displayMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          </div>
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom */}
        {!autoScroll && isStreaming && (
          <div className="absolute bottom-28 right-6 z-10">
            <button onClick={() => { setAutoScroll(true); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              className="p-2.5 rounded-xl shadow-xl transition-all"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}>
              <ArrowDown size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="glass p-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 rounded-2xl transition-all duration-200"
              style={{
                border: `1px solid ${inputFocused ? 'var(--accent-border)' : 'var(--border-strong)'}`,
                background: inputFocused ? 'var(--input-focus)' : 'var(--input-bg)',
                boxShadow: inputFocused ? '0 0 20px var(--accent-bg)' : 'none',
              }}>
              <CommandInput
                ref={inputRef}
                value={input}
                onChange={setInput}
                onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onActiveSkillsChange={setActiveSkills}
                placeholder="输入消息... 输入 / 唤起技能列表 (Enter 发送, Shift+Enter 换行)"
                disabled={false}
                className="flex-1"
              />
              <div className="flex items-center gap-1.5 pr-2 pb-2.5">
                {isStreaming ? (
                  <button onClick={handleAbort}
                    className="flex-shrink-0 p-2.5 rounded-xl transition-all bg-red-500/15 hover:bg-red-500/25"
                    style={{ border: '1px solid rgba(239,68,68,0.2)' }} title="停止生成">
                    <StopCircle size={16} className="text-red-400" />
                  </button>
                ) : (
                  <button onClick={handleSend} disabled={!input.trim()}
                    className={clsx('flex-shrink-0 p-2.5 rounded-xl transition-all',
                      input.trim() ? 'bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white shadow-lg shadow-violet-500/20' : 'cursor-not-allowed')}
                    style={!input.trim() ? { background: 'var(--bg-hover)', color: 'var(--text-faint)' } : undefined}
                    title="发送">
                    {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2.5 px-1">
              <div className="flex items-center gap-3">
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  / 唤起技能 · Shift+Enter 换行 · /clear 清空
                </span>
                {inputTokens > 0 && (
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--text-faint)', background: 'var(--bg-hover)' }}>
                    {inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k` : inputTokens} tokens
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isStreaming && (
                  <span className="text-[11px] text-violet-400/70 animate-pulse flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    生成中...
                  </span>
                )}
                {!isStreaming && messages.length >= 4 && (
                  <button onClick={handleCompact}
                    disabled={isCompacting}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg transition-all hover:bg-violet-500/10"
                    style={{ color: isCompacting ? 'var(--text-faint)' : 'var(--text-muted)' }}
                    title="压缩上下文（释放 token 空间）">
                    {isCompacting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Minimize2 size={11} />
                    )}
                    <span>{isCompacting ? '压缩中...' : '压缩'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {permissionReq && <PermissionModal request={permissionReq} onRespond={handlePermission} />}
    </div>
  )
}
