import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/server/api-auth';
import { sendPushToUsers } from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

type EntityType = 'note' | 'memo' | 'planning';

const ENTITY_TABLES: Record<EntityType, string> = {
  note: 'notes',
  memo: 'memo_notes',
  planning: 'planning_templates',
};

const cleanText = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const entityType = body?.entityType as EntityType;
    const entityId = cleanText(body?.entityId, 200);
    const requestedTitle = cleanText(body?.title, 180);
    const requestedBody = cleanText(body?.body, 500);

    if (!ENTITY_TABLES[entityType] || !entityId) {
      return NextResponse.json({ error: 'Élément partagé invalide.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const selectColumns = entityType === 'note'
      ? 'id, owner_id, space_id, assigned_to, title'
      : entityType === 'planning'
        ? 'id, owner_id, space_id, name'
        : 'id, owner_id, space_id, title';
    const { data: entity, error: entityError } = await admin
      .from(ENTITY_TABLES[entityType])
      .select(selectColumns)
      .eq('id', entityId)
      .maybeSingle();

    if (entityError || !entity) {
      return NextResponse.json({ error: 'Élément introuvable.' }, { status: 404 });
    }
    if (!entity.space_id) {
      return NextResponse.json({ error: "L'élément n'est pas partagé." }, { status: 400 });
    }

    const { data: actorMembership } = await admin
      .from('space_members')
      .select('user_id')
      .eq('space_id', entity.space_id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (entity.owner_id !== auth.user.id && !actorMembership) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
    }

    const { data: memberRows, error: memberError } = await admin
      .from('space_members')
      .select('user_id')
      .eq('space_id', entity.space_id)
      .neq('user_id', auth.user.id);

    if (memberError) throw memberError;

    let recipients: string[] = (memberRows || []).map((row: { user_id: string }) => String(row.user_id));
    const assignedTo = entityType === 'note' ? (entity as any).assigned_to : null;
    if (assignedTo && assignedTo !== auth.user.id) {
      recipients = recipients.filter((userId: string) => userId === assignedTo);
    }

    const fallbackName = cleanText((entity as any).title || (entity as any).name, 180) || 'Élément partagé';
    const title = requestedTitle || `${auth.user.user_metadata?.display_name || 'Un proche'} t’a partagé un élément`;
    const notificationBody = requestedBody || fallbackName;

    if (recipients.length > 0) {
      const { error: notificationError } = await admin
        .from('collaboration_notifications')
        .insert(recipients.map((recipientId: string) => ({
          recipient_id: recipientId,
          actor_id: auth.user.id,
          space_id: entity.space_id,
          notification_type: 'shared_item',
          title,
          body: notificationBody,
          entity_type: entityType,
          entity_id: entityId,
        })));
      if (notificationError) throw notificationError;
    }

    const url = entityType === 'note'
      ? `/#note-${encodeURIComponent(entityId)}`
      : entityType === 'planning'
        ? '/#planning'
        : '/#notes';
    const push = await sendPushToUsers(recipients, {
      title,
      body: notificationBody,
      url,
      tag: `shared-${entityType}-${entityId}`,
    });

    return NextResponse.json({ success: true, recipients: recipients.length, pushes: push.sent });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Impossible d'envoyer la notification." },
      { status: 500 }
    );
  }
}
