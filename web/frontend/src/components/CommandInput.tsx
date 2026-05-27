import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { X, Loader2, Zap } from 'lucide-react'
import clsx from 'clsx'
import { SkillSuggestionList, type SkillItem } from './SkillSuggestionList'

/** A skill that has been selected and whose content has been loaded */
export interface ActiveSkill {
  id: string
  name: string
  emoji: string
  content: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  /** Called when active skills change (for parent to inject content on send) */
  onActiveSkillsChange?: (skills: ActiveSkill[]) => void
}

export interface CommandInputHandle {
  focus: () => void
  resetHeight: () => void
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export const CommandInput = forwardRef<CommandInputHandle, Props>(function CommandInput({
  value, onChange, onKeyDown, onFocus, onBlur,
  placeholder, disabled, className, style, onActiveSkillsChange,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  // -- Suggestion list state --
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allSkills, setAllSkills] = useState<SkillItem[]>([])
  const [filterText, setFilterText] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [cursorPos, setCursorPos] = useState(0)

  // -- Active skills (selected, with content loaded) --
  const [activeSkills, setActiveSkills] = useState<ActiveSkill[]>([])
  const [loadingSkill, setLoadingSkill] = useState<string | null>(null)

  const debouncedFilter = useDebounce(filterText, 200)

  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    resetHeight: () => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    },
  }))

  // Notify parent when active skills change
  useEffect(() => {
    onActiveSkillsChange?.(activeSkills)
  }, [activeSkills, onActiveSkillsChange])

  // Load skills from both sources on mount
  useEffect(() => {
    const loadAll = async () => {
      try {
        const [localRes, mpRes] = await Promise.all([
          fetch('/api/skills').then(r => r.json()).catch(() => ({ skills: [] })),
          fetch('/api/skills/marketplace?limit=50&sortBy=stars').then(r => r.json()).catch(() => ({ skills: [] })),
        ])

        const local: SkillItem[] = (localRes.skills || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          category: s.category,
          type: s.type,
          emoji: s.emoji,
          source: 'local' as const,
        }))

        const mp: SkillItem[] = (mpRes.skills || []).map((s: any) => ({
          id: `mp:${s.id}`,
          name: s.name,
          description: s.description || '',
          source: 'marketplace' as const,
        }))

        setAllSkills([...local, ...mp])
      } catch (e) {
        console.error('Failed to load skills for suggestions:', e)
      }
    }
    loadAll()
  }, [])

  // Filtered skills (debounced)
  const filteredSkills = useMemo(() => {
    if (!debouncedFilter) return allSkills.slice(0, 30)
    const q = debouncedFilter.toLowerCase()
    return allSkills
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 30)
  }, [allSkills, debouncedFilter])

  useEffect(() => { setHighlightIndex(0) }, [debouncedFilter])

  // Detect `/` trigger
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursor = e.target.selectionStart ?? newValue.length
    onChange(newValue)

    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'

    if (composingRef.current) return

    const textBeforeCursor = newValue.slice(0, cursor)
    const lastSlash = textBeforeCursor.lastIndexOf('/')

    if (lastSlash >= 0) {
      const charBeforeSlash = lastSlash > 0 ? textBeforeCursor[lastSlash - 1] : ' '
      if (lastSlash === 0 || /\s/.test(charBeforeSlash)) {
        const filterPart = textBeforeCursor.slice(lastSlash + 1)
        if (!filterPart.includes(' ') && !filterPart.includes('\n')) {
          setShowSuggestions(true)
          setFilterText(filterPart)
          setCursorPos(lastSlash)
          return
        }
      }
    }

    setShowSuggestions(false)
    setFilterText('')
  }, [onChange])

  // Select a skill: fetch its content and add to active skills
  const selectSkill = useCallback(async (skill: SkillItem) => {
    // Remove the `/filter` text from input
    const textarea = textareaRef.current
    if (textarea) {
      const after = value.slice(textarea.selectionStart ?? value.length)
      const before = value.slice(0, cursorPos)
      onChange(before + after)
    }

    setShowSuggestions(false)
    setFilterText('')

    // Don't add duplicate
    if (activeSkills.some(s => s.id === skill.id)) {
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }

    // Fetch content
    setLoadingSkill(skill.id)
    try {
      const res = await fetch(`/api/skills/content?id=${encodeURIComponent(skill.id)}`)
      const data = await res.json()
      if (data.success && data.content) {
        const newSkill: ActiveSkill = {
          id: skill.id,
          name: skill.name,
          emoji: skill.emoji || '🧊',
          content: data.content,
        }
        setActiveSkills(prev => [...prev, newSkill])
      }
    } catch (e) {
      console.error('Failed to fetch skill content:', e)
    } finally {
      setLoadingSkill(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [value, cursorPos, onChange, activeSkills])

  // Remove an active skill
  const removeSkill = useCallback((skillId: string) => {
    setActiveSkills(prev => prev.filter(s => s.id !== skillId))
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return

    if (showSuggestions && filteredSkills.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightIndex(i => Math.min(i + 1, filteredSkills.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          setHighlightIndex(i => Math.max(i - 1, 0))
          return
        case 'Enter':
          if (!e.shiftKey) {
            e.preventDefault()
            selectSkill(filteredSkills[highlightIndex])
            return
          }
          break
        case 'Tab':
          e.preventDefault()
          selectSkill(filteredSkills[highlightIndex])
          return
        case 'Escape':
          e.preventDefault()
          setShowSuggestions(false)
          return
      }
    }

    onKeyDown?.(e)
  }, [showSuggestions, filteredSkills, highlightIndex, selectSkill, onKeyDown])

  // IME composition handlers
  const handleCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    handleChange({
      target: e.currentTarget,
      currentTarget: e.currentTarget,
    } as React.ChangeEvent<HTMLTextAreaElement>)
  }, [handleChange])

  return (
    <div className={clsx('relative flex-1', className)}>
      {/* Suggestion list */}
      <SkillSuggestionList
        skills={filteredSkills}
        filterText={debouncedFilter}
        highlightIndex={highlightIndex}
        onSelect={selectSkill}
        visible={showSuggestions}
      />

      {/* Active skills tags */}
      {(activeSkills.length > 0 || loadingSkill) && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
          {activeSkills.map(skill => (
            <span key={skill.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: 'var(--accent-bg)',
                color: 'var(--accent-from)',
                border: '1px solid var(--accent-border)',
              }}>
              <span>{skill.emoji}</span>
              <span>{skill.name}</span>
              <button
                onClick={() => removeSkill(skill.id)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {loadingSkill && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs"
              style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={12} className="animate-spin" />
              <span>加载中...</span>
            </span>
          )}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder || '输入消息... 输入 / 唤起技能列表 (Enter 发送, Shift+Enter 换行)'}
        rows={1}
        disabled={disabled}
        className="resize-none bg-transparent px-4 py-3.5 text-sm focus:outline-none min-h-[48px] w-full"
        style={{ color: 'var(--text-primary)', ...style }}
      />
    </div>
  )
})
