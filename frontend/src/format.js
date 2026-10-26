const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const f0 = nf(0), f2 = nf(2)

export const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(v)

export const fmt = {
  num: (v, d = 2) => (isNum(v) ? nf(d).format(v) : '—'),
  int: (v) => (isNum(v) ? f0.format(v) : '—'),
  pct: (v, d = 2) => (isNum(v) ? `${nf(d).format(v)}%` : '—'),
  brl: (v) => (isNum(v) ? `R$ ${f2.format(v)}` : '—'),
  // valores grandes: R$ 1,2 bi / 350 mi / 12 mil
  big: (v, prefix = 'R$ ') => {
    if (!isNum(v)) return '—'
    const a = Math.abs(v)
    if (a >= 1e9) return `${prefix}${nf(1).format(v / 1e9)} bi`
    if (a >= 1e6) return `${prefix}${nf(1).format(v / 1e6)} mi`
    if (a >= 1e3) return `${prefix}${nf(0).format(v / 1e3)} mil`
    return `${prefix}${f0.format(v)}`
  },
  date: (s) => (s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—'),
}

export const signClass = (v) => (isNum(v) ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '')
export const signed = (v, d = 2) => (isNum(v) ? `${v > 0 ? '+' : ''}${fmt.num(v, d)}%` : '—')

// formato por coluna (usado na tabela e no detalhe)
export const COL_FMT = {
  preco: fmt.brl, valor_patrimonial: fmt.brl, ultimo_rendimento: (v) => fmt.num(v, 4), proventos_12m: (v) => fmt.num(v, 4),
  valor_mercado: fmt.big, patrimonio_liquido: fmt.big, valor_ativo: fmt.big, liquidez_media: fmt.big,
  volume_medio: (v) => fmt.big(v, ''), cotas_emitidas: (v) => fmt.big(v, ''), cotistas: fmt.int, num_proventos_12m: fmt.int,
  pvp: (v) => fmt.num(v, 2), pl: (v) => fmt.num(v, 1), beta_ibov: (v) => fmt.num(v, 2), correlacao_ibov: (v) => fmt.num(v, 2),
  sharpe_12m: (v) => fmt.num(v, 2), psr: (v) => fmt.num(v, 2), ev_ebitda: (v) => fmt.num(v, 1), ev_receita: (v) => fmt.num(v, 2),
  peg: (v) => fmt.num(v, 2), lpa: fmt.brl, vpa: fmt.brl, valor_graham: fmt.brl, preco_alvo: fmt.brl, pl_projetado: (v) => fmt.num(v, 1),
  receita: fmt.big, ebitda: fmt.big, lucro_liquido: fmt.big, divida_total: fmt.big, caixa: fmt.big, divida_liquida: fmt.big,
  div_liq_ebitda: (v) => fmt.num(v, 2), liquidez_corrente: (v) => fmt.num(v, 2), divida_patrimonio: (v) => fmt.pct(v, 1),
  num_analistas: fmt.int, acoes_por_unit: fmt.int, max_52s: fmt.brl, min_52s: fmt.brl, media_50d: fmt.brl, media_200d: fmt.brl,
  data_ultimo_rend: fmt.date, data_ref_cvm: fmt.date, data_funcionamento: fmt.date, atualizado_em: fmt.date,
}
const PCT = /^(retorno|dividend_yield|dy_|rentab|volatil|max_drawdown|dist_max|crescimento|pct_|alavancagem|taxa_adm|roe|roa|margem_|earnings_yield|payout|free_float|potencial)/
const SIGNED = /^(retorno|rentab|max_drawdown|dist_max|crescimento|margem_graham|potencial)/

export function formatCol(col, v) {
  if (COL_FMT[col]) return COL_FMT[col](v)
  if (PCT.test(col)) return SIGNED.test(col) ? signed(v) : fmt.pct(v)
  if (typeof v === 'number') return fmt.num(v)
  return v ?? '—'
}
export const colClass = (col, v) => (SIGNED.test(col) ? signClass(v) : '')
