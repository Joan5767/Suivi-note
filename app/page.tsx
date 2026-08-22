'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface Subtask { id: string; text: string; completed: boolean; }
interface Note {
  id: string; title: string; content: string; completed: boolean; is_archived: boolean;
  importance: 'vert' | 'orange' | 'rouge'; reminder_active: boolean; reminder_popup_active?: boolean; 
  daily_reminder_time?: string; subtasks: Subtask[]; is_list: boolean; target_date?: string;
  snooze_until?: string; completed_at?: string; popup_active?: boolean;
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
  const [collapsedPriorities, setCollapsedPriorities] = useState<Record<string, boolean>>({ rouge: true, orange: true, vert: true });

  const fetchNotes = async () => {
    const { data } = await supabase.from('notes').select('*').order('created_at', { ascending: false });
    if (data) setNotes(data);
  };

  useEffect(() => { fetchNotes(); }, []);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const now = Date.now();
      setCurrentTime(now);
      let needsUpdate = false;
      for (const note of notes) {
        if (note.popup_active && !note.completed && !note.is_archived && note.target_date) {
          if (new Date(note.target_date).getTime() <= now) {
            alert('⏰ RAPPEL : ' + (note.title || 'Note') + '\n' + (note.content || ''));
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
        title: newTitle, content: newContent, importance, subtasks: [],
        is_list: noteMode === 'list', reminder_active: activateReminder,
        reminder_popup_active: reminderPopupActive, daily_reminder_time: dailyTime,
        target_date: finalTargetDate, popup_active: finalPopupActive
    }]);

    if (error) { alert("Erreur Supabase : " + error.message); setLoading(false); return; }

    if (sendImmediateEmail) {
      await fetch('/api/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() || "Nouvelle note", importance })
      });
    }

    setNewTitle(''); setNewContent(''); setImportance('vert');
    setSendImmediateEmail(false); setShowPopupConfig(false); setPopupHours(''); setPopupMinutes('');
    setShowDailyConfig(false); setActivateReminder(false); setReminderPopupActive(false);
    setShowCalendarConfig(false); setTargetDate(''); setLoading(false);
    fetchNotes();
  };

  const deleteNote = async (id: string) => {
    if (window.confirm('Supprimer cette note ?')) {
      await supabase.from('notes').delete().eq('id', id); fetchNotes();
    }
  };

  const updateNote = async (id: string, field: string, value: any) => {
    const completedAt = field === 'completed' && value ? new Date().toISOString() : (field === 'completed' ? '' : undefined);
    await supabase.from('notes').update({ [field]: value, ...(completedAt !== undefined ? { completed_at: completedAt } : {}) }).eq('id', id);
    fetchNotes();
  };

  const toggleDictation = (mode: 'micro' | 'ai') => {
    if (listeningMode !== 'none') { if (recognitionRef.current) recognitionRef.current.stop(); return; }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Navigateur incompatible."); return; }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR'; recognition.continuous = true; recognitionRef.current = recognition;
    const transcript = { text: '' };
    
    recognition.onstart = () => setListeningMode(mode);
    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) current += event.results[i][0].transcript + ' ';
      transcript.text = current;
      if (noteMode === 'list') setNewTitle(current); else setNewContent(current);
    };

    recognition.onend = async () => {
      setListeningMode('none');
      const finalTranscript = transcript.text;
      if (mode === 'ai') {
        if (!finalTranscript.trim()) { alert("❌ Rien enregistré."); return; }
        alert(`🎤 Texte capté : "${finalTranscript}"\nEnvoi à l'IA...`);
        setIsAiProcessing(true);
        try {
          const res = await fetch('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: finalTranscript, currentDate: new Date().toLocaleString('fr-FR') })
          });
          const data = await res.json();
          if (!res.ok) { alert("❌ Erreur IA : " + (data.error || "Inconnue")); setIsAiProcessing(false); return; }
          alert("✅ L'IA a répondu !");
          setAiProposal(data);
        } catch (e: any) { alert("❌ Erreur réseau : " + e.message); }
        setIsAiProcessing(false);
      }
    };
    recognition.start();
  };

  const confirmAiNote = async (data: any) => {
    setLoading(true);
    await supabase.from('notes').insert([{
      title: data.title || '', content: data.content || '', importance: data.importance || 'vert',
      subtasks: [], is_list: data.is_list || false, reminder_active: false,
      reminder_popup_active: false, target_date: data.target_date || '', popup_active: !!data.target_date 
    }]);
    setAiProposal(null); setNewTitle(''); setNewContent(''); setLoading(false); fetchNotes();
  };

  const loadProposalIntoForm = (data: any) => {
    if (data.title) setNewTitle(data.title);
    if (data.content) setNewContent(data.content);
    if (data.importance) setImportance(data.importance);
    if (data.is_list !== undefined) setNoteMode(data.is_list ? 'list' : 'text');
    if (data.target_date) { setTargetDate(data.target_date); setShowCalendarConfig(true); }
    setAiProposal(null);
  };

  const displayedNotes = notes.filter(n => !n.is_archived);
  const columns = [
    { id: 'rouge', title: '🔴 Urgentes', notes: displayedNotes.filter(n => n.importance === 'rouge') },
    { id: 'orange', title: '🟠 Importantes', notes: displayedNotes.filter(n => n.importance === 'orange') },
    { id: 'vert', title: '🟢 Normales', notes: displayedNotes.filter(n => n.importance === 'vert') },
  ];

  return (
    <main className="max-w-7xl mx-auto p-6 pb-20 relative">
      {aiProposal && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg flex flex-col gap-4 border-4 border-purple-500">
            <h2 className="text-2xl font-bold text-gray-800 border-b pb-2">🤖 Proposition de l&apos;IA</h2>
            <div className="flex flex-col gap-2 text-base text-gray-800 bg-gray-50 p-4 rounded-lg">
              <p><strong>Titre :</strong> {aiProposal.title || '(Vide)'}</p>
              <p><strong>Contenu :</strong> {aiProposal.content}</p>
              <p><strong>Priorité :</strong> {aiProposal.importance}</p>
              {aiProposal.target_date && <p><strong>⏰ Rappel :</strong> {aiProposal.target_date}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => confirmAiNote(aiProposal)} className="flex-1 bg-green-600 text-white font-bold py-3 rounded-xl">✅ Valider et Créer</button>
              <button onClick={() => loadProposalIntoForm(aiProposal)} className="flex-1 bg-gray-200 font-bold py-3 rounded-xl">✏️ Modifier</button>
            </div>
            <button onClick={() => setAiProposal(null)} className="text-gray-400 text-sm underline text-center">Fermer</button>
          </div>
        </div>
      )}

      <h1 className="text-3xl font-bold text-gray-800 mb-6">Mes Notes &amp; Rappels</h1>

      <form onSubmit={addNote} className="flex flex-col gap-4 mb-8 p-6 rounded-lg shadow-md border bg-gray-50">
        <div className="flex gap-2">
          <button type="button" onClick={() => setNoteMode('text')} className={`px-4 py-2 text-sm rounded font-semibold ${noteMode === 'text' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200'}`}>📝 Texte</button>
          <button type="button" onClick={() => setNoteMode('list')} className={`px-4 py-2 text-sm rounded font-semibold ${noteMode === 'list' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200'}`}>✅ Liste</button>
        </div>

        <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre..." className="border p-2 rounded text-black font-semibold" />
        <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Contenu..." className="border p-3 rounded text-black min-h-[100px]" />

        <select value={importance} onChange={(e) => setImportance(e.target.value as any)} className="border p-3 rounded text-black font-bold bg-white">
          <option value="vert">🟢 Normale</option>
          <option value="orange">🟠 Importante</option>
          <option value="rouge">🔴 Urgente</option>
        </select>

        <div className="flex gap-3">
          <button type="button" onClick={() => toggleDictation('micro')} className="flex-1 py-3 bg-white border rounded-xl font-bold">🎙️ Dictée simple</button>
          <button type="button" onClick={() => toggleDictation('ai')} className="flex-1 py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl font-bold">🤖 Dictée IA</button>
        </div>

        <button type="submit" disabled={loading} className="bg-gray-900 text-white p-4 rounded-xl font-bold shadow-lg">Créer la note</button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {columns.map(col => (
          <div key={col.id} className="bg-gray-50 p-4 rounded-xl border shadow-inner">
            <h2 className="text-xl font-bold mb-4 text-gray-800">{col.title} ({col.notes.length})</h2>
            <ul className="space-y-4">
              {col.notes.map(note => (
                <li key={note.id} className="bg-white p-4 rounded shadow border-l-4 border-blue-500 flex flex-col gap-2">
                  <div className="font-bold text-gray-900 text-lg">{note.title}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</div>
                  <div className="flex justify-end gap-2 mt-2 pt-2 border-t">
                    <button onClick={() => updateNote(note.id, 'is_archived', true)} className="text-xs bg-gray-200 px-2 py-1 rounded">Archiver</button>
                    <button onClick={() => deleteNote(note.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Suppr</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
        }
                                                                                 
