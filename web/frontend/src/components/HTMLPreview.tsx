import { useState, useRef, useEffect } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface HTMLPreviewProps {
  code: string
}

export function HTMLPreview({ code }: HTMLPreviewProps) {
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (iframeRef.current && !showSource) {
      const iframe = iframeRef.current
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (doc) {
        doc.open()
        doc.write(code)
        doc.close()
      }
    }
  }, [code, showSource])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenInNewTab = () => {
    const newWindow = window.open('', '_blank')
    if (newWindow) {
      newWindow.document.write(code)
      newWindow.document.close()
    }
  }

  return (
    <div className="relative group my-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            HTML 预览
          </span>
          <button
            onClick={() => setShowSource(!showSource)}
            className="text-[11px] px-2 py-0.5 rounded-md transition-colors"
            style={{ 
              color: showSource ? 'var(--accent-light)' : 'var(--text-muted)',
              background: showSource ? 'var(--accent-bg)' : 'transparent',
              border: showSource ? '1px solid var(--accent-border)' : '1px solid transparent'
            }}
          >
            {showSource ? '预览' : '源码'}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleOpenInNewTab}
            className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ExternalLink size={12} />
            <span>新窗口打开</span>
          </button>
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}>
            {copied ? (
              <><Check size={12} className="text-emerald-400" /><span className="text-emerald-400">已复制</span></>
            ) : (
              <><Copy size={12} /><span>复制</span></>
            )}
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      {showSource ? (
        <pre className="!m-0 !p-4 overflow-x-auto text-sm leading-relaxed"
          style={{ background: 'var(--code-bg)' }}>
          <code className="language-html">{code}</code>
        </pre>
      ) : (
        <div className="relative" style={{ minHeight: '200px', maxHeight: '600px' }}>
          <iframe
            ref={iframeRef}
            className="w-full border-0"
            style={{ 
              background: 'white',
              minHeight: '200px',
              maxHeight: '600px'
            }}
            sandbox="allow-scripts allow-same-origin"
            title="HTML 预览"
          />
        </div>
      )}
    </div>
  )
}