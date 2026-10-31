// Login (link mágico por e-mail) e sincronização das carteiras do Home Broker com o Supabase.
// Sem login tudo continua só no navegador (localStorage); com login, cada carteira vira uma linha da tabela
// public.carteiras (RLS: só o dono lê e grava) e a versão mais recente de cada uma vence nos dois sentidos.
import { createClient } from '@supabase/supabase-js'

const URL_SB = import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const CHAVE = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = URL_SB && CHAVE
  ? createClient(URL_SB, CHAVE, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  : null

export async function entrar(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { emailRedirectTo: `${window.location.origin}/#broker` },
  })
  if (error) throw error
}

export const sair = () => supabase.auth.signOut()

// junta local e nuvem: por id, fica a versão com `atualizada` mais recente; exclusões também sincronizam
export async function sincronizar(local) {
  const { data, error } = await supabase.from('carteiras').select('id, dados, atualizada, excluida')
  if (error) throw error
  const remotas = new Map(data.map((r) => [r.id, r]))
  const excluidas = new Set(local.excluidas || [])
  const carteiras = [], subir = []
  for (const c of local.carteiras) {
    const r = remotas.get(c.id)
    const tLocal = c.atualizada || c.criada || '1970-01-01'
    if (r && new Date(r.atualizada) > new Date(tLocal)) {
      if (!r.excluida) carteiras.push(r.dados)
    } else {
      carteiras.push(c)
      if (!r || new Date(tLocal) > new Date(r.atualizada)) subir.push({ id: c.id, dados: c, atualizada: tLocal, excluida: false })
    }
    remotas.delete(c.id)
  }
  for (const r of remotas.values()) {  // existe só na nuvem
    if (excluidas.has(r.id)) { if (!r.excluida) subir.push({ id: r.id, dados: r.dados, atualizada: new Date().toISOString(), excluida: true }) }
    else if (!r.excluida) carteiras.push(r.dados)
  }
  for (const id of excluidas) {
    if (!data.some((r) => r.id === id)) continue
    if (!subir.some((s) => s.id === id)) subir.push({ id, dados: data.find((r) => r.id === id).dados, atualizada: new Date().toISOString(), excluida: true })
  }
  if (subir.length) {
    const { error: e2 } = await supabase.from('carteiras').upsert(subir, { onConflict: 'user_id,id' })
    if (e2) throw e2
  }
  const ativa = carteiras.some((c) => c.id === local.ativa) ? local.ativa : carteiras[0]?.id || null
  return { ativa, carteiras, excluidas: [], subidas: subir.length }
}
