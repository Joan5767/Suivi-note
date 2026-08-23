import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Renseigne tes clés VAPID configurées sur Vercel
webpush.setVapidDetails(
  'mailto:ton.email@exemple.com', // Mets ton adresse mail ici !
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

export const dynamic = 'force-dynamic'; // Empêche Vercel de mettre cette page en cache

export async function GET() {
  try {
    const now = new Date().toISOString();
    
    // 1. Trouver les notes qui doivent sonner
    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('popup_active', true)
      .lte('target_date', now);

    if (notesError) throw notesError;
    if (!notes || notes.length === 0) {
      return NextResponse.json({ status: "Aucune alarme en attente" });
    }

    // 2. Récupérer les téléphones inscrits
    const { data: subs, error: subError } = await supabase.from('subscriptions').select('*');
    if (subError) throw subError;

    // 3. Envoyer la notification native en arrière-plan
    for (const note of notes) {
      const payload = JSON.stringify({
        title: '⏰ Rappel : ' + (note.title || 'Note'),
        body: note.content || 'Il est l\'heure !',
        url: '/'
      });

      if (subs) {
        for (const sub of subs) {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              auth: sub.keys_auth,
              p256dh: sub.keys_p256dh
            }
          };
          try {
            await webpush.sendNotification(pushSubscription, payload);
          } catch (err) {
            console.error("Le téléphone a rejeté la notification :", err);
          }
        }
      }
      
      // 4. Désactiver l'alarme dans la base
      await supabase.from('notes').update({ popup_active: false }).eq('id', note.id);
    }

    return NextResponse.json({ success: true, alarmes_sonnees: notes.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
