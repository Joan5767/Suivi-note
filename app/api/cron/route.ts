import { NextResponse } from 'next/server';

// Cette route est conservée pour ne pas casser d'anciens liens,
// mais les rappels ne sont plus envoyés par Vercel Cron.
// Sur l'offre Hobby, Vercel ne permet pas une exécution chaque minute.
// Le moteur de rappels est désormais appelé par Supabase Cron via /api/push-worker.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Non autorisé', { status: 401 });
  }

  return NextResponse.json({
    success: true,
    disabled: true,
    message: 'Ancien cron Vercel désactivé. Les rappels sont gérés par Supabase Cron.',
  });
}
