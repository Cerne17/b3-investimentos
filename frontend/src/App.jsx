import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Carteira from './components/Carteira.jsx'
import ComparadorFIIs from './components/ComparadorFIIs.jsx'
import Conta from './components/Conta.jsx'
import Detail from './components/Detail.jsx'
import Guia, { CHAVE_GUIA } from './components/Guia.jsx'
import Docs from './components/Docs.jsx'
import HomeBroker from './components/HomeBroker.jsx'
import MonteCarlo from './components/MonteCarlo.jsx'
import Live from './components/live/Live.jsx'
import Overview from './components/Overview.jsx'
import Screener from './components/Screener.jsx'

// navegação em dois níveis: seções no topo e, nos grupos, as abas da seção logo abaixo
const NAV = [
  { k: 'geral', l: 'Visão geral' },
  { k: 'mercado', l: 'Mercado', itens: [['acoes', 'Ações'], ['fiis', 'FIIs'], ['etfs', 'ETFs'], ['criptos', 'Cripto'], ['comparafiis', 'Comparar FIIs']] },
  { k: 'investir', l: 'Investir', itens: [['carteira', 'Markowitz'], ['montecarlo', 'Monte Carlo'], ['broker', 'Home Broker']] },
  { k: 'live', l: 'Tempo real' },
  { k: 'docs', l: 'API & MCP' },
]
const TABS = NAV.flatMap((g) => g.itens || [[g.k, g.l]])
const grupoDe = (tab) => NAV.find((g) => (g.itens ? g.itens.some(([k]) => k === tab) : g.k === tab))
const rotulo = (tab) => TABS.find(([k]) => k === tab)?.[1]
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
  const h = window.location.hash.slice(1).split('?')[0] // "#broker?c=..." = link de carteira compartilhada
  return TABS.some(([k]) => k === h) ? h : 'geral'
}

export default function App() {
  const [tab, setTab] = useState(tabDaUrl)
  const [aberto, setAberto] = useState(null)
  const [extras, setExtras] = useState({})
  const [menu, setMenu] = useState(false)
  // última aba visitada em cada grupo: clicar em "Mercado" volta para onde o usuário estava
  const [ultima, setUltima] = useState({})
  const [mcPreset, setMcPreset] = useState(null) // carteira levada do Markowitz/Home Broker para o Monte Carlo
  // dark ("heartwood core") é o padrão da marca; light ("sapwood") é opcional
  // primeiro acesso: guia de primeiros passos (não abre em links compartilhados de carteira)
  const [guia, setGuia] = useState(() => { try { return !localStorage.getItem(CHAVE_GUIA) && !window.location.hash.includes('?c=') } catch { return false } })
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

  const ir = (k) => { window.location.hash = k; setTab(k); setMenu(false); window.scrollTo(0, 0) }
  const grupo = grupoDe(tab)
  useEffect(() => { if (grupo?.itens) setUltima((u) => ({ ...u, [grupo.k]: tab })) }, [tab])
  useEffect(() => {
    if (!menu) return
    const esc = (e) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [menu])
  const abrirGrupo = (g) => ir(g.itens ? ultima[g.k] || g.itens[0][0] : g.k)
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
        <nav className="tabs" aria-label="Seções">
          {NAV.map((g) => (
            <button key={g.k} className={`tab ${grupo?.k === g.k ? 'active' : ''}`} aria-current={grupo?.k === g.k ? 'page' : undefined}
              onClick={() => abrirGrupo(g)}>
              {g.l}{g.itens && <span className="tab-count" aria-hidden="true">{g.itens.length}</span>}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button className="menu-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-controls="menu-mobile">
          <span className="menu-atual">{grupo?.itens ? `${grupo.l} · ` : ''}<b>{rotulo(tab)}</b></span>
          <span className="menu-icone" aria-hidden="true">{menu ? '✕' : '☰'}</span>
          <span className="sr-only">Menu</span>
        </button>
        <Conta />
        <button className="icon-btn" onClick={() => setGuia(true)} aria-label="Guia de primeiros passos" title="Guia de primeiros passos">?</button>
        <button className="icon-btn" onClick={() => setTema(escuro ? 'light' : 'dark')} aria-label="Alternar tema">{escuro ? '☀' : '☾'}</button>
      </header>
      {menu && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(false)} />
          <nav id="menu-mobile" className="menu-mobile" aria-label="Todas as seções">
            {NAV.map((g) => (
              <div key={g.k} className="menu-grupo">
                {g.itens ? (
                  <>
                    <div className="eyebrow">{g.l}</div>
                    <div className="menu-itens">
                      {g.itens.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => ir(k)}>{l}</button>)}
                    </div>
                  </>
                ) : (
                  <button className={`tab menu-solo ${tab === g.k ? 'active' : ''}`} onClick={() => ir(g.k)}>{g.l}</button>
                )}
              </div>
            ))}
          </nav>
        </>
      )}
      {grupo?.itens && (
        <nav className="subnav" aria-label={grupo.l} style={{ '--n': grupo.itens.length }}>
          {grupo.itens.map(([k, l]) => (
            <button key={k} className={`subtab ${tab === k ? 'active' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => ir(k)}>{l}</button>
          ))}
        </nav>
      )}
      <main>
        {guia && <Guia onIr={ir} onFechar={() => setGuia(false)} />}
        {tab === 'geral' && <Overview onOpen={abrir} />}
        {['acoes', 'fiis', 'etfs', 'criptos'].includes(tab) && <Screener tipo={tab} onOpen={abrir} extraCols={extras[tab]} />}
        {tab === 'comparafiis' && <ComparadorFIIs onOpen={abrir} />}
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
