import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireApiUser } from '@/lib/server/api-auth';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.error) return auth.error;

  const { title } = await request.json();

  if (!title) {
    return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
  }

  // 1. Sauvegarde en BDD
  const { data, error } = await getSupabaseAdmin()
    .from('notes')
    .insert([{ title, owner_id: auth.user.id, created_by: auth.user.id, updated_by: auth.user.id }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2. Email de confirmation direct
  if (!auth.user.email) {
    return NextResponse.json(data);
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: process.env.NOTIFICATION_FROM?.trim() || 'Rappels <onboarding@resend.dev>',
      to: auth.user.email,
      subject: `Nouvelle note ajoutée : ${title}`,
      text: `Ta note "${title}" a été enregistrée. Tu recevras des rappels réguliers tant qu'elle n'est pas cochée.`,
    });
  }

  return NextResponse.json(data);
}
