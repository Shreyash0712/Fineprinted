import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Plain anon-key client for public pages. No cookies/session — RLS limits
 * it to published data, and skipping cookies() keeps public pages
 * statically cacheable (ISR).
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
