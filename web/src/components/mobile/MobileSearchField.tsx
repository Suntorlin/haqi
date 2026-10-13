import { ClearIcon, SearchIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

/** Rounded grey search field used at the top of lists and pickers. */
export function MobileSearchField(props: { value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean }) {
    const { t } = useTranslation()
    return (
        <label className="flex h-10 items-center gap-2.5 rounded-xl bg-[var(--social-muted)] px-3.5 text-[var(--social-fg-subtle)]">
            <SearchIcon className="h-[17px] w-[17px] shrink-0" />
            <input
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={props.placeholder}
                autoFocus={props.autoFocus}
                className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--social-fg)] outline-none placeholder:text-[var(--social-fg-subtle)] [&::-webkit-search-cancel-button]:hidden"
                type="search"
                enterKeyHint="search"
            />
            {props.value ? (
                <button type="button" onClick={() => props.onChange('')} className="shrink-0 opacity-70" aria-label={t('search.clear')}>
                    <ClearIcon className="h-4 w-4" />
                </button>
            ) : null}
        </label>
    )
}
