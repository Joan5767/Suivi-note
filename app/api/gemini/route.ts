import { NextResponse } from 'next/server';

type Importance = 'vert' | 'orange' | 'rouge';

type AiResult = {
  title: string;
  content: string;
  importance: Importance;
  is_list: boolean;
  list_items: string[];
  calendar_time: string | null;
  popup_time: string | null;
  send_email: boolean;
  daily_reminder: boolean;
  daily_reminder_time: string | null;
  daily_reminder_email: boolean;
  daily_reminder_popup: boolean;
};

const cleanString = (value: unknown, maxLength = 4000) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const cleanNullableString = (value: unknown) => {
  const cleaned = cleanString(value, 100);
  return cleaned || null;
};

const cleanBoolean = (value: unknown) => value === true;

const cleanListItems = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map(item => item.slice(0, 300));
};

const normalizeResult = (raw: any): AiResult => {
  const listItems = cleanListItems(raw?.list_items);
  const isList = cleanBoolean(raw?.is_list) || listItems.length > 0;

  const importance: Importance =
    raw?.importance === 'rouge' || raw?.importance === 'orange' || raw?.importance === 'vert'
      ? raw.importance
      : 'vert';

  let dailyReminder = cleanBoolean(raw?.daily_reminder);
  let dailyReminderEmail = cleanBoolean(raw?.daily_reminder_email);
  let dailyReminderPopup = cleanBoolean(raw?.daily_reminder_popup);

  // Si le modèle comprend qu'il faut une relance quotidienne mais n'a pas choisi de canal,
  // on privilégie la notification push plutôt que l'e-mail.
  if (dailyReminder && !dailyReminderEmail && !dailyReminderPopup) {
    dailyReminderPopup = true;
  }

  if (dailyReminderEmail || dailyReminderPopup) {
    dailyReminder = true;
  }

  const dailyTime =
    typeof raw?.daily_reminder_time === 'string' && /^\d{2}:\d{2}$/.test(raw.daily_reminder_time)
      ? raw.daily_reminder_time
      : dailyReminder
        ? '09:00'
        : null;

  return {
    title: cleanString(raw?.title, 200),
    content: cleanString(raw?.content, 5000),
    importance,
    is_list: isList,
    list_items: isList ? listItems : [],
    calendar_time: cleanNullableString(raw?.calendar_time),
    popup_time: cleanNullableString(raw?.popup_time),
    send_email: cleanBoolean(raw?.send_email),
    daily_reminder: dailyReminder,
    daily_reminder_time: dailyTime,
    daily_reminder_email: dailyReminderEmail,
    daily_reminder_popup: dailyReminderPopup,
  };
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const text = cleanString(body?.text, 12000);
    const currentDate = cleanString(body?.currentDate, 200);
    const timeZone = cleanString(body?.timeZone, 100) || 'Europe/Paris';
    const timezoneOffsetMinutes = Number.isFinite(Number(body?.timezoneOffsetMinutes))
      ? Number(body.timezoneOffsetMinutes)
      : null;

    if (!text) {
      return NextResponse.json({ error: "La dictée est vide." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "La clé GEMINI_API_KEY est introuvable sur Vercel." },
        { status: 500 }
      );
    }

    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';

    const prompt = `Tu es le moteur de compréhension d'une application de notes, rappels et productivité.
Tu dois convertir UNE dictée utilisateur en JSON, sans texte supplémentaire.

CONTEXTE TEMPOREL
- Date/heure locale fournie par l'application : ${currentDate || 'inconnue'}
- Fuseau IANA : ${timeZone}
- getTimezoneOffset() : ${timezoneOffsetMinutes ?? 'inconnu'} minutes
- Pour toute date/heure calculée, respecte le fuseau local de l'utilisateur.
- Les dates retournées doivent être en ISO 8601 avec décalage explicite, par exemple 2026-09-15T17:00:00+02:00.
- Si l'utilisateur dit seulement « à 17h » : choisis aujourd'hui si 17h n'est pas encore passé, sinon le prochain jour pertinent.

DICTÉE UTILISATEUR
<<<${text}>>>

RÈGLES
1. Ne répète jamais dans title/content les instructions techniques déjà extraites (rappel, heure, agenda, e-mail).
2. title : résumé court et naturel.
3. content : détails utiles qui ne sont pas déjà dans title/list_items.
4. importance : rouge uniquement si réellement urgent/échéance immédiate, orange si important, sinon vert.
5. Si l'utilisateur énumère plusieurs choses à faire/acheter/vérifier : is_list=true et chaque élément va dans list_items.
6. Pour une liste, ne recopie pas toute la liste dans content.
7. popup_time : rappel ponctuel demandé par « rappelle-moi », « alarme », « préviens-moi », « dans X minutes », etc.
8. calendar_time : uniquement si l'utilisateur demande explicitement agenda/calendrier/rendez-vous/événement.
9. send_email=true uniquement si l'utilisateur demande explicitement un e-mail immédiat.
10. daily_reminder=true uniquement pour une répétition quotidienne.
11. Pour une relance quotidienne :
   - daily_reminder_popup=true par défaut pour « rappelle-moi tous les jours » ;
   - daily_reminder_email=true uniquement si l'utilisateur demande un e-mail quotidien ;
   - les deux peuvent être true s'il demande les deux.
12. daily_reminder_time au format HH:mm, sinon null quand il n'y a pas de relance quotidienne.
13. Une valeur non demandée doit être null, false ou [] selon son type.

OBJET JSON ATTENDU
{
  "title": "string",
  "content": "string",
  "importance": "vert|orange|rouge",
  "is_list": false,
  "list_items": [],
  "calendar_time": null,
  "popup_time": null,
  "send_email": false,
  "daily_reminder": false,
  "daily_reminder_time": null,
  "daily_reminder_email": false,
  "daily_reminder_popup": false
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.error) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      return NextResponse.json({ error: `Refus de Google : ${message}` }, { status: 502 });
    }

    const jsonText = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    if (!jsonText) {
      return NextResponse.json(
        { error: "Gemini n'a renvoyé aucune proposition exploitable." },
        { status: 502 }
      );
    }

    let rawResult: any;
    try {
      rawResult = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "Gemini a renvoyé un JSON invalide." },
        { status: 502 }
      );
    }

    const result = normalizeResult(rawResult);

    if (!result.title && !result.content && result.list_items.length === 0) {
      return NextResponse.json(
        { error: "La proposition IA est vide. Reformule la dictée." },
        { status: 422 }
      );
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { error: "Gemini met trop de temps à répondre. Réessaie." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: `Crash du serveur : ${error?.message || 'erreur inconnue'}` },
      { status: 500 }
    );
  }
}
