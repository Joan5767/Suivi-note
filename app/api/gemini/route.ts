import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, currentDate } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json({ error: "La clé GEMINI_API_KEY est introuvable sur Vercel." }, { status: 500 });
    }

    const prompt = `Tu es l'assistant intelligent d'une application de productivité et de rappels. L'utilisateur a dicté ou écrit ce texte : "${text}".
    Aujourd'hui nous sommes le : ${currentDate}.
    
    Analyse finement le texte et renvoie STRICTEMENT ET UNIQUEMENT un objet JSON valide (sans balises markdown ni texte autour).
    
    Propriétés attendues dans le JSON :
    - "title": un titre très court et pertinent résumant l'action.
    - "content": le contenu détaillé, structuré et corrigé.
    - "priority": obligatoirement "Haute", "Moyenne" ou "Basse" selon l'urgence exprimée.
    - "target_date": si l'utilisateur demande une alarme, un rappel, ou une échéance à une date/heure précise ou dans X temps, déduis la date et l'heure exacte au format ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ). Sinon, mets null.
    - "popup_active": true si l'utilisateur veut une alerte / notification push (ou s'il y a une target_date définie), sinon false.
    - "is_recurring": true si l'utilisateur demande un rappel quotidien ou récurrent, sinon false.
    - "send_email": true si l'utilisateur demande explicitement à recevoir un e-mail, sinon false.`;

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
