// Classificação de tickers que não estão na base: cripto em reais (BTC-BRL), renda fixa sintética (CDI, IPCA+6,
// CDI+2, PRE-13, POUPANCA, CAIXA...) e títulos do Tesouro Direto (TD-IPCA-2035). Renda fixa aceita um rótulo depois de
// "@" (CDI-110@C6) para separar aplicações iguais de emissores diferentes.
export const base = (t) => String(t).split('@')[0]
export const rotulo = (t) => (String(t).includes('@') ? String(t).split('@').slice(1).join('@') : null)
export const ehCripto = (t) => /-(BRL|USD|USDT|EUR)$/.test(t)
export const ehTesouro = (t) => /^TD-(SELIC|PRE|PREJ|IPCA|IPCAJ|IGPMJ|RENDA|EDUCA)-\d{4}$/.test(base(t))
export const ehCaixa = (t) => base(t) === 'CAIXA'
export const ehRendaFixa = (t) => ehTesouro(t) ||
  /^(CDI(-\d+([.,]\d+)?)?|CDI\+\d+([.,]\d+)?|SELIC|IPCA\+\d+([.,]\d+)?|PRE-\d+([.,]\d+)?|CAIXA|POUPANCA)$/.test(base(t))
export const fracionario = (t) => ehCripto(t) || ehRendaFixa(t)
// ticker em maiúsculas, mas o rótulo depois do @ mantém o que a pessoa escreveu
export const normalizar = (t) => {
  const s = String(t).trim()
  const i = s.indexOf('@')
  return (i < 0 ? s.toUpperCase() : `${s.slice(0, i).toUpperCase()}@${s.slice(i + 1).trim()}`).replace(/\.SA$/, '')
}
