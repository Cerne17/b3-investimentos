// Classificação de tickers que não estão na base: cripto em reais (BTC-BRL), renda fixa sintética (CDI, IPCA+6...)
// e títulos do Tesouro Direto (TD-IPCA-2035), que têm preço de mercado
export const ehCripto = (t) => /-(BRL|USD|USDT|EUR)$/.test(t)
export const ehTesouro = (t) => /^TD-(SELIC|PRE|PREJ|IPCA|IPCAJ|IGPMJ|RENDA|EDUCA)-\d{4}$/.test(t)
export const ehRendaFixa = (t) => ehTesouro(t) || /^(CDI(-\d+([.,]\d+)?)?|SELIC|IPCA\+\d+([.,]\d+)?|PRE-\d+([.,]\d+)?)$/.test(t)
export const fracionario = (t) => ehCripto(t) || ehRendaFixa(t)
