import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Vérifie que SUPABASE_ANON_KEY est disponible (nécessaire pour les clients par utilisateur)
if (!process.env.SUPABASE_ANON_KEY) {
  console.warn('[Supabase] SUPABASE_ANON_KEY manquant — la multi-tenancy ne fonctionnera pas')
}
