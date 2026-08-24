import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Renseigne ton email ici
webpush.setVapidDetails(
  'mailto:ton.email@exemple.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date().toISOString();
    
    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('popup_active', true)
      .lte('target_date', now);

    if (notesError) throw notesError;
    if (!notes || notes.length === 0) {
      return NextResponse.json({ status: "Aucune alarme en attente" });
    }

    const { data: subs, error: subError } = await supabase.from('subscriptions').select('*');
    if (subError) throw subError;

    let succesCount = 0;
    let erreurDetails = [];

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
            succesCount++;
          } catch (err: any) {
            // CETTE FOIS ON AFFICHE LA VRAIE ERREUR
            erreurDetails.push(err.message || 'Erreur Google FCM');
            
            // Si le téléphone a désactivé les notifs, on supprime l'ancien abonnement
            if (err.statusCode === 410 || err.statusCode === 404) {
               await supabase.from('subscriptions').delete().eq('id', sub.id);
            }
          }
        }
      }
      
      await supabase.from('notes').update({ popup_active: false }).eq('id', note.id);
    }

    return NextResponse.json({ 
      success: true, 
      telephones_sonnes: succesCount,
      erreurs_google: erreurDetails 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
