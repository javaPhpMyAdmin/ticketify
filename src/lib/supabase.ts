import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ExtraConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

const supabaseUrl = extra.supabaseUrl ?? '';
const supabaseAnonKey = extra.supabaseAnonKey ?? '';

/**
 * The client is created even when env vars are missing so importing this
 * module never throws. Calls will fail loudly with a network error and
 * the placeholder values from `app.json` are obvious enough to spot.
 *
 * Once we add `supabase gen types typescript` we'll parameterize this with
 * the generated `Database` type for end-to-end type safety.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('YOUR-PROJECT'),
);
