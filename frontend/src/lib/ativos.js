// Classificação de tickers que não estão na base: cripto em reais (BTC-BRL) e renda fixa sintética (CDI, IPCA+6...)
export const ehCripto = (t) => /-(BRL|USD|USDT|EUR)$/.test(t)
export const ehRendaFixa = (t) => /^(CDI(-\d+([.,]\d+)?)?|SELIC|IPCA\+\d+([.,]\d+)?|PRE-\d+([.,]\d+)?)$/.test(t)
export const fracionario = (t) => ehCripto(t) || ehRendaFixa(t)
