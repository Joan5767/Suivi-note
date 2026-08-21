'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Subtask {
  id: string;
  text: string;
  completed: boolean;
}

interface Note {
  id: string;
  title: string;
  completed: boolean;
  is_archived: boolean;
  importance: 'vert' | 'orange' | 'rouge';
  reminder_active: boolean;
  subtasks: Subtask[];
  is_list: boolean;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text'); // Choix du format
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});

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
    await supabase.from('notes').insert([{ 
        title: newTitle, 
        importance: importance,
        subtasks: [],
        is_list: noteMode === 'list'
    }]);

    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, importance })
    });

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

  const saveEdit = async (id: string) => {
    if (editingTitle.trim()) {
      await updateNote(id, 'title', editingTitle);
    }
    setEditingId(null);
  };

  // --- Gestion des listes à cocher (sous-tâches) ---
  const addSubtask = async (note: Note) => {
    const text = newSubtaskTexts[note.id];
    if (!text || !text.trim()) return;

    const newSubtask = { id: crypto.randomUUID(), text, completed: false };
    const updatedSubtasks = [...(note.subtasks || []), newSubtask];

    await supabase.from('notes').update({ subtasks: updatedSubtasks }).eq('id', note.id);
    
    setNewSubtaskTexts(prev => ({ ...prev, [note.id]: '' }));
    fetchNotes();
  };

  const toggleSubtask = async (note: Note, subtaskId: string) => {
    const updated = (note.subtasks || []).map(st =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );
    await supabase.from('notes').update({ subtasks: updated }).eq('id', note.id);
    fetchNotes();
  };

  const deleteSubtask = async (note: Note, subtaskId: string) => {
    const updated = (note.subtasks || []).filter(st => st.id !== subtaskId);
    await supabase.from('notes').update({ subtasks: updated }).eq('id', note.id);
    fetchNotes();
  };
  // -------------------------------------------------

  const getImportanceColor = (imp: string) => {
    if (imp === 'rouge') return 'border-l-4 border-red-500 bg-red-50';
    if (imp === 'orange') return 'border-l-4 border-orange-500 bg-orange-50';
    return 'border-l-4 border-green-500 bg-green-50';
  };

  const displayedNotes = notes.filter(n => n.is_archived === showArchived);

  return (
    <main className="max-w-3xl mx-auto p-6 pb-20">
      <h1 className="text-2xl font-bold mb-6">Mes Notes & Rappels</h1>

      {/* Formulaire d'ajout avec sélecteur de format */}
      <form onSubmit={addNote} className="flex flex-col gap-3 mb-8 bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200">
        
        {/* Sélecteur de mode */}
        <div className="flex gap-2 mb-1">
          <button
            type="button"
            onClick={() => setNoteMode('text')}
            className={`px-3 py-1.5 text-sm rounded-md font-semibold transition-colors ${noteMode === 'text' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            📝 Format Texte
          </button>
          <button
            type="button"
            onClick={() => setNoteMode('list')}
            className={`px-3 py-1.5 text-sm rounded-md font-semibold transition-colors ${noteMode === 'list' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            ✅ Format Liste
          </button>
        </div>

        {/* Champ de saisie dynamique selon le mode */}
        {noteMode === 'text' ? (
          <textarea
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Écris ta note complète ici (Sauts de ligne autorisés)..."
            className="w-full border border-gray-300 p-3 rounded text-black resize-y min-h-[100px]"
            disabled={loading}
          />
        ) : (
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titre de ta liste (ex: Courses, Tâches du jour)..."
            className="w-full border border-gray-300 p-3 rounded text-black font-semibold"
            disabled={loading}
          />
        )}

        <div className="flex gap-2 justify-end">
          <select 
            value={importance} 
            onChange={(e) => setImportance(e.target.value as any)}
            className="border border-gray-300 p-2 rounded text-black bg-white cursor-pointer"
          >
            <option value="vert">🟢 Normale</option>
            <option value="orange">🟠 Importante</option>
            <option value="rouge">🔴 Urgente</option>
          </select>
          <button
            type="submit"
            disabled={loading || !newTitle.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '...' : (noteMode === 'text' ? 'Ajouter la note' : 'Créer la liste')}
          </button>
        </div>
      </form>

      {/* Boutons Archives / Actives */}
      <div className="flex gap-4 mb-4">
        <button 
          onClick={() => setShowArchived(false)}
          className={`px-4 py-2 rounded font-semibold transition-colors ${!showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          Notes Actives
        </button>
        <button 
          onClick={() => setShowArchived(true)}
          className={`px-4 py-2 rounded font-semibold transition-colors ${showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          Dossier Archives
        </button>
      </div>

      {/* Liste des notes */}
      <ul className="space-y-4">
        {displayedNotes.length === 0 && (
          <p className="text-gray-500 italic p-4">Aucune note ici pour le moment.</p>
        )}
        {displayedNotes.map((note) => (
          <li
            key={note.id}
            className={`flex flex-col gap-3 p-4 rounded shadow-sm transition-all ${getImportanceColor(note.importance)}`}
          >
            {/* Haut de la note : Checkbox principale + Texte + Actions */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 mt-1">
                <input
                  type="checkbox"
                  checked={note.completed}
                  onChange={() => updateNote(note.id, 'completed', !note.completed)}
                  className="w-5 h-5 cursor-pointer mt-1 flex-shrink-0"
                />
                
                {editingId === note.id ? (
                  <div className="flex flex-col flex-1 gap-2 w-full">
                    {note.is_list ? (
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="w-full border border-gray-400 p-2 rounded text-black font-semibold"
                        autoFocus
                      />
                    ) : (
                      <textarea
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="w-full border border-gray-400 p-2 rounded text-black resize-y min-h-[100px]"
                        autoFocus
                      />
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(note.id)} className="bg-green-500 hover:bg-green-600 text-white px-4 py-1 rounded font-semibold">Enregistrer</button>
                      <button onClick={() => setEditingId(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-1 rounded">Annuler</button>
                    </div>
                  </div>
                ) : (
                  <span 
                    onDoubleClick={() => { setEditingId(note.id); setEditingTitle(note.title); }}
                    className={`flex-1 whitespace-pre-wrap ${note.is_list ? 'text-xl font-bold' : 'text-lg'} ${note.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}
                  >
                    {note.title}
                  </span>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 text-sm flex-wrap justify-end">
                <select
                  value={note.importance}
                  onChange={(e) => updateNote(note.id, 'importance', e.target.value)}
                  className="border border-gray-300 p-1 rounded text-gray-700 text-xs bg-white cursor-pointer"
                >
                  <option value="vert">🟢 Normale</option>
                  <option value="orange">🟠 Imp.</option>
                  <option value="rouge">🔴 Urg.</option>
                </select>

                {editingId !== note.id && (
                  <button onClick={() => { setEditingId(note.id); setEditingTitle(note.title); }} className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors">
                    Modifier
                  </button>
                )}
                <button onClick={() => updateNote(note.id, 'is_archived', !note.is_archived)} className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors">
                  {note.is_archived ? 'Désarchiver' : 'Archiver'}
                </button>
                <button onClick={() => deleteNote(note.id)} className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">
                  Supprimer
                </button>
              </div>
            </div>

            {/* Zone des listes à cocher (AFFICHÉE UNIQUEMENT SI LE MODE LISTE EST ACTIF) */}
            {note.is_list && (
              <div className="ml-8 mt-2 pl-2 border-l-2 border-gray-400">
                {(note.subtasks || []).map((st) => (
                  <div key={st.id} className="flex items-center gap-2 mb-2 group">
                    <input 
                      type="checkbox" 
                      checked={st.completed} 
                      onChange={() => toggleSubtask(note, st.id)}
                      className="cursor-pointer"
                    />
                    <span className={`text-sm flex-1 ${st.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {st.text}
                    </span>
                    <button 
                      onClick={() => deleteSubtask(note, st.id)} 
                      className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2"
                    >
                      ✖
                    </button>
                  </div>
                ))}
                
                <div className="flex gap-2 mt-2 items-center">
                  <input
                    type="text"
                    placeholder="Ajouter un élément à la liste..."
                    value={newSubtaskTexts[note.id] || ''}
                    onChange={(e) => setNewSubtaskTexts({ ...newSubtaskTexts, [note.id]: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addSubtask(note)}
                    className="text-sm border border-gray-300 p-1.5 rounded flex-1 text-black bg-white/70"
                  />
                  <button 
                    onClick={() => addSubtask(note)} 
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Option de rappel */}
            {!note.is_archived && (
              <div className="flex items-center gap-2 ml-8 mt-4 text-xs text-gray-500 pt-3 border-t border-gray-200/50">
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