import { useEffect, useState } from 'react'

/** Current time in epoch ms, refreshed once a minute: enough for wake-up times shown in lists. */
export function useMinuteClock(): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000)
        return () => window.clearInterval(timer)
    }, [])
    return now
}
