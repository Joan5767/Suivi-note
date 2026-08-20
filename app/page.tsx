'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Note {
  id: string;
  title: string;
  completed: boolean;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchNotes = async () => {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setNotes(data);
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setLoading(true);
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });

    setNewTitle('');
    setLoading(false);
    fetchNotes();
  };

  const toggleNote = async (id: string, currentStatus: boolean) => {
    await supabase.from('notes').update({ completed: !currentStatus }).eq('id', id);
    fetchNotes();
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Mes Notes & Rappels</h1>

      <form onSubmit={addNote} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Ajouter une note..."
          className="flex-1 border border-gray-300 p-2 rounded text-black"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded font-semibold disabled:opacity-50"
        >
          {loading ? '...' : 'Ajouter'}
        </button>
      </form>

      <ul className="space-y-2">
        {notes.map((note) => (
          <li
            key={note.id}
            className="flex items-center gap-3 p-3 border rounded bg-white shadow-sm"
          >
            <input
              type="checkbox"
              checked={note.completed}
              onChange={() => toggleNote(note.id, note.completed)}
              className="w-5 h-5 cursor-pointer"
            />
            <span className={note.completed ? 'line-through text-gray-400' : 'text-gray-900'}>
              {note.title}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}