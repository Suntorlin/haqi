import { useState, useRef, useEffect } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { IconButton } from '@/components/ui/IconButton'
import { CheckIcon } from '@/components/mobile/icons'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { cn } from '@/lib/utils'

const locales: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
]

function LanguageIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  )
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale)
    setIsOpen(false)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        size="sm"
        label={t('language.title')}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <LanguageIcon />
      </IconButton>

      {isOpen && (
        <div
          className={cn('animate-menu-pop absolute right-0 top-full z-50 mt-1 flex min-w-[208px] flex-col', CONTEXT_MENU_SURFACE)}
          style={{ transformOrigin: 'top right' }}
          role="menu"
          aria-label={t('language.title')}
        >
          {locales.map((loc) => {
            const isSelected = locale === loc.value
            return (
              <ContextMenuItem
                key={loc.value}
                label={loc.label}
                checked={isSelected}
                onSelect={() => handleLocaleChange(loc.value)}
                trailing={(
                  <CheckIcon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-[var(--social-fg)]' : 'text-transparent')} />
                )}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
