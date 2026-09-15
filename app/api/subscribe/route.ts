import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
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

    const { error } = await supabase
      .from('subscriptions')
      .upsert(
        {
          endpoint: subscription.endpoint,
          keys_auth: subscription.keys.auth,
          keys_p256dh: subscription.keys.p256dh
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