import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
if (!supabaseUrl) {
  console.warn('SUPABASE_URL is not set. Copy .env.example to .env and add your project URL.')
}

export const supabase = createClient(supabaseUrl || '', process.env.SUPABASE_ANON_KEY || '', {
  auth: { persistSession: true },
})
