'use client';
import { createBrowserClient } from '@supabase/ssr';
let instance: ReturnType<typeof createBrowserClient> | undefined;
export function browserClient() {
  return (instance ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ));
}
