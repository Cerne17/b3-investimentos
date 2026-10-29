import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../format.js'
import { ehRendaFixa } from '../lib/ativos.js'
import { novaOperacao } from '../lib/broker.js'
import BuscaAtivo from './BuscaAtivo.jsx'

const hoje = () => new Date().toISOString().slice(0, 10)
const qtdFmt = (q) => (Number.isInteger(q) ? fmt.int(q) : fmt.num(q, q < 1 ? 6 : 4))

// Formulário de compra/venda com data e a lista de operações da carteira; importa o extrato da B3 numa carteira nova.
export default function Operacoes({ transacoes, setTransacoes, onImportarB3 }) {
  const [novo, setNovo] = useState({ tipo: 'compra', data: hoje(), ticker: '', quantidade: '', preco: '', valor: '' })
  const [sugerido, setSugerido] = useState(null) // preço de fechamento na data, para preencher
  const [aberto, setAberto] = useState(false)
  const [importando, setImportando] = useState(null)
  const arquivo = useRef(null)
  const rf = ehRendaFixa(novo.ticker)

  // preço de fechamento na data (como negociado): preenche o campo e, na renda fixa, converte valor em cotas
  useEffect(() => {
    setSugerido(null)
    if (!novo.ticker || !novo.data) return
    let vivo = true
    api.precoEm(novo.ticker, novo.data).then((r) => vivo && setSugerido(r)).catch(() => vivo && setSugerido({ erro: true }))
    return () => { vivo = false }
  }, [novo.ticker, novo.data])

  const preco = rf ? sugerido?.preco : Number(novo.preco) || sugerido?.preco
  const quantidade = rf ? (sugerido?.preco ? Number(novo.valor) / sugerido.preco : 0) : Number(novo.quantidade)
  const valido = novo.ticker && novo.data && quantidade > 0 && preco > 0

  const registrar = (e) => {
    e.preventDefault()
    if (!valido) return
    setTransacoes((ts) => [...ts, novaOperacao({ tipo: novo.tipo, data: novo.data, ticker: novo.ticker, quantidade, preco })])
    setNovo((n) => ({ ...n, ticker: '', quantidade: '', preco: '', valor: '' }))
    setAberto(true)
  }

  const lerB3 = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setImportando({ carregando: true })
    const leitor = new FileReader()
    leitor.onload = () => {
      const b64 = String(leitor.result).split(',')[1]
      api.importarB3({ arquivo_base64: b64, nome: f.name })
        .then((r) => setImportando({ ...r, nome: f.name }))
        .catch((err) => setImportando({ erro: err.message }))
    }
    leitor.readAsDataURL(f)
  }

  const ordenadas = useMemo(() => [...transacoes].sort((a, b) => b.data.localeCompare(a.data)), [transacoes])
  const iniciais = transacoes.length > 0 && transacoes.every((t) => t.inicial)

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Operações</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => arquivo.current?.click()} title="Extrato de Negociação ou de Movimentação da Área do Investidor (investidor.b3.com.br), em Excel ou CSV">
            Importar extrato da B3
          </button>
          <input ref={arquivo} type="file" accept=".xlsx,.xls,.csv" hidden onChange={lerB3} />
          <button className="btn" onClick={() => setAberto((a) => !a)}>{aberto ? 'Ocultar' : 'Ver'} {transacoes.length} operaç{transacoes.length === 1 ? 'ão' : 'ões'}</button>
        </div>
      </div>

      {importando && (
        <div className="alert section" style={{ marginTop: 10 }}>
          {importando.carregando ? 'Lendo o extrato…' : importando.erro ? importando.erro : (
            <>
              <b>{importando.transacoes.length} operações</b> em {importando.nome}
              {Object.keys(importando.ignoradas).length > 0 && <> · ignoradas: {Object.entries(importando.ignoradas).map(([k, v]) => `${k} (${v})`).join(', ')}</>}
              {importando.avisos.map((a) => <div key={a} className="muted" style={{ fontSize: 13 }}>{a}</div>)}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn primary" disabled={!importando.transacoes.length}
                  onClick={() => { onImportarB3(importando.transacoes, importando.nome); setImportando(null) }}>Criar carteira com essas operações</button>
                <button className="btn" onClick={() => setImportando(null)}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {iniciais && (
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
          As posições desta carteira foram criadas sem data de compra (contam como compradas em {fmt.date(transacoes[0].data)}).
          Lance as operações com as datas reais — ou importe o extrato da B3 — para ver o desempenho de verdade.
        </p>
      )}

      <form className="filters" onSubmit={registrar} style={{ margin: '12px 0 4px' }}>
        <label className="field">Operação
          <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
            <option value="compra">Compra</option><option value="venda">Venda</option>
          </select>
        </label>
        <label className="field">Data<input type="date" value={novo.data} max={hoje()} onChange={(e) => setNovo({ ...novo, data: e.target.value })} /></label>
        <BuscaAtivo onAdd={(t) => setNovo({ ...novo, ticker: t, preco: '' })} label="Ativo" width={200} />
        {novo.ticker && <div className="field">Selecionado<span className="sel-chip" style={{ marginTop: 4 }}>{novo.ticker}</span></div>}
        {rf ? (
          <label className="field">Valor aplicado (R$)<input type="number" step="any" min="0" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></label>
        ) : (
          <>
            <label className="field">Quantidade<input type="number" step="any" min="0" value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} /></label>
            <label className="field">Preço (R$)<input type="number" step="any" min="0" value={novo.preco}
              placeholder={sugerido?.preco ? fmt.num(sugerido.preco, 2) : ''} onChange={(e) => setNovo({ ...novo, preco: e.target.value })} /></label>
          </>
        )}
        <button className="btn primary" disabled={!valido}>Registrar</button>
      </form>
      {novo.ticker && (
        <div className="muted" style={{ fontSize: 12 }}>
          {sugerido?.erro ? 'Sem preço nessa data.' : sugerido?.preco
            ? rf ? `Índice em ${fmt.date(sugerido.data)}: ${fmt.num(sugerido.preco, 4)} → ${quantidade ? qtdFmt(quantidade) : '—'} cotas.`
              : `Fechamento em ${fmt.date(sugerido.data)}: ${fmt.preco(sugerido.preco)} (usado se o preço ficar em branco).`
            : 'Buscando preço na data…'}
        </div>
      )}

      {aberto && (
        <div className="table-wrap" style={{ border: 0, marginTop: 8 }}>
          <table>
            <thead><tr><th className="txt">Data</th><th className="txt">Operação</th><th className="txt">Ativo</th><th>Qtd.</th><th>Preço</th><th>Total</th><th aria-label="Excluir" /></tr></thead>
            <tbody>
              {ordenadas.map((t) => (
                <tr key={t.id} style={{ cursor: 'default' }}>
                  <td className="txt">{fmt.date(t.data)}{t.inicial ? ' *' : ''}</td>
                  <td className="txt"><span className={`badge ${t.tipo === 'venda' ? 'neg' : ''}`}>{t.tipo === 'venda' ? 'Venda' : 'Compra'}</span></td>
                  <td className="txt">{t.ticker}</td>
                  <td className="num">{qtdFmt(t.quantidade)}</td>
                  <td className="num">{fmt.preco(t.preco)}</td>
                  <td className="num">{fmt.brl(t.quantidade * t.preco)}</td>
                  <td><button className="chip" style={{ padding: '0 6px' }} aria-label={`Excluir operação de ${t.ticker}`}
                    onClick={() => setTransacoes((ts) => ts.filter((x) => x.id !== t.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!transacoes.length && <div className="empty">Nenhuma operação ainda.</div>}
          {transacoes.some((t) => t.inicial) && <p className="muted" style={{ fontSize: 12 }}>* posição sem data real (criada antes do registro de operações).</p>}
        </div>
      )}
    </div>
  )
}
