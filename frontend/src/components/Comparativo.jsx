import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { GRUPOS, LABELS } from '../config.js'
import { colClass, formatCol } from '../format.js'
import BuscaAtivo from './BuscaAtivo.jsx'

// direção "melhor" de cada métrica para destacar o vencedor da linha; métricas neutras não são destacadas
const MAIOR = ['dividend_yield', 'dy_anualizado', 'dy_12m_cvm', 'proventos_12m', 'num_proventos_12m', 'crescimento_proventos',
  'retorno_1m', 'retorno_3m', 'retorno_6m', 'retorno_ytd', 'retorno_12m', 'retorno_24m', 'retorno_total_12m', 'sharpe_12m',
  'max_drawdown_12m', 'liquidez_media', 'volume_medio', 'valor_mercado', 'patrimonio_liquido', 'valor_ativo', 'cotistas',
  'rentab_efetiva_12m', 'rentab_patrimonial_12m', 'dist_max_52s', 'roe', 'roa', 'margem_bruta', 'margem_ebitda',
  'margem_operacional', 'margem_liquida', 'earnings_yield', 'margem_graham', 'crescimento_receita', 'crescimento_lucro', 'receita',
  'ebitda', 'lucro_liquido', 'liquidez_corrente', 'potencial_alvo', 'free_float', 'sortino_12m', 'valor_mercado_usd',
  'volume_24h_usd', 'volume_mcap', 'mcap_fdv', 'pct_emitido', 'variacao_24h', 'variacao_7d', 'dist_ath']
const MENOR = ['pvp', 'pl', 'pl_projetado', 'psr', 'ev_ebitda', 'ev_receita', 'peg', 'volatilidade_12m', 'alavancagem', 'taxa_adm_anual',
  'div_liq_ebitda', 'divida_patrimonio', 'rank_mercado']
const melhor = (c) => (MAIOR.includes(c) ? 'max' : MENOR.includes(c) ? 'min' : null)

const CHAVE = (tipo) => `comparativos_${tipo}`
export const carregarSalvos = (tipo) => { try { return JSON.parse(localStorage.getItem(CHAVE(tipo))) || [] } catch { return [] } }
const gravarSalvos = (tipo, v) => { try { localStorage.setItem(CHAVE(tipo), JSON.stringify(v)) } catch {} }

export default function Comparativo({ tipo, codigos, onChange, onOpen, onClose }) {
  const [dados, setDados] = useState([])
  const [erro, setErro] = useState(null)
  const [salvos, setSalvos] = useState(() => carregarSalvos(tipo))
  const [soDiferencas, setSoDiferencas] = useState(false)

  useEffect(() => {
    if (!codigos.length) { setDados([]); return }
    api.comparar(codigos).then((d) => { setDados(d); setErro(null) }).catch((e) => setErro(e.message))
  }, [codigos.join(',')])

  const salvar = () => {
    const nome = window.prompt('Nome do comparativo:', codigos.join(' × '))
    if (!nome) return
    const novo = [...salvos.filter((s) => s.nome !== nome), { nome, codigos }]
    setSalvos(novo); gravarSalvos(tipo, novo)
  }
  const excluirSalvo = (nome) => { const novo = salvos.filter((s) => s.nome !== nome); setSalvos(novo); gravarSalvos(tipo, novo) }
  const add = (t) => {
    const c = tipo === 'acoes' ? t.toUpperCase() : t.toUpperCase().replace(/\d+$/, '')
    if (!codigos.includes(c)) onChange([...codigos, c])
  }

  const exportar = () => {
    const cols = GRUPOS[tipo].flatMap(([, c]) => c)
    const linhas = [['metrica', ...dados.map((d) => d.ticker || d.codigo)], ...cols.map((c) => [LABELS[c] || c, ...dados.map((d) => d[c] ?? '')])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + linhas.map((l) => l.join(';')).join('\n')], { type: 'text/csv' }))
    a.download = `comparativo_${tipo}.csv`
    a.click()
  }

  const valoresIguais = (c) => new Set(dados.map((d) => String(d[c] ?? ''))).size <= 1

  return (
    <div className="card section comparativo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Comparativo · {codigos.length} {tipo === 'fiis' ? 'FIIs' : tipo === 'acoes' ? 'ações' : 'ETFs'}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <label className="chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={soDiferencas} onChange={(e) => setSoDiferencas(e.target.checked)} /> Só diferenças
          </label>
          <button className="chip" onClick={salvar} disabled={!codigos.length}>Salvar comparativo</button>
          <button className="chip" onClick={exportar} disabled={!dados.length}>Exportar CSV</button>
          <button className="chip" onClick={() => onChange([])}>Limpar</button>
          <button className="chip" onClick={onClose} aria-label="Fechar comparativo">✕</button>
        </div>
      </div>

      {salvos.length > 0 && (
        <div className="chips" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>Salvos:</span>
          {salvos.map((s) => (
            <span key={s.nome} className="sel-chip" style={{ fontWeight: 500 }}>
              <button style={{ padding: 0, color: 'inherit' }} onClick={() => onChange(s.codigos)}>{s.nome}</button>
              <button onClick={() => excluirSalvo(s.nome)} aria-label={`Excluir ${s.nome}`}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="filters" style={{ marginTop: 10, marginBottom: 10 }}>
        <BuscaAtivo onAdd={add} label="Adicionar à comparação" width={260} />
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>ou marque linhas na tabela abaixo. Em destaque, o melhor valor de cada métrica.</span>
      </div>

      {erro && <div className="alert">{erro}</div>}
      {!codigos.length && <div className="empty">Selecione ativos para comparar.</div>}
      {dados.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: '70vh' }}>
          <table className="tabela-comp">
            <thead>
              <tr>
                <th className="txt">Métrica</th>
                {dados.map((d) => (
                  <th key={d.codigo}>
                    <button className="link" onClick={() => onOpen(tipo, d.codigo)}>{d.ticker || d.codigo}</button>
                    <button className="x" onClick={() => onChange(codigos.filter((c) => c !== d.codigo))} aria-label={`Remover ${d.codigo}`}>✕</button>
                    <div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{d.categoria}{d.segmento ? ` · ${d.segmento}` : ''}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRUPOS[tipo].map(([grupo, cols]) => {
                const visiveis = cols.filter((c) => !soDiferencas || !valoresIguais(c))
                if (!visiveis.length) return null
                return (
                  <React.Fragment key={grupo}>
                    <tr className="grupo"><td className="txt" colSpan={dados.length + 1}>{grupo}</td></tr>
                    {visiveis.map((c) => {
                      const dir = melhor(c)
                      const nums = dados.map((d) => d[c]).filter((v) => typeof v === 'number')
                      const alvo = dir && nums.length > 1 ? (dir === 'max' ? Math.max(...nums) : Math.min(...nums.filter((v) => dir !== 'min' || v > 0))) : null
                      return (
                        <tr key={c} style={{ cursor: 'default' }}>
                          <td className="txt">{LABELS[c] || c}</td>
                          {dados.map((d) => (
                            <td key={d.codigo} className={`num ${colClass(c, d[c])} ${d[c] === alvo ? 'best' : ''}`}>{formatCol(c, d[c])}</td>
                          ))}
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
