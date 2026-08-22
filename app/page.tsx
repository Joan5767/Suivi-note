'use client';

import { useState, useEffect, useRef } from 'react';
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
  reminder_popup_active?: boolean; 
  daily_reminder_time?: string;
  subtasks: Subtask[];
  is_list: boolean;
  target_date?: string;
  snooze_until?: string;
  completed_at?: string;
  popup_active?: boolean; 
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text');
  
  const [sendImmediateEmail, setSendImmediateEmail] = useState(false);
  const [showPopupConfig, setShowPopupConfig] = useState(false);
  const [popupHours, setPopupHours] = useState('');
  const [popupMinutes, setPopupMinutes] = useState('');
  
  const [showDailyConfig, setShowDailyConfig] = useState(false);
  const [activateReminder, setActivateReminder] = useState(false); 
  const [reminderPopupActive, setReminderPopupActive] = useState(false); 
  const [dailyTime, setDailyTime] = useState('09:00');
  
  const [showCalendarConfig, setShowCalendarConfig] = useState(false);
  const [targetDate, setTargetDate] = useState('');
  const [enableGoogleCal, setEnableGoogleCal] = useState(true);
  const [enableICal, setEnableICal] = useState(true);
  
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState<boolean | 'snoozed'>(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [isFocusMode, setIsFocusMode] = useState(false);
  
  const [listeningMode, setListeningMode] = useState<'none' | 'micro' | 'ai'>('none');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiProposal, setAiProposal] = useState<any>(null);
  const recognitionRef = useRef<any>(null);

  // États d'édition
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editingTargetDate, setEditingTargetDate] = useState('');
  const [editingPopupActive, setEditingPopupActive] = useState(false);
  const [showEditingPopupConfig, setShowEditingPopupConfig] = useState(false);
  const [editingPopupHours, setEditingPopupHours] = useState('');
  const [editingPopupMinutes, setEditingPopupMinutes] = useState('');
  
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});
  const [snoozeDaysByNote, setSnoozeDaysByNote] = useState<Record<string, number>>({});
  
  const [collapsedPriorities, setCollapsedPriorities] = useState<Record<string, boolean>>({
    rouge: true,
    orange: true,
    vert: true,
  });

  const fetchNotes = async () => {
    const { data, error } = await supabase.from('notes').select('*').order('created_at', { ascending: false });
    if (error) { console.error("Erreur Fetch:", error); return; }
    if (data) {
      const now = new Date().getTime();
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

  useEffect(() => { fetchNotes(); }, []);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const now = Date.now();
      setCurrentTime(now);
      
      let needsUpdate = false;
      for (const note of notes) {
        if (note.popup_active && !note.completed && !note.is_archived && note.target_date) {
          const targetTime = new Date(note.target_date).getTime();
          if (targetTime <= now) {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('⏰ Rappel : ' + (note.title || 'Note'), { body: note.content || 'Il est l\'heure !' });
            } else {
              alert('⏰ RAPPEL : ' + (note.title || 'Note') + '\n' + (note.content || ''));
            }
            await supabase.from('notes').update({ popup_active: false }).eq('id', note.id);
            needsUpdate = true;
          }
        }
      }
      if (needsUpdate) fetchNotes();
    }, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [notes]);

  const addNote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) return;

    setLoading(true);
    let finalTargetDate = '';
    let finalPopupActive = false;

    if (showPopupConfig && (popupHours || popupMinutes)) {
      const d = new Date();
      d.setHours(d.getHours() + (parseInt(popupHours) || 0));
      d.setMinutes(d.getMinutes() + (parseInt(popupMinutes) || 0));
      const tzOffset = d.getTimezoneOffset() * 60000;
      finalTargetDate = new Date(d.getTime() - tzOffset).toISOString().slice(0,16);
      finalPopupActive = true;
    } else if (showCalendarConfig && targetDate) {
      finalTargetDate = targetDate;
    }

    const { error } = await supabase.from('notes').insert([{ 
        title: newTitle, 
        content: newContent,
        importance: importance,
        subtasks: [],
        is_list: noteMode === 'list',
        reminder_active: activateReminder,
        reminder_popup_active: reminderPopupActive,
        daily_reminder_time: dailyTime,
        target_date: finalTargetDate,
        popup_active: finalPopupActive
    }]);

    if (error) {
      alert("Erreur de sauvegarde Supabase : " + error.message);
      setLoading(false);
      return;
    }

    if (sendImmediateEmail) {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() ? newTitle : "Nouvelle note", importance })
      });
    }

    setNewTitle(''); setNewContent(''); setImportance('vert');
    setSendImmediateEmail(false); 
    setShowPopupConfig(false); setPopupHours(''); setPopupMinutes('');
    setShowDailyConfig(false); setActivateReminder(false); setReminderPopupActive(false);
    setShowCalendarConfig(false); setTargetDate('');
    setLoading(false);
    
    setCollapsedPriorities(prev => ({ ...prev, [importance]: false }));
    fetchNotes();
  };

  const deleteNote = async (id: string) => {
    if (window.confirm('Es-tu sûr de vouloir supprimer cette note définitivement ?')) {
      await supabase.from('notes').delete().eq('id', id); 
      fetchNotes();
    }
  };

  const triggerImmediateEmail = async (note: Note) => {
    if (window.confirm('Es-tu sûr de vouloir envoyer un e-mail immédiat pour cette note ?')) {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title || "Rappel de note", importance: note.importance })
      });
      alert('E-mail envoyé avec succès !');
    }
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

  // -- FONCTIONS IA --
  const toggleDictation = (mode: 'micro' | 'ai') => {
    if (listeningMode !== 'none') {
      if (recognitionRef.current) recognitionRef.current.stop();
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Ton navigateur ne supporte pas la dictée vocale."); return; }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = true; 
    recognitionRef.current = recognition;
    
    const transcript = { text: '' };
    
    recognition.onstart = () => setListeningMode(mode);
    
    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript + ' ';
      }
      transcript.text = current;
      
      if (noteMode === 'list') setNewTitle(current);
      else setNewContent(current);
    };

    recognition.onend = async () => {
      setListeningMode('none');
      const finalTranscript = transcript.text;

      if (mode === 'ai') {
        if (!finalTranscript.trim()) {
          alert("❌ Le micro n'a rien enregistré. Vérifie tes permissions.");
          return;
        }

        // TRACEUR 1 : On vérifie que l'enregistrement a marché
        alert(`🎤 Enregistrement terminé. Texte capté : "${finalTranscript}"\n\nEnvoi à l'IA en cours...`);
        setIsAiProcessing(true);

        try {
          const res = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: finalTranscript,
              currentDate: new Date().toLocaleString('fr-FR')
            })
          });
          
          if (!res.ok) {
            const errData = await res.json();
            // TRACEUR 2 : Si le serveur Vercel/Google bloque
            alert("❌ Erreur Vercel/Google : " + (errData.error || "Erreur inconnue"));
            setIsAiProcessing(false);
            return;
          }

          const data = await res.json();
          // TRACEUR 3 : Si Google répond correctement
          alert("✅ L'IA a répondu ! Ouverture de la fenêtre récapitulative.");
          setAiProposal(data);
          
        } catch (e: any) {
          // TRACEUR 4 : S'il y a un problème de connexion (ex: pas de 4G)
          alert("❌ Erreur réseau lors de la connexion à l'IA : " + e.message);
        }
        setIsAiProcessing(false);
      }
    };
    recognition.start();
  };

  const confirmAiNote = async (data: any) => {
    setLoading(true);
    const { error } = await supabase.from('notes').insert([{
      title: data.title || '',
      content: data.content || '',
      importance: data.importance || 'vert',
      subtasks: [],
      is_list: data.is_list || false,
      reminder_active: false,
      reminder_popup_active: false,
      target_date: data.target_date || '',
      popup_active: !!data.target_date 
    }]);

    if (error) {
      alert("Erreur Supabase : " + error.message);
    } else {
      if ('Notification' in window && Notification.permission !== 'granted') {
         Notification.requestPermission();
      }
      setAiProposal(null);
      setNewTitle('');
      setNewContent('');
      fetchNotes();
    }
    setLoading(false);
  };

  const loadProposalIntoForm = (data: any) => {
    if (data.title) setNewTitle(data.title);
    if (data.content) setNewContent(data.content);
    if (data.importance) setImportance(data.importance);
    if (data.is_list !== undefined) setNoteMode(data.is_list ? 'list' : 'text');
    if (data.target_date) {
      setTargetDate(data.target_date);
      setShowCalendarConfig(true);
    }
    setAiProposal(null);
  };

  const formatDatesForCalendar = (dateString: string) => {
    if (!dateString) return null;
    const date = new Date(dateString); const pad = (n: number) => (n < 10 ? '0' + n : n);
    const start = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
    const endDate = new Date(date.getTime() + 60 * 60 * 1000);
    const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
    return { start, end };
  };

  const getGoogleCalendarLink = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || ''); if (!dates) return '#';
    const text = encodeURIComponent(note.title || 'Note'); const details = encodeURIComponent(note.content || '');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates.start}/${dates.end}&details=${details}`;
  };

  const downloadICS = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || ''); if (!dates) return;
    const icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${note.title || 'Note'}\nDESCRIPTION:${note.content || ''}\nDTSTART:${dates.start}\nDTEND:${dates.end}\nEND:VEVENT\nEND:VCALENDAR`.replace(/\n/g, '\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'rendez-vous.ics'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };
  
  const saveEdit = async (id: string) => {
    let finalTargetDate = editingTargetDate;
    let finalPopupActive = editingPopupActive;

    if (showEditingPopupConfig && (editingPopupHours || editingPopupMinutes)) {
      const d = new Date();
      d.setHours(d.getHours() + (parseInt(editingPopupHours) || 0));
      d.setMinutes(d.getMinutes() + (parseInt(editingPopupMinutes) || 0));
      const tzOffset = d.getTimezoneOffset() * 60000;
      finalTargetDate = new Date(d.getTime() - tzOffset).toISOString().slice(0,16);
      finalPopupActive = true;
    }

    await supabase.from('notes').update({ 
      title: editingTitle, 
      content: editingContent, 
      target_date: finalTargetDate, 
      popup_active: finalPopupActive
    }).eq('id', id);
    
    setEditingId(null); 
    fetchNotes();
  };

  const startEditing = (note: Note) => {
    setEditingId(note.id); 
    setEditingTitle(note.title || ''); 
    setEditingContent(note.content || '');
    setEditingTargetDate(note.target_date || ''); 
    setEditingPopupActive(note.popup_active || false);
    setShowEditingPopupConfig(false);
    setEditingPopupHours('');
    setEditingPopupMinutes('');
  };
  
  const snoozeNote = async (id: string, days: number) => {
    const snoozeDate = new Date(); snoozeDate.setDate(snoozeDate.getDate() + days);
    await supabase.from('notes').update({ snooze_until: snoozeDate.toISOString() }).eq('id', id);
    fetchNotes();
  };

  const addSubtask = async (note: Note) => {
    const text = newSubtaskTexts[note.id]; if (!text || !text.trim()) return;
    const newSubtask = { id: crypto.randomUUID(), text, completed: false };
    const updatedSubtasks = [...(note.subtasks || []), newSubtask];
    await supabase.from('notes').update({ subtasks: updatedSubtasks }).eq('id', note.id);
    setNewSubtaskTexts(prev => ({ ...prev, [note.id]: '' })); fetchNotes();
  };

  const deleteSubtask = async (note: Note, subtaskId: string) => {
    const updated = (note.subtasks || []).filter(st => st.id !== subtaskId);
    await supabase.from('notes').update({ subtasks: updated }).eq('id', note.id); fetchNotes();
  };

  const snoozedNotes = notes.filter(n => !n.is_archived && !!n.snooze_until && new Date(n.snooze_until).getTime() > currentTime);
  const hasSnoozedNotes = snoozedNotes.length > 0;

  const displayedNotes = notes.filter(n => {
    const isSnoozed = !!n.snooze_until && new Date(n.snooze_until).getTime() > currentTime;
    if (showArchived === true) return n.is_archived;
    if (showArchived === 'snoozed') return !n.is_archived && isSnoozed;
    return !n.is_archived && !isSnoozed;
  });

  const columns = isFocusMode ? [
    { id: 'rouge', title: '🔴 Urgentes', notes: displayedNotes.filter(n => n.importance === 'rouge') },
  ] : [
    { id: 'rouge', title: '🔴 Priorité Urgente', notes: displayedNotes.filter(n => n.importance === 'rouge') },
    { id: 'orange', title: '🟠 Priorité Importante', notes: displayedNotes.filter(n => n.importance === 'orange') },
    { id: 'vert', title: '🟢 Priorité Normale', notes: displayedNotes.filter(n => n.importance === 'vert') },
  ];

  const togglePriority = (priorityId: string) => { setCollapsedPriorities(prev => ({ ...prev, [priorityId]: !prev[priorityId] })); };

  return (
    <main className="max-w-7xl mx-auto p-6 pb-20 relative">

      {aiProposal && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg flex flex-col gap-4 animate-fade-in border-4 border-purple-500">
            <h2 className="text-2xl font-bold text-gray-800 border-b pb-2 flex items-center gap-2">
              <span>🤖</span> Proposition de l'IA
            </h2>

            <div className="flex flex-col gap-3 text-base text-gray-800 bg-gray-50 p-4 rounded-lg border border-gray-200">
              <p><strong className="text-purple-700">Titre :</strong> {aiProposal.title || '(Vide)'}</p>
              {aiProposal.content && <p><strong className="text-purple-700">Contenu :</strong> {aiProposal.content}</p>}
              <p><strong className="text-purple-700">Format :</strong> {aiProposal.is_list ? 'Liste de tâches ✅' : 'Note texte 📝'}</p>
              <p><strong className="text-purple-700">Priorité :</strong> {
                aiProposal.importance === 'rouge' ? '🔴 Urgente' :
                aiProposal.importance === 'orange' ? '🟠 Importante' : '🟢 Normale'
              }</p>
              {aiProposal.target_date && (
                <p className="bg-purple-100 p-2 rounded text-purple-900 border border-purple-200">
                  <strong>⏰ Alarme programmée :</strong> {new Date(aiProposal.target_date).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <button onClick={() => confirmAiNote(aiProposal)} disabled={loading} className="flex-1 bg-green-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-green-700 transition-colors shadow-md disabled:opacity-50">
                {loading ? 'Création...' : '✅ Valider et Créer'}
              </button>
              <button onClick={() => loadProposalIntoForm(aiProposal)} disabled={loading} className="flex-1 bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-xl hover:bg-gray-300 transition-colors">
                ✏️ Modifier manuellement
              </button>
            </div>
            
            <button onClick={() => setAiProposal(null)} className="text-gray-400 hover:text-gray-600 text-sm mt-1 underline">
              Annuler et fermer
            </button>
          </div>
        </div>
      )}
      
      <div className={`flex items-center mb-6 ${isFocusMode ? 'justify-end' : 'justify-between'}`}>
        {!isFocusMode && <h1 className="text-3xl font-bold text-gray-800">Mes Notes & Rappels</h1>}
        <button onClick={() => setIsFocusMode(!isFocusMode)} className={`px-4 py-2 rounded-full font-bold shadow transition-all ${isFocusMode ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-white hover:bg-gray-700'}`}>
          {isFocusMode ? 'Désactiver le FOCUS' : '🎯 Mode Focus'}
        </button>
      </div>

      {!isFocusMode && (
      <form onSubmit={addNote} className="flex flex-col gap-4 mb-8 p-6 rounded-lg shadow-md border bg-gray-50 border-gray-200">
        
        <div className="flex gap-2">
          <button type="button" onClick={() => setNoteMode('text')} className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'text' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>📝 Format Texte</button>
          <button type="button" onClick={() => setNoteMode('list')} className={`px-4 py-2 text-sm rounded-md font-semibold transition-colors ${noteMode === 'list' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>✅ Format Liste</button>
        </div>

        {noteMode === 'text' ? (
          <div className="flex flex-col gap-2">
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre (Optionnel)" className="w-full border border-gray-300 p-2 rounded text-black font-semibold text-lg" disabled={loading || isAiProcessing} />
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Écris le contenu de ta note ici..." className="w-full border border-gray-300 p-3 rounded text-black resize-y min-h-[120px] text-base" disabled={loading || isAiProcessing} />
          </div>
        ) : (
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre de ta liste (ex: Courses)..." className="w-full border border-gray-300 p-3 rounded text-black font-semibold text-lg" disabled={loading || isAiProcessing} />
        )}

        <div className="flex items-center gap-3 w-full">
          <select value={importance} onChange={(e) => setImportance(e.target.value as any)} disabled={isAiProcessing} className="w-full border border-gray-300 p-3 rounded-lg text-black bg-white cursor-pointer font-bold">
            <option value="vert">🟢 Priorité Normale</option>
            <option value="orange">🟠 Priorité Importante</option>
            <option value="rouge">🔴 Priorité Urgente</option>
          </select>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 border-b border-gray-200 pb-4">
          <button type="button" onClick={() => toggleDictation('micro')} disabled={listeningMode === 'ai' || isAiProcessing} className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-sm ${listeningMode === 'micro' ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}>
            <span>🎙️</span> {listeningMode === 'micro' ? 'Cliquer pour arrêter' : 'Dictée simple (Micro)'}
          </button>
          <button type="button" onClick={() => toggleDictation('ai')} disabled={listeningMode === 'micro' || isAiProcessing} className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-sm ${isAiProcessing ? 'bg-indigo-600 text-white animate-pulse' : listeningMode === 'ai' ? 'bg-purple-600 text-white animate-pulse' : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'}`}>
            <span>🤖</span> {isAiProcessing ? 'L\'IA réfléchit...' : listeningMode === 'ai' ? 'Cliquer pour analyser' : 'Dictée intelligente (IA)'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          
          <button type="button" onClick={() => setSendImmediateEmail(!sendImmediateEmail)} disabled={isAiProcessing} className={`p-3 rounded-lg font-bold border transition-colors text-left flex items-center justify-between ${sendImmediateEmail ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
            <span>📨 E-mail immédiat à la création</span>
            <span>{sendImmediateEmail ? 'ON' : 'OFF'}</span>
          </button>

          <div className="flex flex-col">
            <button type="button" onClick={() => { setShowPopupConfig(!showPopupConfig); if (!showPopupConfig && 'Notification' in window) Notification.requestPermission(); }} disabled={isAiProcessing} className={`p-3 rounded-lg font-bold border transition-colors text-left flex justify-between items-center ${(showPopupConfig || popupHours || popupMinutes) ? 'bg-indigo-600 text-white border-indigo-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              <span>⏰ Notification alarme pop-up</span> <span>{showPopupConfig ? '▲' : '▼'}</span>
            </button>
            {showPopupConfig && (
              <div className="bg-indigo-50 border border-t-0 border-indigo-200 p-4 rounded-b-lg flex flex-col items-center gap-3">
                <div className="flex flex-wrap items-center gap-2 justify-center">
                  <span className="text-sm font-bold text-indigo-900">Dans :</span>
                  <input type="number" placeholder="0" min="0" value={popupHours} onChange={(e) => setPopupHours(e.target.value)} className="w-16 p-2 border border-indigo-300 rounded-lg text-center text-black font-bold" />
                  <span className="text-sm font-bold text-indigo-900">h</span>
                  <input type="number" placeholder="0" min="0" value={popupMinutes} onChange={(e) => setPopupMinutes(e.target.value)} className="w-16 p-2 border border-indigo-300 rounded-lg text-center text-black font-bold" />
                  <span className="text-sm font-bold text-indigo-900">min</span>
                </div>
                {(popupHours || popupMinutes) && (
                  <button type="button" onClick={() => { setPopupHours(''); setPopupMinutes(''); setShowPopupConfig(false); }} className="bg-red-100 text-red-600 px-3 py-1 rounded-md text-xs font-bold hover:bg-red-200 transition-colors">
                    ✖ Annuler la saisie
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col">
            <button type="button" onClick={() => setShowDailyConfig(!showDailyConfig)} disabled={isAiProcessing} className={`p-3 rounded-lg font-bold border transition-colors text-left flex justify-between items-center ${(activateReminder || reminderPopupActive) ? 'bg-green-600 text-white border-green-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              <span>🔄 Relance quotidienne</span> <span>{showDailyConfig ? '▲' : '▼'}</span>
            </button>
            {showDailyConfig && (
              <div className="bg-green-50 border border-t-0 border-green-200 p-4 rounded-b-lg flex flex-col gap-4">
                <div className="flex flex-wrap gap-6 justify-center">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-green-900 text-sm">
                    <input type="checkbox" checked={activateReminder} onChange={(e) => setActivateReminder(e.target.checked)} className="w-5 h-5 accent-green-600"/> E-mail
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-green-900 text-sm">
                    <input type="checkbox" checked={reminderPopupActive} onChange={(e) => setReminderPopupActive(e.target.checked)} className="w-5 h-5 accent-green-600"/> Pop-up alarme
                  </label>
                </div>
                <div className="flex items-center justify-center gap-2 pt-2 border-t border-green-200">
                  <span className="text-sm font-bold text-green-900">Heure du rappel :</span>
                  <input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="p-2 border border-green-300 rounded-lg text-black bg-white font-bold" />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col">
            <button type="button" onClick={() => setShowCalendarConfig(!showCalendarConfig)} disabled={isAiProcessing} className={`p-3 rounded-lg font-bold border transition-colors text-left flex justify-between items-center ${targetDate ? 'bg-purple-600 text-white border-purple-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              <span>📅 Calendrier (Agenda / .ics)</span> <span>{showCalendarConfig ? '▲' : '▼'}</span>
            </button>
            {showCalendarConfig && (
              <div className="bg-purple-50 border border-t-0 border-purple-200 p-4 rounded-b-lg flex flex-col gap-3 items-center">
                <label className="text-xs font-bold text-purple-900 uppercase">Date & Heure :</label>
                <input type="datetime-local" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="border border-purple-300 p-2 rounded-lg text-black bg-white font-bold" />
                
                <div className="flex flex-wrap gap-4 pt-1 justify-center">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-purple-900">
                    <input type="checkbox" checked={enableGoogleCal} onChange={(e) => setEnableGoogleCal(e.target.checked)} className="accent-purple-600" /> Google Agenda
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-purple-900">
                    <input type="checkbox" checked={enableICal} onChange={(e) => setEnableICal(e.target.checked)} className="accent-purple-600" /> Fichier iCal (.ics)
                  </label>
                </div>

                {targetDate && (
                  <button type="button" onClick={() => { setTargetDate(''); setShowCalendarConfig(false); }} className="bg-red-100 text-red-600 px-3 py-1 rounded-md text-xs font-bold hover:bg-red-200 transition-colors">
                    ✖ Annuler la date
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        <button type="submit" disabled={loading || isAiProcessing || (!newTitle.trim() && !newContent.trim())} className="mt-4 bg-gray-900 text-white px-6 py-4 rounded-xl font-bold text-lg hover:bg-gray-800 disabled:opacity-50 transition-colors w-full shadow-lg">
          {loading ? 'Création...' : isAiProcessing ? 'Veuillez patienter...' : 'Créer la note'}
        </button>
      </form>
      )}

      {!isFocusMode && (
        <div className="flex flex-wrap gap-4 mb-6">
          <button onClick={() => setShowArchived(false)} className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === false ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>📂 Dossier Actif</button>
          {hasSnoozedNotes && (
            <button onClick={() => setShowArchived('snoozed')} className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === 'snoozed' ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'}`}>💤 Masqué</button>
          )}
          <button onClick={() => setShowArchived(true)} className={`px-5 py-2.5 rounded font-bold transition-colors ${showArchived === true ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>📦 Archives</button>
        </div>
      )}

      <div className={`grid items-start gap-6 ${isFocusMode ? 'grid-cols-1 max-w-3xl mx-auto' : 'grid-cols-1 lg:grid-cols-3'}`}>
        {columns.map((col) => (
          <div key={col.id} className={isFocusMode ? 'flex flex-col' : 'flex flex-col bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-inner'}>
            {!isFocusMode && (() => {
              const isCollapsed = collapsedPriorities[col.id] ?? false;
              return (
                <button type="button" onClick={() => setCollapsedPriorities(prev => ({ ...prev, [col.id]: !prev[col.id] }))} className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-left mb-4 border-b-2 border-gray-200 pb-2 text-gray-800 hover:text-gray-950 transition-colors" aria-expanded={!isCollapsed}>
                  <span className="text-xl font-bold">{isCollapsed ? '▶' : '▼'} {col.title} ({col.notes.length})</span>
                </button>
              );
            })()}
            
            {(!isFocusMode ? !(collapsedPriorities[col.id] ?? false) : true) && (
            <ul className="space-y-4">
              {!isFocusMode && col.notes.length === 0 && <p className="text-gray-400 italic text-sm text-center py-4">Vide</p>}
              
              {col.notes.map((note) => (
                <li key={note.id} className={`flex flex-col gap-3 p-4 rounded shadow bg-white border-l-4 transition-all ${note.importance === 'rouge' ? 'border-red-500 bg-red-50' : note.importance === 'orange' ? 'border-orange-500 bg-orange-50' : 'border-green-500 bg-green-50'}`}>
                  <div className="flex items-start gap-2 flex-1 mt-1">
                    <input type="checkbox" checked={note.completed} onChange={() => updateNote(note.id, 'completed', !note.completed)} className="w-5 h-5 cursor-pointer mt-1 flex-shrink-0" />
                    
                    {editingId === note.id ? (
                      <div className="flex flex-col flex-1 gap-3 w-full">
                        {note.is_list ? (
                          <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm" autoFocus />
                        ) : (
                          <>
                            <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} placeholder="Titre (optionnel)" className="w-full border border-gray-400 p-2 rounded text-black font-semibold text-sm" />
                            <textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)} className="w-full border border-gray-400 p-2 rounded text-black resize-y min-h-[100px] text-sm" />
                          </>
                        )}
                        
                        <div className="flex flex-col gap-2 mt-1">
                          
                          <div className="flex flex-col">
                            <button type="button" onClick={() => setShowEditingPopupConfig(!showEditingPopupConfig)} className={`p-2 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${showEditingPopupConfig ? 'bg-indigo-600 text-white border-indigo-600 rounded-b-none' : 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100'}`}>
                              <span>⏰ Programmer une alarme pop-up</span> <span>{showEditingPopupConfig ? '▲' : '▼'}</span>
                            </button>
                            {showEditingPopupConfig && (
                              <div className="bg-indigo-50 border border-t-0 border-indigo-200 p-2 rounded-b flex flex-col items-center gap-2 justify-center">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-indigo-900">Dans:</span>
                                  <input type="number" placeholder="0" min="0" value={editingPopupHours} onChange={(e) => setEditingPopupHours(e.target.value)} className="w-12 p-1 border border-indigo-300 rounded text-center text-black text-xs" />
                                  <span className="text-xs font-bold text-indigo-900">h</span>
                                  <input type="number" placeholder="0" min="0" value={editingPopupMinutes} onChange={(e) => setEditingPopupMinutes(e.target.value)} className="w-12 p-1 border border-indigo-300 rounded text-center text-black text-xs" />
                                  <span className="text-xs font-bold text-indigo-900">min</span>
                                </div>
                                {(editingPopupHours || editingPopupMinutes) && (
                                  <button type="button" onClick={() => { setEditingPopupHours(''); setEditingPopupMinutes(''); setShowEditingPopupConfig(false); }} className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold hover:bg-red-200 transition-colors">
                                    ✖ Annuler
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <button type="button" onClick={() => triggerImmediateEmail(note)} className="p-2 rounded font-bold border transition-colors text-left text-xs bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 flex items-center gap-2">
                            <span>📨</span> Envoyer un rappel e-mail immédiat
                          </button>

                        </div>

                        <div className="flex gap-2 mt-2">
                          <button onClick={() => saveEdit(note.id)} className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 text-xs rounded font-bold">Enregistrer les modifs</button>
                          <button onClick={() => setEditingId(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1.5 text-xs rounded font-bold">Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div onDoubleClick={() => startEditing(note)} className={`flex-1 ${note.completed ? 'opacity-50 line-through' : ''}`}>
                         <div className="font-bold text-gray-900 text-lg">{note.title}</div>
                         <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{note.content}</div>
                      </div>
                    )}
                  </div>
                  
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

                  {note.target_date && !note.completed && editingId !== note.id && (
                    <div className="flex flex-col gap-2 mt-1 mb-2 bg-blue-50/50 p-2.5 rounded border border-blue-100">
                      <div className="flex justify-between items-center w-full">
                        <span className="text-xs font-bold text-blue-800">
                          📅 {new Date(note.target_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {note.popup_active && ' 🔔'}
                        </span>
                        <button onClick={() => { updateNote(note.id, 'target_date', ''); updateNote(note.id, 'popup_active', false); }} className="text-red-500 hover:bg-red-100 px-2 py-0.5 rounded text-xs font-bold transition-colors">✖ Annuler</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {enableGoogleCal && (
                          <a href={getGoogleCalendarLink(note)} target="_blank" rel="noopener noreferrer" className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded text-xs font-bold transition-colors text-center">Mon Google Agenda</a>
                        )}
                        {enableICal && (
                          <button onClick={() => downloadICS(note)} className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1.5 rounded text-xs font-bold transition-colors text-center">Partager (.ics)</button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs justify-end mt-2 pt-2 border-t border-gray-100">
                    {!isFocusMode && showArchived === 'snoozed' && (
                       <button onClick={() => updateNote(note.id, 'snooze_until', '')} className="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded font-medium transition-colors">↩ Réactiver</button>
                    )}

                    {!isFocusMode && showArchived === false && !note.completed && (
                      <div className="flex items-center gap-1">
                        <select value={snoozeDaysByNote[note.id] ?? 3} onChange={(e) => setSnoozeDaysByNote(prev => ({ ...prev, [note.id]: Number(e.target.value) }))} className="border border-yellow-300 bg-yellow-50 text-yellow-900 p-1 rounded cursor-pointer">
                          {Array.from({ length: 30 }, (_, index) => index + 1).map(days => (
                            <option key={days} value={days}>{days} {days === 1 ? 'jour' : 'jours'}</option>
                          ))}
                        </select>
                        <button onClick={() => snoozeNote(note.id, snoozeDaysByNote[note.id] ?? 3)} className="px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded font-medium transition-colors">💤 Masquer</button>
                      </div>
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

                  {!note.is_archived && (
                    <div className="flex flex-col gap-2 mt-2 text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                      <span className="font-semibold text-gray-600">Relances quotidiennes ({note.daily_reminder_time || '09:00'}) :</span>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={note.reminder_active} onChange={() => updateNote(note.id, 'reminder_active', !note.reminder_active)} className="cursor-pointer" />
                          E-mail
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={note.reminder_popup_active || false} onChange={() => updateNote(note.id, 'reminder_popup_active', !note.reminder_popup_active)} className="cursor-pointer" />
                          Pop-up
                        </label>
                      </div>
                    </div>
                  )}

                </li>
              ))}
            </ul>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
