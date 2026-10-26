import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Carteira from './components/Carteira.jsx'
import Detail from './components/Detail.jsx'
import Docs from './components/Docs.jsx'
import Live from './components/live/Live.jsx'
import Overview from './components/Overview.jsx'
import Screener from './components/Screener.jsx'

const TABS = [['geral', 'Visão geral'], ['acoes', 'Ações'], ['fiis', 'FIIs'], ['etfs', 'ETFs'], ['carteira', 'Carteira'], ['live', 'Tempo real'], ['docs', 'API & MCP']]
const TEXTO = new Set(['codigo', 'ticker', 'razao_social', 'nome_pregao', 'nome_yahoo', 'status'])

const tabDaUrl = () => {
  const h = window.location.hash.slice(1)
  return TABS.some(([k]) => k === h) ? h : 'geral'
}

export default function App() {
  const [tab, setTab] = useState(tabDaUrl)
  const [aberto, setAberto] = useState(null)
  const [extras, setExtras] = useState({})
  const [tema, setTema] = useState(() => { try { return localStorage.getItem('tema') } catch { return null } })

  useEffect(() => {
    const on = () => setTab(tabDaUrl())
    window.addEventListener('hashchange', on)
    api.metricas().then((m) => setExtras({
      fiis: m.fundos.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
      acoes: m.acoes.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
      etfs: m.etfs.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
    })).catch(() => {})
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (tema) document.documentElement.dataset.theme = tema
    else delete document.documentElement.dataset.theme
    try { tema ? localStorage.setItem('tema', tema) : localStorage.removeItem('tema') } catch {}
  }, [tema])

  const ir = (k) => { window.location.hash = k; setTab(k) }
  const abrir = useCallback((tipo, codigo) => setAberto({ tipo, codigo }), [])
  const fechar = useCallback(() => setAberto(null), [])
  const escuro = tema ? tema === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="dot" />B3 Fundos<span className="full muted" style={{ fontWeight: 400 }}>· Ações, ETFs & FIIs</span></div>
        <nav className="tabs">
          {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => ir(k)}>{l}</button>)}
        </nav>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setTema(escuro ? 'light' : 'dark')} aria-label="Alternar tema">{escuro ? '☀' : '☾'}</button>
      </header>
      <main>
        {tab === 'geral' && <Overview onOpen={abrir} />}
        {['acoes', 'fiis', 'etfs'].includes(tab) && <Screener tipo={tab} onOpen={abrir} extraCols={extras[tab]} />}
        {tab === 'carteira' && <Carteira />}
        {tab === 'live' && <Live />}
        {tab === 'docs' && <Docs />}
      </main>
      {aberto && <Detail {...aberto} onClose={fechar} />}
    </>
  )
}
