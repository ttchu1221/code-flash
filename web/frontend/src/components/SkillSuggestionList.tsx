import { useEffect, useRef } from 'react'
import { Package, Globe, Puzzle } from 'lucide-react'
import clsx from 'clsx'

export interface SkillItem {
  id: string
  name: string
  description: string
  category?: string
  type?: 'plugin' | 'markdown' | 'unknown'
  emoji?: string
  source?: 'local' | 'marketplace'
}

interface Props {
  skills: SkillItem[]
  filterText: string
  highlightIndex: number
  onSelect: (skill: SkillItem) => void
  visible: boolean
}

export function SkillSuggestionList({ skills, filterText, highlightIndex, onSelect, visible }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Filter skills by name / description / category
  const filtered = filterText
    ? skills.filter(s => {
        const q = filterText.toLowerCase()
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.category?.toLowerCase().includes(q) ?? false)
        )
      })
    : skills

  // Auto-scroll highlighted item into view
  useEffect(() => {
    const el = itemRefs.current[highlightIndex]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  if (!visible || filtered.length === 0) return null

  // Group by source
  const localSkills = filtered.filter(s => s.source !== 'marketplace')
  const marketplaceSkills = filtered.filter(s => s.source === 'marketplace')

  const renderGroup = (label: string, icon: React.ReactNode, items: SkillItem[], startIndex: number) => {
    if (items.length === 0) return null
    return (
      <div key={label}>
        {/* Group header */}
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: 'var(--bg-hover)' }}>
          {icon}
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {label}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {items.length}
          </span>
        </div>
        {items.map((skill, i) => {
          const idx = startIndex + i
          const isHighlight = idx === highlightIndex
          return (
            <div
              key={skill.id}
              ref={el => { itemRefs.current[idx] = el }}
              onMouseDown={e => { e.preventDefault(); onSelect(skill) }}
              onMouseEnter={() => {}}
              className={clsx('flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors')}
              style={{
                background: isHighlight ? 'var(--bg-active)' : 'transparent',
                borderLeft: isHighlight ? '2px solid var(--accent-from)' : '2px solid transparent',
              }}
            >
              {/* Icon */}
              <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm mt-0.5"
                style={{ background: 'var(--bg-hover)' }}>
                {skill.emoji || (skill.source === 'marketplace' ? <Globe size={14} style={{ color: 'var(--text-muted)' }} /> : '🧊')}
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {skill.name}
                  </span>
                  {skill.category && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-md"
                      style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {skill.category}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                    {skill.description.length > 80 ? skill.description.slice(0, 80) + '...' : skill.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl shadow-2xl z-50"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {renderGroup(
        '本地技能',
        <Package size={12} style={{ color: 'var(--text-muted)' }} />,
        localSkills,
        0,
      )}
      {renderGroup(
        '在线市场',
        <Globe size={12} style={{ color: 'var(--text-muted)' }} />,
        marketplaceSkills,
        localSkills.length,
      )}
    </div>
  )
}
