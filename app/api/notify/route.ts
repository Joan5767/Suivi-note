import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { title, importance } = await request.json();
    const icon = importance === 'rouge' ? '🔴' : importance === 'orange' ? '🟠' : '🟢';
    const color = importance === 'rouge' ? '#ef4444' : importance === 'orange' ? '#f97316' : '#22c55e';

    await resend.emails.send({
      from: 'Rappels <onboarding@resend.dev>',
      to: process.env.NOTIFICATION_EMAIL!,
      subject: `📝 NOUVELLE NOTE : ${title}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px;">
          <h2 style="color: #374151;">Nouvelle note ajoutée au système</h2>
          <div style="padding: 15px; background-color: #f9fafb; border-radius: 5px; border-left: 4px solid ${color}; margin: 20px 0;">
            <span style="font-size: 18px; color: #111827;">${icon} <b>${title}</b></span>
          </div>
          <a href="https://suivi-note-henna.vercel.app" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Ouvrir l'application
          </a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de l'envoi" }, { status: 500 });
  }
}