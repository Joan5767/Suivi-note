import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, currentDate } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json({ error: "La clé GEMINI_API_KEY est introuvable sur Vercel." }, { status: 500 });
    }

    const prompt = `Tu es l'assistant intelligent d'une application de productivité. L'utilisateur a dicté ce texte : "${text}".
    Aujourd'hui nous sommes le : ${currentDate}.
    
    Ton unique rôle est d'analyser la demande et de la convertir STRICTEMENT en un objet JSON valide.
    RÈGLE ABSOLUE : Extrais les informations de configuration (dates, heures, e-mails, rappels) pour remplir les clés spécifiques, et NE LES RÉPÈTE PAS dans le titre ou le contenu.
    
    Propriétés attendues dans le JSON :
    - "title": Un résumé très court.
    - "content": Les détails de la note.
    - "importance": "rouge" (urgent), "orange" (important), ou "vert" (normal).
    - "is_list": true si l'utilisateur énumère des choses, sinon false.
    - "calendar_time": SI demande d'ajout calendrier/agenda, date ISO 8601 (ex: 2026-09-15T16:00:00.000Z). Sinon null.
    - "popup_time": SI demande d'alarme/pop-up ponctuelle (ex: dans 15 min, à 14h), date ISO 8601. Sinon null.
    - "send_email": true SI l'utilisateur demande d'envoyer un e-mail immédiat maintenant. Sinon false.
    - "daily_reminder": true SI l'utilisateur veut une relance ou un rappel tous les jours / quotidiennement. Sinon false.
    - "daily_reminder_time": SI daily_reminder est true, déduis l'heure demandée au format "HH:mm" (ex: "09:00" ou "18:30"). Sinon null.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data = await response.json();

    if (data.error) {
       return NextResponse.json({ error: `Refus de Google : ${data.error.message}` }, { status: 400 });
    }

    let jsonText = data.candidates[0].content.parts[0].text;
    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();

    const result = JSON.parse(jsonText);
    return NextResponse.json(result);
      
  } catch (error: any) {
    return NextResponse.json({ error: `Crash du serveur: ${error.message}` }, { status: 500 });
  }
}