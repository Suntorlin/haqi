import { createContext, useContext } from 'react'

/** Set by the chat of a session: opens an http(s) link in that session's built-in preview. */
export type OpenInPreview = (url: string) => Promise<boolean>

export const PreviewLinkContext = createContext<OpenInPreview | null>(null)

export function useOpenInPreview(): OpenInPreview | null {
    return useContext(PreviewLinkContext)
}
