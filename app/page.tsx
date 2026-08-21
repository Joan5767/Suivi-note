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
  target_date?: string;
  snooze_until?: string;
  completed_at?: string;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text');
  
  const [sendImmediateEmail, setSendImmediateEmail] = useState(true);
  const [activateReminder, setActivateReminder] = useState(true);
  
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState<boolean | 'snoozed'>(false);
  
  // Nouveaux états
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editingTargetDate, setEditingTargetDate] = useState('');
  
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});

  const fetchNotes = async () => {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (data) {
      const now = new Date().getTime();
      
      // AUTO-NETTOYAGE : Archiver silencieusement les notes terminées depuis plus de 24h
      const cleanedData = data.map(note => {
        if (note.completed && note.completed_at && !note.is_archived) {
          const completedTime = new Date(note.completed_at).getTime();
          if (now - completedTime > 24 * 60 * 60 * 1000) {
            supabase.from('notes').update({ is_archived: true }).eq('id', note.id).then();
            return { ...note, is_archived: true };
          }
        }
        return note;
      });
      
      setNotes(cleanedData);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) return;

    setLoading(true);
    
    await supabase.from('notes').insert([{ 
        title: newTitle, 
        content: newContent,
        importance: importance,
        subtasks: [],
        is_list: noteMode === 'list',
        reminder_active: activateReminder,
        target_date: targetDate
    }]);

    if (sendImmediateEmail) {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: newTitle.trim() ? newTitle : "Nouvelle note", 
          importance 
        })
      });
    }

    setNewTitle('');
    setNewContent('');
    setTargetDate('');
    setSendImmediateEmail(true);
    setActivateReminder(true);
    setImportance('vert');
    setLoading(false);
    fetchNotes();
  };

  const updateNote = async (id: string, field: string, value: any) => {
    if (field === 'completed') {
      const completedAt = value ? new Date().toISOString() : '';
      await supabase.from('notes').update({ completed: value, completed_at: completedAt }).eq('id', id);
    } else {
      await supabase.from('notes').update({ [field]: value }).eq('id', id);
    }
    fetchNotes();
  };

  const snoozeNote = async (id: string, days: number) => {
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + days);
    await supabase.from('notes').update({ snooze_until: snoozeDate.toISOString() }).eq('id', id);
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
      content: editingContent,
      target_date: editingTargetDate
    }).eq('id', id);
    setEditingId(null);
    fetchNotes();
  };

  const startEditing = (note: Note) => {
    setEditingId(note.id);
    setEditingTitle(note.title || '');
    setEditingContent(note.content || '');
    setEditingTargetDate(note.target_date || '');
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
    
    // Si tout est coché, on marque la note comme terminée avec la date
    const allCompleted = updated.every(st => st.completed);
    const completedAt = allCompleted ? new Date().toISOString() : '';

    await supabase.from('notes').update({ 
      subtasks: updated, 
      completed: allCompleted,
      completed_at: completedAt
    }).eq('id', note.id);
    
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

  // --- OUTILS CALENDRIER (Préservés) ---
  const formatDatesForCalendar = (dateString: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const pad = (n: number) => (n < 10 ? '0' + n : n);
    const start = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
    const endDate = new Date(date.getTime() + 60 * 60 * 1000);
    const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
    return { start, end };
  };

  const getGoogleCalendarLink = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || '');
    if (!dates) return '#';
    const text = encodeURIComponent(note.title || 'Note');
    const details = encodeURIComponent(note.content || 'Pas de description supplémentaire.');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates.start}/${dates.end}&details=${details}`;
  };

  const downloadICS = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || '');
    if (!dates) return;
    const icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${note.title || 'Note'}\nDESCRIPTION:${note.content || ''}\nDTSTART:${dates.start}\nDTEND:${dates.end}\nEND:VEVENT\nEND:VCALENDAR`.replace(/\n/g, '\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rendez-vous.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  // -------------------------

  // --- IA Vocale (Micro) ---
  const startVoiceDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Ton navigateur ne supporte pas la dictée vocale.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      const lowerText = text.toLowerCase();
      
      let detectedImportance = importance;
      if (lowerText.includes('urgent') || lowerText.includes('très vite')) detectedImportance = 'rouge';
      else if (lowerText.includes('important')) detectedImportance = 'orange';
      
      let detectedDate = targetDate;
      if (lowerText.includes('demain')) {
        const tmr = new Date();
        tmr.setDate(tmr.getDate() + 1);
        tmr.setHours(12, 0, 0, 0);
        detectedDate = new Date(tmr.getTime() - tmr.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      }
      
      if (noteMode === 'list') {
        setNewTitle(text);
      } else {
        setNewContent(prev => prev ? prev + ' ' + text : text);
      }
      setImportance(detectedImportance as any);
      if (detectedDate) setTargetDate(detectedDate);
    };
    recognition.start();
  };
  // -------------------------

  // Filtrage
  const nowTime = new Date().getTime();
  const displayedNotes = notes.filter(n => {
    const isSnoozed = !!n.snooze_until && new Date(n.snooze_until).getTime() > nowTime;

    // 📦 Archives
    if (showArchived === true) {
      return n.is_archived;
    }

    // 💤 Masqué 3j
    if (showArchived === 'snoozed') {
      return !n.is_archived && isSnoozed;
    }

    // 📂 Dossier Actif
    return !n.is_archived && !isSnoozed;
  });
  
  const columns = isFocusMode ? [
    { id: 'rouge', title: '🎯 Mode FOCUS : Urgences', notes: displayedNotes.filter(n => n.importance === 'rouge') }
  ] : [
    { id: 'rouge', title: '🔴 Priorité Urgente', notes: displayedNotes.filter(n => n.importance === 'rouge') },
    { id: 'orange', title: '🟠 Priorité Importante', notes: displayedNotes.filter(n => n.importance === 'orange') },
    { id: 'vert', title: '🟢 Priorité Normale', notes: displayedNotes.filter(n => n.importance === 'vert') },
  ];

  return (
    <main className="max-w-7xl mx-auto p-6 pb-20">
      
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Mes Notes & Rappels</h1>
        <button 
          onClick={() => setIsFocusMode(!isFocusMode)}
          className={`px-4 py-2 rounded-full font-bold shadow transition-all ${isFocusMode ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
        >
          {isFocusMode ? 'Désactiver le FOCUS' : '🎯 Mode Focus'}
        </button>
      </div>

      {/* Formulaire d'ajout */}
      <form onSubmit={addNote} className={`flex flex-col gap-3 mb-8 p-6 rounded-lg shadow-sm border ${isFocusMode ? 'bg-white opacity-50 pointer-events-none' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex justify-between items-center mb-1">
          <div className="flex gap-2">
            <button type="button" onClick={() => setNoteMode('text')} className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'text' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>📝 Format Texte</button>
            <button type="button" onClick={() => setNoteMode('list')} className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'list' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>✅ Format Liste</button>
          </div>
          
          <button 
            type="button" 
            onClick={startVoiceDictation}
            className={`p-3 rounded-full flex items-center gap-2 transition-all shadow-md ${isListening ? 'bg-red-500 text-white animate-bounce' : 'bg-white text-blue-600 hover:bg-blue-50 border border-blue-200'}`}
            title="Parlez, l'IA remplit le formulaire"
          >
            <span className="text-xl">🎙️</span>
            <span className="font-bold text-sm hidden sm:inline">{isListening ? 'Je vous écoute...' : 'Dictée Intelligente'}</span>
          </button>
        </div>

        {noteMode === 'text' ? (
          <div className="flex flex-col gap-2">
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre (Optionnel)" className="w-full border border-gray-300 p-2 rounded text-black font-semibold" disabled={loading} />
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Écris le contenu de ta note ici..." className="w-full border border-gray-300 p-3 rounded text-black resize-y min-h-[100px]" disabled={loading} />
          </div>
        ) : (
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre de ta liste (ex: Courses)..." className="w-full border border-gray-300 p-3 rounded text-black font-semibold" disabled={loading} />
        )}

        <div className="flex flex-col sm:flex-row gap-4 mt-2 p-3 bg-white border border-gray-200 rounded-md">
          <div className="flex flex-col gap-2 flex-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={sendImmediateEmail} onChange={(e) => setSendImmediateEmail(e.target.checked)} className="w-4 h-4 text-blue-600 cursor-pointer"/> E-mail immédiat à la création
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={activateReminder} onChange={(e) => setActivateReminder(e.target.checked)} className="w-4 h-4 text-blue-600 cursor-pointer"/> Relances quotidiennes
            </label>
          </div>
          <div className="flex flex-col gap-1 sm:border-l sm:border-gray-200 sm:pl-4">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Planifier (Optionnel)</label>
            <div className="flex items-center gap-2">
              <input type="datetime-local" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="border border-gray-300 p-1.5 rounded text-black text-sm flex-1" />
              {targetDate && <button type="button" onClick={() => setTargetDate('')} className="bg-red-100 text-red-600 hover:bg-red-200 px-2 py-1.5 rounded text-xs font-bold transition-colors">✖</button>}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-end sm:items-center mt-2">
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <label className="text-gray-600 font-medium text-sm whitespace-nowrap">Niveau d'urgence :</label>
            <select value={importance} onChange={(e) => setImportance(e.target.value as any)} className="border border-gray-300 p-2 rounded text-black bg-white cursor-pointer font-medium flex-1 sm:flex-none">
              <option value="vert">🟢 Normale</option>
              <option value="orange">🟠 Importante</option>
              <option value="rouge">🔴 Urgente</option>
            </select>
          </div>
          <button type="submit" disabled={loading || (!newTitle.trim() && !newContent.trim())} className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors w-full sm:w-auto">
            {loading ? '...' : (noteMode === 'text' ? 'Ajouter la note' : 'Créer la liste')}
          </button>
        </div>
      </form>

      {!isFocusMode && (
        <div className="flex flex-wrap gap-4 mb-6">
          <button
            onClick={() => setShowArchived(false)}
            className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === false ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            📂 Dossier Actif
          </button>

          <button
            onClick={() => setShowArchived('snoozed')}
            className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === 'snoozed' ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'}`}
          >
            💤 Masqué 3j
          </button>

          <button
            onClick={() => setShowArchived(true)}
            className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === true ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            📦 Archives
          </button>
        </div>
      )}

      {/* Affichage des colonnes */}
      <div className={`grid gap-6 ${isFocusMode ? 'grid-cols-1 max-w-2xl mx-auto' : 'grid-cols-1 lg:grid-cols-3'}`}>
        {columns.map((col) => (
          <div key={col.id} className={`flex flex-col bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-inner ${isFocusMode ? 'bg-white shadow-xl border-red-200' : ''}`}>
            <h2 className="text-xl font-bold mb-4 border-b-2 border-gray-200 pb-2 text-gray-800">
              {col.title} ({col.notes.length})
            </h2>
            
            <ul className="space-y-4">
              {col.notes.length === 0 && <p className="text-gray-400 italic text-sm text-center py-4">Vide</p>}
              
              {col.notes.map((note) => (
                <li key={note.id} className={`flex flex-col gap-3 p-4 rounded shadow bg-white border-l-4 transition-all ${getImportanceColor(note.importance).split(' ')[1]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 mt-1">
                      <input type="checkbox" checked={note.completed} onChange={() => updateNote(note.id, 'completed', !note.completed)} className="w-5 h-5 cursor-pointer mt-1 flex-shrink-0" title="Cocher pour lancer l'auto-nettoyage (24h)"/>
                      
                      {editingId === note.id ? (
                        <div className="flex flex-col flex-1 gap-2 w-full">
                          {note.is_list ? (
                            <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm" autoFocus />
                          ) : (
                            <>
                              <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} placeholder="Titre (optionnel)" className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm" />
                              <textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)} className="w-full border border-gray-400 p-2 rounded text-black resize-y min-h-[100px] text-sm" />
                            </>
                          )}
                          <div className="flex items-center gap-2">
                            <input type="datetime-local" value={editingTargetDate} onChange={(e) => setEditingTargetDate(e.target.value)} className="border border-gray-400 p-1.5 rounded text-black text-sm flex-1" />
                            {editingTargetDate && <button type="button" onClick={() => setEditingTargetDate('')} className="bg-red-100 text-red-600 px-2 py-1.5 rounded text-xs font-bold">✖ Retirer</button>}
                          </div>
                          <div className="flex gap-2 mt-1">
                            <button onClick={() => saveEdit(note.id)} className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-bold">OK</button>
                            <button onClick={() => setEditingId(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1 text-xs rounded">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div onDoubleClick={() => startEditing(note)} className={`flex-1 ${note.completed ? 'opacity-50' : ''}`}>
                          {note.title && <div className={`whitespace-pre-wrap font-bold ${note.is_list ? 'text-lg' : 'text-base text-gray-900'}`}>{note.completed ? <span className="line-through">{note.title}</span> : note.title}</div>}
                          {!note.is_list && note.content && <div className={`whitespace-pre-wrap text-sm text-gray-700 mt-1 ${!note.title ? 'text-base' : ''}`}>{note.completed ? <span className="line-through">{note.content}</span> : note.content}</div>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Boutons Calendrier s'affichent si une date est planifiée */}
                  {note.target_date && !note.completed && editingId !== note.id && (
                    <div className="flex flex-col gap-2 mt-1 mb-2 bg-blue-50/50 p-2.5 rounded border border-blue-100">
                      <div className="flex justify-between items-center w-full">
                        <span className="text-xs font-bold text-blue-800">
                          📅 Planifié pour le {new Date(note.target_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button 
                          onClick={() => updateNote(note.id, 'target_date', '')}
                          className="text-red-500 hover:bg-red-100 px-2 py-0.5 rounded text-xs font-bold transition-colors"
                          title="Annuler cette planification"
                        >
                          ✖ Annuler
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a 
                          href={getGoogleCalendarLink(note)} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded text-xs font-bold transition-colors text-center"
                        >
                          Mon Google Agenda
                        </a>
                        <button 
                          onClick={() => downloadICS(note)}
                          className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1.5 rounded text-xs font-bold transition-colors text-center"
                        >
                          Partager l'invitation (.ics)
                        </button>
                      </div>
                    </div>
                  )}

                  {note.is_list && (
                    <div className="mt-3 pl-2 border-l-2 border-gray-300 bg-gray-50/50 p-2 rounded">
                      {(note.subtasks || []).map((st) => (
                         <div key={st.id} className="flex items-center gap-2 mb-2 group">
                           <input type="checkbox" checked={st.completed} onChange={() => toggleSubtask(note, st.id)} className="cursor-pointer" />
                           <span className={`text-xs flex-1 ${st.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>{st.text}</span>
                           <button onClick={() => deleteSubtask(note, st.id)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2">✖</button>
                         </div>
                       ))}
                       <div className="flex gap-2 mt-2 items-center">
                         <input type="text" placeholder="Ajouter..." value={newSubtaskTexts[note.id] || ''} onChange={(e) => setNewSubtaskTexts({ ...newSubtaskTexts, [note.id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addSubtask(note)} className="text-xs border border-gray-300 p-1.5 rounded flex-1 text-black bg-white" />
                         <button onClick={() => addSubtask(note)} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded font-bold text-xs">+</button>
                       </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs justify-end mt-2 pt-2 border-t border-gray-100">
                    {showArchived === false && !note.completed && (
                       <button onClick={() => snoozeNote(note.id, 3)} className="px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded font-medium transition-colors" title="Masquer l'alerte pendant 3 jours">
                         💤 À plus tard (3j)
                       </button>
                    )}
                    <select value={note.importance} onChange={(e) => updateNote(note.id, 'importance', e.target.value)} className="border border-gray-300 p-1 rounded text-gray-700 bg-white cursor-pointer">
                      <option value="vert">Normale</option>
                      <option value="orange">Imp.</option>
                      <option value="rouge">Urg.</option>
                    </select>
                    {editingId !== note.id && <button onClick={() => startEditing(note)} className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors">Modif</button>}
                    <button onClick={() => updateNote(note.id, 'is_archived', !note.is_archived)} className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors">{note.is_archived ? 'Désarchiver' : 'Archiver'}</button>
                    <button onClick={() => deleteNote(note.id)} className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">Suppr</button>
                  </div>

                  {/* La case de rappel en bas des notes préservée ! */}
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