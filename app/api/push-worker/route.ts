import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';
import { sendPushToUsers } from '@/lib/server/push';

const supabase = getSupabaseAdmin();

const APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || 'Europe/Paris';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://suivi-note-henna.vercel.app';
const PUSH_WORKER_SECRET = process.env.PUSH_WORKER_SECRET?.trim() || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL?.trim() || '';
const NOTIFICATION_FROM =
  process.env.NOTIFICATION_FROM?.trim() || 'Rappels <onboarding@resend.dev>';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type NoteRow = {
  id: string;
  owner_id?: string | null;
  space_id?: string | null;
  assigned_to?: string | null;
  title?: string | null;
  content?: string | null;
  completed?: boolean | null;
  is_archived?: boolean | null;
  popup_active?: boolean | null;
  target_date?: string | null;
  reminder_active?: boolean | null;
  reminder_popup_active?: boolean | null;
  daily_reminder_time?: string | null;
  last_email_reminded_at?: string | null;
  last_popup_reminded_at?: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const localParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');

  return {
    dateKey: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
};

const parseReminderMinutes = (value?: string | null) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return 9 * 60;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 9 * 60;

  return hours * 60 + minutes;
};

const wasSentToday = (timestamp: string | null | undefined, now: Date) => {
  if (!timestamp) return false;
  const sentAt = new Date(timestamp);
  if (Number.isNaN(sentAt.getTime())) return false;
  return localParts(sentAt).dateKey === localParts(now).dateKey;
};

const isAuthorized = (request: Request) => {
  if (!PUSH_WORKER_SECRET) return false;
  return request.headers.get('authorization') === `Bearer ${PUSH_WORKER_SECRET}`;
};

const getRecipientIds = async (note: NoteRow): Promise<string[]> => {
  if (note.assigned_to) return [note.assigned_to];
  if (note.space_id) {
    const { data, error } = await supabase
      .from('space_members')
      .select('user_id')
      .eq('space_id', note.space_id);
    if (error) throw error;
    const userIds = ((data || []) as Array<{ user_id: string }>).map(row => String(row.user_id));
    return Array.from(new Set<string>(userIds));
  }
  return note.owner_id ? [note.owner_id] : [];
};

const sendPush = async (note: NoteRow, titlePrefix: string) => {
  const recipients = await getRecipientIds(note);
  if (recipients.length === 0) return { success: false, sent: 0, error: 'Aucun destinataire.' };
  const result = await sendPushToUsers(recipients, {
    title: `${titlePrefix}${note.title || 'Note'}`,
    body: note.content || 'Tu as une tâche à traiter.',
    url: `/#note-${encodeURIComponent(note.id)}`,
    tag: `note-${note.id}`,
  });
  return {
    success: result.sent > 0,
    sent: result.sent,
    error: result.sent > 0 ? null : result.errors.join(' | ') || 'Aucun push envoyé.',
  };
};

const sendDailyEmail = async (note: NoteRow) => {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return { success: false, error: 'Configuration Resend manquante.' };
  }
  const resend = new Resend(resendApiKey);

  const recipientIds = await getRecipientIds(note);
  const recipientEmails: string[] = [];
  for (const userId of recipientIds) {
    const { data } = await supabase.auth.admin.getUserById(userId);
    if (data.user?.email) recipientEmails.push(data.user.email);
  }
  if (recipientEmails.length === 0 && NOTIFICATION_EMAIL) recipientEmails.push(NOTIFICATION_EMAIL);
  if (recipientEmails.length === 0) return { success: false, error: 'Aucun e-mail destinataire.' };

  const safeTitle = escapeHtml(note.title || 'Note');
  const safeContent = escapeHtml(note.content || '').replaceAll('\n', '<br/>');

  const { error } = await resend.emails.send({
    from: NOTIFICATION_FROM,
    to: Array.from(new Set(recipientEmails)),
    subject: `🔔 Rappel : ${note.title || 'Note'}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background: #111827; color: white; padding: 16px 20px;">
            <strong>Rappel quotidien</strong>
          </div>
          <div style="padding: 20px;">
            <h2 style="margin: 0 0 12px; color: #111827;">${safeTitle}</h2>
            ${safeContent ? `<p style="color: #374151; line-height: 1.5;">${safeContent}</p>` : ''}
            <a href="${APP_URL}" style="display:inline-block;margin-top:12px;background:#2563eb;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;">
              Ouvrir l'application
            </a>
          </div>
        </div>
      </div>
    `,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
};

async function runReminderEngine() {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowLocal = localParts(now);

  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('completed', false)
    .eq('is_archived', false);

  if (error) throw error;

  const notes = (data || []) as NoteRow[];

  let oneTimePushes = 0;
  let dailyPushes = 0;
  let dailyEmails = 0;
  const errors: string[] = [];

  for (const note of notes) {
    // 1) Alarme ponctuelle : target_date + popup_active.
    if (note.popup_active && note.target_date) {
      const target = new Date(note.target_date);

      if (!Number.isNaN(target.getTime()) && target.getTime() <= now.getTime()) {
        const push = await sendPush(note, '⏰ Rappel : ');

        if (push.success) {
          oneTimePushes += push.sent;
          const { error: updateError } = await supabase
            .from('notes')
            .update({ popup_active: false })
            .eq('id', note.id);

          if (updateError) errors.push(`Note ${note.id}: ${updateError.message}`);
        } else if (push.error) {
          errors.push(`Alarme ponctuelle ${note.id}: ${push.error}`);
        }
      }
    }

    // 2) Relances quotidiennes à l'heure choisie.
    const reminderMinutes = parseReminderMinutes(note.daily_reminder_time);
    if (nowLocal.minutes < reminderMinutes) continue;

    const updates: Record<string, string> = {};

    if (note.reminder_active && !wasSentToday(note.last_email_reminded_at, now)) {
      const email = await sendDailyEmail(note);
      if (email.success) {
        dailyEmails += 1;
        updates.last_email_reminded_at = nowIso;
      } else if (email.error) {
        errors.push(`E-mail quotidien ${note.id}: ${email.error}`);
      }
    }

    if (
      note.reminder_popup_active &&
      !wasSentToday(note.last_popup_reminded_at, now)
    ) {
      const push = await sendPush(note, '🔄 Rappel quotidien : ');
      if (push.success) {
        dailyPushes += push.sent;
        updates.last_popup_reminded_at = nowIso;
      } else if (push.error) {
        errors.push(`Push quotidien ${note.id}: ${push.error}`);
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('notes')
        .update({ ...updates, last_reminded_at: nowIso })
        .eq('id', note.id);

      if (updateError) errors.push(`Sauvegarde rappel ${note.id}: ${updateError.message}`);
    }
  }

  return {
    success: true,
    timezone: APP_TIMEZONE,
    local_time: nowLocal.time,
    notes_checked: notes.length,
    one_time_pushes: oneTimePushes,
    daily_pushes: dailyPushes,
    daily_emails: dailyEmails,
    errors,
    time: nowIso,
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const result = await runReminderEngine();
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Erreur inconnue' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: 'Le moteur de rappels accepte uniquement les appels POST authentifiés.',
      timezone: APP_TIMEZONE,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
