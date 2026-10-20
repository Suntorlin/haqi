import type { Config } from 'tailwindcss'

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            maxWidth: {
                content: '720px'
            },
            // The type scale in rem, so every size follows the font-size setting (html font-size). See DESIGN.md 2.4.
            fontSize: {
                caption: '0.75rem',
                footnote: '0.8125rem',
                body: '0.9375rem',
                headline: '1rem',
                title: '1.25rem',
                display: '2rem'
            }
        }
    },
    plugins: []
} satisfies Config

