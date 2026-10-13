import { createContext, useContext } from 'react'

type GroupInfoPanel = {
    open: boolean
    setOpen: (open: boolean) => void
}

/** The groups layout owns the header; the detail page owns the "group info" panel it opens. */
export const GroupInfoPanelContext = createContext<GroupInfoPanel>({
    open: false,
    setOpen: () => {}
})

export function useGroupInfoPanel(): GroupInfoPanel {
    return useContext(GroupInfoPanelContext)
}
