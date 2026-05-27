import { useState, useRef, useEffect } from 'react'
import { Copy, Check, ExternalLink, Download, FileText, Image, File, Code } from 'lucide-react'
import { PDFPreview } from './PDFPreview'

interface FilePreviewProps {
  code: string
  language?: string
  fileName?: string
  defaultShowSource?: boolean // 是否默认显示源代码
}

export function FilePreview({ code, language, fileName, defaultShowSource = false }: FilePreviewProps) {
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(defaultShowSource)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewType, setPreviewType] = useState<'html' | 'image' | 'code' | 'pdf' | 'unsupported'>('code')

  useEffect(() => {
    // 根据语言或文件扩展名确定预览类型
    const lang = language?.toLowerCase() || ''
    const ext = fileName?.split('.').pop()?.toLowerCase() || ''
    
    if (lang === 'html' || ext === 'html' || ext === 'htm') {
      setPreviewType('html')
    } else if (['svg', 'xml'].includes(lang) && (ext === 'svg' || code.trim().startsWith('<svg'))) {
      setPreviewType('html') // SVG 可以作为 HTML 渲染
    } else if (['image', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(lang) ||
               ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
      setPreviewType('image')
    } else if (lang === 'pdf' || ext === 'pdf') {
      setPreviewType('pdf')
    } else if (['json', 'javascript', 'typescript', 'python', 'bash', 'css', 'markdown'].includes(lang) ||
               ['json', 'js', 'ts', 'py', 'sh', 'css', 'md'].includes(ext)) {
      setPreviewType('code')
    } else {
      setPreviewType('unsupported')
    }
  }, [code, language, fileName])

  useEffect(() => {
    if (iframeRef.current && previewType === 'html' && !showSource) {
      const iframe = iframeRef.current
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (doc) {
        doc.open()
        doc.write(code)
        doc.close()
      }
    }
  }, [code, previewType, showSource])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenInNewTab = () => {
    if (previewType === 'html') {
      const newWindow = window.open('', '_blank')
      if (newWindow) {
        newWindow.document.write(code)
        newWindow.document.close()
      }
    } else if (previewType === 'image') {
      // 对于图片，创建 data URL
      const ext = fileName?.split('.').pop()?.toLowerCase() || 'png'
      const mime = `image/${ext === 'svg' ? 'svg+xml' : ext}`
      const dataUrl = `data:${mime};base64,${code}`
      window.open(dataUrl, '_blank')
    }
  }

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'file.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getLanguageLabel = () => {
    if (language) return language
    if (fileName) {
      const ext = fileName.split('.').pop()
      return ext ? ext.toUpperCase() : 'TEXT'
    }
    return 'TEXT'
  }

  const getIcon = () => {
    switch (previewType) {
      case 'html':
        return <Code size={14} className="text-orange-400" />
      case 'image':
        return <Image size={14} className="text-green-400" />
      case 'code':
        return <FileText size={14} className="text-blue-400" />
      default:
        return <File size={14} className="text-gray-400" />
    }
  }

  return (
    <div className="relative group my-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {getLanguageLabel()} 预览
          </span>
          {fileName && (
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
              {fileName}
            </span>
          )}
          {previewType === 'html' && (
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
          )}
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
          <button onClick={handleDownload}
            className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Download size={12} />
            <span>下载</span>
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
      {previewType === 'html' && !showSource ? (
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
      ) : previewType === 'image' ? (
        <div className="flex items-center justify-center p-4" style={{ minHeight: '200px', maxHeight: '600px' }}>
          <img
            src={`data:image/${fileName?.split('.').pop() || 'png'};base64,${code}`}
            alt={fileName || '图片预览'}
            className="max-w-full max-h-full object-contain rounded-lg"
            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}
          />
        </div>
      ) : previewType === 'pdf' ? (
        <PDFPreview code={code} fileName={fileName} />
      ) : (
        <pre className="!m-0 !p-4 overflow-x-auto text-sm leading-relaxed"
          style={{ background: 'var(--code-bg)', minHeight: '100px', maxHeight: '400px' }}>
          <code className={`language-${language || 'text'}`}>{code}</code>
        </pre>
      )}

      {/* 不支持预览的提示 */}
      {previewType === 'unsupported' && (
        <div className="flex flex-col items-center justify-center p-6 gap-3">
          <File size={32} className="text-gray-400" />
          <div className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            此文件类型不支持预览
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}
          >
            <Download size={16} />
            下载文件
          </button>
        </div>
      )}
    </div>
  )
}