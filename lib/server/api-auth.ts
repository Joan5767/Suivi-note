import 'server-only';

import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase-admin';

export type ApiAuthResult =
  | { user: User; error: null }
  | { user: null; error: Response };

export const requireApiUser = async (request: Request): Promise<ApiAuthResult> => {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

  if (!token) {
    return {
      user: null,
      error: Response.json({ error: 'Authentification requise.' }, { status: 401 }),
    };
  }

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    return {
      user: null,
      error: Response.json({ error: 'Session invalide ou expirée.' }, { status: 401 }),
    };
  }

  return { user: data.user, error: null };
};

