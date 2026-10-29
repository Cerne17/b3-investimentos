// Link compartilhável de carteira: as operações vão comprimidas (deflate) e em base64url no próprio link, depois do
// "#" — o servidor nunca recebe a carteira. Quem abre o link escolhe se importa a cópia no próprio navegador.

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function comprimir(texto) {
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(fluxo).arrayBuffer())
}

async function descomprimir(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(fluxo).text()
}

// formato compacto: [nome, meta_renda, [[data, ticker, c|v, quantidade, preco, evento?], ...]]
export async function linkDaCarteira(carteira) {
  const ops = (carteira.transacoes || []).map((t) => [t.data, t.ticker, t.tipo === 'venda' ? 'v' : 'c', t.quantidade, t.preco, ...(t.evento ? [t.evento] : [])])
  const bytes = await comprimir(JSON.stringify([carteira.nome, carteira.meta_renda ?? null, ops]))
  return `${window.location.origin}${window.location.pathname}#broker?c=${b64url(bytes)}`
}

export async function carteiraDoLink(hash = window.location.hash) {
  const m = hash.match(/[?&]c=([\w-]+)/)
  if (!m) return null
  const [nome, meta, ops] = JSON.parse(await descomprimir(deB64url(m[1])))
  return {
    nome: String(nome || 'Carteira compartilhada'), meta_renda: meta,
    transacoes: ops.map(([data, ticker, tipo, quantidade, preco, evento]) => ({
      data, ticker, tipo: tipo === 'v' ? 'venda' : 'compra', quantidade: Number(quantidade), preco: Number(preco), ...(evento ? { evento } : {}),
    })),
  }
}

export const limparLink = () => window.history.replaceState(null, '', `${window.location.pathname}#broker`)
