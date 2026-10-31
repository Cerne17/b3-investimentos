// Carteiras do Home Broker, guardadas no navegador (localStorage); com login, lib/nuvem.js as sincroniza.
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
  if (Array.isArray(c.transacoes)) return { ...c, posicoes: posicoesDe(c.transacoes) } // posições sempre derivadas das operações
  const data = (c.criada || new Date().toISOString()).slice(0, 10)
  const transacoes = (c.posicoes || []).map((p) => ({ id: id(), data, ticker: p.ticker, tipo: 'compra', quantidade: p.quantidade, preco: p.preco_medio, inicial: true }))
  return { ...c, transacoes, posicoes: posicoesDe(transacoes) }
}

// `atualizada` marca a última mudança de cada carteira (é o que decide quem vence na sincronização);
// carteiras excluídas ficam em `excluidas` até a próxima sincronização apagar na nuvem.
// tocar=false grava sem marcar mudança (ex.: o que acabou de vir da nuvem).
export function salvar(estado, { tocar = true } = {}) {
  let antes = {}
  try { antes = Object.fromEntries((JSON.parse(localStorage.getItem(CHAVE))?.carteiras || []).map((c) => [c.id, c])) } catch {}
  const agora = new Date().toISOString()
  const semData = (c) => JSON.stringify({ ...c, atualizada: undefined, posicoes: undefined })
  const carteiras = estado.carteiras.map((c) => {
    const nova = { ...c, posicoes: posicoesDe(c.transacoes || []) }
    if (tocar && (!antes[c.id] || semData(antes[c.id]) !== semData(nova))) nova.atualizada = agora
    return nova
  })
  const sumiram = Object.keys(antes).filter((id) => !carteiras.some((c) => c.id === id))
  const excluidas = [...new Set([...(estado.excluidas || []), ...(tocar ? sumiram : [])])]
  const e = { ...estado, carteiras, excluidas }
  try { localStorage.setItem(CHAVE, JSON.stringify(e)) } catch {}
  if (tocar) window.dispatchEvent(new Event('carteiras-alteradas'))
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
export function novaCarteira(nome, posicoes = [], transacoes = null, extras = {}) {
  const e = carregar()
  const hoje = new Date().toISOString().slice(0, 10)
  const ops = transacoes ? transacoes.map(novaOperacao)
    : limpar(posicoes).map((p) => novaOperacao({ data: hoje, ticker: p.ticker, quantidade: p.quantidade, preco: p.preco_medio }))
  const c = { id: id(), nome: nome || `Carteira ${e.carteiras.length + 1}`, transacoes: ops, criada: new Date().toISOString(), ...extras }
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


// Junta operações importadas às de uma carteira existente, sem duplicar:
// - operação idêntica (data, ativo, tipo, quantidade, preço, evento) já registrada é ignorada;
// - posição sem data real (extrato de Posição) de um ativo que a carteira já tem é ignorada;
// - operações reais de um ativo substituem as posições "sem data real" que a carteira tinha dele.
export function mesclarOperacoes(existentes, novas) {
  const chave = (t) => [t.data, t.ticker, t.tipo, (+t.quantidade).toFixed(6), (+t.preco).toFixed(4), t.evento || ''].join('|')
  const reaisPorAtivo = new Set(novas.filter((t) => !t.inicial).map((t) => t.ticker))
  const substituidas = existentes.filter((t) => t.inicial && reaisPorAtivo.has(t.ticker))
  const base = existentes.filter((t) => !(t.inicial && reaisPorAtivo.has(t.ticker)))
  const vistas = new Set(base.map(chave))
  const ativos = new Set(base.map((t) => t.ticker))
  const adicionadas = []
  let ignoradas = 0
  for (const t of novas) {
    if (vistas.has(chave(t)) || (t.inicial && ativos.has(t.ticker))) { ignoradas++; continue }
    vistas.add(chave(t))
    adicionadas.push(novaOperacao(t))
  }
  return { transacoes: [...base, ...adicionadas], adicionadas: adicionadas.length, ignoradas, substituidas: substituidas.length }
}
