import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Non autorisé', { status: 401 });
  }

  // On récupère uniquement les tâches non complétées, non archivées, avec rappel actif
  const { data: pendingNotes, error } = await supabase
    .from('notes')
    .select('*')
    .eq('completed', false)
    .eq('is_archived', false)
    .eq('reminder_active', true);

  if (error || !pendingNotes || pendingNotes.length === 0) {
    return NextResponse.json({ message: 'Aucune relance nécessaire' });
  }

  // Création d'une liste visuelle avec l'émoji correspondant à l'importance
  const listItems = pendingNotes.map(n => {
    const icon = n.importance === 'rouge' ? '🔴' : n.importance === 'orange' ? '🟠' : '🟢';
    return `<li style="margin-bottom: 10px; padding: 10px; background-color: white; border-radius: 5px; border-left: 4px solid ${n.importance === 'rouge' ? '#ef4444' : n.importance === 'orange' ? '#f97316' : '#22c55e'};">${icon} <b>${n.title}</b></li>`;
  }).join('');

  // Envoi de l'e-mail avec un template HTML stylisé
  await resend.emails.send({
    from: 'Rappels <onboarding@resend.dev>',
    to: process.env.NOTIFICATION_EMAIL!,
    subject: `🚨 NOTE / RAPPEL : ${pendingNotes.length} tâche(s) en attente 🚨`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #e5e7eb; border-radius: 10px; overflow: hidden; background-color: #f9fafb;">
        <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; text-transform: uppercase;">🔔 C'est l'heure du rappel 🔔</h1>
        </div>
        
        <div style="padding: 30px 20px;">
          <p style="font-size: 18px; color: #374151; margin-top: 0;">Tu as <b>${pendingNotes.length}</b> tâche(s) qui requièrent ton attention :</p>
          
          <ul style="font-size: 16px; color: #111827; list-style-type: none; padding-left: 0;">
            ${listItems}
          </ul>
          
          <div style="margin-top: 40px; text-align: center;">
            <a href="https://suivi-note-henna.vercel.app" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px;">
              👉 Ouvrir mes notes
            </a>
          </div>
        </div>
      </div>
    `,
  });

  return NextResponse.json({ success: true, count: pendingNotes.length });
}