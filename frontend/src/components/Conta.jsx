import React, { useEffect, useRef, useState } from 'react'
import { carregar, salvar } from '../lib/broker.js'
import { entrar, sair, sincronizar, supabase } from '../lib/nuvem.js'

// Botão de conta no topo: login por link mágico e sincronização automática das carteiras.
export default function Conta() {
  const [sessao, setSessao] = useState(null)
  const [aberto, setAberto] = useState(false)
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState(null) // 'enviando' | 'enviado' | 'sincronizando' | 'ok' | {erro}
  const [quando, setQuando] = useState(null)
  const caixa = useRef(null)
  const timer = useRef(null)

  const sincronizarAgora = async () => {
    if (!supabase) return
    setEstado('sincronizando')
    try {
      const novo = await sincronizar(carregar())
      salvar(novo, { tocar: false })
      window.dispatchEvent(new Event('carteiras-sincronizadas'))
      setQuando(new Date()); setEstado('ok')
    } catch (e) { setEstado({ erro: e.message }) }
  }

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setSessao(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // logado: sincroniza ao entrar, 2 s depois de cada mudança local, ao voltar para a aba e a cada 2 min
  useEffect(() => {
    if (!sessao) return
    sincronizarAgora()
    const mudou = () => { clearTimeout(timer.current); timer.current = setTimeout(sincronizarAgora, 2000) }
    const voltou = () => document.visibilityState === 'visible' && sincronizarAgora()
    window.addEventListener('carteiras-alteradas', mudou)
    document.addEventListener('visibilitychange', voltou)
    const id = setInterval(sincronizarAgora, 120000)
    return () => { window.removeEventListener('carteiras-alteradas', mudou); document.removeEventListener('visibilitychange', voltou); clearInterval(id); clearTimeout(timer.current) }
  }, [sessao?.user?.id])

  useEffect(() => {
    const fora = (e) => caixa.current && !caixa.current.contains(e.target) && setAberto(false)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  if (!supabase) return null
  const enviar = async (e) => {
    e.preventDefault()
    setEstado('enviando')
    try { await entrar(email.trim()); setEstado('enviado') } catch (err) { setEstado({ erro: err.message }) }
  }
  const usuario = sessao?.user?.email
  return (
    <div className="conta" ref={caixa}>
      <button className="icon-btn" onClick={() => setAberto((a) => !a)} aria-label={usuario ? `Conta ${usuario}` : 'Entrar'}
        title={usuario ? `${usuario} · carteiras sincronizadas` : 'Entrar para sincronizar as carteiras'}>
        {usuario ? usuario[0].toUpperCase() : '👤'}
      </button>
      {aberto && (
        <div className="card conta-menu">
          {usuario ? (
            <>
              <div style={{ fontSize: 13 }}>Conectado como <b>{usuario}</b></div>
              <div className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>
                {estado === 'sincronizando' ? 'Sincronizando…' : estado?.erro ? `Erro: ${estado.erro}` : quando ? `Carteiras sincronizadas às ${quando.toLocaleTimeString('pt-BR')}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={sincronizarAgora}>Sincronizar agora</button>
                <button className="btn" onClick={() => { sair(); setAberto(false) }}>Sair</button>
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>Ao sair, as carteiras continuam neste navegador.</p>
            </>
          ) : estado === 'enviado' ? (
            <div style={{ fontSize: 13 }}>Enviamos um link de acesso para <b>{email}</b>. Abra-o neste aparelho para entrar.</div>
          ) : (
            <form onSubmit={enviar}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>Entre com seu e-mail para ter as carteiras em qualquer aparelho. Sem senha: mandamos um link.</div>
              <input type="email" required placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} autoFocus />
              <button className="btn primary" style={{ marginTop: 8, width: '100%' }} disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Enviar link de acesso'}</button>
              {estado?.erro && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Erro: {estado.erro}</div>}
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>As carteiras deste navegador sobem para a sua conta no primeiro login.</p>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
