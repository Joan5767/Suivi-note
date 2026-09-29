import 'server-only';

import webpush from 'web-push';
import { getSupabaseAdmin } from './supabase-admin';

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type SubscriptionRow = {
  id: number | string;
  endpoint: string;
  keys_auth: string;
  keys_p256dh: string;
  user_id: string;
};

let vapidConfigured = false;

const configureVapid = () => {
  if (vapidConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const contact = process.env.NOTIFICATION_EMAIL?.trim() || 'noreply@example.com';
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(`mailto:${contact}`, publicKey, privateKey);
  vapidConfigured = true;
  return true;
};

export const sendPushToUsers = async (userIds: string[], payload: PushPayload) => {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return { sent: 0, errors: [] as string[] };
  if (!configureVapid()) return { sent: 0, errors: ['Clés VAPID manquantes.'] };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('subscriptions')
    .select('id, endpoint, keys_auth, keys_p256dh, user_id')
    .in('user_id', uniqueUserIds);

  if (error) return { sent: 0, errors: [error.message] };

  const subscriptions = Array.from(
    new Map(((data || []) as SubscriptionRow[]).map(item => [item.endpoint, item])).values()
  );
  let sent = 0;
  const errors: string[] = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            auth: subscription.keys_auth,
            p256dh: subscription.keys_p256dh,
          },
        },
        JSON.stringify({ ...payload, timestamp: Date.now() }),
        { urgency: 'high', TTL: 300 }
      );
      sent += 1;
    } catch (pushError: any) {
      errors.push(pushError?.message || 'Erreur push inconnue');
      if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
        await admin.from('subscriptions').delete().eq('id', subscription.id);
      }
    }
  }

  return { sent, errors };
};

