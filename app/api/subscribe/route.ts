import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
  try {
    const subscription = await req.json();
    
    // Vérifie si l'abonnement existe déjà pour éviter les doublons
    const { data } = await supabase.from('subscriptions')
      .select('*')
      .eq('endpoint', subscription.endpoint)
      .single();

    if (!data) {
      const { error } = await supabase.from('subscriptions').insert([{
        endpoint: subscription.endpoint,
        keys_auth: subscription.keys.auth,
        keys_p256dh: subscription.keys.p256dh
      }]);
      if (error) throw error;
    }
    
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
