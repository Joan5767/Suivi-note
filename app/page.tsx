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
  content: string;
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
  const [newContent, setNewContent] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text');
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // États pour l'édition
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  
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
    // On exige au moins un titre OU un texte
    if (!newTitle.trim() && !newContent.trim()) return;

    setLoading(true);
    await supabase.from('notes').insert([{ 
        title: newTitle, 
        content: newContent,
        importance: importance,
        subtasks: [],
        is_list: noteMode === 'list'
    }]);

    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        title: newTitle.trim() ? newTitle : "Nouvelle note texte", 
        importance 
      })
    });

    setNewTitle('');
    setNewContent('');
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
    await supabase.from('notes').update({ 
      title: editingTitle,
      content: editingContent
    }).eq('id', id);
    setEditingId(null);
    fetchNotes();
  };

  const startEditing = (note: Note) => {
    setEditingId(note.id);
    setEditingTitle(note.title || '');
    setEditingContent(note.content || '');
  };

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

  const getImportanceColor = (imp: string) => {
    if (imp === 'rouge') return 'border-l-4 border-red-500 bg-red-50';
    if (imp === 'orange') return 'border-l-4 border-orange-500 bg-orange-50';
    return 'border-l-4 border-green-500 bg-green-50';
  };

  const displayedNotes = notes.filter(n => n.is_archived === showArchived);
  
  const columns = [
    { id: 'rouge', title: '🔴 Priorité Urgente', notes: displayedNotes.filter(n => n.importance === 'rouge') },
    { id: 'orange', title: '🟠 Priorité Importante', notes: displayedNotes.filter(n => n.importance === 'orange') },
    { id: 'vert', title: '🟢 Priorité Normale', notes: displayedNotes.filter(n => n.importance === 'vert') },
  ];

  return (
    <main className="max-w-7xl mx-auto p-6 pb-20">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Mes Notes & Rappels</h1>

      {/* Formulaire d'ajout */}
      <form onSubmit={addNote} className="flex flex-col gap-3 mb-8 bg-gray-50 p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex gap-2 mb-1">
          <button
            type="button"
            onClick={() => setNoteMode('text')}
            className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'text' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            📝 Format Texte
          </button>
          <button
            type="button"
            onClick={() => setNoteMode('list')}
            className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'list' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            ✅ Format Liste
          </button>
        </div>

        {noteMode === 'text' ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Titre (Optionnel)"
              className="w-full border border-gray-300 p-2 rounded text-black font-semibold"
              disabled={loading}
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Écris le contenu de ta note ici..."
              className="w-full border border-gray-300 p-3 rounded text-black resize-y min-h-[100px]"
              disabled={loading}
            />
          </div>
        ) : (
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titre de ta liste (ex: Courses)..."
            className="w-full border border-gray-300 p-3 rounded text-black font-semibold"
            disabled={loading}
          />
        )}

        <div className="flex gap-3 justify-end items-center">
          <label className="text-gray-600 font-medium text-sm">Niveau d'urgence :</label>
          <select 
            value={importance} 
            onChange={(e) => setImportance(e.target.value as any)}
            className="border border-gray-300 p-2 rounded text-black bg-white cursor-pointer font-medium"
          >
            <option value="vert">🟢 Normale</option>
            <option value="orange">🟠 Importante</option>
            <option value="rouge">🔴 Urgente</option>
          </select>
          <button
            type="submit"
            disabled={loading || (!newTitle.trim() && !newContent.trim())}
            className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors ml-2"
          >
            {loading ? '...' : (noteMode === 'text' ? 'Ajouter la note' : 'Créer la liste')}
          </button>
        </div>
      </form>

      {/* Boutons Archives / Actives */}
      <div className="flex gap-4 mb-6">
        <button 
          onClick={() => setShowArchived(false)}
          className={`px-5 py-2.5 rounded font-bold transition-colors ${!showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          Dossier Actif
        </button>
        <button 
          onClick={() => setShowArchived(true)}
          className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          Dossier Archives
        </button>
      </div>

      {/* Affichage en 3 colonnes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {columns.map((col) => (
          <div key={col.id} className="flex flex-col bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-inner">
            <h2 className="text-xl font-bold mb-4 border-b-2 border-gray-200 pb-2 text-gray-800">
              {col.title} ({col.notes.length})
            </h2>
            
            <ul className="space-y-4">
              {col.notes.length === 0 && (
                <p className="text-gray-400 italic text-sm text-center py-4">Vide</p>
              )}
              
              {col.notes.map((note) => (
                <li
                  key={note.id}
                  className={`flex flex-col gap-3 p-4 rounded shadow bg-white border-l-4 transition-all ${getImportanceColor(note.importance).split(' ')[1]}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 mt-1">
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
                              className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm"
                              autoFocus
                            />
                          ) : (
                            <>
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                placeholder="Titre (optionnel)"
                                className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm"
                              />
                              <textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="w-full border border-gray-400 p-2 rounded text-black resize-y min-h-[100px] text-sm"
                              />
                            </>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(note.id)} className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-bold">OK</button>
                            <button onClick={() => setEditingId(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1 text-xs rounded">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div 
                          onDoubleClick={() => startEditing(note)}
                          className={`flex-1 ${note.completed ? 'opacity-50' : ''}`}
                        >
                          {/* Affichage du Titre si présent */}
                          {note.title && (
                            <div className={`whitespace-pre-wrap font-bold ${note.is_list ? 'text-lg' : 'text-base text-gray-900'}`}>
                              {note.completed ? <span className="line-through">{note.title}</span> : note.title}
                            </div>
                          )}
                          {/* Affichage du Contenu si présent */}
                          {!note.is_list && note.content && (
                            <div className={`whitespace-pre-wrap text-sm text-gray-700 mt-1 ${!note.title ? 'text-base' : ''}`}>
                              {note.completed ? <span className="line-through">{note.content}</span> : note.content}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Menu des actions et changement de priorité */}
                  <div className="flex flex-wrap items-center gap-2 text-xs justify-end mt-2">
                    {/* LE MENU POUR CHANGER LA PRIORITÉ EST ICI 👇 */}
                    <select
                      value={note.importance}
                      onChange={(e) => updateNote(note.id, 'importance', e.target.value)}
                      className="border border-gray-300 p-1 rounded text-gray-700 bg-white cursor-pointer"
                    >
                      <option value="vert">Normale</option>
                      <option value="orange">Imp.</option>
                      <option value="rouge">Urg.</option>
                    </select>

                    {editingId !== note.id && (
                      <button onClick={() => startEditing(note)} className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors">
                        Modif
                      </button>
                    )}
                    <button onClick={() => updateNote(note.id, 'is_archived', !note.is_archived)} className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors">
                      {note.is_archived ? 'Désarchiver' : 'Archiver'}
                    </button>
                    <button onClick={() => deleteNote(note.id)} className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">
                      Suppr
                    </button>
                  </div>

                  {note.is_list && (
                    <div className="mt-3 pl-2 border-l-2 border-gray-300 bg-gray-50/50 p-2 rounded">
                      {(note.subtasks || []).map((st) => (
                         <div key={st.id} className="flex items-center gap-2 mb-2 group">
                           <input 
                             type="checkbox" 
                             checked={st.completed} 
                             onChange={() => toggleSubtask(note, st.id)}
                             className="cursor-pointer"
                           />
                           <span className={`text-xs flex-1 ${st.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                             {st.text}
                           </span>
                           <button 
                             onClick={() => deleteSubtask(note, st.id)} 
                             className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2"
                           >
                             ✖
                           </button>
                         </div>
                       ))}
                       <div className="flex gap-2 mt-2 items-center">
                         <input
                           type="text"
                           placeholder="Ajouter..."
                           value={newSubtaskTexts[note.id] || ''}
                           onChange={(e) => setNewSubtaskTexts({ ...newSubtaskTexts, [note.id]: e.target.value })}
                           onKeyDown={(e) => e.key === 'Enter' && addSubtask(note)}
                           className="text-xs border border-gray-300 p-1.5 rounded flex-1 text-black bg-white"
                         />
                         <button 
                           onClick={() => addSubtask(note)} 
                           className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded font-bold text-xs"
                         >
                           +
                         </button>
                       </div>
                    </div>
                  )}

                  {!note.is_archived && (
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={note.reminder_active}
                          onChange={() => updateNote(note.id, 'reminder_active', !note.reminder_active)}
                        />
                        Mail de relance quotidien
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}