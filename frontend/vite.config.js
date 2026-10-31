import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em dev, /api é redirecionado para o backend FastAPI
// envDir na raiz (o .env.local do `vercel env pull` fica lá); NEXT_PUBLIC_ porque é o prefixo das variáveis
// públicas que a integração do Supabase cria na Vercel (URL e chave publicável — nunca a secreta)
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/docs': 'http://localhost:8000', '/openapi.json': 'http://localhost:8000' },
  },
})
