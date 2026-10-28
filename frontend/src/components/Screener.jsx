import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { LABELS, TELAS } from '../config.js'
import { colClass, formatCol } from '../format.js'
import Comparativo, { carregarSalvos } from './Comparativo.jsx'

const LIMITE = 50

export default function Screener({ tipo, onOpen, extraCols }) {
  const tela = TELAS[tipo]
  const [filtros, setFiltros] = useState({})
  const [ordenar, setOrdenar] = useState(tela.ordenarPadrao)
  const [ordem, setOrdem] = useState('desc')
  const [offset, setOffset] = useState(0)
  const [cols, setCols] = useState(tela.colunas)
  const [dados, setDados] = useState({ total: 0, itens: [] })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [segmentos, setSegmentos] = useState([])
  const [categorias, setCategorias] = useState(tela.categorias || [])
  const [atalho, setAtalho] = useState(null)
  const [selecao, setSelecao] = useState([])
  const [comparando, setComparando] = useState(false)

  useEffect(() => {
    // reinicia ao trocar de aba
    setFiltros({}); setOrdenar(tela.ordenarPadrao); setOrdem('desc'); setOffset(0); setCols(tela.colunas); setAtalho(null)
    setSelecao([]); setComparando(false)
    setSegmentos([]); setCategorias(tela.categorias || [])
    if (tela.segmentoCol) api.valores(tipo, tela.segmentoCol).then(setSegmentos).catch(() => {})
    if (!tela.categorias) api.valores(tipo, 'categoria').then((v) => setCategorias(v.map((x) => x.valor))).catch(() => {})
  }, [tipo])

  useEffect(() => {
    setCarregando(true)
    const t = setTimeout(() => {
      api.listar(tipo, { ...filtros, ordenar, ordem, limite: LIMITE, offset })
        .then((d) => { setDados(d); setErro(null) })
        .catch((e) => setErro(e.message))
        .finally(() => setCarregando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [tipo, filtros, ordenar, ordem, offset])

  const set = (k, v) => { setOffset(0); setAtalho(null); setFiltros((f) => ({ ...f, [k]: v })) }
  const sort = (c) => {
    if (c === 'ticker') c = 'codigo'
    setOffset(0)
    if (c === ordenar) setOrdem((o) => (o === 'desc' ? 'asc' : 'desc'))
    else { setOrdenar(c); setOrdem('desc') }
  }
  const aplicarAtalho = (a) => {
    setOffset(0); setAtalho(a.nome); setFiltros(a.f); setOrdenar(a.ordenar || tela.ordenarPadrao); setOrdem(a.ordem || 'desc')
  }
  const disponiveis = useMemo(() => (extraCols || []).filter((c) => !cols.includes(c)), [extraCols, cols])

  const exportarCSV = async () => {
    const d = await api.listar(tipo, { ...filtros, ordenar, ordem, limite: 1000 })
    const keys = Object.keys(d.itens[0] || {})
    const csv = [keys.join(';'), ...d.itens.map((r) => keys.map((k) => String(r[k] ?? '').replace(/;/g, ',')).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    a.download = `${tipo}.csv`
    a.click()
  }

  return (
    <>
      <h1>{tela.titulo}</h1>
      <p className="sub">{tela.subtitulo}</p>

      <div className="chips">
        {tela.atalhos.map((a) => (
          <button key={a.nome} className={`chip ${atalho === a.nome ? 'on' : ''}`} onClick={() => aplicarAtalho(a)}>{a.nome}</button>
        ))}
      </div>

      <div className="filters">
        <label className="field">Buscar
          <input className="wide" placeholder="Código ou nome" value={filtros.busca || ''} onChange={(e) => set('busca', e.target.value)} />
        </label>
        <label className="field">{tipo === 'acoes' ? 'Setor' : 'Categoria'}
          <select value={filtros.categoria || ''} onChange={(e) => set('categoria', e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {tela.segmentoCol && (
          <label className="field">{tela.segmentoLabel}
            <select value={filtros.segmento || ''} onChange={(e) => set('segmento', e.target.value)}>
              <option value="">Todos</option>
              {segmentos.map((s) => <option key={s.valor} value={s.valor}>{s.valor} ({s.quantidade})</option>)}
            </select>
          </label>
        )}
        {tela.filtros.map(({ col, label, lado, step }) => {
          const k = `${lado}_${col}`
          return (
            <label className="field" key={k}>{label}
              <input type="number" step={step || 'any'} value={filtros[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
            </label>
          )
        })}
        {disponiveis.length > 0 && (
          <label className="field">Adicionar coluna
            <select value="" onChange={(e) => e.target.value && setCols((c) => [...c, e.target.value])}>
              <option value="">+ coluna</option>
              {disponiveis.map((c) => <option key={c} value={c}>{tela.labels?.[c] || LABELS[c] || c}</option>)}
            </select>
          </label>
        )}
        <button className="btn" onClick={() => { setFiltros({}); setAtalho(null); setOffset(0); setCols(tela.colunas) }}>Limpar</button>
        <button className="btn" onClick={exportarCSV}>Exportar CSV</button>
        <button className={`btn ${selecao.length ? 'primary' : ''}`} onClick={() => setComparando(true)}
          title="Marque linhas da tabela ou abra um comparativo salvo">
          Comparar{selecao.length ? ` (${selecao.length})` : carregarSalvos(tipo).length ? ' · salvos' : ''}
        </button>
      </div>

      {comparando && (
        <Comparativo tipo={tipo} codigos={selecao} onChange={setSelecao} onOpen={onOpen} onClose={() => setComparando(false)} />
      )}

      {erro && <div className="alert">{erro}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="txt sel-col" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Selecionar página"
                  checked={dados.itens.length > 0 && dados.itens.every((r) => selecao.includes(r.codigo))}
                  onChange={(e) => setSelecao((s) => (e.target.checked
                    ? [...new Set([...s, ...dados.itens.map((r) => r.codigo)])]
                    : s.filter((c) => !dados.itens.some((r) => r.codigo === c))))} />
              </th>
              {cols.map((c) => {
                const key = c === 'ticker' ? 'codigo' : c
                return (
                  <th key={c} className={`${['ticker', 'categoria', 'segmento', 'mandato', 'tipo_gestao', 'administrador'].includes(c) ? 'txt' : ''} ${ordenar === key ? 'sorted' : ''}`}
                    onClick={() => sort(c)} title="Ordenar">
                    {c === 'categoria' && tipo === 'acoes' ? 'Setor' : tela.labels?.[c] || LABELS[c] || c}{ordenar === key ? (ordem === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((r) => (
              <tr key={r.codigo} onClick={() => onOpen(tipo, r.codigo)} className={selecao.includes(r.codigo) ? 'selected' : ''}>
                <td className="sel-col" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Comparar ${r.codigo}`} checked={selecao.includes(r.codigo)}
                    onChange={() => { setSelecao((s) => (s.includes(r.codigo) ? s.filter((c) => c !== r.codigo) : [...s, r.codigo])); setComparando(true) }} />
                </td>
                {cols.map((c) =>
                  c === 'ticker' ? (
                    <td key={c} className="txt">
                      <span className="tk">{r.ticker || r.codigo}</span>
                      {r.alerta && <span className="warn-dot" title={r.alerta}>⚠</span>}
                      <span className="nm">{r.nome_pregao}</span>
                    </td>
                  ) : ['categoria', 'segmento', 'mandato', 'tipo_gestao', 'administrador', 'segmento_listagem', 'tipo_acao', 'setor_yahoo', 'recomendacao', 'controle_acionario'].includes(c) ? (
                    <td key={c} className="txt">{r[c] ? <span className="badge">{r[c]}</span> : '—'}</td>
                  ) : (
                    <td key={c} className={`num ${colClass(c, r[c])}`}>{formatCol(c, r[c])}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!dados.itens.length && !carregando && <div className="empty">Nenhum ativo com esses filtros.</div>}
      </div>
      <div className="pager">
        <span>{carregando ? 'Carregando…' : `${dados.total} ativos`} · ⚠ = alerta de qualidade do dado</span>
        <span>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMITE))}>Anterior</button>{' '}
          <span className="num">{dados.total ? `${offset + 1}–${Math.min(offset + LIMITE, dados.total)}` : ''}</span>{' '}
          <button className="btn" disabled={offset + LIMITE >= dados.total} onClick={() => setOffset(offset + LIMITE)}>Próxima</button>
        </span>
      </div>
    </>
  )
}
