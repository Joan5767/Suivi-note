import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, currentDate } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Clé manquante" }, { status: 500 });
    }

    const prompt = `Tu es un assistant intelligent de prise de notes. L'utilisateur a dicté ce texte : "${text}".
    Aujourd'hui nous sommes le : ${currentDate}.
    Analyse le texte et renvoie UNIQUEMENT un objet JSON strict (sans aucun formatage markdown autour) avec ces propriétés :
    - "title": un titre très court et pertinent (chaine de caractères).
    - "content": le contenu détaillé et corrigé (chaine de caractères).
    - "importance": 'rouge' (si urgent/très important), 'orange' (si important), ou 'vert' (normal).
    - "target_date": si l'utilisateur mentionne une date/heure de rappel, déduis la date exacte au format ISO 8601 (YYYY-MM-DDTHH:mm). Sinon, null.
    - "is_list": true si l'utilisateur énumère des choses (courses, tâches), sinon false.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data = await response.json();
    const jsonText = data.candidates[0].content.parts[0].text;
    const result = JSON.parse(jsonText);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de l'analyse IA" }, { status: 500 });
  }
}
