import React from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import { ativarCartoes } from './lib/cartoes.js'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics />
  </>
)

ativarCartoes()

// PWA: instalável e com a interface disponível offline (só em produção, para não atrapalhar o hot reload)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
