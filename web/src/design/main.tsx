import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { I18nProvider } from '@/lib/i18n-context'
import { DesignShowcase } from './DesignShowcase'

document.documentElement.classList.add('social-app')

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <I18nProvider>
            <DesignShowcase />
        </I18nProvider>
    </React.StrictMode>
)
