import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const isDemo =
  process.env.DEMO_MODE === 'true' ||
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearTable(table: string) {
  const { data, error } = await supabase.from(table).select('id');
  if (error) throw new Error(`${table}: ${error.message}`);
  const ids = (data || []).map((row: any) => row.id);
  if (ids.length === 0) return;
  const { error: deleteError } = await supabase.from(table).delete().in('id', ids);
  if (deleteError) throw new Error(`${table}: ${deleteError.message}`);
}

export async function POST() {
  if (!isDemo) {
    return NextResponse.json({ error: 'Route disponible uniquement en mode démonstration.' }, { status: 404 });
  }

  try {
    await clearTable('subscriptions');
    await clearTable('planning_events');
    await clearTable('planning_templates');
    await clearTable('memo_notes');
    await clearTable('memo_folders');
    await clearTable('notes');

    const { error: notesError } = await supabase.from('notes').insert([
      {
        title: 'Appeler le garage',
        content: 'Demander un rendez-vous pour la révision.',
        importance: 'rouge',
        reminder_active: false,
        reminder_popup_active: false,
        popup_active: false,
        sort_order: 0,
      },
      {
        title: 'Envoyer le devis',
        content: 'Relire le document avant envoi.',
        importance: 'orange',
        reminder_active: false,
        reminder_popup_active: false,
        popup_active: false,
        sort_order: 0,
      },
      {
        title: 'Acheter du lait',
        content: 'À prendre en rentrant.',
        importance: 'vert',
        reminder_active: false,
        reminder_popup_active: false,
        popup_active: false,
        sort_order: 0,
      },
    ]);
    if (notesError) throw new Error(`notes: ${notesError.message}`);

    const { error: memosError } = await supabase.from('memo_notes').insert([
      {
        title: 'Idées week-end',
        content: 'Balade\nRestaurant\nPréparer les affaires',
        memo_type: 'text',
        items: [],
        color: 'sage',
        pinned: true,
        archived: false,
        sort_order: 0,
      },
      {
        title: 'Liste de courses',
        content: '',
        memo_type: 'list',
        items: [
          { id: 'demo-1', text: 'Pain', completed: false },
          { id: 'demo-2', text: 'Lait', completed: false },
          { id: 'demo-3', text: 'Café', completed: false },
        ],
        color: 'sand',
        pinned: false,
        archived: false,
        sort_order: 0,
      },
      {
        title: 'Dimensions bureau',
        content: 'Mur : 3,20 m\nBureau : 1,40 m\nÉtagère : 80 cm',
        memo_type: 'text',
        items: [],
        color: 'blue',
        pinned: false,
        archived: false,
        sort_order: 1,
      },
    ]);
    if (memosError) throw new Error(`memo_notes: ${memosError.message}`);

    const { error: planningError } = await supabase.from('planning_templates').insert([
      {
        name: 'Semaine exemple',
        blocks: [
          { id: 'demo-p1', title: 'Travail', day: 'Lundi', startHour: 9, startMinute: 0, duration: 480, color: '#dce7d3', kind: 'task' },
          { id: 'demo-p2', title: 'Courses', day: 'Mardi', startHour: 17, startMinute: 30, duration: 60, color: '#eadbc8', kind: 'task' },
          { id: 'demo-p3', title: 'Sport', day: 'Jeudi', startHour: 18, startMinute: 0, duration: 90, color: '#d8e4ea', kind: 'task' },
        ],
      },
    ]);
    if (planningError) throw new Error(`planning_templates: ${planningError.message}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Erreur inconnue pendant la réinitialisation.' },
      { status: 500 }
    );
  }
}
