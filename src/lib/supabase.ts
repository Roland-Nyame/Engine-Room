import { createClient } from '@supabase/supabase-js'

// GitHub Pages builds do not read a local .env.local file. Keep these
// frontend-safe defaults so the deployed app can connect without manual setup.
// The publishable/anon key is intended for browser use; database RLS remains
// responsible for protecting private records. Never place a service-role key here.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  || 'https://uyjtbrkbwpoqjctwothe.supabase.co'
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  || 'sb_publishable_mjGf3ldN_2hwNrSQyvBszw_WPGBxPUP'

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
