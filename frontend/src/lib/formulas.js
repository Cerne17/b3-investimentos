// Indicadores técnicos e uma linguagem de fórmulas segura (sem eval) para séries de preço.
// Séries são Float64Array com NaN onde não há valor; escalares fazem broadcast.

const isArr = (v) => v instanceof Float64Array
const N = (len) => new Float64Array(len).fill(NaN)

export function sma(x, n) {
  const out = N(x.length)
  let soma = 0, cont = 0
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(x[i])) { soma += x[i]; cont++ }
    if (i >= n && !Number.isNaN(x[i - n])) { soma -= x[i - n]; cont-- }
    if (i >= n - 1 && cont === n) out[i] = soma / n
  }
  return out
}

export function ema(x, n) {
  const out = N(x.length), k = 2 / (n + 1)
  let prev = NaN, buf = []
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (Number.isNaN(v)) continue
    if (Number.isNaN(prev)) {
      buf.push(v)
      if (buf.length === n) { prev = buf.reduce((a, b) => a + b, 0) / n; out[i] = prev }
    } else { prev = v * k + prev * (1 - k); out[i] = prev }
  }
  return out
}

export function rollStd(x, n) {
  const out = N(x.length)
  for (let i = n - 1; i < x.length; i++) {
    let s = 0, s2 = 0, ok = true
    for (let j = i - n + 1; j <= i; j++) { if (Number.isNaN(x[j])) { ok = false; break } s += x[j]; s2 += x[j] * x[j] }
    if (ok) out[i] = Math.sqrt(Math.max(0, (s2 - (s * s) / n) / (n - 1)))
  }
  return out
}

const rollAgg = (x, n, fn) => {
  const out = N(x.length)
  for (let i = n - 1; i < x.length; i++) {
    const w = Array.from(x.subarray(i - n + 1, i + 1)).filter((v) => !Number.isNaN(v))
    if (w.length === n) out[i] = fn(w)
  }
  return out
}
export const rollMax = (x, n) => rollAgg(x, n, (w) => Math.max(...w))
export const rollMin = (x, n) => rollAgg(x, n, (w) => Math.min(...w))

export function lag(x, n = 1) {
  const out = N(x.length)
  for (let i = n; i < x.length; i++) out[i] = x[i - n]
  return out
}

export const pct = (x, n = 1) => map2(x, lag(x, n), (a, b) => (a / b - 1) * 100)

export function rsi(x, n = 14) {
  const out = N(x.length)
  let g = 0, l = 0
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1]
    const up = Math.max(d, 0), dn = Math.max(-d, 0)
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l) }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l) }
  }
  return out
}

export function cumsum(x) {
  const out = N(x.length); let s = 0
  for (let i = 0; i < x.length; i++) { if (!Number.isNaN(x[i])) s += x[i]; out[i] = s }
  return out
}
export function cummax(x) {
  const out = N(x.length); let m = -Infinity
  for (let i = 0; i < x.length; i++) { if (!Number.isNaN(x[i])) m = Math.max(m, x[i]); out[i] = m === -Infinity ? NaN : m }
  return out
}
export function cummin(x) {
  const out = N(x.length); let m = Infinity
  for (let i = 0; i < x.length; i++) { if (!Number.isNaN(x[i])) m = Math.min(m, x[i]); out[i] = m === Infinity ? NaN : m }
  return out
}
export function first(x) {
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) return x[i]
  return NaN
}

function map2(a, b, fn) {
  const len = isArr(a) ? a.length : isArr(b) ? b.length : 0
  if (!len) return fn(a, b)
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    const r = fn(isArr(a) ? a[i] : a, isArr(b) ? b[i] : b)
    out[i] = Number.isFinite(r) ? r : NaN
  }
  return out
}
const map1 = (a, fn) => (isArr(a) ? map2(a, 0, (v) => fn(v)) : fn(a))

// ---------- linguagem de fórmulas ----------

const intArg = (v, nome) => {
  if (isArr(v) || !Number.isInteger(v) || v < 1) throw new Error(`${nome}: o período precisa ser um inteiro ≥ 1`)
  return v
}
const serie = (v, nome) => {
  if (!isArr(v)) throw new Error(`${nome}: o primeiro argumento precisa ser uma série (ex.: close)`)
  return v
}

export const FUNCOES = {
  sma: { args: 'x, n', desc: 'Média móvel simples', fn: (x, n) => sma(serie(x, 'sma'), intArg(n, 'sma')) },
  ema: { args: 'x, n', desc: 'Média móvel exponencial', fn: (x, n) => ema(serie(x, 'ema'), intArg(n, 'ema')) },
  std: { args: 'x, n', desc: 'Desvio padrão móvel', fn: (x, n) => rollStd(serie(x, 'std'), intArg(n, 'std')) },
  max: { args: 'x, n | a, b', desc: 'Máxima móvel de n períodos, ou maior entre duas séries', fn: (a, b) => (isArr(a) && !isArr(b) ? rollMax(a, intArg(b, 'max')) : map2(a, b, Math.max)) },
  min: { args: 'x, n | a, b', desc: 'Mínima móvel de n períodos, ou menor entre duas séries', fn: (a, b) => (isArr(a) && !isArr(b) ? rollMin(a, intArg(b, 'min')) : map2(a, b, Math.min)) },
  lag: { args: 'x, n', desc: 'Valor de n períodos atrás', fn: (x, n = 1) => lag(serie(x, 'lag'), intArg(n, 'lag')) },
  pct: { args: 'x, n', desc: 'Variação % em n períodos', fn: (x, n = 1) => pct(serie(x, 'pct'), intArg(n, 'pct')) },
  rsi: { args: 'x, n', desc: 'Índice de força relativa (Wilder)', fn: (x, n = 14) => rsi(serie(x, 'rsi'), intArg(n, 'rsi')) },
  zscore: { args: 'x, n', desc: 'Desvios padrão em relação à média móvel', fn: (x, n) => { serie(x, 'zscore'); intArg(n, 'zscore'); return map2(map2(x, sma(x, n), (a, b) => a - b), rollStd(x, n), (a, b) => a / b) } },
  cumsum: { args: 'x', desc: 'Soma acumulada', fn: (x) => cumsum(serie(x, 'cumsum')) },
  cummax: { args: 'x', desc: 'Máxima acumulada', fn: (x) => cummax(serie(x, 'cummax')) },
  cummin: { args: 'x', desc: 'Mínima acumulada', fn: (x) => cummin(serie(x, 'cummin')) },
  first: { args: 'x', desc: 'Primeiro valor da série (escalar)', fn: (x) => first(serie(x, 'first')) },
  abs: { args: 'x', desc: 'Valor absoluto', fn: (x) => map1(x, Math.abs) },
  log: { args: 'x', desc: 'Logaritmo natural', fn: (x) => map1(x, Math.log) },
  sqrt: { args: 'x', desc: 'Raiz quadrada', fn: (x) => map1(x, Math.sqrt) },
  exp: { args: 'x', desc: 'Exponencial', fn: (x) => map1(x, Math.exp) },
}

export const VARIAVEIS = {
  close: 'Fechamento', open: 'Abertura', high: 'Máxima', low: 'Mínima', volume: 'Volume', div: 'Proventos pagos no dia',
}

function tokenizar(src) {
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_]\w*)|(\*\*|[-+*/^(),]))/y
  const out = []
  let pos = 0
  src = src.trim()
  while (pos < src.length) {
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m || m[0].length === 0) throw new Error(`Caractere inesperado em “${src.slice(pos, pos + 8)}”`)
    pos = re.lastIndex
    if (m[1]) out.push({ t: 'num', v: parseFloat(m[1]) })
    else if (m[2]) out.push({ t: 'id', v: m[2].toLowerCase() })
    else out.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] })
    while (pos < src.length && /\s/.test(src[pos])) pos++
  }
  return out
}

// Parser descendente recursivo -> árvore; avaliação separada para reaproveitar entre ativos
export function compilar(src) {
  if (!src || !src.trim()) throw new Error('Fórmula vazia')
  const tk = tokenizar(src)
  let i = 0
  const peek = () => tk[i]
  const take = (v) => {
    const t = tk[i]
    if (!t || (v && t.v !== v)) throw new Error(v ? `Esperado “${v}”` : 'Fórmula incompleta')
    i++
    return t
  }
  const expr = () => {
    let n = termo()
    while (peek()?.v === '+' || peek()?.v === '-') { const op = take().v; n = { op, a: n, b: termo() } }
    return n
  }
  const termo = () => {
    let n = fator()
    while (peek()?.v === '*' || peek()?.v === '/') { const op = take().v; n = { op, a: n, b: fator() } }
    return n
  }
  const fator = () => {
    const base = unario()
    if (peek()?.v === '^') { take(); return { op: '^', a: base, b: fator() } }
    return base
  }
  const unario = () => {
    if (peek()?.v === '-') { take(); return { op: 'neg', a: unario() } }
    if (peek()?.v === '+') { take(); return unario() }
    return primario()
  }
  const primario = () => {
    const t = take()
    if (t.t === 'num') return { num: t.v }
    if (t.t === 'id') {
      if (peek()?.v === '(') {
        if (!FUNCOES[t.v]) throw new Error(`Função desconhecida: ${t.v}`)
        take('(')
        const args = []
        if (peek()?.v !== ')') { args.push(expr()); while (peek()?.v === ',') { take(); args.push(expr()) } }
        take(')')
        return { fn: t.v, args }
      }
      if (!(t.v in VARIAVEIS)) throw new Error(`Variável desconhecida: ${t.v}`)
      return { var: t.v }
    }
    if (t.v === '(') { const n = expr(); take(')'); return n }
    throw new Error(`Token inesperado: ${t.v}`)
  }
  const arvore = expr()
  if (i < tk.length) throw new Error(`Sobrou “${tk[i].v}” no fim da fórmula`)
  return arvore
}

const OPS = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '^': (a, b) => a ** b }

export function avaliar(arvore, dados) {
  const ev = (n) => {
    if ('num' in n) return n.num
    if (n.var) return dados[n.var]
    if (n.fn) return FUNCOES[n.fn].fn(...n.args.map(ev))
    if (n.op === 'neg') return map1(ev(n.a), (v) => -v)
    return map2(ev(n.a), ev(n.b), OPS[n.op])
  }
  const r = ev(arvore)
  return isArr(r) ? r : new Float64Array(dados.close.length).fill(Number.isFinite(r) ? r : NaN)
}

export function calcular(src, dados) {
  return avaliar(compilar(src), dados)
}

// histórico da API -> séries
export function series(hist) {
  const col = (k) => Float64Array.from(hist, (h) => (h[k] == null ? NaN : h[k]))
  return { close: col('fechamento'), open: col('abertura'), high: col('maxima'), low: col('minima'), volume: col('volume'), div: col('dividendos') }
}

// ---------- fórmulas padrão ----------
// painel 'preco' sobrepõe ao gráfico de preço (mesma escala); 'proprio' abre um gráfico abaixo

export const PADRAO = {
  sma: { nome: 'Média móvel simples', params: { n: 20 }, painel: 'preco', linhas: ({ n }) => [[`MMS ${n}`, `sma(close, ${n})`]] },
  ema: { nome: 'Média móvel exponencial', params: { n: 21 }, painel: 'preco', linhas: ({ n }) => [[`MME ${n}`, `ema(close, ${n})`]] },
  bollinger: {
    nome: 'Bandas de Bollinger', params: { n: 20, k: 2 }, painel: 'preco',
    linhas: ({ n, k }) => [[`Bollinger sup.`, `sma(close, ${n}) + ${k} * std(close, ${n})`, true], [`Bollinger méd.`, `sma(close, ${n})`], [`Bollinger inf.`, `sma(close, ${n}) - ${k} * std(close, ${n})`, true]],
  },
  donchian: {
    nome: 'Canal de Donchian', params: { n: 20 }, painel: 'preco',
    linhas: ({ n }) => [[`Donchian máx ${n}`, `max(high, ${n})`, true], [`Donchian mín ${n}`, `min(low, ${n})`, true]],
  },
  rsi: { nome: 'IFR / RSI', params: { n: 14 }, painel: 'proprio', faixa: [30, 70], linhas: ({ n }) => [[`RSI ${n}`, `rsi(close, ${n})`]] },
  macd: {
    nome: 'MACD', params: { rapida: 12, lenta: 26, sinal: 9 }, painel: 'proprio', zero: true,
    linhas: ({ rapida, lenta, sinal }) => [
      ['MACD', `ema(close, ${rapida}) - ema(close, ${lenta})`],
      ['Sinal', `ema(ema(close, ${rapida}) - ema(close, ${lenta}), ${sinal})`, true],
    ],
  },
  estocastico: {
    nome: 'Estocástico %K', params: { n: 14 }, painel: 'proprio', faixa: [20, 80],
    linhas: ({ n }) => [[`%K ${n}`, `(close - min(low, ${n})) / (max(high, ${n}) - min(low, ${n})) * 100`]],
  },
  volatilidade: { nome: 'Volatilidade móvel (% a.a.)', params: { n: 21 }, painel: 'proprio', linhas: ({ n }) => [[`Vol ${n}d`, `std(pct(close, 1), ${n}) * sqrt(252)`]] },
  drawdown: { nome: 'Drawdown (%)', params: {}, painel: 'proprio', zero: true, linhas: () => [['Drawdown', '(close / cummax(close) - 1) * 100']] },
  retorno: { nome: 'Retorno acumulado (%)', params: {}, painel: 'proprio', zero: true, linhas: () => [['Retorno acum.', '(close / first(close) - 1) * 100']] },
  momentum: { nome: 'Momentum (%)', params: { n: 21 }, painel: 'proprio', zero: true, linhas: ({ n }) => [[`Momentum ${n}`, `pct(close, ${n})`]] },
  zscore: { nome: 'Z-score do preço', params: { n: 20 }, painel: 'proprio', zero: true, linhas: ({ n }) => [[`Z ${n}`, `zscore(close, ${n})`]] },
  volume: { nome: 'Volume e média', params: { n: 20 }, painel: 'proprio', linhas: ({ n }) => [['Volume', 'volume'], [`Média ${n}`, `sma(volume, ${n})`, true]] },
}

export const EXEMPLOS = [
  ['Cruzamento de médias', 'sma(close, 9) - sma(close, 21)'],
  ['Distância da MM200 (%)', '(close / sma(close, 200) - 1) * 100'],
  ['Amplitude diária (%)', '(high - low) / close * 100'],
  ['Retorno total com proventos', '(cumsum(div) + close) / first(close) * 100 - 100'],
  ['Retorno log acumulado', 'log(close / first(close)) * 100'],
]
