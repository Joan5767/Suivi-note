import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/server/api-auth';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.error) return auth.error;

  try {
    const subscription = await req.json();

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.auth ||
      !subscription?.keys?.p256dh
    ) {
      return NextResponse.json(
        { error: 'Abonnement push invalide' },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseAdmin()
      .from('subscriptions')
      .upsert(
        {
          user_id: auth.user.id,
          endpoint: subscription.endpoint,
          keys_auth: subscription.keys.auth,
          keys_p256dh: subscription.keys.p256dh,
          device_label: req.headers.get('user-agent')?.slice(0, 180) || 'Appareil',
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'endpoint'
        }
      );

    if (error) throw error;

    return NextResponse.json({ success: true });

  } catch (e: any) {
    return NextResponse.json(
      { error: e.message },
      { status: 500 }
    );
  }
}
