import { ClearIcon, SearchIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { useTranslation } from '@/lib/use-translation'

/** Rounded grey search field used at the top of lists and pickers. */
export function MobileSearchField(props: { value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean }) {
    const { t } = useTranslation()
    return (
        <TextField
            variant="pill"
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            placeholder={props.placeholder}
            autoFocus={props.autoFocus}
            className="[&::-webkit-search-cancel-button]:hidden"
            type="search"
            enterKeyHint="search"
            leading={<SearchIcon className="h-[17px] w-[17px]" />}
            trailing={props.value ? (
                <IconButton size="sm" label={t('search.clear')} onClick={() => props.onChange('')}>
                    <ClearIcon className="h-4 w-4" />
                </IconButton>
            ) : null}
        />
    )
}
