import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot, Info, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import type { ChatMessage } from '../types'
import { CodeBlock } from './CodeBlock'
import { FilePreview } from './FilePreview'
import { ToolCallCard } from './ToolCallCard'

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    const isWarning = message.content.startsWith('⚠️')
    return (
      <div className="flex items-center justify-center gap-2 py-2 animate-fade-in">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
          style={{
            background: isWarning ? 'rgba(245,158,11,0.08)' : 'var(--bg-hover)',
            color: isWarning ? '#fbbf24' : 'var(--text-muted)',
            border: `1px solid ${isWarning ? 'rgba(245,158,11,0.15)' : 'var(--border)'}`,
          }}>
          {isWarning ? <AlertTriangle size={13} /> : <Info size={13} />}
          <span>{message.content}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('flex gap-3 animate-fade-in', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center"
            style={{ border: '1px solid var(--accent-border)' }}>
            <Bot size={15} className="text-violet-400" />
          </div>
        </div>
      )}

      <div className={clsx('max-w-[80%] min-w-0', isUser ? 'order-first' : '')}>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {message.toolCalls.map((tc) => <ToolCallCard key={tc.id} tool={tc} />)}
          </div>
        )}

        {message.content && (
          <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={isUser
              ? { background: 'var(--user-bubble)', color: 'var(--user-bubble-text)', borderRadius: '1rem 1rem 0.25rem 1rem', boxShadow: '0 4px 12px rgba(124,58,237,0.15)' }
              : { background: 'var(--assistant-bubble)', color: 'var(--text-primary)', borderRadius: '1rem 1rem 1rem 0.25rem', border: '1px solid var(--assistant-border)' }
            }>
            <MarkdownContent content={message.content} isStreaming={isStreaming} isUser={isUser} />
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center"
            style={{ border: '1px solid rgba(59,130,246,0.15)' }}>
            <User size={15} className="text-blue-400" />
          </div>
        </div>
      )}
    </div>
  )
}

function MarkdownContent({ content, isStreaming, isUser }: { content: string; isStreaming?: boolean; isUser?: boolean }) {
  const components = useMemo(
    () => ({
      code({ node, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '')
        const codeStr = String(children).replace(/\n$/, '')
        const isInline = !match && !codeStr.includes('\n')
        if (!isInline && (match || codeStr.includes('\n'))) {
          // 检查是否是可预览的文件类型
          const language = match?.[1]?.toLowerCase() || ''
          const previewableLanguages = ['html', 'svg', 'xml', 'image', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf']
          const previewableExtensions = ['html', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf']

          // 检查语言是否可预览
          const isPreviewable = previewableLanguages.includes(language) ||
            (language === 'xml' && codeStr.trim().startsWith('<svg'))

          // 检查是否是完整的HTML文档（包含<html>或<body>标签）
          const isCompleteHTML = language === 'html' && 
            (codeStr.includes('<html') || codeStr.includes('<body') || codeStr.includes('<!DOCTYPE'))

          // 检查代码块是否包含文件名（通过注释或特殊标记）
          const fileNameMatch = codeStr.match(/^<!--\s*filename:\s*(.+?)\s*-->/i) ||
                               codeStr.match(/^\/\*\s*filename:\s*(.+?)\s*\*\//i) ||
                               codeStr.match(/^#\s*filename:\s*(.+?)\s*$/m)

          let fileName = ''
          if (fileNameMatch) {
            fileName = fileNameMatch[1].trim()
            const ext = fileName.split('.').pop()?.toLowerCase() || ''
            if (previewableExtensions.includes(ext)) {
              // 对于完整的HTML文档，默认显示预览；否则默认显示代码
              const defaultShowSource = !isCompleteHTML
              return <FilePreview code={codeStr} language={language} fileName={fileName} defaultShowSource={defaultShowSource} />
            }
          }

          if (isPreviewable) {
            // 对于完整的HTML文档，默认显示预览；否则默认显示代码
            const defaultShowSource = !isCompleteHTML
            return <FilePreview code={codeStr} language={language} defaultShowSource={defaultShowSource} />
          }

          return <CodeBlock code={codeStr} language={match?.[1]} />
        }
        return (
          <code className="px-1.5 py-0.5 rounded text-xs"
            style={isUser
              ? { background: 'rgba(255,255,255,0.15)', color: '#e0e7ff' }
              : { background: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
            {...props}>
            {children}
          </code>
        )
      },
      pre({ children }: any) {
        if (children?.type === CodeBlock) return children
        return <>{children}</>
      },
      table({ children }: any) {
        return (
          <div className="overflow-x-auto my-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <table className="border-collapse text-xs w-full">{children}</table>
          </div>
        )
      },
      th({ children }: any) {
        return <th className="px-3 py-2 text-left font-medium" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>{children}</th>
      },
      td({ children }: any) {
        return <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)', color: isUser ? '#e0e7ff' : 'var(--text-secondary)' }}>{children}</td>
      },
      a({ href, children }: any) {
        return <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors hover:opacity-80" style={{ color: isUser ? '#c4b5fd' : 'var(--accent-light)' }}>{children}</a>
      },
      ul({ children }: any) {
        return <ul className="list-disc list-inside my-1.5 space-y-0.5">{children}</ul>
      },
      ol({ children }: any) {
        return <ol className="list-decimal list-inside my-1.5 space-y-0.5">{children}</ol>
      },
      blockquote({ children }: any) {
        return <blockquote className="border-l-2 pl-3 my-2 italic" style={{ borderColor: 'var(--accent-border)', color: isUser ? '#c4b5fd' : 'var(--text-secondary)' }}>{children}</blockquote>
      },
      h1({ children }: any) {
        return <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>
      },
      h2({ children }: any) {
        return <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>
      },
      h3({ children }: any) {
        return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>
      },
      hr() {
        return <hr className="my-3" style={{ borderColor: 'var(--border)' }} />
      },
      p({ children }: any) {
        return <p className="my-1.5 leading-relaxed">{children}</p>
      },
    }),
    [isUser]
  )

  return (
    <div className="prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 rounded-sm" />}
    </div>
  )
}
