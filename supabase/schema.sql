-- Carteiras do Home Broker sincronizadas por usuário (login do Supabase Auth).
-- Cada linha é uma carteira inteira (operações, alvos, alertas...) em JSON, como no localStorage do navegador.
create table if not exists public.carteiras (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  dados      jsonb not null,
  atualizada timestamptz not null default now(),
  excluida   boolean not null default false,  -- exclusão sincroniza entre aparelhos sem perder o registro
  primary key (user_id, id)
);

alter table public.carteiras enable row level security;

-- cada usuário só enxerga e altera as próprias carteiras
drop policy if exists "carteiras do dono: ler" on public.carteiras;
drop policy if exists "carteiras do dono: inserir" on public.carteiras;
drop policy if exists "carteiras do dono: alterar" on public.carteiras;
drop policy if exists "carteiras do dono: apagar" on public.carteiras;
create policy "carteiras do dono: ler" on public.carteiras for select to authenticated using (user_id = (select auth.uid()));
create policy "carteiras do dono: inserir" on public.carteiras for insert to authenticated with check (user_id = (select auth.uid()));
create policy "carteiras do dono: alterar" on public.carteiras for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "carteiras do dono: apagar" on public.carteiras for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.carteiras from anon;
grant select, insert, update, delete on public.carteiras to authenticated;
