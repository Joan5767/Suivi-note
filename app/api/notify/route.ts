import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireApiUser } from '@/lib/server/api-auth';

const isDemo =
  process.env.DEMO_MODE === 'true' ||
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export async function POST(request: Request) {
  if (isDemo) {
    return NextResponse.json({
      success: false,
      demo: true,
      message: 'Fonction désactivée en mode démonstration.',
    });
  }

  const auth = await requireApiUser(request);
  if (auth.error) return auth.error;

  try {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const notificationEmail = auth.user.email?.trim();

    if (!apiKey || !notificationEmail) {
      return NextResponse.json(
        { error: 'Configuration e-mail manquante.' },
        { status: 503 }
      );
    }

    const { title: rawTitle, importance } = await request.json();
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 200) : '';
    if (!title) return NextResponse.json({ error: 'Titre requis.' }, { status: 400 });
    const safeTitle = title
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    const icon = importance === 'rouge' ? '🔴' : importance === 'orange' ? '🟠' : '🟢';
    const color = importance === 'rouge' ? '#ef4444' : importance === 'orange' ? '#f97316' : '#22c55e';
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: process.env.NOTIFICATION_FROM?.trim() || 'Rappels <onboarding@resend.dev>',
      to: notificationEmail,
      subject: `📝 NOUVELLE TÂCHE : ${title}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px;">
          <h2 style="color: #374151;">Nouvelle tâche ajoutée</h2>
          <div style="padding: 15px; background-color: #f9fafb; border-radius: 5px; border-left: 4px solid ${color}; margin: 20px 0;">
            <span style="font-size: 18px; color: #111827;">${icon} <b>${safeTitle}</b></span>
          </div>
        </div>
      `,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erreur lors de l'envoi" },
      { status: 500 }
    );
  }
}
