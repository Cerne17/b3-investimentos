// Cliente da API FastAPI. Em dev o Vite faz proxy de /api para :8000.
const BASE = import.meta.env.VITE_API_URL || ''

async function req(path, opts) {
  const r = await fetch(BASE + path, opts)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.detail || `Erro ${r.status}`)
  return body
}

const qs = (params) => {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v)
  })
  return p.toString()
}

export const api = {
  resumo: () => req('/api/resumo'),
  metricas: () => req('/api/metricas'),
  listar: (tipo, params) => req(`/api/${tipo}?${qs(params)}`),
  obter: (tipo, codigo) => req(`/api/${tipo}/${codigo}`),
  valores: (tipo, coluna) => req(`/api/${tipo}/valores/${coluna}`),
  ranking: (tipo, metrica, params) => req(`/api/ranking/${tipo}/${metrica}?${qs(params)}`),
  comparar: (codigos) => req(`/api/comparar?${qs({ codigos: codigos.join(',') })}`),
  proventos: (codigo) => req(`/api/proventos/${codigo}`),
  cotacao: (ticker) => req(`/api/tempo-real/cotacao/${encodeURIComponent(ticker)}`),
  proventosRecentes: (tickers) => req(`/api/tempo-real/proventos?${qs({ tickers: tickers.join(',') })}`),
  cotacoes: (tickers) => req(`/api/tempo-real/cotacoes?${qs({ tickers: tickers.join(',') })}`),
  historico: (ticker, periodo = '6mo', intervalo = '1d') =>
    req(`/api/tempo-real/historico/${encodeURIComponent(ticker)}?${qs({ periodo, intervalo })}`),
  sql: (query) => req('/api/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }),
  busca: (q) => req(`/api/busca?${qs({ q, limite: 10 })}`),
  carteiraOpcoes: () => req('/api/carteira/opcoes'),
  otimizar: (body) => req('/api/carteira/otimizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  mcCarteira: (body) => req('/api/montecarlo/carteira', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  mcAtivo: (body) => req('/api/montecarlo/ativo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  aporte: (body) => req('/api/carteira/aporte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  desempenho: (body) => req('/api/carteira/desempenho', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  importarB3: (body) => req('/api/carteira/importar-b3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  precoEm: (ticker, data) => req(`/api/tempo-real/preco/${encodeURIComponent(ticker)}?${qs({ data })}`),
  atualizar: (tipo, codigo) => req(`/api/atualizar/${tipo}/${codigo}`, { method: 'POST' }),
}
