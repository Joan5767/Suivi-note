'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Note {
  id: string;
  title: string;
  completed: boolean;
  is_archived: boolean;
  importance: 'vert' | 'orange' | 'rouge';
  reminder_active: boolean;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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
    // Sauvegarde avec l'importance (Pas d'email direct ici pour simplifier, on laisse le cron faire)
    await supabase.from('notes').insert([{ 
        title: newTitle, 
        importance: importance 
    }]);

    setNewTitle('');
    setLoading(false);
    fetchNotes();
  };

  const updateNote = async (id: string, field: string, value: any) => {
    await supabase.from('notes').update({ [field]: value }).eq('id', id);
    fetchNotes();
  };

  const deleteNote = async (id: string) => {
    if (window.confirm('Es-tu sûr de vouloir supprimer cette note ?')) {
      await supabase.from('notes').delete().eq('id', id);
      fetchNotes();
    }
  };

  const getImportanceColor = (imp: string) => {
    if (imp === 'rouge') return 'border-l-4 border-red-500 bg-red-50';
    if (imp === 'orange') return 'border-l-4 border-orange-500 bg-orange-50';
    return 'border-l-4 border-green-500 bg-green-50';
  };

  const displayedNotes = notes.filter(n => n.is_archived === showArchived);

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Mes Notes & Rappels</h1>

      {/* Formulaire d'ajout */}
      <form onSubmit={addNote} className="flex gap-2 mb-8 bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Nouvelle note..."
          className="flex-1 border border-gray-300 p-2 rounded text-black"
          disabled={loading}
        />
        <select 
          value={importance} 
          onChange={(e) => setImportance(e.target.value as any)}
          className="border border-gray-300 p-2 rounded text-black"
        >
          <option value="vert">🟢 Normale</option>
          <option value="orange">🟠 Importante</option>
          <option value="rouge">🔴 Urgente</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '...' : 'Ajouter'}
        </button>
      </form>

      {/* Bouton pour basculer entre Actives et Archivées */}
      <div className="flex gap-4 mb-4">
        <button 
          onClick={() => setShowArchived(false)}
          className={`px-4 py-2 rounded font-semibold ${!showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}
        >
          Notes Actives
        </button>
        <button 
          onClick={() => setShowArchived(true)}
          className={`px-4 py-2 rounded font-semibold ${showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}
        >
          Dossier Archives
        </button>
      </div>

      {/* Liste des notes */}
      <ul className="space-y-3">
        {displayedNotes.length === 0 && (
          <p className="text-gray-500 italic p-4">Aucune note ici pour le moment.</p>
        )}
        {displayedNotes.map((note) => (
          <li
            key={note.id}
            className={`flex flex-col gap-2 p-4 rounded shadow-sm transition-all ${getImportanceColor(note.importance)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={note.completed}
                  onChange={() => updateNote(note.id, 'completed', !note.completed)}
                  className="w-5 h-5 cursor-pointer mt-1"
                />
                <span className={`text-lg ${note.completed ? 'line-through text-gray-500' : 'text-gray-900 font-medium'}`}>
                  {note.title}
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => updateNote(note.id, 'is_archived', !note.is_archived)}
                  className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
                >
                  {note.is_archived ? 'Désarchiver' : 'Archiver'}
                </button>
                <button
                  onClick={() => deleteNote(note.id)}
                  className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                >
                  Supprimer
                </button>
              </div>
            </div>

            {/* Option de rappel uniquement si non archivée */}
            {!note.is_archived && (
              <div className="flex items-center gap-2 ml-8 mt-2 text-sm text-gray-600">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={note.reminder_active}
                    onChange={() => updateNote(note.id, 'reminder_active', !note.reminder_active)}
                  />
                  Activer le rappel par mail quotidien
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}