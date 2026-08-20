import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const { title } = await request.json();

  if (!title) {
    return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
  }

  // 1. Sauvegarde en BDD
  const { data, error } = await supabase
    .from('notes')
    .insert([{ title }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2. Email de confirmation direct
  await resend.emails.send({
    from: 'Rappels <onboarding@resend.dev>',
    to: process.env.NOTIFICATION_EMAIL!,
    subject: `Nouvelle note ajoutée : ${title}`,
    text: `Ta note "${title}" a été enregistrée. Tu recevras des rappels réguliers tant qu'elle n'est pas cochée.`,
  });

  return NextResponse.json(data);
}