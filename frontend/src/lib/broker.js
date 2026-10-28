// Carteiras do Home Broker, guardadas só no navegador (localStorage): cada visitante tem as suas.
const CHAVE = 'homebroker_v1'
const vazio = () => ({ ativa: null, carteiras: [] })
const id = () => Math.random().toString(36).slice(2, 10)

export function carregar() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE))
    return s && Array.isArray(s.carteiras) ? s : vazio()
  } catch { return vazio() }
}

export function salvar(estado) {
  try { localStorage.setItem(CHAVE, JSON.stringify(estado)) } catch {}
  return estado
}

// cria uma carteira (ex.: vinda da aba Carteira) e a torna ativa
export function novaCarteira(nome, posicoes = []) {
  const e = carregar()
  const c = { id: id(), nome: nome || `Carteira ${e.carteiras.length + 1}`, posicoes: limpar(posicoes), criada: new Date().toISOString() }
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

