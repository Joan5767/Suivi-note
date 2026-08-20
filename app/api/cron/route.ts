import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: Request) {
  // Sécurisation du cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Non autorisé', { status: 401 });
  }

  // Récupérer les tâches non terminées
  const { data: pendingNotes, error } = await supabase
    .from('notes')
    .select('*')
    .eq('completed', false);

  if (error || !pendingNotes || pendingNotes.length === 0) {
    return NextResponse.json({ message: 'Aucune relance nécessaire' });
  }

  const listItems = pendingNotes.map(n => `- ${n.title}`).join('\n');

  // Envoi du mail de rappel
  await resend.emails.send({
    from: 'Rappels <onboarding@resend.dev>',
    to: process.env.NOTIFICATION_EMAIL!,
    subject: `⚠️ Rappel : ${pendingNotes.length} tâche(s) en attente`,
    text: `N'oublie pas de réaliser et cocher ces tâches :\n\n${listItems}`,
  });

  return NextResponse.json({ success: true, count: pendingNotes.length });
}