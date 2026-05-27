import { useEffect, useRef, useState } from 'react'
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
import { Copy, Check } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const ref = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    if (ref.current) {
      ref.current.removeAttribute('data-highlighted')
      hljs.highlightElement(ref.current)
    }
  }, [code, language])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isDark = theme === 'dark'

  return (
    <div className="relative group my-2 rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}>
      {language && (
        <div className="flex items-center justify-between px-4 py-2"
          style={{ background: isDark ? '#0d1017' : '#f0f2f5', borderBottom: '1px solid var(--border)' }}>
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{language}</span>
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
      )}
      <pre className="!m-0 !p-4 overflow-x-auto text-sm leading-relaxed"
        style={{ background: 'var(--code-bg)' }}>
        <code ref={ref} className={language ? `language-${language}` : ''}>
          {code}
        </code>
      </pre>
    </div>
  )
}
