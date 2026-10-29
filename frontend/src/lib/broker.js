// Carteiras do Home Broker, guardadas só no navegador (localStorage): cada visitante tem as suas.
const CHAVE = 'homebroker_v1'
const vazio = () => ({ ativa: null, carteiras: [] })
const id = () => Math.random().toString(36).slice(2, 10)

// Cada carteira guarda as operações (compra/venda com data); as posições (quantidade e preço médio) são derivadas
// delas e regravadas a cada salvamento. Carteiras antigas, só com posições, viram compras na data de criação
// (marcadas como "inicial", sem data real).
export function carregar() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE))
    if (!s || !Array.isArray(s.carteiras)) return vazio()
    return { ...s, carteiras: s.carteiras.map(migrar) }
  } catch { return vazio() }
}

function migrar(c) {
  if (Array.isArray(c.transacoes)) return c
  const data = (c.criada || new Date().toISOString()).slice(0, 10)
  const transacoes = (c.posicoes || []).map((p) => ({ id: id(), data, ticker: p.ticker, tipo: 'compra', quantidade: p.quantidade, preco: p.preco_medio, inicial: true }))
  return { ...c, transacoes, posicoes: posicoesDe(transacoes) }
}

export function salvar(estado) {
  const e = { ...estado, carteiras: estado.carteiras.map((c) => ({ ...c, posicoes: posicoesDe(c.transacoes || []) })) }
  try { localStorage.setItem(CHAVE, JSON.stringify(e)) } catch {}
  return e
}

// posição de cada ativo pelo custo médio: a compra soma quantidade e custo; a venda baixa o custo proporcionalmente
export function posicoesDe(transacoes) {
  const m = new Map()
  for (const t of [...transacoes].sort((a, b) => a.data.localeCompare(b.data))) {
    const p = m.get(t.ticker) || { ticker: t.ticker, quantidade: 0, custo: 0 }
    if (t.tipo === 'venda') {
      const q = Math.min(t.quantidade, p.quantidade)
      p.custo -= p.quantidade ? (p.custo / p.quantidade) * q : 0
      p.quantidade -= q
    } else {
      p.quantidade += t.quantidade
      p.custo += t.quantidade * (t.preco || 0)
    }
    m.set(t.ticker, p)
  }
  return [...m.values()].filter((p) => p.quantidade > 1e-9)
    .map((p) => ({ ticker: p.ticker, quantidade: +p.quantidade.toPrecision(12), preco_medio: p.quantidade ? p.custo / p.quantidade : 0 }))
}

export const novaOperacao = (o) => ({ id: id(), tipo: 'compra', ...o, ticker: String(o.ticker).trim().toUpperCase().replace(/\.SA$/, '') })

// cria uma carteira (ex.: vinda da aba Markowitz, com posições compradas hoje, ou de um extrato da B3, com
// operações) e a torna ativa
export function novaCarteira(nome, posicoes = [], transacoes = null) {
  const e = carregar()
  const hoje = new Date().toISOString().slice(0, 10)
  const ops = transacoes ? transacoes.map(novaOperacao)
    : limpar(posicoes).map((p) => novaOperacao({ data: hoje, ticker: p.ticker, quantidade: p.quantidade, preco: p.preco_medio }))
  const c = { id: id(), nome: nome || `Carteira ${e.carteiras.length + 1}`, transacoes: ops, criada: new Date().toISOString() }
  return salvar({ ativa: c.id, carteiras: [...e.carteiras, c] })
}

// normaliza posições importadas: ticker em maiúsculas, quantidade > 0 e preço médio numérico
export function limpar(posicoes) {
  const porTicker = new Map()
  for (const p of posicoes || []) {
    const ticker = String(p.ticker || '').trim().toUpperCase().replace(/\.SA$/, '')
    const q = Number(p.quantidade), pm = Number(p.preco_medio)
    if (!ticker || !(q > 0)) continue
    const ant = porTicker.get(ticker)
    // mesmo ativo duas vezes: soma quantidades e faz o preço médio ponderado
    if (ant) porTicker.set(ticker, { ticker, quantidade: ant.quantidade + q, preco_medio: (ant.quantidade * ant.preco_medio + q * (pm || 0)) / (ant.quantidade + q) })
    else porTicker.set(ticker, { ticker, quantidade: q, preco_medio: pm > 0 ? pm : 0 })
  }
  return [...porTicker.values()]
}

