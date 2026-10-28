import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Carteira from './components/Carteira.jsx'
import Detail from './components/Detail.jsx'
import Docs from './components/Docs.jsx'
import HomeBroker from './components/HomeBroker.jsx'
import MonteCarlo from './components/MonteCarlo.jsx'
import Live from './components/live/Live.jsx'
import Overview from './components/Overview.jsx'
import Screener from './components/Screener.jsx'

const TABS = [['geral', 'Visão geral'], ['acoes', 'Ações'], ['fiis', 'FIIs'], ['etfs', 'ETFs'], ['criptos', 'Cripto'],
  ['carteira', 'Carteira'], ['montecarlo', 'Monte Carlo'], ['broker', 'Home Broker'], ['live', 'Tempo real'], ['docs', 'API & MCP']]
const TEXTO = new Set(['codigo', 'ticker', 'razao_social', 'nome_pregao', 'nome_yahoo', 'status'])

// logomarca: anéis concêntricos em heartwood; no app segue os tokens do tema
function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="12" fill="none" stroke="var(--heartwood-glow)" strokeWidth="6" />
      <circle cx="50" cy="50" r="26" fill="none" stroke="var(--heartwood)" strokeWidth="5" opacity="0.75" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--heartwood)" strokeWidth="4" opacity="0.4" />
    </svg>
  )
}

const tabDaUrl = () => {
  const h = window.location.hash.slice(1)
  return TABS.some(([k]) => k === h) ? h : 'geral'
}

export default function App() {
  const [tab, setTab] = useState(tabDaUrl)
  const [aberto, setAberto] = useState(null)
  const [extras, setExtras] = useState({})
  const [mcPreset, setMcPreset] = useState(null) // carteira levada da aba Carteira/Home Broker para o Monte Carlo
  // dark ("heartwood core") é o padrão da marca; light ("sapwood") é opcional
  const [tema, setTema] = useState(() => { try { return localStorage.getItem('tema') || 'dark' } catch { return 'dark' } })

  useEffect(() => {
    const on = () => setTab(tabDaUrl())
    window.addEventListener('hashchange', on)
    api.metricas().then((m) => setExtras({
      fiis: m.fundos.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
      acoes: m.acoes.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
      etfs: m.etfs.map((c) => c.coluna).filter((c) => !TEXTO.has(c)),
      criptos: (m.criptos || []).map((c) => c.coluna).filter((c) => !TEXTO.has(c) && !/provento|dividend|rend|alerta|cotas/.test(c)),
    })).catch(() => {})
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = tema
    try { localStorage.setItem('tema', tema) } catch {}
  }, [tema])

  const ir = (k) => { window.location.hash = k; setTab(k); window.scrollTo(0, 0) }
  const simular = useCallback((preset) => { setMcPreset({ ...preset, t: Date.now() }); ir('montecarlo') }, [])
  const abrir = useCallback((tipo, codigo) => setAberto({ tipo, codigo }), [])
  const fechar = useCallback(() => setAberto(null), [])
  const escuro = tema === 'dark'

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#geral" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo />B3<span className="full muted" style={{ fontWeight: 500 }}>· cerne.pro</span>
        </a>
        <nav className="tabs">
          {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => ir(k)}>{l}</button>)}
        </nav>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setTema(escuro ? 'light' : 'dark')} aria-label="Alternar tema">{escuro ? '☀' : '☾'}</button>
      </header>
      <main>
        {tab === 'geral' && <Overview onOpen={abrir} />}
        {['acoes', 'fiis', 'etfs', 'criptos'].includes(tab) && <Screener tipo={tab} onOpen={abrir} extraCols={extras[tab]} />}
        {tab === 'carteira' && <Carteira onSimular={simular} onBroker={() => ir('broker')} />}
        {tab === 'montecarlo' && <MonteCarlo preset={mcPreset} />}
        {tab === 'broker' && <HomeBroker onOpen={abrir} onSimular={simular} />}
        {tab === 'live' && <Live />}
        {tab === 'docs' && <Docs />}
      </main>
      {aberto && <Detail {...aberto} onClose={fechar} />}
    </>
  )
}
