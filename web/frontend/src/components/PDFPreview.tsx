import { useState, useRef, useEffect } from 'react'
import { Copy, Check, ExternalLink, Download, FileText, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

// 设置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

interface PDFPreviewProps {
  code: string // Base64 编码的 PDF 内容
  fileName?: string
}

export function PDFPreview({ code, fileName }: PDFPreviewProps) {
  const [copied, setCopied] = useState(false)
  const [numPages, setNumPages] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [scale, setScale] = useState<number>(1.0)
  const [rotation, setRotation] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdfDoc, setPdfDoc] = useState<any>(null)

  // 加载 PDF 文档
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setLoading(true)
        setError('')
        
        // 将 base64 转换为 Uint8Array
        const binaryString = atob(code)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        
        // 加载 PDF 文档
        const loadingTask = pdfjsLib.getDocument({ data: bytes })
        const pdf = await loadingTask.promise
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
        setCurrentPage(1)
        setLoading(false)
      } catch (err) {
        console.error('PDF 加载错误:', err)
        setError('PDF 文件加载失败')
        setLoading(false)
      }
    }
    
    if (code) {
      loadPDF()
    }
  }, [code])

  // 渲染当前页面
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return
      
      try {
        const page = await pdfDoc.getPage(currentPage)
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        
        // 计算缩放和旋转
        const viewport = page.getViewport({ scale, rotation })
        
        // 设置 canvas 尺寸
        canvas.height = viewport.height
        canvas.width = viewport.width
        
        // 渲染页面
        const renderContext = {
          canvasContext: context!,
          viewport: viewport
        }
        
        await page.render(renderContext).promise
      } catch (err) {
        console.error('PDF 渲染错误:', err)
        setError('PDF 页面渲染失败')
      }
    }
    
    renderPage()
  }, [pdfDoc, currentPage, scale, rotation])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    // 从 base64 创建下载链接
    const binaryString = atob(code)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'document.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleOpenInNewTab = () => {
    // 从 base64 创建新窗口
    const binaryString = atob(code)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // 延迟释放 URL
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.2, 3.0))
  }

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.2, 0.5))
  }

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360)
  }

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1))
  }

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, numPages))
  }

  return (
    <div className="relative group my-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-red-400" />
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            PDF 预览
          </span>
          {fileName && (
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
              {fileName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* 页面导航 */}
          {numPages > 0 && (
            <div className="flex items-center gap-1 mr-2">
              <button onClick={handlePrevPage} disabled={currentPage <= 1}
                className="p-1 rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                style={{ color: 'var(--text-secondary)' }}>
                &lt;
              </button>
              <span className="text-[11px] px-1" style={{ color: 'var(--text-secondary)' }}>
                {currentPage} / {numPages}
              </span>
              <button onClick={handleNextPage} disabled={currentPage >= numPages}
                className="p-1 rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                style={{ color: 'var(--text-secondary)' }}>
                &gt;
              </button>
            </div>
          )}
          
          {/* 缩放控制 */}
          <button onClick={handleZoomOut}
            className="p-1 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            title="缩小">
            <ZoomOut size={14} />
          </button>
          <span className="text-[11px] px-1" style={{ color: 'var(--text-secondary)' }}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={handleZoomIn}
            className="p-1 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            title="放大">
            <ZoomIn size={14} />
          </button>
          
          {/* 旋转 */}
          <button onClick={handleRotate}
            className="p-1 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            title="旋转">
            <RotateCw size={14} />
          </button>
          
          {/* 其他操作 */}
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

      {/* PDF 内容 */}
      <div ref={containerRef} className="flex items-center justify-center p-4" style={{ minHeight: '400px', maxHeight: '600px', overflow: 'auto' }}>
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>PDF 加载中...</div>
          </div>
        )}
        
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <FileText size={32} className="text-red-400" />
            <div className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}
            >
              <Download size={16} />
              下载 PDF 文件
            </button>
          </div>
        )}
        
        {!loading && !error && (
          <canvas ref={canvasRef} className="shadow-lg" style={{ maxWidth: '100%', maxHeight: '100%' }} />
        )}
      </div>
    </div>
  )
}