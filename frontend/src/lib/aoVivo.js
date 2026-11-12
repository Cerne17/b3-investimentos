// Atualização periódica de cotações sem acordar o servidor à toa: cada consulta é uma chamada de função na Vercel.
// Só atualiza com a aba visível, com alguém mexendo na página nos últimos 15 minutos e, para ativos da B3, no
// horário do pregão (cripto negocia o tempo todo). Ao voltar para a aba, atualiza na hora se o dado já envelheceu.
import { useEffect, useRef } from 'react'

const INTERVALO = 60000
const OCIOSO = 15 * 60000

let ultimaAtividade = Date.now()
if (typeof window !== 'undefined') {
  const marcar = () => { ultimaAtividade = Date.now() }
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, marcar, { passive: true })
}

// pregão da B3 (10h às 18h30 de Brasília, dias úteis; feriados não entram) com folga para o leilão de fechamento
export function pregaoAberto(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(agora).map((x) => [x.type, x.value]))
  const min = Number(p.hour) * 60 + Number(p.minute)
  return !['Sat', 'Sun'].includes(p.weekday) && min >= 9 * 60 + 55 && min <= 18 * 60 + 40
}

export const temCripto = (tickers) => tickers.some((t) => /-(BRL|USD)$/i.test(t))

// load() roda já, e de novo a cada minuto enquanto valer a pena; deps como no useEffect
export function useAoVivo(load, deps, { ligado = true, cripto = false } = {}) {
  const ref = useRef(load)
  ref.current = load
  useEffect(() => {
    let ultima = Date.now()
    const rodar = () => { ultima = Date.now(); ref.current() }
    rodar()
    if (!ligado) return
    const vale = () => document.visibilityState === 'visible' && Date.now() - ultimaAtividade < OCIOSO && (cripto || pregaoAberto())
    const id = setInterval(() => vale() && rodar(), INTERVALO)
    const voltou = () => { if (vale() && Date.now() - ultima >= INTERVALO) rodar() }
    document.addEventListener('visibilitychange', voltou)
    window.addEventListener('focus', voltou)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', voltou); window.removeEventListener('focus', voltou) }
  }, [...deps, ligado, cripto])
}
