/**
 * FileViewer — in-app file preview modal
 * Supports text files with syntax highlighting and image preview.
 */
import { useState, useEffect, useRef } from 'react'
import { X, Download, ExternalLink, Copy, Check } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import ini from 'highlight.js/lib/languages/ini'
import { useTheme } from '../hooks/useTheme'

// Register languages (idempotent — hljs skips if already registered)
const _langs: Record<string, any> = {
  python, javascript, typescript, bash, json, css, html: xml, xml,
  go, rust, java, sql, yaml, markdown, ini,
}
for (const [name, mod] of Object.entries(_langs)) {
  try { hljs.registerLanguage(name, mod) } catch {}
}

// Map file extensions to highlight.js language names
const EXT_TO_LANG: Record<string, string> = {
  '.py': 'python',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.html': 'html',
  '.css': 'css',
  '.json': 'json',
  '.md': 'markdown',
  '.sh': 'bash',
  '.bash': 'bash',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.sql': 'sql',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.txt': '',
  '.log': '',
  '.csv': '',
  '.env': '',
  '.gitignore': '',
  '.dockerfile': 'dockerfile',
  '.docker': 'dockerfile',
  '.makefile': 'makefile',
  '.r': 'r',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.vue': 'html',
  '.svelte': 'html',
}

interface FileViewerProps {
  sessionId: string
  filePath: string
  onClose: () => void
}

export default function FileViewer({ sessionId, filePath, onClose }: FileViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [contentType, setContentType] = useState<'text' | 'image' | 'binary'>('text')
  const [content, setContent] = useState('')
  const [mime, setMime] = useState('')
  const [fileName, setFileName] = useState('')
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const loadFile = async () => {
      setLoading(true)
      setError('')
      try {
        const resp = await fetch(`/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(filePath)}`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        setContentType(data.type)
        setContent(data.content)
        setMime(data.mime || '')
        setFileName(data.name || filePath.split('/').pop() || filePath)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadFile()
  }, [sessionId, filePath])

  // Syntax highlighting
  useEffect(() => {
    if (contentType === 'text' && codeRef.current && content) {
      const ext = '.' + (fileName.split('.').pop() || '')
      const lang = EXT_TO_LANG[ext] || ''
      codeRef.current.removeAttribute('data-highlighted')
      if (lang) {
        codeRef.current.className = `language-${lang}`
        hljs.highlightElement(codeRef.current)
      } else {
        hljs.highlightElement(codeRef.current)
      }
    }
  }, [content, contentType, fileName])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const url = `/api/sessions/${sessionId}/files/${encodeURIComponent(filePath)}`
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  }

  const handleOpenExternal = () => {
    const url = `/api/sessions/${sessionId}/files/${encodeURIComponent(filePath)}`
    window.open(url, '_blank')
  }

  const ext = '.' + (fileName.split('.').pop() || '')
  const isDark = theme === 'dark'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: 'min(90vw, 960px)',
          height: 'min(85vh, 720px)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {fileName}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
              {ext}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {contentType === 'text' && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
            )}
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Download size={13} />
              <span>下载</span>
            </button>
            <button
              onClick={handleOpenExternal}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-secondary)' }}
              title="在新标签页打开"
            >
              <ExternalLink size={13} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-sm text-red-400">加载失败: {error}</div>
            </div>
          )}

          {!loading && !error && contentType === 'image' && (
            <div className="flex items-center justify-center h-full p-4">
              <img
                src={`data:${mime};base64,${content}`}
                alt={fileName}
                className="max-w-full max-h-full object-contain rounded-lg"
                style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}
              />
            </div>
          )}

          {!loading && !error && contentType === 'text' && (
            <pre
              className="!m-0 !p-4 text-sm leading-relaxed h-full overflow-auto"
              style={{ background: isDark ? '#0d1017' : '#f8f9fa' }}
            >
              <code ref={codeRef} className="">
                {content}
              </code>
            </pre>
          )}

          {!loading && !error && contentType === 'binary' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
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
      </div>
    </div>
  )
}
