import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, currentDate } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json({ error: "La clé GEMINI_API_KEY est introuvable sur Vercel." }, { status: 500 });
    }

    const prompt = `Tu es un assistant intelligent de prise de notes. L'utilisateur a dicté ce texte : "${text}".
    Aujourd'hui nous sommes le : ${currentDate}.
    Analyse le texte et renvoie STRICTEMENT ET UNIQUEMENT un objet JSON valide (sans balises markdown).
    Propriétés attendues :
    - "title": un titre très court et pertinent.
    - "content": le contenu détaillé et corrigé.
    - "importance": 'rouge' (urgent), 'orange' (important), ou 'vert' (normal).
    - "is_list": true si l'utilisateur énumère des choses, sinon false.
    - "popup_time": si l'utilisateur demande une alarme ou un rappel dans X minutes/heures ou à une heure précise, déduis la date/heure exacte au format ISO 8601 (YYYY-MM-DDTHH:mm). Sinon, null.
    - "calendar_time": uniquement si l'utilisateur demande explicitement d'ajouter un rendez-vous/événement dans son agenda ou calendrier, déduis la date/heure exacte au format ISO 8601 (YYYY-MM-DDTHH:mm). Sinon, null.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

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
