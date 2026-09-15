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
  target_date?: string | null;
  snooze_until?: string | null;
  completed_at?: string | null;
  popup_active?: boolean;
  duration_minutes?: number | null;
  last_reminded_at?: string | null;
  last_email_reminded_at?: string | null;
  last_popup_reminded_at?: string | null;
  created_at?: string | null; 
}

interface WeeklyBlock {
  id: string;
  title: string;
  day: string;
  startHour: number;
  startMinute: number;
  duration: number;
  color: string;
  kind?: 'task' | 'marker';
}

interface PlanningTemplate {
  id: string;
  name: string;
  blocks: WeeklyBlock[];
  created_at?: string | null;
}

interface AiProposal {
  title: string;
  content: string;
  importance: 'vert' | 'orange' | 'rouge';
  is_list: boolean;
  list_items: string[];
  calendar_time: string | null;
  popup_time: string | null;
  send_email: boolean;
  daily_reminder: boolean;
  daily_reminder_time: string | null;
  daily_reminder_email: boolean;
  daily_reminder_popup: boolean;
}

const getSafeTime = (dateStr?: string | null) => {
  if (!dateStr) return 0;
  const s = dateStr.trim().replace(' ', 'T');
  const time = new Date(s).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const toValidIso = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const time = getSafeTime(value);
  return time ? new Date(time).toISOString() : '';
};

const escapeICS = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const formatDuration = (totalMinutes: number) => {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h > 0 && m > 0) return `${h}h${m.toString().padStart(2, '0')}`;
  if (h > 0) return `${h}h`;
  return `${m} min`;
};

// Sauvegarde locale des brouillons : protège les saisies en cas de rafraîchissement
// accidentel, fermeture du navigateur ou redémarrage de la PWA.
const NOTE_DRAFT_STORAGE_KEY = 'rappel-notes-note-draft-v1';
const PLANNING_DRAFT_STORAGE_KEY = 'rappel-notes-planning-draft-v1';

export default function Home() {
  const [mainMode, setMainMode] = useState<'hub' | 'notes' | 'planning_home' | 'planning' | 'planning_gallery'>('hub');
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'notes' | 'history'>('create');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [newListItems, setNewListItems] = useState<string[]>([]);
  const [currentNewListItem, setCurrentNewListItem] = useState('');
  const [newDurationHours, setNewDurationHours] = useState('');
  const [newDurationMinutes, setNewDurationMinutes] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
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
  const [enableICal, setEnableICal] = useState(false);
  
  const [showArchived, setShowArchived] = useState<boolean | 'snoozed'>(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusPhase, setFocusPhase] = useState<'rouge' | 'ask_orange' | 'orange' | 'ask_vert' | 'vert' | 'done'>('rouge');
  const [skippedFocusIds, setSkippedFocusIds] = useState<string[]>([]);
  
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [collapsedPriorities, setCollapsedPriorities] = useState<Record<string, boolean>>({
    rouge: true, orange: true, vert: true,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editingTargetDate, setEditingTargetDate] = useState('');
  const [editingPopupActive, setEditingPopupActive] = useState(false);
  const [showEditingPopupConfig, setShowEditingPopupConfig] = useState(false);
  const [showEditingExactDateConfig, setShowEditingExactDateConfig] = useState(false);
  const [editingPopupHours, setEditingPopupHours] = useState('');
  const [editingPopupMinutes, setEditingPopupMinutes] = useState('');
  const [showEditingDailyConfig, setShowEditingDailyConfig] = useState(false);
  const [editingImportance, setEditingImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [editingReminderActive, setEditingReminderActive] = useState(false);
  const [editingReminderPopupActive, setEditingReminderPopupActive] = useState(false);
  const [editingDailyTime, setEditingDailyTime] = useState('09:00');
  const [editingDurationHours, setEditingDurationHours] = useState('');
  const [editingDurationMinutes, setEditingDurationMinutes] = useState('');
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});

  const [listeningMode, setListeningMode] = useState<'none' | 'title' | 'content' | 'list_item' | 'ai'>('none');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const recognitionRef = useRef<any>(null);
  const [triggeredAlarm, setTriggeredAlarm] = useState<Note | null>(null);
  const locallyTriggeredAlarmIdsRef = useRef<Set<string>>(new Set());

  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupThresholdDays, setCleanupThresholdDays] = useState(30); 
  const [cleanupNotes, setCleanupNotes] = useState<Note[]>([]);
  const [currentCleanupIndex, setCurrentCleanupIndex] = useState(0);
  const [cleanupMode, setCleanupMode] = useState<'actif' | 'archive'>('actif');

  const WEEK_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const PLANNING_START_HOUR = 7;
  const PLANNING_END_HOUR = 22;
  const PLANNING_HEADER_HEIGHT = 40;
  const hoursOfDay = Array.from(
    { length: PLANNING_END_HOUR - PLANNING_START_HOUR + 1 },
    (_, i) => i + PLANNING_START_HOUR
  );

  const [weeklyBlocks, setWeeklyBlocks] = useState<WeeklyBlock[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<PlanningTemplate[]>([]); 
  const [previewTemplate, setPreviewTemplate] = useState<PlanningTemplate | null>(null);

  // Si un planning sauvegardé est chargé, on conserve son identité et son état d'origine.
  // Ainsi, « Enregistrer » met à jour CE planning au lieu d'en créer un nouveau.
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState('');
  const [planningSavedSnapshot, setPlanningSavedSnapshot] = useState<string | null>(null);
  const [showClosePlanningModal, setShowClosePlanningModal] = useState(false);
  
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [blockDay, setBlockDay] = useState('Lundi');
  const [blockTime, setBlockTime] = useState('09:00'); 
  const [blockTitle, setBlockTitle] = useState('');
  const [blockColor, setBlockColor] = useState('blue');
  const [blockKind, setBlockKind] = useState<'task' | 'marker'>('task');

  // Déplacement par appui long : un appui simple ouvre la bulle, un appui maintenu
  // permet de faire glisser le bloc vers un autre jour ou une autre heure.
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [draggingBlockPreview, setDraggingBlockPreview] = useState<{ day: string; hour: number; minute: number } | null>(null);
  const suppressedBlockClickIdsRef = useRef<Set<string>>(new Set());
  const activeBlockDragCleanupRef = useRef<(() => void) | null>(null);

  // Passe à true seulement après la restauration initiale de localStorage. Cela évite
  // que les valeurs par défaut écrasent un brouillon existant au premier rendu.
  const [draftStorageReady, setDraftStorageReady] = useState(false);

  // Redimensionnement des blocs : une ref évite les pertes d'événements pendant le drag tactile/souris.
  const resizingBlockRef = useRef<{ id: string; startY: number; initialDuration: number; maxDuration: number; pointerId: number } | null>(null);

  useEffect(() => {
    return () => {
      activeBlockDragCleanupRef.current?.();
    };
  }, []);

  const normalizeWeeklyBlocks = (rawBlocks: unknown): WeeklyBlock[] => {
    if (!Array.isArray(rawBlocks)) return [];

    const planningStartMinutes = PLANNING_START_HOUR * 60;
    const planningEndMinutes = (PLANNING_END_HOUR + 1) * 60;
    const allowedColors = new Set(['blue', 'green', 'red', 'gray']);

    return rawBlocks.flatMap((raw: any) => {
      if (!raw || typeof raw !== 'object') return [];

      const day =
        typeof raw.day === 'string' && WEEK_DAYS.includes(raw.day)
          ? raw.day
          : 'Lundi';

      const rawHour = Number(raw.startHour);
      const rawMinute = Number(raw.startMinute ?? 0);
      const requestedStart =
        (Number.isFinite(rawHour) ? rawHour : PLANNING_START_HOUR) * 60 +
        (Number.isFinite(rawMinute) ? rawMinute : 0);

      const snappedStart = Math.round(requestedStart / 15) * 15;
      const safeStart = Math.min(
        planningEndMinutes - 15,
        Math.max(planningStartMinutes, snappedStart)
      );

      const startHour = Math.floor(safeStart / 60);
      const startMinute = safeStart % 60;
      const maxDuration = Math.max(15, planningEndMinutes - safeStart);

      const kind: 'task' | 'marker' = raw.kind === 'marker' ? 'marker' : 'task';

      const rawDuration = Number(raw.duration ?? 60);
      const snappedDuration =
        Math.round((Number.isFinite(rawDuration) ? rawDuration : 60) / 15) * 15;
      const duration =
        kind === 'marker'
          ? 0
          : Math.min(maxDuration, Math.max(15, snappedDuration));

      return [{
        id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
        title: typeof raw.title === 'string' ? raw.title : '',
        day,
        startHour,
        startMinute,
        duration,
        color:
          typeof raw.color === 'string' && allowedColors.has(raw.color)
            ? raw.color
            : 'blue',
        kind,
      }];
    });
  };

  // Empreinte stable d'un planning pour savoir s'il a réellement été modifié.
  // L'ordre interne du tableau n'a pas d'importance visuelle, on trie donc par id.
  const getPlanningSnapshot = (blocks: WeeklyBlock[]) =>
    JSON.stringify(
      blocks
        .map(block => ({
          id: block.id,
          title: block.title,
          day: block.day,
          startHour: block.startHour,
          startMinute: block.startMinute || 0,
          duration: block.kind === 'marker' ? 0 : (block.duration || 60),
          color: block.color,
          kind: block.kind === 'marker' ? 'marker' : 'task',
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );

  const currentPlanningSnapshot = getPlanningSnapshot(weeklyBlocks);
  const isPlanningDirty = activeTemplateId
    ? planningSavedSnapshot !== currentPlanningSnapshot
    : weeklyBlocks.length > 0;

  // ==========================================
  // === PROTECTION CONTRE LE RAFRAÎCHISSEMENT ACCIDENTEL
  // ==========================================
  useEffect(() => {
    // Sur Chrome/Android et les navigateurs compatibles, ceci désactive le geste
    // « tirer vers le bas pour rafraîchir » sans empêcher le scroll normal de la page.
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverscrollY = html.style.overscrollBehaviorY;
    const previousBodyOverscrollY = body.style.overscrollBehaviorY;

    html.style.overscrollBehaviorY = 'none';
    body.style.overscrollBehaviorY = 'none';

    return () => {
      html.style.overscrollBehaviorY = previousHtmlOverscrollY;
      body.style.overscrollBehaviorY = previousBodyOverscrollY;
    };
  }, []);

  // ==========================================
  // === RESTAURATION AUTOMATIQUE DES BROUILLONS
  // ==========================================
  useEffect(() => {
    try {
      const savedNoteDraft = window.localStorage.getItem(NOTE_DRAFT_STORAGE_KEY);
      if (savedNoteDraft) {
        const draft = JSON.parse(savedNoteDraft);

        if (typeof draft.newTitle === 'string') setNewTitle(draft.newTitle);
        if (typeof draft.newContent === 'string') setNewContent(draft.newContent);
        if (draft.importance === 'vert' || draft.importance === 'orange' || draft.importance === 'rouge') {
          setImportance(draft.importance);
        }
        if (draft.noteMode === 'text' || draft.noteMode === 'list') setNoteMode(draft.noteMode);
        if (Array.isArray(draft.newListItems)) {
          setNewListItems(draft.newListItems.filter((item: unknown): item is string => typeof item === 'string'));
        }
        if (typeof draft.currentNewListItem === 'string') setCurrentNewListItem(draft.currentNewListItem);
        if (typeof draft.newDurationHours === 'string') setNewDurationHours(draft.newDurationHours);
        if (typeof draft.newDurationMinutes === 'string') setNewDurationMinutes(draft.newDurationMinutes);

        if (typeof draft.showAdvancedSettings === 'boolean') setShowAdvancedSettings(draft.showAdvancedSettings);
        if (typeof draft.sendImmediateEmail === 'boolean') setSendImmediateEmail(draft.sendImmediateEmail);
        if (typeof draft.showPopupConfig === 'boolean') setShowPopupConfig(draft.showPopupConfig);
        if (typeof draft.popupHours === 'string') setPopupHours(draft.popupHours);
        if (typeof draft.popupMinutes === 'string') setPopupMinutes(draft.popupMinutes);
        if (typeof draft.showDailyConfig === 'boolean') setShowDailyConfig(draft.showDailyConfig);
        if (typeof draft.activateReminder === 'boolean') setActivateReminder(draft.activateReminder);
        if (typeof draft.reminderPopupActive === 'boolean') setReminderPopupActive(draft.reminderPopupActive);
        if (typeof draft.dailyTime === 'string') setDailyTime(draft.dailyTime);
        if (typeof draft.showCalendarConfig === 'boolean') setShowCalendarConfig(draft.showCalendarConfig);
        if (typeof draft.targetDate === 'string') setTargetDate(draft.targetDate);
        if (typeof draft.enableGoogleCal === 'boolean') setEnableGoogleCal(draft.enableGoogleCal);
        if (typeof draft.enableICal === 'boolean') setEnableICal(draft.enableICal);
      }

      const savedPlanningDraft = window.localStorage.getItem(PLANNING_DRAFT_STORAGE_KEY);
      if (savedPlanningDraft) {
        const draft = JSON.parse(savedPlanningDraft);
        const restoredBlocks = normalizeWeeklyBlocks(draft?.weeklyBlocks);
        if (restoredBlocks.length > 0) setWeeklyBlocks(restoredBlocks);
        if (typeof draft?.activeTemplateId === 'string' && draft.activeTemplateId) {
          setActiveTemplateId(draft.activeTemplateId);
        }
        if (typeof draft?.activeTemplateName === 'string') {
          setActiveTemplateName(draft.activeTemplateName);
        }
        if (typeof draft?.planningSavedSnapshot === 'string') {
          setPlanningSavedSnapshot(draft.planningSavedSnapshot);
        }
      }
    } catch (error) {
      console.warn('Impossible de restaurer les brouillons locaux :', error);
    } finally {
      setDraftStorageReady(true);
    }
  }, []);

  // Sauvegarde automatiquement le formulaire de création de note à chaque modification.
  useEffect(() => {
    if (!draftStorageReady) return;

    try {
      window.localStorage.setItem(
        NOTE_DRAFT_STORAGE_KEY,
        JSON.stringify({
          newTitle,
          newContent,
          importance,
          noteMode,
          newListItems,
          currentNewListItem,
          newDurationHours,
          newDurationMinutes,
          showAdvancedSettings,
          sendImmediateEmail,
          showPopupConfig,
          popupHours,
          popupMinutes,
          showDailyConfig,
          activateReminder,
          reminderPopupActive,
          dailyTime,
          showCalendarConfig,
          targetDate,
          enableGoogleCal,
          enableICal,
        })
      );
    } catch (error) {
      console.warn('Impossible de sauvegarder le brouillon de note :', error);
    }
  }, [
    draftStorageReady,
    newTitle,
    newContent,
    importance,
    noteMode,
    newListItems,
    currentNewListItem,
    newDurationHours,
    newDurationMinutes,
    showAdvancedSettings,
    sendImmediateEmail,
    showPopupConfig,
    popupHours,
    popupMinutes,
    showDailyConfig,
    activateReminder,
    reminderPopupActive,
    dailyTime,
    showCalendarConfig,
    targetDate,
    enableGoogleCal,
    enableICal,
  ]);

  // Sauvegarde également le planning en cours tant qu'il n'a pas forcément été enregistré
  // dans Supabase. Un refresh accidentel ne détruit donc plus la semaine en préparation.
  useEffect(() => {
    if (!draftStorageReady) return;

    try {
      window.localStorage.setItem(
        PLANNING_DRAFT_STORAGE_KEY,
        JSON.stringify({
          weeklyBlocks,
          activeTemplateId,
          activeTemplateName,
          planningSavedSnapshot,
        })
      );
    } catch (error) {
      console.warn('Impossible de sauvegarder le brouillon du planning :', error);
    }
  }, [draftStorageReady, weeklyBlocks, activeTemplateId, activeTemplateName, planningSavedSnapshot]);

  // ==========================================
  // === 1. BLOCAGE DU ZOOM NATIF DU NAVIGATEUR
  // ==========================================
  useEffect(() => {
    const preventNativeZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };
    
    document.addEventListener('touchmove', preventNativeZoom, { passive: false });
    return () => {
      document.removeEventListener('touchmove', preventNativeZoom);
    };
  }, []);

  // ==========================================
  // === 2. CAPTEUR CENTRAL (ZOOM 2 AXES + PAN)
  // ==========================================
  const gridRef = useRef<HTMLDivElement>(null);
  const daysScrollRef = useRef<HTMLDivElement>(null);
  const daysHeaderScrollRef = useRef<HTMLDivElement>(null);

  // Zoom vertical : hauteur d'une heure en pixels
  const [hourHeight, setHourHeight] = useState(64);
  const currentHourHeight = useRef(64);

  // Zoom horizontal : nombre de jours visibles simultanément.
  // 3 = environ 3 jours visibles ; plus petit = colonnes plus larges.
  const [daysPerView, setDaysPerView] = useState(3);
  const currentDaysPerView = useRef(3);

  // Taille des noms de jours liée au dézoom horizontal.
  // Jusqu'à 3 jours visibles : 14 px. Puis la police diminue progressivement
  // pour atteindre 8 px lorsque les 7 jours sont visibles.
  const dayHeaderFontSize = Math.max(
    8,
    Math.min(14, 14 - Math.max(0, daysPerView - 3) * 1.5)
  );

  // Taille du texte des tâches liée aux deux niveaux de zoom du planning.
  // - Zoom horizontal : moins de jours visibles = colonnes plus larges = texte plus grand.
  // - Zoom vertical : heures plus hautes = davantage de place = texte plus grand.
  // La taille reste bornée pour conserver une bonne lisibilité aux extrêmes.
  const horizontalTaskFontBase = Math.max(7, Math.min(14, 10 + (3 - daysPerView) * 1.2));
  const verticalTaskFontFactor = Math.max(0.85, Math.min(1.35, Math.sqrt(hourHeight / 64)));
  const planningTaskFontSize = Math.max(7, Math.min(14, horizontalTaskFontBase * verticalTaskFontFactor));
  const planningTaskTimeFontSize = Math.max(6, Math.min(12, planningTaskFontSize * 0.84));
  const planningTaskPadding = Math.max(2, Math.min(6, planningTaskFontSize * 0.48));

  useEffect(() => {
    currentHourHeight.current = hourHeight;
  }, [hourHeight]);

  useEffect(() => {
    currentDaysPerView.current = daysPerView;
  }, [daysPerView]);

  // Synchronise la ligne des jours figée avec le corps du planning.
  // On peut aussi glisser directement sur l'en-tête : le corps suit le même déplacement.
  useEffect(() => {
    if (mainMode !== 'planning') return;

    const bodyScroller = daysScrollRef.current;
    const headerScroller = daysHeaderScrollRef.current;
    if (!bodyScroller || !headerScroller) return;

    let syncing = false;
    let rafId: number | undefined;

    const releaseSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        syncing = false;
      });
    };

    const syncHeaderFromBody = () => {
      if (syncing) return;
      syncing = true;
      headerScroller.scrollLeft = bodyScroller.scrollLeft;
      releaseSync();
    };

    const syncBodyFromHeader = () => {
      if (syncing) return;
      syncing = true;
      bodyScroller.scrollLeft = headerScroller.scrollLeft;
      releaseSync();
    };

    // Aligne immédiatement les deux zones au montage.
    headerScroller.scrollLeft = bodyScroller.scrollLeft;

    bodyScroller.addEventListener('scroll', syncHeaderFromBody, { passive: true });
    headerScroller.addEventListener('scroll', syncBodyFromHeader, { passive: true });

    return () => {
      bodyScroller.removeEventListener('scroll', syncHeaderFromBody);
      headerScroller.removeEventListener('scroll', syncBodyFromHeader);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [mainMode]);

  useEffect(() => {
    if (mainMode !== 'planning') return;

    const grid = gridRef.current;
    const scroller = daysScrollRef.current;
    if (!grid || !scroller) return;

    let startSpanX = 0;
    let startSpanY = 0;
    let startHeight = 64;
    let startDaysPerView = 3;
    let startScrollLeft = 0;
    let startCenterX = 0;
    let gestureAxis: 'horizontal' | 'vertical' | null = null;
    let rafId: number | undefined;

    const getTouchGeometry = (touches: TouchList) => {
      const t1 = touches[0];
      const t2 = touches[1];
      return {
        spanX: Math.abs(t1.clientX - t2.clientX),
        spanY: Math.abs(t1.clientY - t2.clientY),
        centerX: (t1.clientX + t2.clientX) / 2,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      // À un doigt, aucun JS : le navigateur garde le pan horizontal natif.
      if (e.touches.length !== 2) return;

      if (e.cancelable) e.preventDefault();

      const geo = getTouchGeometry(e.touches);
      startSpanX = Math.max(geo.spanX, 20);
      startSpanY = Math.max(geo.spanY, 20);
      startHeight = currentHourHeight.current;
      startDaysPerView = currentDaysPerView.current;
      startScrollLeft = scroller.scrollLeft;

      const rect = scroller.getBoundingClientRect();
      startCenterX = geo.centerX - rect.left;
      gestureAxis = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startSpanX <= 0 || startSpanY <= 0) return;
      if (e.cancelable) e.preventDefault();

      const geo = getTouchGeometry(e.touches);
      const deltaX = Math.abs(geo.spanX - startSpanX);
      const deltaY = Math.abs(geo.spanY - startSpanY);

      // On attend un petit mouvement avant de choisir l'axe, puis on le verrouille
      // jusqu'à la fin du geste pour éviter les sauts entre X et Y.
      if (!gestureAxis) {
        if (Math.max(deltaX, deltaY) < 6) return;
        gestureAxis = deltaX >= deltaY ? 'horizontal' : 'vertical';
      }

      if (rafId) cancelAnimationFrame(rafId);

      if (gestureAxis === 'horizontal') {
        const horizontalScale = Math.max(0.35, geo.spanX / startSpanX);

        // Écarter les doigts => moins de jours visibles => colonnes plus larges.
        // Pincer => davantage de jours visibles => colonnes plus étroites.
        let newDaysPerView = startDaysPerView / horizontalScale;
        newDaysPerView = Math.min(7, Math.max(1.15, newDaysPerView));

        // Ratio réel de largeur du contenu avant/après le zoom.
        const contentScale = startDaysPerView / newDaysPerView;

        rafId = window.requestAnimationFrame(() => {
          setDaysPerView(newDaysPerView);

          // Maintient autant que possible le point situé sous le centre du pincement.
          requestAnimationFrame(() => {
            const targetScrollLeft =
              (startScrollLeft + startCenterX) * contentScale - startCenterX;
            const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
            scroller.scrollLeft = Math.min(maxScroll, Math.max(0, targetScrollLeft));
          });
        });
      } else {
        const verticalScale = Math.max(0.35, geo.spanY / startSpanY);
        let newHeight = startHeight * verticalScale;

        newHeight = Math.min(200, Math.max(40, newHeight));

        rafId = window.requestAnimationFrame(() => {
          setHourHeight(newHeight);
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        startSpanX = 0;
        startSpanY = 0;
        gestureAxis = null;
      }
    };

    grid.addEventListener('touchstart', handleTouchStart, { passive: false });
    grid.addEventListener('touchmove', handleTouchMove, { passive: false });
    grid.addEventListener('touchend', handleTouchEnd);
    grid.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      grid.removeEventListener('touchstart', handleTouchStart);
      grid.removeEventListener('touchmove', handleTouchMove);
      grid.removeEventListener('touchend', handleTouchEnd);
      grid.removeEventListener('touchcancel', handleTouchEnd);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [mainMode]);

  // ==========================================
  // === SYSTÈME DE ROUTAGE NATIF (RETOUR) ====
  // ==========================================
  const appStateRef = useRef({
    showBlockModal, showCleanupModal, aiProposal, triggeredAlarm, 
    openMenuId, editingId, isFocusMode, activeTab, mainMode, previewTemplate
  });

  useEffect(() => {
    appStateRef.current = {
      showBlockModal, showCleanupModal, aiProposal, triggeredAlarm, 
      openMenuId, editingId, isFocusMode, activeTab, mainMode, previewTemplate
    };
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      
      setShowBlockModal(false);
      setShowCleanupModal(false);
      setAiProposal(null);
      setTriggeredAlarm(null);
      setOpenMenuId(null);
      setEditingId(null);
      setEditingBlockId(null);
      setSelectedBlockId(null);
      setPreviewTemplate(null);

      switch(hash) {
        case '#notes-create':
          setMainMode('notes'); setActiveTab('create'); setIsFocusMode(false); break;
        case '#notes-list':
          setMainMode('notes'); setActiveTab('notes'); setIsFocusMode(false); break;
        case '#notes-history':
          setMainMode('notes'); setActiveTab('history'); setIsFocusMode(false); break;
        case '#notes-focus':
          setMainMode('notes'); setIsFocusMode(true); break;
        case '#planning':
          setMainMode('planning_home'); break;
        case '#planning-editor':
          setMainMode('planning'); break;
        case '#planning-gallery':
          setMainMode('planning_gallery'); break;
        case '#hub':
        default:
          setMainMode('hub'); break;
      }
    };

    if (!window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + '#hub');
    }
    
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Navigation propre de la partie Planning : on garde une seule entrée enfant
  // (éditeur OU galerie) dans l'historique. Passer plusieurs fois de l'un à l'autre
  // ne remplit donc plus le bouton Retour du téléphone avec toutes les étapes.
  const refreshRouteFromCurrentHash = () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const navigatePlanningChild = (targetHash: '#planning-editor' | '#planning-gallery') => {
    const currentHash = window.location.hash;
    const targetUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
    const currentIsPlanningChild = currentHash === '#planning-editor' || currentHash === '#planning-gallery';

    if (currentIsPlanningChild) {
      // Éditeur <-> galerie = même niveau logique : on remplace l'étape courante.
      window.history.replaceState({ ...(window.history.state || {}), planningChild: true }, '', targetUrl);
      refreshRouteFromCurrentHash();
      return;
    }

    // Depuis l'accueil Planning, on crée une seule vraie étape enfant.
    window.history.pushState({ ...(window.history.state || {}), planningChild: true }, '', targetUrl);
    refreshRouteFromCurrentHash();
  };

  const navigatePlanningHome = () => {
    const currentHash = window.location.hash;
    const currentIsPlanningChild = currentHash === '#planning-editor' || currentHash === '#planning-gallery';

    if (currentIsPlanningChild && window.history.state?.planningChild) {
      // L'accueil Planning est juste derrière l'enfant dans l'historique contrôlé.
      window.history.back();
      return;
    }

    // Cas de secours (ex. ouverture directe / refresh sur une URL enfant).
    const targetUrl = `${window.location.pathname}${window.location.search}#planning`;
    window.history.replaceState({ ...(window.history.state || {}), planningChild: false }, '', targetUrl);
    refreshRouteFromCurrentHash();
  };

  // ==========================================

  const fetchNotes = async () => {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur chargement notes :', error);
      return false;
    }

    setNotes((data || []) as Note[]);
    return true;
  };

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from('planning_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur chargement plannings :', error);
      return false;
    }

    const templates = (data || []).map((template: any) => ({
      ...template,
      name: typeof template.name === 'string' ? template.name : 'Planning sans nom',
      blocks: normalizeWeeklyBlocks(template.blocks),
    })) as PlanningTemplate[];

    setSavedTemplates(templates);
    return true;
  };

  useEffect(() => { 
    fetchNotes(); 
    fetchTemplates();
  }, []);

  // Resynchronise les données quand l'utilisateur revient dans l'application.
  // C'est utile car les rappels peuvent être modifiés côté serveur pendant que
  // l'application est en arrière-plan.
  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchNotes();
      void fetchTemplates();
    };

    window.addEventListener('focus', syncWhenVisible);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return () => {
      window.removeEventListener('focus', syncWhenVisible);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) {
            setIsPushEnabled(true);
            fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) }).catch(console.error);
          }
        });
      }).catch(console.error);
    }
  }, []);

  const subscribeToPush = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicVapidKey) return alert("Erreur : La clé VAPID publique manque dans Vercel.");

      const convertedVapidKey = urlBase64ToUint8Array(publicVapidKey);
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
      const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });

      if (res.ok) {
        setIsPushEnabled(true);
        alert("✅ Téléphone connecté avec succès ! Tu recevras les alertes en arrière-plan.");
      } else {
        const err = await res.json();
        alert("Erreur de sauvegarde : " + err.error);
      }
    } catch (error: any) {
      alert(Notification.permission === 'denied' ? "❌ Tu as bloqué les notifications." : "❌ Erreur d'abonnement : " + error.message);
    }
  };

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setCurrentTime(now);

      // Le push système est géré côté serveur par Supabase Cron -> Vercel.
      // Ici on garde seulement la grande alerte visuelle quand l'application est ouverte.
      // Le navigateur ne modifie plus popup_active : cela évite une course avec le worker
      // serveur et donc des notifications perdues ou en doublon.
      const dueNote = notes.find(note => {
        if (!note.popup_active || note.completed || note.is_archived || !note.target_date) return false;
        if (locallyTriggeredAlarmIdsRef.current.has(note.id)) return false;
        const targetTime = getSafeTime(note.target_date);
        return targetTime > 0 && targetTime <= now;
      });

      if (dueNote) {
        locallyTriggeredAlarmIdsRef.current.add(dueNote.id);
        setTriggeredAlarm(dueNote);
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [notes]);

  const acknowledgeTriggeredAlarm = async () => {
    const alarm = triggeredAlarm;
    if (!alarm) return;

    // Ferme immédiatement la modale et met aussi l'état local à jour pour éviter
    // que l'interface reste sur « En cours... » en attendant une resynchronisation.
    setTriggeredAlarm(null);
    locallyTriggeredAlarmIdsRef.current.add(alarm.id);
    setNotes(prev => prev.map(note =>
      note.id === alarm.id ? { ...note, popup_active: false } : note
    ));

    const { error } = await supabase
      .from('notes')
      .update({ popup_active: false })
      .eq('id', alarm.id);

    if (error) {
      console.error('Erreur acquittement alarme :', error);
      await fetchNotes();
    }
  };

  useEffect(() => {
    if (!isFocusMode) return;

    const currentFocusable = notes.filter(n => 
      !n.completed && 
      !n.is_archived && 
      (!n.snooze_until || new Date(n.snooze_until).getTime() <= currentTime) && 
      !skippedFocusIds.includes(n.id)
    );

    const urgentCount = currentFocusable.filter(n => n.importance === 'rouge').length;
    const importantCount = currentFocusable.filter(n => n.importance === 'orange').length;
    const normalCount = currentFocusable.filter(n => n.importance === 'vert').length;

    if (focusPhase === 'rouge' && urgentCount === 0) {
       if (importantCount > 0) setFocusPhase('ask_orange');
       else if (normalCount > 0) setFocusPhase('ask_vert');
       else setFocusPhase('done');
    } else if (focusPhase === 'orange' && importantCount === 0) {
       if (normalCount > 0) setFocusPhase('ask_vert');
       else setFocusPhase('done');
    } else if (focusPhase === 'vert' && normalCount === 0) {
       setFocusPhase('done');
    }
  }, [isFocusMode, focusPhase, notes, skippedFocusIds, currentTime]);

  const openAddBlockModal = (day: string, hour: number, minute: number = 0) => {
    setEditingBlockId(null);
    setBlockDay(day);
    const h = hour.toString().padStart(2, '0');
    const m = minute.toString().padStart(2, '0');
    setBlockTime(`${h}:${m}`);
    setBlockTitle('');
    setBlockColor('blue');
    setBlockKind('task');
    setShowBlockModal(true);
  };

  const openEditBlockModal = (block: WeeklyBlock) => {
    setEditingBlockId(block.id);
    setBlockDay(block.day);
    const h = block.startHour.toString().padStart(2, '0');
    const m = (block.startMinute || 0).toString().padStart(2, '0');
    setBlockTime(`${h}:${m}`);
    setBlockTitle(block.title);
    setBlockColor(block.color);
    setBlockKind(block.kind === 'marker' ? 'marker' : 'task');
    setShowBlockModal(true);
  };

  const saveBlock = () => {
    if (!blockTitle.trim()) return;

    const [hStr, mStr] = blockTime.split(':');
    const parsedHour = parseInt(hStr, 10);
    const parsedMinute = parseInt(mStr, 10);

    if (!Number.isFinite(parsedHour) || !Number.isFinite(parsedMinute)) {
      alert("Heure invalide.");
      return;
    }

    // La grille couvre 7:00 -> 23:00 (la ligne 22h représente 22:00 à 23:00).
    // On borne l'heure par pas de 15 min pour empêcher un bloc de sortir de la grille.
    const planningStartMinutes = PLANNING_START_HOUR * 60;
    const planningEndMinutes = (PLANNING_END_HOUR + 1) * 60;
    const requestedStartMinutes = parsedHour * 60 + parsedMinute;
    const snappedStartMinutes = Math.round(requestedStartMinutes / 15) * 15;
    const safeStartMinutes = Math.min(planningEndMinutes - 15, Math.max(planningStartMinutes, snappedStartMinutes));

    const startHour = Math.floor(safeStartMinutes / 60);
    const startMinute = safeStartMinutes % 60;
    const maxDuration = Math.max(15, planningEndMinutes - safeStartMinutes);

    if (editingBlockId) {
      setWeeklyBlocks(prev => prev.map(b => {
        if (b.id !== editingBlockId) return b;
        const safeDuration =
          blockKind === 'marker'
            ? 0
            : Math.min(maxDuration, Math.max(15, b.duration || 60));
        return {
          ...b,
          title: blockTitle.trim(),
          day: blockDay,
          startHour,
          startMinute,
          duration: safeDuration,
          color: blockColor,
          kind: blockKind,
        };
      }));
    } else {
      const newBlock: WeeklyBlock = {
        id: crypto.randomUUID(),
        title: blockTitle.trim(),
        day: blockDay,
        startHour,
        startMinute,
        duration: blockKind === 'marker' ? 0 : Math.min(60, maxDuration),
        color: blockColor,
        kind: blockKind,
      };
      setWeeklyBlocks(prev => [...prev, newBlock]);
    }

    setShowBlockModal(false);
    setEditingBlockId(null);
    setSelectedBlockId(null);
  };

  const deleteBlock = (id: string) => {
    if (window.confirm("Es-tu sûr de vouloir supprimer cet élément de ton planning ?")) {
      setWeeklyBlocks(prev => prev.filter(b => b.id !== id));
      setSelectedBlockId(null);
    }
  };

  const suppressNextBlockClick = (id: string) => {
    suppressedBlockClickIdsRef.current.add(id);
    window.setTimeout(() => suppressedBlockClickIdsRef.current.delete(id), 700);
  };

  const consumeSuppressedBlockClick = (id: string) => {
    if (!suppressedBlockClickIdsRef.current.has(id)) return false;
    suppressedBlockClickIdsRef.current.delete(id);
    return true;
  };

  const updateDraggedBlockPosition = (block: WeeklyBlock, clientX: number, clientY: number) => {
    const scroller = daysScrollRef.current;
    if (!scroller) return;

    // Défilement automatique horizontal quand on approche d'un bord.
    const scrollerRect = scroller.getBoundingClientRect();
    const horizontalEdge = Math.min(55, scrollerRect.width * 0.18);
    if (clientX < scrollerRect.left + horizontalEdge) {
      scroller.scrollLeft -= 16;
    } else if (clientX > scrollerRect.right - horizontalEdge) {
      scroller.scrollLeft += 16;
    }

    // Et verticalement pour atteindre une heure hors de l'écran sans relâcher.
    const verticalEdge = 70;
    if (clientY < verticalEdge) {
      window.scrollBy(0, -14);
    } else if (clientY > window.innerHeight - verticalEdge) {
      window.scrollBy(0, 14);
    }

    const pointedElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    let dayColumn = pointedElement?.closest<HTMLElement>('[data-planning-day]') || null;

    if (!dayColumn) {
      const columns = Array.from(document.querySelectorAll<HTMLElement>('[data-planning-day]'));
      dayColumn = columns.find(column => {
        const rect = column.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right;
      }) || null;
    }

    const targetDay = dayColumn?.dataset.planningDay;
    if (!dayColumn || !targetDay || !WEEK_DAYS.includes(targetDay)) return;

    const rect = dayColumn.getBoundingClientRect();
    const relativeY = clientY - rect.top - PLANNING_HEADER_HEIGHT;
    const rawStartMinutes = PLANNING_START_HOUR * 60 + (relativeY / currentHourHeight.current) * 60;

    const planningStartMinutes = PLANNING_START_HOUR * 60;
    const planningEndMinutes = (PLANNING_END_HOUR + 1) * 60;
    const effectiveDuration = block.kind === 'marker' ? 15 : Math.max(15, block.duration || 60);
    const latestStartMinutes = Math.max(planningStartMinutes, planningEndMinutes - effectiveDuration);

    // Le déplacement se cale sur la même grille de 15 minutes que la création.
    const snappedMinutes = Math.round(rawStartMinutes / 15) * 15;
    const safeStartMinutes = Math.min(
      latestStartMinutes,
      Math.max(planningStartMinutes, snappedMinutes)
    );

    const startHour = Math.floor(safeStartMinutes / 60);
    const startMinute = safeStartMinutes % 60;

    setDraggingBlockPreview({ day: targetDay, hour: startHour, minute: startMinute });
    setWeeklyBlocks(prev => prev.map(item =>
      item.id === block.id
        ? { ...item, day: targetDay, startHour, startMinute }
        : item
    ));
  };

  const startTouchBlockDrag = (e: React.TouchEvent<HTMLDivElement>, block: WeeklyBlock) => {
    if (e.touches.length !== 1) return;
    if ((e.target as HTMLElement).closest('[data-block-drag-ignore="true"]')) return;

    activeBlockDragCleanupRef.current?.();

    const touch = e.touches[0];
    const touchId = touch.identifier;
    const startX = touch.clientX;
    const startY = touch.clientY;
    let active = false;
    let finished = false;

    const activateDrag = () => {
      if (finished) return;
      active = true;
      setSelectedBlockId(null);
      setDraggingBlockId(block.id);
      setDraggingBlockPreview({ day: block.day, hour: block.startHour, minute: block.startMinute || 0 });
      suppressNextBlockClick(block.id);
      if ('vibrate' in navigator) navigator.vibrate?.(35);
    };

    const timer = window.setTimeout(activateDrag, 420);

    const findTouch = (list: TouchList) => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === touchId) return list[i];
      }
      return null;
    };

    function handleMove(event: TouchEvent) {
      const currentTouch = findTouch(event.touches);
      if (!currentTouch) return;

      // Si l'utilisateur commence à faire défiler avant l'appui long, on annule le drag.
      if (!active) {
        const distance = Math.hypot(currentTouch.clientX - startX, currentTouch.clientY - startY);
        if (distance > 10) cleanup();
        return;
      }

      if (event.cancelable) event.preventDefault();
      updateDraggedBlockPosition(block, currentTouch.clientX, currentTouch.clientY);
    }

    function handleEnd(event: TouchEvent) {
      const remainingTouch = findTouch(event.touches);
      if (remainingTouch) return;

      if (active) {
        const finalTouch = findTouch(event.changedTouches);
        if (finalTouch) updateDraggedBlockPosition(block, finalTouch.clientX, finalTouch.clientY);
      }
      cleanup();
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
      if (active) {
        setDraggingBlockId(null);
        setDraggingBlockPreview(null);
        suppressNextBlockClick(block.id);
      }
      if (activeBlockDragCleanupRef.current === cleanup) {
        activeBlockDragCleanupRef.current = null;
      }
    }

    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
    activeBlockDragCleanupRef.current = cleanup;
  };

  const startMouseBlockDrag = (e: React.PointerEvent<HTMLDivElement>, block: WeeklyBlock) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-block-drag-ignore="true"]')) return;

    activeBlockDragCleanupRef.current?.();

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let finished = false;

    const activateDrag = () => {
      if (finished) return;
      active = true;
      setSelectedBlockId(null);
      setDraggingBlockId(block.id);
      setDraggingBlockPreview({ day: block.day, hour: block.startHour, minute: block.startMinute || 0 });
      suppressNextBlockClick(block.id);
    };

    const timer = window.setTimeout(activateDrag, 320);

    function handleMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;

      if (!active) {
        const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (distance > 8) cleanup();
        return;
      }

      if (event.cancelable) event.preventDefault();
      updateDraggedBlockPosition(block, event.clientX, event.clientY);
    }

    function handleEnd(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (active) updateDraggedBlockPosition(block, event.clientX, event.clientY);
      cleanup();
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (active) {
        setDraggingBlockId(null);
        setDraggingBlockPreview(null);
        suppressNextBlockClick(block.id);
      }
      if (activeBlockDragCleanupRef.current === cleanup) {
        activeBlockDragCleanupRef.current = null;
      }
    }

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    activeBlockDragCleanupRef.current = cleanup;
  };

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>, block: WeeklyBlock) => {
    e.preventDefault();
    e.stopPropagation();

    // Pointer capture = le bloc continue de recevoir les mouvements même si le doigt
    // ou la souris sort visuellement de la poignée pendant le redimensionnement.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    const planningEndMinutes = (PLANNING_END_HOUR + 1) * 60;
    const blockStartMinutes = block.startHour * 60 + (block.startMinute || 0);
    const maxDuration = Math.max(15, planningEndMinutes - blockStartMinutes);

    resizingBlockRef.current = {
      id: block.id,
      startY: e.clientY,
      initialDuration: block.duration || 60,
      maxDuration,
      pointerId: e.pointerId
    };
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const resizing = resizingBlockRef.current;
    if (!resizing || resizing.pointerId !== e.pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    const diffY = e.clientY - resizing.startY;
    const activeHourHeight = currentHourHeight.current || 64;
    const rawDuration = resizing.initialDuration + ((diffY * 60) / activeHourHeight);

    // Pas de 15 minutes. On empêche également le bloc de dépasser le bas de la grille.
    const snappedDuration = Math.min(
      resizing.maxDuration,
      Math.max(15, Math.round(rawDuration / 15) * 15)
    );

    setWeeklyBlocks(prev => prev.map(b =>
      b.id === resizing.id ? { ...b, duration: snappedDuration } : b
    ));
  };

  const handleResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const resizing = resizingBlockRef.current;
    if (!resizing || resizing.pointerId !== e.pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}

    resizingBlockRef.current = null;
  };

  const saveTemplateToDB = async (): Promise<boolean> => {
    if (weeklyBlocks.length === 0) {
      alert("Ton planning est vide ! Ajoute des tâches ou des repères avant de sauvegarder.");
      return false;
    }

    const normalizedBlocks = normalizeWeeklyBlocks(weeklyBlocks);

    // Un planning déjà chargé doit être MIS À JOUR, jamais dupliqué silencieusement.
    if (activeTemplateId) {
      if (!isPlanningDirty) {
        alert("✓ Ce planning est déjà à jour.");
        return true;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('planning_templates')
          .update({ blocks: normalizedBlocks })
          .eq('id', activeTemplateId)
          .select('id')
          .single();

        if (error) throw error;
        if (!data?.id) throw new Error("Le planning sauvegardé n'existe plus.");

        setWeeklyBlocks(normalizedBlocks);
        setPlanningSavedSnapshot(getPlanningSnapshot(normalizedBlocks));
        await fetchTemplates();
        alert(`✅ « ${activeTemplateName || 'Planning'} » a été mis à jour.`);
        return true;
      } catch (error: any) {
        alert("Erreur de sauvegarde : " + (error?.message || "erreur inconnue"));
        return false;
      } finally {
        setLoading(false);
      }
    }

    // Aucun modèle chargé : on crée un nouveau planning une seule fois,
    // puis il devient le planning actif pour les sauvegardes suivantes.
    const name = window.prompt("Donne un nom à ce planning (ex: 'Semaine d'école' ou 'Vacances') :");
    const cleanName = name?.trim();
    if (!cleanName) return false;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('planning_templates')
        .insert([{
          name: cleanName,
          blocks: normalizedBlocks,
        }])
        .select('*')
        .single();

      if (error) throw error;

      const createdBlocks = normalizeWeeklyBlocks(data?.blocks || normalizedBlocks);
      setWeeklyBlocks(createdBlocks);
      setActiveTemplateId(data.id);
      setActiveTemplateName(typeof data.name === 'string' ? data.name : cleanName);
      setPlanningSavedSnapshot(getPlanningSnapshot(createdBlocks));
      await fetchTemplates();
      alert("✅ Planning sauvegardé ! Les prochaines modifications mettront à jour ce même planning.");
      return true;
    } catch (error: any) {
      alert("Erreur de sauvegarde : " + (error?.message || "erreur inconnue"));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const closePlanningNow = () => {
    setWeeklyBlocks([]);
    setActiveTemplateId(null);
    setActiveTemplateName('');
    setPlanningSavedSnapshot(null);
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setPreviewTemplate(null);
    setShowBlockModal(false);
    setShowClosePlanningModal(false);
    navigatePlanningHome();
  };

  const requestClosePlanning = () => {
    const hasUnsavedChanges = activeTemplateId ? isPlanningDirty : weeklyBlocks.length > 0;

    if (hasUnsavedChanges) {
      setShowClosePlanningModal(true);
      return;
    }

    closePlanningNow();
  };

  const saveAndClosePlanning = async () => {
    const saved = await saveTemplateToDB();
    if (saved) closePlanningNow();
  };

  const loadTemplate = (template: PlanningTemplate) => {
    const hasUnsavedChanges = activeTemplateId ? isPlanningDirty : weeklyBlocks.length > 0;

    if (
      hasUnsavedChanges &&
      !window.confirm(
        activeTemplateId
          ? `Tu as des modifications non enregistrées sur « ${activeTemplateName || 'le planning en cours'} ». Les abandonner et charger « ${template.name} » ?`
          : `Abandonner le brouillon actuel et charger « ${template.name} » ?`
      )
    ) {
      return;
    }

    const loadedBlocks = normalizeWeeklyBlocks(template.blocks);
    setWeeklyBlocks(loadedBlocks);
    setActiveTemplateId(template.id);
    setActiveTemplateName(template.name);
    setPlanningSavedSnapshot(getPlanningSnapshot(loadedBlocks));
    setSelectedBlockId(null);
    setEditingBlockId(null);
    navigatePlanningChild('#planning-editor');
  };

  const startNewPlanning = () => {
    if (
      weeklyBlocks.length > 0 &&
      !window.confirm(
        activeTemplateId && isPlanningDirty
          ? `Commencer un nouveau planning ? Les modifications non enregistrées de « ${activeTemplateName || 'ton planning'} » seront abandonnées.`
          : 'Commencer un nouveau planning vide ? Le planning sauvegardé actuel restera intact.'
      )
    ) {
      return;
    }

    setWeeklyBlocks([]);
    setActiveTemplateId(null);
    setActiveTemplateName('');
    setPlanningSavedSnapshot(null);
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setPreviewTemplate(null);
    navigatePlanningChild('#planning-editor');
  };

  const duplicateSavedTemplate = async (template: PlanningTemplate) => {
    const proposedName = `${template.name} - copie`;
    const name = window.prompt("Nom du planning dupliqué :", proposedName);
    const cleanName = name?.trim();
    if (!cleanName) return;

    const duplicatedBlocks = normalizeWeeklyBlocks(template.blocks).map(block => ({
      ...block,
      id: crypto.randomUUID(),
    }));

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('planning_templates')
        .insert([{
          name: cleanName,
          blocks: duplicatedBlocks,
        }])
        .select('*')
        .single();

      if (error) throw error;

      const createdBlocks = normalizeWeeklyBlocks(data?.blocks || duplicatedBlocks);
      await fetchTemplates();

      // La copie s'ouvre directement : on peut partir de la même base sans toucher à l'original.
      setWeeklyBlocks(createdBlocks);
      setActiveTemplateId(data.id);
      setActiveTemplateName(typeof data.name === 'string' ? data.name : cleanName);
      setPlanningSavedSnapshot(getPlanningSnapshot(createdBlocks));
      setSelectedBlockId(null);
      setEditingBlockId(null);
      setPreviewTemplate(null);
      navigatePlanningChild('#planning-editor');
    } catch (error: any) {
      alert("Erreur lors de la duplication : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const deleteSavedTemplate = async (id: string) => {
    if (!window.confirm("Es-tu sûr de vouloir supprimer définitivement ce modèle de ta base de données ?")) {
      return;
    }

    const { error } = await supabase.from('planning_templates').delete().eq('id', id);

    if (error) {
      alert("Erreur lors de la suppression du planning : " + error.message);
      return;
    }

    if (previewTemplate?.id === id) setPreviewTemplate(null);
    if (activeTemplateId === id) {
      // Le contenu reste dans l'éditeur comme brouillon indépendant, mais il n'est plus lié
      // à un planning supprimé.
      setActiveTemplateId(null);
      setActiveTemplateName('');
      setPlanningSavedSnapshot(null);
    }
    await fetchTemplates();
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);

    if (
      !Number.isInteger(draggedIndex) ||
      draggedIndex < 0 ||
      draggedIndex >= savedTemplates.length ||
      draggedIndex === index
    ) {
      return;
    }

    const newTemplates = [...savedTemplates];
    const [draggedItem] = newTemplates.splice(draggedIndex, 1);
    if (!draggedItem) return;

    newTemplates.splice(index, 0, draggedItem);
    setSavedTemplates(newTemplates);

    // Pour l'instant l'ordre est visuel uniquement. Un champ sort_order sera ajouté
    // lors de la migration multi-utilisateur afin de le rendre persistant proprement.
  };

  const exportWeeklyICS = () => {
    if (weeklyBlocks.length === 0) return alert("Le planning est vide !");
    
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\n";
    const daysMap: Record<string, number> = { 'Dimanche': 0, 'Lundi': 1, 'Mardi': 2, 'Mercredi': 3, 'Jeudi': 4, 'Vendredi': 5, 'Samedi': 6 };
    
    weeklyBlocks.filter(block => block.kind !== 'marker').forEach(block => {
      const today = new Date();
      const targetDay = daysMap[block.day];
      const date = new Date(today);
      date.setDate(date.getDate() + ((targetDay + 7 - date.getDay()) % 7 || 7));
      date.setHours(block.startHour, block.startMinute || 0, 0, 0);
      
      const end = new Date(date);
      end.setMinutes(date.getMinutes() + (block.duration || 60));
      
      const pad = (n: number) => (n < 10 ? '0' + n : n);
      const formatICSDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      
      icsContent += `BEGIN:VEVENT\nSUMMARY:${block.title}\nDTSTART:${formatICSDate(date)}\nDTEND:${formatICSDate(end)}\nEND:VEVENT\n`;
    });
    
    icsContent += "END:VCALENDAR";
    
    const blob = new Blob([icsContent.replace(/\n/g, '\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob); 
    const link = document.createElement('a'); 
    link.href = url; link.download = 'ma_semaine_type.ics'; 
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Le référentiel horaire du planning est défini plus haut dans le composant
  // afin que toutes les fonctions utilisent exactement la même plage.

  const loadCleanupNotes = (threshold: number, mode: 'actif' | 'archive') => {
    const thresholdMs = threshold * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const oldNotes = notes.filter(n => {
      if (n.completed) return false; 
      if (mode === 'actif' && n.is_archived) return false;
      if (mode === 'archive' && !n.is_archived) return false;
      if (!n.created_at) return false;
      return now - new Date(n.created_at).getTime() >= thresholdMs;
    });
    setCleanupNotes(oldNotes);
    setCurrentCleanupIndex(0);
  };

  const openCleanupModal = (mode: 'actif' | 'archive') => {
    setCleanupMode(mode);
    loadCleanupNotes(cleanupThresholdDays, mode);
    setShowCleanupModal(true);
  };

  const handleCleanupAction = async (action: 'delete' | 'archive' | 'keep', note: Note) => {
    try {
      if (action === 'delete') {
        const { error } = await supabase.from('notes').delete().eq('id', note.id);
        if (error) throw error;
      } else if (action === 'archive') {
        const { error } = await supabase
          .from('notes')
          .update({ is_archived: true })
          .eq('id', note.id);
        if (error) throw error;
      }

      if (action !== 'keep') await fetchNotes();
      setCurrentCleanupIndex(prev => prev + 1);
    } catch (error: any) {
      alert("Erreur pendant le nettoyage : " + (error?.message || "erreur inconnue"));
    }
  };

  const deleteAllHistory = async () => {
    if (!window.confirm('Es-tu sûr de vouloir supprimer définitivement TOUT l\'historique ?')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('notes').delete().eq('completed', true);
      if (error) throw error;
      await fetchNotes();
    } catch (error: any) {
      alert("Erreur lors de la suppression : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const addNote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim() && !newContent.trim() && newListItems.length === 0) return;

    setLoading(true);

    try {
      let finalTargetDate = '';
      let finalPopupActive = false;

      if (showPopupConfig && (popupHours || popupMinutes)) {
        const hours = Math.max(0, Number.parseInt(popupHours || '0', 10) || 0);
        const minutes = Math.max(0, Number.parseInt(popupMinutes || '0', 10) || 0);
        const totalMinutes = hours * 60 + minutes;

        if (totalMinutes > 0) {
          finalTargetDate = new Date(Date.now() + totalMinutes * 60 * 1000).toISOString();
          finalPopupActive = true;
        }
      } else if (showCalendarConfig && targetDate) {
        const calendarTime = getSafeTime(targetDate);
        if (!calendarTime) {
          alert("La date choisie n'est pas valide.");
          return;
        }
        finalTargetDate = new Date(calendarTime).toISOString();
      }

      const finalSubtasks =
        noteMode === 'list'
          ? newListItems
              .map(item => item.trim())
              .filter(Boolean)
              .map(item => ({ id: crypto.randomUUID(), text: item, completed: false }))
          : [];

      const durationHours = Math.max(0, Number.parseInt(newDurationHours || '0', 10) || 0);
      const durationMinutesPart = Math.max(0, Number.parseInt(newDurationMinutes || '0', 10) || 0);
      const totalDurationMinutes = Math.min(7 * 24 * 60, durationHours * 60 + durationMinutesPart);

      const safeDailyTime = /^\d{2}:\d{2}$/.test(dailyTime) ? dailyTime : '09:00';

      const { error } = await supabase.from('notes').insert([{
        title: newTitle.trim(),
        content: newContent.trim(),
        importance,
        subtasks: finalSubtasks,
        is_list: noteMode === 'list',
        reminder_active: activateReminder,
        reminder_popup_active: reminderPopupActive,
        daily_reminder_time: safeDailyTime,
        target_date: finalTargetDate,
        popup_active: finalPopupActive,
        duration_minutes: totalDurationMinutes > 0 ? totalDurationMinutes : null,
      }]);

      if (error) throw error;

      if (sendImmediateEmail) {
        try {
          const mailRes = await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: newTitle.trim() ? newTitle.trim() : "Nouvelle note",
              importance,
            }),
          });

          if (!mailRes.ok) {
            const mailError = await mailRes.json().catch(() => ({}));
            alert(
              "La note a été créée, mais l'e-mail n'a pas pu être envoyé : " +
              (mailError.error || "erreur inconnue")
            );
          }
        } catch (mailError: any) {
          alert(
            "La note a été créée, mais l'e-mail n'a pas pu être envoyé : " +
            (mailError?.message || "erreur réseau")
          );
        }
      }

      setNewTitle('');
      setNewContent('');
      setImportance('vert');
      setNewListItems([]);
      setCurrentNewListItem('');
      setNewDurationHours('');
      setNewDurationMinutes('');
      setSendImmediateEmail(false);
      setShowPopupConfig(false);
      setPopupHours('');
      setPopupMinutes('');
      setShowDailyConfig(false);
      setActivateReminder(false);
      setReminderPopupActive(false);
      setShowCalendarConfig(false);
      setTargetDate('');
      setShowAdvancedSettings(false);
      setCollapsedPriorities(prev => ({ ...prev, [importance]: false }));

      await fetchNotes();
      window.location.hash = 'notes-list';
      setSuccessMessage('✅ Note créée avec succès !');
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      alert("Erreur Supabase : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm('Es-tu sûr de vouloir supprimer cette note définitivement ?')) return;

    const { error } = await supabase.from('notes').delete().eq('id', id);

    if (error) {
      alert("Erreur lors de la suppression : " + error.message);
      return;
    }

    await fetchNotes();
  };

  const triggerImmediateEmail = async (note: Note) => {
    if (!window.confirm('Es-tu sûr de vouloir envoyer un e-mail immédiat pour cette note ?')) return;

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title || "Rappel de note", importance: note.importance })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur inconnue");
      }

      alert('E-mail envoyé avec succès !');
    } catch (e: any) {
      alert("Échec de l'envoi de l'e-mail : " + e.message);
    }
  };

  const updateNote = async (id: string, field: string, value: any) => {
    let updatePayload: Record<string, any>;

    if (field === 'completed') {
      const isCompleted = Boolean(value);
      updatePayload = {
        completed: isCompleted,
        completed_at: isCompleted ? new Date().toISOString() : null,
        ...(isCompleted ? { popup_active: false } : {}),
      };
    } else {
      updatePayload = { [field]: value };
    }

    const { error } = await supabase
      .from('notes')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      alert("Erreur de mise à jour : " + error.message);
      return false;
    }

    await fetchNotes();
    return true;
  };

  const clearNoteDate = async (id: string) => {
    const { error } = await supabase
      .from('notes')
      .update({ target_date: '', popup_active: false })
      .eq('id', id);

    if (error) {
      alert("Erreur lors de l'annulation de la date : " + error.message);
      return;
    }

    locallyTriggeredAlarmIdsRef.current.delete(id);
    await fetchNotes();
  };

  const processAiNote = async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      alert("❌ Le micro n'a rien enregistré.");
      return;
    }

    setIsAiProcessing(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: finalTranscript,
          currentDate: new Date().toLocaleString('fr-FR'),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Erreur inconnue");
      }

      const proposal = await res.json();
      setAiProposal(proposal as AiProposal);
    } catch (e: any) {
      alert("❌ Erreur IA/réseau : " + (e?.message || "erreur inconnue"));
    } finally {
      setIsAiProcessing(false);
    }
  };

  const toggleDictation = (mode: 'title' | 'content' | 'list_item' | 'ai') => {
    if (listeningMode === mode) {
      if (recognitionRef.current) {
        recognitionRef.current.manuallyStopped = true;
        recognitionRef.current.stop();
      }
      setListeningMode('none');
      if (mode === 'ai' && recognitionRef.current?.accumulatedTranscript) {
        processAiNote(recognitionRef.current.accumulatedTranscript);
      }
      return;
    }
    
    if (listeningMode !== 'none' && recognitionRef.current) {
      recognitionRef.current.manuallyStopped = true;
      recognitionRef.current.stop();
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Ton navigateur ne supporte pas la dictée vocale.");
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR'; 
    recognition.continuous = true; 
    recognition.interimResults = false; 
    recognition.manuallyStopped = false;
    recognition.accumulatedTranscript = ''; 
    recognitionRef.current = recognition;
    
    recognition.onstart = () => setListeningMode(mode);
    
    recognition.onresult = (event: any) => {
      let newText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        newText += event.results[i][0].transcript + ' ';
      }
      if (mode === 'title') setNewTitle(prev => (prev ? prev + ' ' : '') + newText.trim());
      else if (mode === 'content') setNewContent(prev => (prev ? prev + ' ' : '') + newText.trim());
      else if (mode === 'list_item') setCurrentNewListItem(prev => (prev ? prev + ' ' : '') + newText.trim());
      else if (mode === 'ai') {
        recognition.accumulatedTranscript += newText + ' ';
      }
    };

    recognition.onerror = (event: any) => {
      const fatalErrors = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);
      if (fatalErrors.has(event?.error)) {
        recognition.manuallyStopped = true;
        setListeningMode('none');
      }
    };

    recognition.onend = () => {
      if (!recognition.manuallyStopped) {
        try {
          recognition.start();
        } catch (e) {
          setListeningMode('none');
        }
      } else {
        setListeningMode('none');
      }
    };

    try {
      recognition.start();
    } catch (e) {
      setListeningMode('none');
    }
  };

  const normalizeAiListItems = (value: unknown) => {
    if (!Array.isArray(value)) return [] as string[];

    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  };

  const getAiReminderChannels = (data: Partial<AiProposal>) => {
    const dailyReminderRequested = Boolean(data.daily_reminder);
    const explicitEmail = Boolean(data.daily_reminder_email);
    const explicitPopup = Boolean(data.daily_reminder_popup);

    // Compatibilité avec les anciennes réponses IA : un simple « rappelle-moi tous les jours »
    // devient un push, ce qui correspond mieux au sens naturel de « rappel » qu'un e-mail.
    if (dailyReminderRequested && !explicitEmail && !explicitPopup) {
      return { email: false, popup: true };
    }

    return {
      email: explicitEmail,
      popup: explicitPopup,
    };
  };

  const confirmAiNote = async (data: AiProposal) => {
    setLoading(true);

    try {
      const popupIso = toValidIso(data?.popup_time);
      const calendarIso = toValidIso(data?.calendar_time);

      if (data?.popup_time && !popupIso) {
        alert("L'IA a proposé une heure de rappel invalide. Modifie la proposition manuellement.");
        return;
      }

      if (!data?.popup_time && data?.calendar_time && !calendarIso) {
        alert("L'IA a proposé une date de calendrier invalide. Modifie la proposition manuellement.");
        return;
      }

      const targetDateValue = popupIso || calendarIso;
      const isPopupActive = Boolean(popupIso);
      const listItems = normalizeAiListItems(data?.list_items);
      const isList = Boolean(data?.is_list || listItems.length > 0);
      const reminderChannels = getAiReminderChannels(data || {});
      const dailyReminderActive = reminderChannels.email || reminderChannels.popup;
      const dailyReminderTime =
        typeof data?.daily_reminder_time === 'string' &&
        /^\d{2}:\d{2}$/.test(data.daily_reminder_time)
          ? data.daily_reminder_time
          : '09:00';

      const safeImportance =
        data?.importance === 'rouge' || data?.importance === 'orange' || data?.importance === 'vert'
          ? data.importance
          : 'vert';

      const subtasks = isList
        ? listItems.map(text => ({ id: crypto.randomUUID(), text, completed: false }))
        : [];

      const { error } = await supabase.from('notes').insert([{
        title: typeof data?.title === 'string' ? data.title.trim() : '',
        content: typeof data?.content === 'string' ? data.content.trim() : '',
        importance: safeImportance,
        subtasks,
        is_list: isList,
        reminder_active: dailyReminderActive && reminderChannels.email,
        reminder_popup_active: dailyReminderActive && reminderChannels.popup,
        daily_reminder_time: dailyReminderTime,
        target_date: targetDateValue,
        popup_active: isPopupActive,
      }]);

      if (error) throw error;

      if (data?.send_email) {
        try {
          const mailRes = await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: data?.title || 'Nouvelle note',
              importance: safeImportance,
            }),
          });

          if (!mailRes.ok) {
            const mailError = await mailRes.json().catch(() => ({}));
            alert(
              "La note a été créée, mais l'e-mail n'a pas pu être envoyé : " +
              (mailError.error || "erreur inconnue")
            );
          }
        } catch (mailError: any) {
          alert(
            "La note a été créée, mais l'e-mail n'a pas pu être envoyé : " +
            (mailError?.message || "erreur réseau")
          );
        }
      }

      setAiProposal(null);
      setNewTitle('');
      setNewContent('');
      setNewListItems([]);
      setCurrentNewListItem('');
      await fetchNotes();
      window.location.hash = 'notes-list';
      setSuccessMessage('✅ Note créée avec succès par IA !');
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      alert("Erreur lors de la création IA : " + (e?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const loadProposalIntoForm = (data: AiProposal) => {
    // On repart d'une configuration avancée propre pour éviter qu'un ancien
    // rappel/e-mail resté dans le formulaire se mélange à la nouvelle proposition IA.
    setSendImmediateEmail(false);
    setActivateReminder(false);
    setReminderPopupActive(false);
    setDailyTime('09:00');
    setShowDailyConfig(false);
    setShowPopupConfig(false);
    setPopupHours('');
    setPopupMinutes('');
    setShowCalendarConfig(false);
    setTargetDate('');

    if (typeof data?.title === 'string') setNewTitle(data.title);
    if (typeof data?.content === 'string') setNewContent(data.content);

    if (data?.importance === 'vert' || data?.importance === 'orange' || data?.importance === 'rouge') {
      setImportance(data.importance);
    }

    const listItems = normalizeAiListItems(data?.list_items);
    const isList = Boolean(data?.is_list || listItems.length > 0);
    setNoteMode(isList ? 'list' : 'text');
    setNewListItems(isList ? listItems : []);

    if (data?.send_email) {
      setSendImmediateEmail(true);
      setShowAdvancedSettings(true);
    }

    if (data?.daily_reminder) {
      const reminderChannels = getAiReminderChannels(data);
      setActivateReminder(reminderChannels.email);
      setReminderPopupActive(reminderChannels.popup);
      setDailyTime(
        typeof data.daily_reminder_time === 'string' &&
        /^\d{2}:\d{2}$/.test(data.daily_reminder_time)
          ? data.daily_reminder_time
          : '09:00'
      );
      setShowDailyConfig(true);
      setShowAdvancedSettings(true);
    }
    
    if (data?.popup_time) {
      const popupTime = getSafeTime(data.popup_time);
      const diffMs = popupTime - Date.now();

      if (popupTime > 0 && diffMs > 0) {
        const totalMin = Math.max(1, Math.ceil(diffMs / (1000 * 60)));
        setPopupHours(Math.floor(totalMin / 60).toString());
        setPopupMinutes((totalMin % 60).toString());
        setShowPopupConfig(true);
        setShowAdvancedSettings(true);
      }
    } else if (data?.calendar_time) {
      const calendarTime = getSafeTime(data.calendar_time);

      if (calendarTime > 0) {
        const d = new Date(calendarTime);
        const pad = (n: number) => n.toString().padStart(2, '0');
        setTargetDate(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
        );
        setShowCalendarConfig(true);
        setShowAdvancedSettings(true);
      }
    }

    setAiProposal(null);
    window.location.hash = 'notes-create';
  };

  const formatDatesForCalendar = (dateString: string, durationMinutes?: number | null) => {
    const time = getSafeTime(dateString);
    if (!time) return null;

    const formatUtc = (date: Date) =>
      date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

    const safeDurationMinutes =
      typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0
        ? Math.min(7 * 24 * 60, Math.round(durationMinutes))
        : 60;

    const date = new Date(time);
    const endDate = new Date(time + safeDurationMinutes * 60 * 1000);

    return {
      start: formatUtc(date),
      end: formatUtc(endDate),
    };
  };

  const getGoogleCalendarLink = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || '', note.duration_minutes);
    if (!dates) return '#';

    const title = encodeURIComponent(note.title || 'Note');
    const details = encodeURIComponent(note.content || '');
    const timeZone = encodeURIComponent(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'
    );

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates.start}/${dates.end}&details=${details}&ctz=${timeZone}`;
  };

  const downloadICS = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || '', note.duration_minutes);
    if (!dates) return;

    const uid = `${note.id}@suivi-note`;
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Suivi Note//FR',
      'BEGIN:VEVENT',
      `UID:${escapeICS(uid)}`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${escapeICS(note.title || 'Note')}`,
      `DESCRIPTION:${escapeICS(note.content || '')}`,
      `DTSTART:${dates.start}`,
      `DTEND:${dates.end}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rendez-vous.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const saveEdit = async (id: string) => {
    let finalTargetDate = editingTargetDate;
    let finalPopupActive = editingPopupActive;

    if (showEditingPopupConfig && (editingPopupHours || editingPopupMinutes)) {
      const hours = Math.max(0, Number.parseInt(editingPopupHours || '0', 10) || 0);
      const minutes = Math.max(0, Number.parseInt(editingPopupMinutes || '0', 10) || 0);
      const totalMinutes = hours * 60 + minutes;

      if (totalMinutes > 0) {
        finalTargetDate = new Date(Date.now() + totalMinutes * 60 * 1000).toISOString();
        finalPopupActive = true;
      }
    } else if (finalTargetDate) {
      const normalized = toValidIso(finalTargetDate);
      if (!normalized) {
        alert("La date choisie n'est pas valide.");
        return;
      }
      finalTargetDate = normalized;
    }

    if (!finalTargetDate) finalPopupActive = false;

    const safeDailyTime = /^\d{2}:\d{2}$/.test(editingDailyTime)
      ? editingDailyTime
      : '09:00';

    const previousNote = notes.find(note => note.id === id);
    const emailReminderChanged = Boolean(
      editingReminderActive &&
      (!previousNote?.reminder_active || previousNote?.daily_reminder_time !== safeDailyTime)
    );
    const popupReminderChanged = Boolean(
      editingReminderPopupActive &&
      (!previousNote?.reminder_popup_active || previousNote?.daily_reminder_time !== safeDailyTime)
    );

    const editDurationHours = Math.max(0, Number.parseInt(editingDurationHours || '0', 10) || 0);
    const editDurationMinutesPart = Math.max(0, Number.parseInt(editingDurationMinutes || '0', 10) || 0);
    const editTotalDurationMinutes = Math.min(7 * 24 * 60, editDurationHours * 60 + editDurationMinutesPart);

    const updatePayload: Record<string, any> = {
      title: editingTitle.trim(),
      content: editingContent.trim(),
      target_date: finalTargetDate,
      popup_active: finalPopupActive,
      importance: editingImportance,
      reminder_active: editingReminderActive,
      reminder_popup_active: editingReminderPopupActive,
      daily_reminder_time: safeDailyTime,
      duration_minutes: editTotalDurationMinutes > 0 ? editTotalDurationMinutes : null,
    };

    // Si l'utilisateur active un canal ou change l'heure de relance, on remet
    // son horodatage à zéro afin que la nouvelle configuration puisse être
    // prise en compte le jour même.
    if (emailReminderChanged) updatePayload.last_email_reminded_at = null;
    if (popupReminderChanged) updatePayload.last_popup_reminded_at = null;

    const { error } = await supabase.from('notes').update(updatePayload).eq('id', id);

    if (error) {
      alert("Erreur lors de l'enregistrement : " + error.message);
      return;
    }

    locallyTriggeredAlarmIdsRef.current.delete(id);
    setEditingId(null);
    await fetchNotes();
  };

  const startEditing = (note: Note) => {
    setEditingId(note.id); setEditingTitle(note.title || ''); setEditingContent(note.content || '');
    setEditingTargetDate(note.target_date || ''); setEditingPopupActive(note.popup_active || false);
    setEditingImportance(note.importance || 'vert'); setEditingReminderActive(note.reminder_active || false);
    setEditingReminderPopupActive(note.reminder_popup_active || false); setEditingDailyTime(note.daily_reminder_time || '09:00');
    const noteDuration = typeof note.duration_minutes === 'number' && note.duration_minutes > 0 ? note.duration_minutes : 0;
    setEditingDurationHours(noteDuration > 0 ? Math.floor(noteDuration / 60).toString() : '');
    setEditingDurationMinutes(noteDuration > 0 ? (noteDuration % 60).toString() : '');
    setShowEditingPopupConfig(false); setShowEditingDailyConfig(false); setShowEditingExactDateConfig(false);
    setEditingPopupHours(''); setEditingPopupMinutes('');
  };

  const snoozeNote = async (id: string, days: number) => {
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + days);

    const { error } = await supabase
      .from('notes')
      .update({ snooze_until: snoozeDate.toISOString() })
      .eq('id', id);

    if (error) {
      alert("Erreur lors du masquage : " + error.message);
      return;
    }

    await fetchNotes();
  };

  const handleSnoozeClick = (id: string) => {
    const result = window.prompt("Pendant combien de jours veux-tu masquer cette note ?", "3");
    if (result !== null) {
      const days = parseInt(result, 10);
      if (!isNaN(days) && days > 0) snoozeNote(id, days);
      else alert("Veuillez entrer un nombre de jours valide.");
    }
  };

  const toggleSubtask = async (note: Note, subtaskId: string) => {
    const updated = (note.subtasks || []).map(st =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );

    const allCompleted = updated.length > 0 && updated.every(st => st.completed);
    const { error } = await supabase.from('notes').update({
      subtasks: updated,
      completed: allCompleted,
      completed_at: allCompleted ? new Date().toISOString() : null,
      ...(allCompleted ? { popup_active: false } : {}),
    }).eq('id', note.id);

    if (error) {
      alert("Erreur lors de la mise à jour de la liste : " + error.message);
      return;
    }

    await fetchNotes();
  };

  const addSubtask = async (note: Note) => {
    const rawText = newSubtaskTexts[note.id];
    const cleanText = rawText?.trim();
    if (!cleanText) return;

    const updatedSubtasks = [
      ...(note.subtasks || []),
      { id: crypto.randomUUID(), text: cleanText, completed: false },
    ];

    const { error } = await supabase.from('notes').update({
      subtasks: updatedSubtasks,
      completed: false,
      completed_at: null,
    }).eq('id', note.id);

    if (error) {
      alert("Erreur lors de l'ajout : " + error.message);
      return;
    }

    setNewSubtaskTexts(prev => ({ ...prev, [note.id]: '' }));
    await fetchNotes();
  };

  const deleteSubtask = async (note: Note, subtaskId: string) => {
    const updated = (note.subtasks || []).filter(st => st.id !== subtaskId);
    const allCompleted = updated.length > 0 && updated.every(st => st.completed);

    const { error } = await supabase.from('notes').update({
      subtasks: updated,
      completed: allCompleted,
      completed_at: allCompleted ? new Date().toISOString() : null,
      ...(allCompleted ? { popup_active: false } : {}),
    }).eq('id', note.id);

    if (error) {
      alert("Erreur lors de la suppression : " + error.message);
      return;
    }

    await fetchNotes();
  };

  const displayedNotes = notes.filter(n => {
    if (n.completed) return false; 
    const isSnoozed = !!n.snooze_until && new Date(n.snooze_until).getTime() > currentTime;
    if (showArchived === true) return n.is_archived;
    if (showArchived === 'snoozed') return !n.is_archived && isSnoozed;
    return !n.is_archived && !isSnoozed;
  });

  const historyNotes = notes.filter(n => {
    if (!n.completed) return false;
    if (!historySearch.trim()) return true;
    const term = historySearch.toLowerCase();
    return (n.title && n.title.toLowerCase().includes(term)) || (n.content && n.content.toLowerCase().includes(term));
  });

  const hasSnoozedNotes = notes.some(n => !n.is_archived && !n.completed && !!n.snooze_until && new Date(n.snooze_until).getTime() > currentTime);

  const focusableNotes = displayedNotes.filter(n => !skippedFocusIds.includes(n.id) && !n.is_archived);
  const urgentNotes = focusableNotes.filter(n => n.importance === 'rouge');
  const importantNotes = focusableNotes.filter(n => n.importance === 'orange');
  const normalNotes = focusableNotes.filter(n => n.importance === 'vert');

  let currentFocusNote: Note | null = null;
  let focusStatus = '';

  if (focusPhase === 'rouge' && urgentNotes.length > 0) { 
    currentFocusNote = urgentNotes[0]; 
    focusStatus = 'Priorité Urgente'; 
  } else if (focusPhase === 'orange' && importantNotes.length > 0) { 
    currentFocusNote = importantNotes[0]; 
    focusStatus = 'Priorité Importante'; 
  } else if (focusPhase === 'vert' && normalNotes.length > 0) { 
    currentFocusNote = normalNotes[0]; 
    focusStatus = 'Priorité Normale'; 
  }

  const columns = [
    { id: 'rouge', title: '🔴 Priorité Urgente', notes: displayedNotes.filter(n => n.importance === 'rouge') },
    { id: 'orange', title: '🟠 Priorité Importante', notes: displayedNotes.filter(n => n.importance === 'orange') },
    { id: 'vert', title: '🟢 Priorité Normale', notes: displayedNotes.filter(n => n.importance === 'vert') },
  ];

  const renderNoteItem = (note: Note) => (
    <li key={note.id} className={`flex flex-col gap-2 p-3 rounded shadow border-l-4 transition-all ${
      showArchived === true ? 'border-gray-300 bg-gray-50' : 
      note.importance === 'rouge' ? 'border-red-500 bg-white' : 
      note.importance === 'orange' ? 'border-orange-500 bg-white' : 'border-green-500 bg-white'
    }`}>
      {note.popup_active && note.target_date && editingId !== note.id && (
        <div className={`p-1.5 rounded flex items-center justify-between shadow-sm border-2 ${showArchived === true ? 'bg-gray-100 border-gray-300' : 'bg-red-50 border-red-400'}`}>
          <span className={`text-xs font-black flex items-center gap-1 ${showArchived === true ? 'text-gray-500' : 'text-red-800'}`}>
            <span className={showArchived === true ? '' : 'animate-pulse'}>{showArchived === true ? '⏱️' : '🔴'}</span> DANS :
          </span>
          <span className={`text-sm font-black tracking-wider ${showArchived === true ? 'text-gray-500' : 'text-red-600'}`}>
            {(() => {
              const diff = Math.ceil((getSafeTime(note.target_date) - currentTime) / 1000);
              if (diff <= 0) return "En cours...";
              const m = Math.floor(diff / 60); const s = diff % 60;
              return `${m}m ${s}s`;
            })()}
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 flex-1 mt-1">
        {editingId === note.id ? (
          <div className="flex flex-col flex-1 gap-2 w-full">
            {note.is_list ? (
              <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} className="w-full border border-gray-400 p-1.5 rounded text-black font-semibold text-sm" autoFocus />
            ) : (
              <>
                <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} placeholder="Titre (optionnel)" className="w-full border border-gray-400 p-1.5 rounded text-black font-semibold text-sm" />
                <textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)} className="w-full border border-gray-400 p-1.5 rounded text-black resize-y min-h-[60px] text-sm" />
              </>
            )}
            
            <select value={editingImportance} onChange={(e) => setEditingImportance(e.target.value as any)} className="border border-gray-400 p-1.5 rounded text-black text-sm w-full font-bold">
              <option value="vert">🟢 Priorité Normale</option>
              <option value="orange">🟠 Priorité Importante</option>
              <option value="rouge">🔴 Priorité Urgente</option>
            </select>

            <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2">
              <span className="text-xs font-bold text-amber-900 whitespace-nowrap">⏱ Durée :</span>
              <input type="number" min="0" max="168" placeholder="0" value={editingDurationHours} onChange={(e) => setEditingDurationHours(e.target.value)} className="w-14 p-1 border border-amber-300 rounded text-center text-black text-xs bg-white" />
              <span className="text-xs font-bold text-amber-900">h</span>
              <input type="number" min="0" max="59" placeholder="0" value={editingDurationMinutes} onChange={(e) => setEditingDurationMinutes(e.target.value)} className="w-14 p-1 border border-amber-300 rounded text-center text-black text-xs bg-white" />
              <span className="text-xs font-bold text-amber-900">min</span>
            </div>

            <div className="flex flex-col">
              <button type="button" onClick={() => setShowEditingDailyConfig(!showEditingDailyConfig)} className={`p-1.5 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${showEditingDailyConfig ? 'bg-green-600 text-white border-green-600 rounded-b-none' : 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100'}`}>
                <span>🔄 Configurer les relances</span> <span>{showEditingDailyConfig ? '▲' : '▼'}</span>
              </button>
              {showEditingDailyConfig && (
                <div className="flex flex-col gap-2 bg-green-50 p-2 rounded-b border border-green-200 border-t-0">
                  <div className="flex flex-wrap items-center gap-3 justify-center">
                    <input type="time" value={editingDailyTime} onChange={(e) => setEditingDailyTime(e.target.value)} className="p-1 border border-green-300 rounded text-black text-xs bg-white" />
                    <label className="flex items-center gap-1 cursor-pointer text-xs font-semibold text-green-900"><input type="checkbox" checked={editingReminderActive} onChange={(e) => setEditingReminderActive(e.target.checked)} className="cursor-pointer accent-green-600" />E-mail</label>
                    <label className="flex items-center gap-1 cursor-pointer text-xs font-semibold text-green-900"><input type="checkbox" checked={editingReminderPopupActive} onChange={(e) => setEditingReminderPopupActive(e.target.checked)} className="cursor-pointer accent-green-600" />Pop-up</label>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => setShowEditingExactDateConfig(!showEditingExactDateConfig)} className={`p-1.5 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${showEditingExactDateConfig ? 'bg-purple-600 text-white border-purple-600 rounded-b-none' : 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'}`}>
                  <span>📅 Ajouter au calendrier (Agenda / .ics)</span> <span>{showEditingExactDateConfig ? '▲' : '▼'}</span>
                </button>
                {showEditingExactDateConfig && (
                  <div className="bg-purple-50 border border-t-0 border-purple-200 p-2 rounded-b flex flex-col items-center gap-2 justify-center">
                    <input type="datetime-local" value={editingTargetDate ? (() => {
                      const ts = getSafeTime(editingTargetDate); if (!ts) return '';
                      const d = new Date(ts); const pad = (n: number) => n.toString().padStart(2, '0');
                      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    })() : ''} onChange={(e) => { setEditingTargetDate(e.target.value ? new Date(e.target.value).toISOString() : ''); }} className="p-1 border border-purple-300 rounded text-black text-xs bg-white w-full" />
                    <label className="flex items-center gap-1 cursor-pointer text-xs font-semibold text-purple-900 mt-1"><input type="checkbox" checked={editingPopupActive} onChange={(e) => setEditingPopupActive(e.target.checked)} className="cursor-pointer accent-purple-600" />Activer l'alarme pop-up à cette date</label>
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <button type="button" onClick={() => setShowEditingPopupConfig(!showEditingPopupConfig)} className={`p-1.5 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${showEditingPopupConfig ? 'bg-indigo-600 text-white border-indigo-600 rounded-b-none' : 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100'}`}>
                  <span>⏰ Alarme pop-up rapide (Dans...)</span> <span>{showEditingPopupConfig ? '▲' : '▼'}</span>
                </button>
                {showEditingPopupConfig && (
                  <div className="bg-indigo-50 border border-t-0 border-indigo-200 p-2 rounded-b flex flex-col items-center gap-1.5 justify-center">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-indigo-900">Dans:</span>
                      <input type="number" placeholder="0" min="0" value={editingPopupHours} onChange={(e) => setEditingPopupHours(e.target.value)} className="w-10 p-1 border border-indigo-300 rounded text-center text-black text-xs" />
                      <span className="text-xs font-bold text-indigo-900">h</span>
                      <input type="number" placeholder="0" min="0" value={editingPopupMinutes} onChange={(e) => setEditingPopupMinutes(e.target.value)} className="w-10 p-1 border border-indigo-300 rounded text-center text-black text-xs" />
                      <span className="text-xs font-bold text-indigo-900">min</span>
                    </div>
                    {(editingPopupHours || editingPopupMinutes) && (
                      <button type="button" onClick={() => { setEditingPopupHours(''); setEditingPopupMinutes(''); setShowEditingPopupConfig(false); }} className="bg-red-100 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-200 transition-colors">✖ Annuler</button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => triggerImmediateEmail(note)} className="p-1.5 rounded font-bold border transition-colors text-left text-xs bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 flex items-center gap-2"><span>📨</span> E-mail immédiat</button>
            </div>
            <div className="flex gap-2 mt-1">
              <button onClick={() => saveEdit(note.id)} className="bg-green-500 hover:bg-green-600 text-white px-2 py-1.5 text-xs rounded font-bold flex-1">Enregistrer</button>
              <button onClick={() => setEditingId(null)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-2 py-1.5 text-xs rounded font-bold flex-1">Annuler</button>
            </div>
          </div>
        ) : (
          <div onDoubleClick={() => startEditing(note)} className={`flex-1 w-full overflow-hidden`}>
             {showArchived === true && (
               <div className="mb-1">
                 <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${note.importance === 'rouge' ? 'bg-red-50 text-red-600 border-red-200' : note.importance === 'orange' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-green-50 text-green-600 border-green-200'}`}>
                    {note.importance === 'rouge' ? '🔴 Urgent' : note.importance === 'orange' ? '🟠 Important' : '🟢 Normal'}
                 </span>
               </div>
             )}
             <div className={`font-bold text-base ${showArchived === true ? 'text-gray-500' : 'text-gray-900'}`}>{note.title}</div>
             <div className={`text-sm mt-0.5 whitespace-pre-wrap ${showArchived === true ? 'text-gray-400' : 'text-gray-700'}`}>{note.content}</div>
             {typeof note.duration_minutes === 'number' && note.duration_minutes > 0 && (
               <div className={`mt-1 text-[11px] font-bold ${showArchived === true ? 'text-gray-400' : 'text-amber-700'}`}>
                 ⏱ Durée : {formatDuration(note.duration_minutes)}
               </div>
             )}
          </div>
        )}
      </div>
      
      {note.is_list && (
        <div className={`mt-2 pl-2 border-l-2 p-1.5 rounded ${showArchived === true ? 'border-gray-200 bg-gray-100/50' : 'border-gray-300 bg-gray-50/50'}`}>
          {(note.subtasks || []).map((st) => (
             <div key={st.id} className="flex items-center gap-2 mb-1 group">
               <input type="checkbox" checked={st.completed} onChange={() => toggleSubtask(note, st.id)} className="cursor-pointer" />
               <span className={`text-xs flex-1 ${st.completed ? 'line-through text-gray-400' : showArchived === true ? 'text-gray-500' : 'text-gray-800'}`}>{st.text}</span>
               <button onClick={() => deleteSubtask(note, st.id)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2">✖</button>
             </div>
           ))}
           <div className="flex gap-1.5 mt-1.5 items-center">
             <input type="text" placeholder="Ajouter..." value={newSubtaskTexts[note.id] || ''} onChange={(e) => setNewSubtaskTexts({ ...newSubtaskTexts, [note.id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addSubtask(note)} className="text-xs border border-gray-300 p-1 rounded flex-1 text-black bg-white" />
             <button onClick={() => addSubtask(note)} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-1.5 py-0.5 rounded font-bold text-xs">+</button>
           </div>
        </div>
      )}

      {note.target_date && editingId !== note.id && (
        <div className={`flex flex-col gap-1.5 mt-1 mb-1 p-2 rounded border ${showArchived === true ? 'bg-gray-100 border-gray-200' : 'bg-blue-50/50 border-blue-100'}`}>
          <div className="flex justify-between items-center w-full">
            <span className={`text-[11px] font-bold ${showArchived === true ? 'text-gray-500' : 'text-blue-800'}`}>
              📅 {new Date(getSafeTime(note.target_date)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {note.popup_active && ' 🔔'}
            </span>
            <button onClick={() => clearNoteDate(note.id)} className="text-red-500 hover:bg-red-100 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors">✖ Annuler</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {enableGoogleCal && (
              <a href={getGoogleCalendarLink(note)} target="_blank" rel="noopener noreferrer" className={`text-white px-2 py-1 rounded text-[10px] font-bold transition-colors text-center ${showArchived === true ? 'bg-gray-400 hover:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700'}`}>Google Agenda</a>
            )}
            {enableICal && (
              <button onClick={() => downloadICS(note)} className={`text-white px-2 py-1 rounded text-[10px] font-bold transition-colors text-center ${showArchived === true ? 'bg-gray-400 hover:bg-gray-500' : 'bg-purple-600 hover:bg-purple-700'}`}>Fichier (.ics)</button>
            )}
          </div>
        </div>
      )}

      {editingId !== note.id && (
        <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-gray-100 relative">
          <button onClick={() => updateNote(note.id, 'completed', true)} className={`font-extrabold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 shadow-sm transition-colors ${showArchived === true ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : 'bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800'}`}><span className="text-sm">✓</span> Terminé</button>
          <button onClick={() => setOpenMenuId(openMenuId === note.id ? null : note.id)} className={`font-bold px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1 shadow-sm border ${openMenuId === note.id ? 'bg-gray-200 text-gray-800 border-gray-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>⚙️ Options {openMenuId === note.id ? '▲' : '▼'}</button>
          {openMenuId === note.id && (
            <div className="absolute bottom-full right-0 mb-2 w-36 bg-white border border-gray-200 shadow-xl rounded-xl flex flex-col overflow-hidden z-10">
              {showArchived === 'snoozed' && (<button onClick={() => { updateNote(note.id, 'snooze_until', ''); setOpenMenuId(null); }} className="px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 border-b border-gray-100">↩ Réactiver</button>)}
              {showArchived === false && (<button onClick={() => { handleSnoozeClick(note.id); setOpenMenuId(null); }} className="px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 border-b border-gray-100">💤 Masquer</button>)}
              <button onClick={() => { startEditing(note); setOpenMenuId(null); }} className="px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 border-b border-gray-100">✏️ Modifier</button>
              <button onClick={() => { updateNote(note.id, 'is_archived', !note.is_archived); setOpenMenuId(null); }} className="px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 border-b border-gray-100">📦 {note.is_archived ? 'Désarchiver' : 'Archiver'}</button>
              <button onClick={() => { deleteNote(note.id); setOpenMenuId(null); }} className="px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50">🗑️ Supprimer</button>
            </div>
          )}
        </div>
      )}
    </li>
  );

  return (
    <main className="max-w-7xl mx-auto p-4 pb-20 relative">

      {/* ================= MODALS GLOBALES ================= */}
      {showCleanupModal && (
        <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-4 animate-fade-in border-4 border-blue-500">
            <div className="flex justify-between items-center border-b pb-2">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><span>🧹</span> Nettoyage {cleanupMode === 'archive' ? 'archive' : ''}</h2>
              <button onClick={() => setShowCleanupModal(false)} className="text-gray-400 hover:text-black font-bold text-xl transition-colors">✖</button>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-sm font-semibold text-gray-700">Ancienneté requise :</span>
              <select value={cleanupThresholdDays} onChange={(e) => { const val = Number(e.target.value); setCleanupThresholdDays(val); loadCleanupNotes(val, cleanupMode); }} className="border border-gray-300 p-1.5 rounded text-sm font-bold text-black bg-white flex-1">
                <option value={0}>👁️ Tout visualiser</option>
                <option value={14}>+ de 2 semaines</option>
                <option value={30}>+ de 1 mois</option>
                <option value={90}>+ de 3 mois</option>
              </select>
            </div>
            {currentCleanupIndex < cleanupNotes.length ? (
              <div className="flex flex-col gap-4 mt-2">
                <div className="text-center text-xs font-bold text-gray-500 uppercase tracking-widest">Note {currentCleanupIndex + 1} sur {cleanupNotes.length}</div>
                <div className="bg-white border border-gray-300 p-4 rounded-xl shadow-sm min-h-[150px] max-h-[300px] overflow-y-auto flex flex-col">
                  <h3 className="font-bold text-lg text-black">{cleanupNotes[currentCleanupIndex].title || '(Sans titre)'}</h3>
                  <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap flex-1">{cleanupNotes[currentCleanupIndex].content}</p>
                  <span className="text-[10px] text-gray-400 mt-4 text-right font-semibold">Créée le {new Date(cleanupNotes[currentCleanupIndex].created_at || '').toLocaleDateString('fr-FR')}</span>
                </div>
                <div className={`grid gap-2 mt-2 ${cleanupMode === 'actif' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <button onClick={() => handleCleanupAction('delete', cleanupNotes[currentCleanupIndex])} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 py-3 rounded-xl font-bold flex flex-col items-center gap-1 transition-colors shadow-sm"><span className="text-xl">🗑️</span> <span className="text-[10px] uppercase">Supprimer</span></button>
                  <button onClick={() => handleCleanupAction('keep', cleanupNotes[currentCleanupIndex])} className="bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 py-3 rounded-xl font-bold flex flex-col items-center gap-1 transition-colors shadow-sm"><span className="text-xl">✅</span> <span className="text-[10px] uppercase">Conserver</span></button>
                  {cleanupMode === 'actif' && (<button onClick={() => handleCleanupAction('archive', cleanupNotes[currentCleanupIndex])} className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 py-3 rounded-xl font-bold flex flex-col items-center gap-1 transition-colors shadow-sm"><span className="text-xl">📦</span> <span className="text-[10px] uppercase">Archiver</span></button>)}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 flex flex-col items-center gap-3">
                <span className="text-5xl">✨</span><p className="font-bold text-lg text-gray-800">Tout est propre !</p>
                <p className="text-sm text-gray-500">Il n'y a plus aucune note à trier pour cette durée.</p>
                <button onClick={() => setShowCleanupModal(false)} className="mt-4 bg-gray-900 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-black transition-colors">Fermer</button>
              </div>
            )}
          </div>
        </div>
      )}

      {triggeredAlarm && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-6 animate-pulse">
          <div className="bg-red-600 rounded-3xl shadow-2xl p-8 w-full max-w-md flex flex-col gap-6 items-center text-white text-center border-4 border-white">
            <span className="text-6xl">⏰</span><h2 className="text-3xl font-black uppercase tracking-widest">{triggeredAlarm.title || 'Alarme !'}</h2>
            {triggeredAlarm.content && <p className="text-lg font-medium">{triggeredAlarm.content}</p>}
            <button onClick={acknowledgeTriggeredAlarm} className="mt-4 bg-white text-red-600 px-8 py-4 rounded-xl font-black text-xl hover:bg-gray-100 transition-colors shadow-lg w-full">J'AI COMPRIS (STOP)</button>
          </div>
        </div>
      )}

      {/* MODALE D'APERÇU DU MODÈLE DE SEMAINE */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewTemplate(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-black text-gray-800">{previewTemplate.name}</h2>
              <button onClick={() => setPreviewTemplate(null)} className="text-gray-400 hover:text-black font-bold text-xl">✖</button>
            </div>
            
            {/* GRILLE MINIATURE AGRANDIE AVEC REPÈRES HORAIRES */}
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl overflow-y-auto relative h-[400px]">
              <div className="flex h-[800px] w-full relative">

                {/* Colonne des heures : reste visible à gauche pendant le défilement vertical */}
                <div className="w-8 flex-shrink-0 bg-gray-100 border-r border-gray-300 relative z-20">
                  <div className="h-6 sticky top-0 z-30 bg-gray-100 border-b border-gray-200" />
                  <div className="relative" style={{ height: 'calc(100% - 24px)' }}>
                    {hoursOfDay.map((hour, index) => (
                      <div
                        key={hour}
                        className="absolute left-0 right-0 text-[8px] font-bold text-gray-500 text-center leading-none"
                        style={{
                          top: `${(index / hoursOfDay.length) * 100}%`,
                          transform: 'translateY(2px)'
                        }}
                      >
                        {hour}h
                      </div>
                    ))}
                  </div>
                </div>

                {/* Jours + blocs */}
                <div className="flex flex-1 min-w-0 h-full relative">
                  {WEEK_DAYS.map((dayName, dIdx) => (
                    <div key={dIdx} className="flex-1 border-r border-gray-200 relative h-full min-w-0">
                      <div className="h-6 text-[10px] font-bold text-center bg-gray-100 flex items-center justify-center border-b border-gray-200 sticky top-0 z-10">
                        {dayName.substring(0, 3)}
                      </div>

                      <div className="absolute left-0 right-0 bottom-0" style={{ top: '24px' }}>
                        {previewTemplate.blocks?.filter((b: any) => b.day === dayName).map((ev: any) => {
                          const topPercent = ((ev.startHour - PLANNING_START_HOUR) + (ev.startMinute || 0) / 60) / hoursOfDay.length * 100;

                          if (ev.kind === 'marker') {
                            return (
                              <div
                                key={ev.id}
                                className="absolute left-0 right-0 z-20 flex items-center"
                                style={{ top: `${topPercent}%`, height: '8px', transform: 'translateY(-50%)' }}
                                title={ev.title}
                              >
                                <div className={`w-full h-[4px] rounded-full shadow-sm ${ev.color === 'blue' ? 'bg-blue-500' : ev.color === 'green' ? 'bg-green-500' : ev.color === 'red' ? 'bg-red-500' : 'bg-gray-500'}`} />
                              </div>
                            );
                          }

                          const heightPercent = ((ev.duration || 60) / 60) / hoursOfDay.length * 100;
                          return (
                            <div key={ev.id} className="absolute left-0 right-0 p-0.5" style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}>
                              <div className={`h-full w-full rounded shadow-sm border overflow-hidden ${ev.color === 'blue' ? 'bg-blue-100 border-blue-300' : ev.color === 'green' ? 'bg-green-100 border-green-300' : ev.color === 'red' ? 'bg-red-100 border-red-300' : 'bg-gray-100 border-gray-300'}`}>
                                <span className="text-[8px] font-bold leading-tight block px-1 truncate text-black/70">{ev.title}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <button onClick={() => { loadTemplate(previewTemplate); setPreviewTemplate(null); }} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors">
                Écraser mon planning par ce modèle
              </button>
            </div>
          </div>
        </div>
      )}

      {aiProposal && (
        <div className="fixed inset-0 bg-black/80 z-[9998] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg flex flex-col gap-4 animate-fade-in border-4 border-purple-500">
            <h2 className="text-2xl font-bold text-gray-800 border-b pb-2 flex items-center gap-2"><span>🤖</span> Proposition de l&apos;IA</h2>
            <div className="flex flex-col gap-3 text-base text-gray-800 bg-gray-50 p-4 rounded-lg border border-gray-200">
              <p><strong className="text-purple-700">Titre :</strong> {aiProposal.title || '(Vide)'}</p>
              {aiProposal.content && <p><strong className="text-purple-700">Contenu :</strong> {aiProposal.content}</p>}
              <p><strong className="text-purple-700">Format :</strong> {aiProposal.is_list ? 'Liste de tâches ✅' : 'Note texte 📝'}</p>
              {aiProposal.is_list && aiProposal.list_items?.length > 0 && (
                <div className="bg-white border border-purple-200 rounded-lg p-3">
                  <strong className="text-purple-700">Éléments :</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                    {aiProposal.list_items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                  </ul>
                </div>
              )}
              <p><strong className="text-purple-700">Priorité :</strong> {aiProposal.importance === 'rouge' ? '🔴 Urgente' : aiProposal.importance === 'orange' ? '🟠 Importante' : '🟢 Normale'}</p>
              {aiProposal.send_email && <p className="bg-blue-100 p-2 rounded text-blue-900 border border-blue-200"><strong>📨 E-mail :</strong> Envoi immédiat activé</p>}
              {aiProposal.daily_reminder && (
                <p className="bg-green-100 p-2 rounded text-green-900 border border-green-200">
                  <strong>🔄 Relance quotidienne :</strong> {aiProposal.daily_reminder_time || '09:00'}
                  {' — '}
                  {aiProposal.daily_reminder_email && aiProposal.daily_reminder_popup
                    ? 'e-mail + notification'
                    : aiProposal.daily_reminder_email
                      ? 'e-mail'
                      : 'notification'}
                </p>
              )}
              {aiProposal.popup_time && <p className="bg-indigo-100 p-2 rounded text-indigo-900 border border-indigo-200"><strong>⏰ Alarme pop-up :</strong> {new Date(getSafeTime(aiProposal.popup_time)).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</p>}
              {aiProposal.calendar_time && <p className="bg-purple-100 p-2 rounded text-purple-900 border border-purple-200"><strong>📅 Ajout Agenda :</strong> {new Date(getSafeTime(aiProposal.calendar_time)).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</p>}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <button onClick={() => confirmAiNote(aiProposal)} disabled={loading} className="flex-1 bg-green-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-green-700 transition-colors shadow-md disabled:opacity-50">{loading ? 'Création...' : '✅ Valider et Créer'}</button>
              <button onClick={() => loadProposalIntoForm(aiProposal)} disabled={loading} className="flex-1 bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-xl hover:bg-gray-300 transition-colors">✏️ Modifier manuellement</button>
            </div>
            <button onClick={() => setAiProposal(null)} className="text-gray-400 hover:text-gray-600 text-sm mt-1 underline">Annuler et fermer</button>
          </div>
        </div>
      )}

      {/* MODALE : FERMER LE PLANNING */}
      {showClosePlanningModal && (
        <div className="fixed inset-0 bg-black/70 z-[12000] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">Fermer le planning ?</h2>
              <p className="text-sm text-gray-600 font-semibold mt-2">
                {activeTemplateId
                  ? <>Tu as des modifications non enregistrées sur <strong>« {activeTemplateName || 'ce planning'} »</strong>.</>
                  : <>Ce nouveau planning contient des modifications qui ne sont pas encore sauvegardées.</>}
              </p>
            </div>

            <button
              onClick={() => void saveAndClosePlanning()}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-black py-3 rounded-xl shadow"
            >
              {loading ? 'Enregistrement…' : '💾 Enregistrer et fermer'}
            </button>

            <button
              onClick={closePlanningNow}
              disabled={loading}
              className="w-full bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-700 font-black py-3 rounded-xl border border-red-200"
            >
              Fermer sans enregistrer
            </button>

            <button
              onClick={() => setShowClosePlanningModal(false)}
              disabled={loading}
              className="w-full bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-800 font-bold py-3 rounded-xl"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ================= VUE : HUB PRINCIPAL ================= */}
      {mainMode === 'hub' && (
        <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 animate-fade-in">
           <h1 className="text-3xl font-black text-gray-800 mb-8 text-center">Que veux-tu faire ?</h1>
           <button onClick={() => window.location.hash = 'notes-create'} className="w-full max-w-sm bg-gray-900 text-white p-8 rounded-3xl shadow-xl hover:bg-black transition-transform hover:scale-105 active:scale-95 flex flex-col items-center gap-4">
              <span className="text-5xl">📝</span><span className="text-xl font-bold">Notes & Rappels</span>
           </button>
           <button onClick={() => window.location.hash = 'planning'} className="w-full max-w-sm bg-blue-600 text-white p-8 rounded-3xl shadow-xl hover:bg-blue-700 transition-transform hover:scale-105 active:scale-95 flex flex-col items-center gap-4 border-4 border-blue-500">
              <span className="text-5xl">📅</span><span className="text-xl font-bold text-center">Planning &<br/>Semaines types</span>
           </button>
        </div>
      )}

      {/* ================= VUE : ACCUEIL PLANNING ================= */}
      {mainMode === 'planning_home' && (
        <div className="flex flex-col items-center justify-center min-h-[78vh] gap-6 animate-fade-in">
          <div className="w-full max-w-xl flex items-center justify-between mb-2">
            <button
              onClick={() => window.location.hash = 'hub'}
              className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-2 transition-colors"
            >
              ← Menu Principal
            </button>
            <h1 className="text-2xl font-black text-gray-800">Planning</h1>
          </div>

          <p className="text-sm text-gray-500 font-semibold text-center max-w-md -mt-2 mb-2">
            Choisis si tu veux partir d'un planning vide ou ouvrir un planning déjà sauvegardé.
          </p>

          <button
            onClick={startNewPlanning}
            className="w-full max-w-md bg-blue-600 text-white p-7 rounded-3xl shadow-xl hover:bg-blue-700 transition-transform hover:scale-[1.02] active:scale-95 flex items-center gap-5 text-left border-4 border-blue-500"
          >
            <span className="text-5xl flex-shrink-0">➕</span>
            <span className="flex flex-col">
              <span className="text-xl font-black">Nouveau planning</span>
              <span className="text-sm font-semibold text-blue-100 mt-1">Commencer sur une semaine vide</span>
            </span>
          </button>

          <button
            onClick={() => navigatePlanningChild('#planning-gallery')}
            className="w-full max-w-md bg-white text-gray-900 p-7 rounded-3xl shadow-lg hover:shadow-xl transition-transform hover:scale-[1.02] active:scale-95 flex items-center gap-5 text-left border-2 border-gray-300"
          >
            <span className="text-5xl flex-shrink-0">📂</span>
            <span className="flex flex-col min-w-0">
              <span className="text-xl font-black">Plannings sauvegardés</span>
              <span className="text-sm font-semibold text-gray-500 mt-1">{savedTemplates.length} planning{savedTemplates.length > 1 ? 's' : ''} disponible{savedTemplates.length > 1 ? 's' : ''}</span>
            </span>
          </button>
        </div>
      )}

      {/* ================= NOUVELLE VUE : GALERIE DES PLANNINGS ================= */}
      {mainMode === 'planning_gallery' && (
        <div className="flex flex-col gap-4 animate-fade-in w-full">
           <div className="flex items-center justify-between mb-4">
             <button onClick={navigatePlanningHome} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-2 transition-colors">← Accueil Planning</button>
             <h1 className="text-xl font-black text-gray-800">Mes Plannings</h1>
           </div>

           {savedTemplates.length === 0 ? (
             <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-3xl p-12 flex flex-col items-center justify-center text-center gap-4">
                <span className="text-5xl">📂</span>
                <p className="text-gray-500 font-bold">Tu n'as encore sauvegardé aucun modèle.</p>
             </div>
           ) : (
             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
               {savedTemplates.map((tmpl, index) => (
                 <div 
                   key={tmpl.id} 
                   className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-transform hover:shadow-md cursor-grab active:cursor-grabbing"
                   draggable={true}
                   onDragStart={(e) => handleDragStart(e, index)}
                   onDragOver={(e) => e.preventDefault()}
                   onDrop={(e) => handleDrop(e, index)}
                 >
                   {/* En-tête de la carte */}
                   <div className="bg-gray-900 text-white p-3 flex justify-between items-center gap-2">
                     <div className="min-w-0 flex items-center gap-2">
                       <h3 className="font-bold text-sm truncate">{tmpl.name}</h3>
                       {activeTemplateId === tmpl.id && (
                         <span className="flex-shrink-0 bg-green-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">EN COURS</span>
                       )}
                     </div>
                     <span className="text-gray-400 cursor-grab px-1">⣿</span>
                   </div>

                   {/* GÉNÉRATEUR DE MINIATURE (Aperçu visuel de la grille) */}
                   <div className="h-32 bg-gray-50 w-full relative flex border-b border-gray-200 p-1 pointer-events-none">
                     {WEEK_DAYS.map((dayName, dIdx) => (
                       <div key={dIdx} className="flex-1 border-r border-gray-200/50 last:border-0 relative h-full">
                         {tmpl.blocks?.filter((b: any) => b.day === dayName).map((ev: any) => {
                           const topPercent = ((ev.startHour - PLANNING_START_HOUR) + (ev.startMinute || 0) / 60) / hoursOfDay.length * 100;
                           const colorClass = ev.color === 'blue' ? 'bg-blue-500' : ev.color === 'green' ? 'bg-green-500' : ev.color === 'red' ? 'bg-red-500' : 'bg-gray-500';

                           if (ev.kind === 'marker') {
                             return (
                               <div
                                 key={ev.id}
                                 className={`absolute left-0.5 right-0.5 h-[3px] rounded-full opacity-90 ${colorClass}`}
                                 style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
                               />
                             );
                           }

                           const heightPercent = ((ev.duration || 60) / 60) / hoursOfDay.length * 100;
                           return (
                             <div 
                               key={ev.id} 
                               className={`absolute left-0.5 right-0.5 rounded-[2px] opacity-80 ${colorClass}`}
                               style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
                             />
                           )
                         })}
                       </div>
                     ))}
                   </div>

                   {/* Boutons d'action */}
                   <div className="p-2 flex flex-col gap-1.5 bg-gray-50">
                     <button onClick={() => setPreviewTemplate(tmpl)} className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs py-2 rounded-lg transition-colors">🔍 Aperçu</button>
                     <div className="flex gap-1.5">
                       <button onClick={() => loadTemplate(tmpl)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] py-2 rounded-lg transition-colors">Charger</button>
                       <button onClick={() => duplicateSavedTemplate(tmpl)} className="flex-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold text-[11px] py-2 rounded-lg transition-colors">⧉ Dupliquer</button>
                       <button onClick={() => deleteSavedTemplate(tmpl.id)} className="bg-red-100 hover:bg-red-200 text-red-600 font-bold text-xs px-2.5 py-2 rounded-lg transition-colors">🗑️</button>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           )}
        </div>
      )}

      {/* ================= VUE : PLANNING (ÉDITEUR) ================= */}
      {mainMode === 'planning' && (
         <div className="flex flex-col gap-4 animate-fade-in w-full">
           <div className="flex items-center justify-between mb-2 gap-3">
             <button onClick={requestClosePlanning} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-2 transition-colors">✕ Fermer le planning</button>
             <div className="text-right min-w-0">
               <h1 className="text-xl font-black text-gray-800">Éditeur de Semaine</h1>
               {activeTemplateId && (
                 <p className={`text-[11px] font-bold truncate ${isPlanningDirty ? 'text-orange-600' : 'text-green-600'}`}>
                   {activeTemplateName} · {isPlanningDirty ? 'modifié' : 'à jour'}
                 </p>
               )}
             </div>
           </div>

           {/* Contrôles du modèle */}
           <div className="flex flex-col gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200">
              <div className="flex gap-2">
                <button
                  onClick={saveTemplateToDB}
                  disabled={Boolean(activeTemplateId) && !isPlanningDirty}
                  className={`flex-1 font-bold py-3 rounded-xl text-sm shadow transition-colors ${
                    activeTemplateId && !isPlanningDirty
                      ? 'bg-green-100 text-green-700 cursor-default'
                      : 'bg-gray-900 text-white hover:bg-black'
                  }`}
                >
                  {activeTemplateId
                    ? (isPlanningDirty ? '💾 Enregistrer les modifications' : '✓ Planning à jour')
                    : '💾 Sauvegarder comme nouveau planning'}
                </button>
                <button onClick={exportWeeklyICS} className="flex-1 bg-purple-600 text-white font-bold py-3 rounded-xl text-sm shadow hover:bg-purple-700 transition-colors">
                  📅 Exporter (Agenda)
                </button>
              </div>

              {/* NOUVEAU PLANNING + GALERIE */}
              <div className="flex gap-2">
                <button
                  onClick={startNewPlanning}
                  className="bg-white border-2 border-gray-300 text-gray-800 font-bold px-4 py-3 rounded-xl text-sm shadow-sm hover:border-gray-800 transition-colors"
                  title="Commencer un planning vide sans modifier le planning sauvegardé actuel"
                >
                  ➕ Nouveau
                </button>
                <button 
                  onClick={() => navigatePlanningChild('#planning-gallery')} 
                  className="flex-1 bg-white border-2 border-gray-300 text-gray-800 font-bold py-3 rounded-xl text-sm shadow-sm hover:border-gray-800 transition-colors flex items-center justify-center gap-2"
                >
                  <span>📂</span> Mes plannings sauvegardés ({savedTemplates.length})
                </button>
              </div>
           </div>

           <div className="text-center mb-1">
             <span className="text-xs font-bold text-gray-400">↔️ 1 doigt : déplacer | ↔️ 2 doigts : zoom jours | ↕️ 2 doigts : zoom heures | 📌 Jours figés en haut</span>
           </div>

           {/* LIGNE DES JOURS FIGÉE : reste visible pendant le scroll vertical, façon Excel */}
           <div className="sticky top-0 z-[200] h-10 flex w-full bg-white rounded-t-2xl border border-gray-200 shadow-md overflow-hidden">
             {/* Coin au-dessus de la colonne des heures */}
             <div className="flex-shrink-0 w-12 h-10 bg-gray-50 border-r border-gray-200"></div>

             {/* En-têtes des jours : scroll horizontal synchronisé avec le planning */}
             <div
               ref={daysHeaderScrollRef}
               className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [&::-webkit-scrollbar]:hidden"
               style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x', scrollbarWidth: 'none' }}
             >
               <div className="flex h-10" style={{ minWidth: `${(7 / daysPerView) * 100}%` }}>
                 {WEEK_DAYS.map((dayName) => (
                   <div
                     key={`sticky-${dayName}`}
                     className="flex-1 min-w-0 h-10 flex items-center justify-center border-r border-gray-200 last:border-r-0 bg-white overflow-hidden"
                   >
                     <span className="font-black text-gray-800 whitespace-nowrap px-1 leading-none" style={{ fontSize: `${dayHeaderFontSize}px` }}>{dayName}</span>
                   </div>
                 ))}
               </div>
             </div>
           </div>

           {/* La grille remonte sous la ligne figée. Sa hauteur est basée sur hoursOfDay.length pour éviter tout écrasement des lignes. */}
           <div className="-mt-10">
           {/* Grille du planning avec DÉFILEMENT HORIZONTAL NATIF + ZOOM PERSONNALISÉ */}
           <div 
             ref={gridRef}
             className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative flex w-full" 
             style={{ height: `${hoursOfDay.length * hourHeight + PLANNING_HEADER_HEIGHT}px`, touchAction: 'pan-x pan-y' }}
           >
             
             {/* Colonne des heures (Fixée à gauche) */}
             <div className="flex-shrink-0 z-20 flex flex-col w-12 bg-gray-50 border-r border-gray-200 shadow-[2px_0_5px_rgba(0,0,0,0.05)] pointer-events-none">
               <div className="h-10 border-b border-gray-200 bg-gray-50 sticky top-0 z-30" style={{ flexShrink: 0 }}></div> {/* Coin vide */}
               {hoursOfDay.map(hour => (
                 <div key={hour} className="flex items-start justify-center pt-1 border-b border-gray-200" style={{ height: `${hourHeight}px`, flexShrink: 0 }}>
                   <span className="text-[10px] font-bold text-gray-400">{hour}h</span>
                 </div>
               ))}
             </div>

             {/* Colonnes des jours : vraie zone défilable horizontalement au doigt */}
             <div
               ref={daysScrollRef}
               className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain relative ${selectedBlockId ? 'z-40' : 'z-0'}`}
               style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
             >
               {/* La largeur varie avec le zoom horizontal.
                   daysPerView = 3 => environ 3 jours visibles ; 1.15 => gros zoom ; 7 => semaine entière. */}
               <div className="flex h-full" style={{ minWidth: `${(7 / daysPerView) * 100}%` }}>
                 {WEEK_DAYS.map((dayName) => (
                   <div key={dayName} data-planning-day={dayName} className="flex-1 min-w-0 flex flex-col border-r border-gray-100 last:border-r-0 relative h-full overflow-visible">
                   
                   <div className="h-10 flex items-center justify-center border-b border-gray-200 bg-white sticky top-0 z-10" style={{ flexShrink: 0 }}>
                       <span className="font-black text-gray-800 whitespace-nowrap px-1 leading-none" style={{ fontSize: `${dayHeaderFontSize}px` }}>{dayName}</span>
                   </div>

                   {/* Lignes de fond (cliquables pour ajouter) */}
                   {hoursOfDay.map(hour => (
                     <div 
                       key={hour} 
                       onClick={(e) => {
                         if (selectedBlockId) {
                           setSelectedBlockId(null);
                           return;
                         }
                         const rect = e.currentTarget.getBoundingClientRect();
                         const offsetY = e.clientY - rect.top;
                         const minute = Math.floor(offsetY / (hourHeight / 4)) * 15;
                         openAddBlockModal(dayName, hour, minute);
                       }} 
                       className="border-b border-gray-100 w-full hover:bg-blue-50/30 cursor-pointer"
                       style={{ height: `${hourHeight}px`, flexShrink: 0 }}
                     >
                     </div>
                   ))}

                   {/* Blocs d'événements */}
                   {weeklyBlocks.filter(b => b.day === dayName).map(ev => {
                     const topPx = ((ev.startHour - PLANNING_START_HOUR) + (ev.startMinute || 0) / 60) * hourHeight;
                     const heightPx = ((ev.duration || 60) / 60) * hourHeight;
                     const isSelected = selectedBlockId === ev.id;
                     const isDragging = draggingBlockId === ev.id;

                     if (ev.kind === 'marker') {
                       const markerTop = topPx + PLANNING_HEADER_HEIGHT;
                       const markerPopoverPosition = ev.startHour < 10
                         ? { top: 'calc(50% + 8px)' }
                         : { bottom: 'calc(50% + 8px)' };

                       return (
                         <div
                           key={ev.id}
                           className={`absolute left-1 right-1 h-6 flex items-center select-none ${isDragging ? 'z-[850]' : isSelected ? 'z-[450]' : 'z-20'}`}
                           style={{ top: `${markerTop - 12}px` }}
                           onTouchStart={(e) => startTouchBlockDrag(e, ev)}
                           onPointerDown={(e) => startMouseBlockDrag(e, ev)}
                           onContextMenu={(e) => e.preventDefault()}
                           onClick={(e) => {
                             e.stopPropagation();
                             if (consumeSuppressedBlockClick(ev.id)) return;
                             if (selectedBlockId && selectedBlockId !== ev.id) {
                               setSelectedBlockId(null);
                             } else {
                               setSelectedBlockId(isSelected ? null : ev.id);
                             }
                           }}
                         >
                           <div
                             className={`w-full h-[5px] rounded-full shadow-sm cursor-pointer transition-all ${
                               ev.color === 'blue' ? 'bg-blue-500' :
                               ev.color === 'green' ? 'bg-green-500' :
                               ev.color === 'red' ? 'bg-red-500' : 'bg-gray-500'
                             } ${isSelected ? 'ring-2 ring-black ring-offset-1' : ''} ${isDragging ? 'ring-2 ring-purple-500 ring-offset-2 scale-y-150 shadow-lg' : ''}`}
                           />

                           {isSelected && (
                             <div
                               data-block-drag-ignore="true"
                               className="absolute left-1/2 -translate-x-1/2 w-[190px] max-w-[85vw] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] border-2 border-gray-800 p-3 flex flex-col gap-2 z-[1000] cursor-default"
                               style={markerPopoverPosition}
                               onClick={(e) => e.stopPropagation()}
                             >
                               <div className="flex items-center gap-2">
                                 <span className={`block w-8 h-[5px] rounded-full ${
                                   ev.color === 'blue' ? 'bg-blue-500' :
                                   ev.color === 'green' ? 'bg-green-500' :
                                   ev.color === 'red' ? 'bg-red-500' : 'bg-gray-500'
                                 }`} />
                                 <span className="text-[10px] uppercase tracking-wide font-black text-gray-400">Repère horaire</span>
                               </div>
                               <h4 className="font-black text-sm text-gray-900 leading-tight">{ev.title}</h4>
                               <p className="text-xs text-gray-600 font-bold">
                                 {ev.day} · {ev.startHour}h{ev.startMinute ? ev.startMinute.toString().padStart(2, '0') : '00'}
                               </p>
                               <div className="flex gap-2 mt-1">
                                 <button onClick={(e) => { e.stopPropagation(); openEditBlockModal(ev); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2 rounded-lg text-lg shadow-sm border border-gray-200">✏️</button>
                                 <button onClick={(e) => { e.stopPropagation(); deleteBlock(ev.id); }} className="flex-1 bg-red-100 hover:bg-red-200 text-red-600 font-bold py-2 rounded-lg text-lg shadow-sm border border-red-200">🗑️</button>
                               </div>
                             </div>
                           )}
                         </div>
                       );
                     }

                     // Le contenu du bloc s'adapte à sa taille réelle à l'écran.
                     // Une tâche haute peut afficher plusieurs lignes ; une tâche très petite
                     // privilégie le titre et masque l'heure si elle n'a pas assez de place.
                     const showTaskTime = heightPx >= planningTaskFontSize * 3.5;
                     const taskTimeHeight = showTaskTime ? planningTaskTimeFontSize * 1.25 + 2 : 0;
                     const resizeHandleSpace = isSelected ? 24 : 0;
                     const taskTitleAvailableHeight = Math.max(
                       planningTaskFontSize * 1.15,
                       heightPx - (planningTaskPadding * 2) - taskTimeHeight - resizeHandleSpace
                     );
                     const taskTitleLineCount = Math.max(
                       1,
                       Math.min(6, Math.floor(taskTitleAvailableHeight / (planningTaskFontSize * 1.15)))
                     );
                     
                     const popoverPosition = ev.startHour < 10 
                       ? { top: 'calc(100% + 5px)' } 
                       : { bottom: 'calc(100% + 5px)' };

                     return (
                       <div 
                         key={ev.id} 
                         className={`absolute left-1 right-1 p-0.5 ${isDragging ? 'z-[850]' : isSelected ? 'z-[400]' : 'z-10'}`}
                         style={{ top: `${topPx + PLANNING_HEADER_HEIGHT}px`, height: `${heightPx}px` }} 
                       >
                         <div 
                           onTouchStart={(e) => startTouchBlockDrag(e, ev)}
                           onPointerDown={(e) => startMouseBlockDrag(e, ev)}
                           onContextMenu={(e) => e.preventDefault()}
                           onClick={(e) => { 
                             e.stopPropagation();
                             if (consumeSuppressedBlockClick(ev.id)) return;
                             if (selectedBlockId && selectedBlockId !== ev.id) {
                               setSelectedBlockId(null);
                             } else {
                               setSelectedBlockId(isSelected ? null : ev.id); 
                             }
                           }}
                           className={`relative h-full w-full rounded-lg shadow-sm border transition-all cursor-pointer select-none ${ev.color === 'blue' ? 'bg-blue-100 border-blue-300 text-blue-900' : ev.color === 'green' ? 'bg-green-100 border-green-300 text-green-900' : ev.color === 'red' ? 'bg-red-100 border-red-300 text-red-900' : 'bg-gray-100 border-gray-300 text-gray-900'} ${isSelected ? 'ring-2 ring-black shadow-md' : 'overflow-hidden'} ${isDragging ? 'ring-2 ring-purple-500 shadow-xl scale-[1.02] opacity-90 cursor-grabbing' : ''}`}
                         >
                           
                           <div
                             className="flex-1 overflow-hidden pointer-events-none"
                             style={{
                               padding: `${planningTaskPadding}px`,
                               paddingTop: `${Math.max(2, planningTaskPadding * 0.75)}px`,
                             }}
                           >
                             <span
                               className="font-bold block"
                               style={{
                                 fontSize: `${planningTaskFontSize}px`,
                                 lineHeight: 1.15,
                                 display: '-webkit-box',
                                 WebkitBoxOrient: 'vertical',
                                 WebkitLineClamp: taskTitleLineCount,
                                 overflow: 'hidden',
                                 overflowWrap: 'anywhere',
                               }}
                             >
                               {ev.title}
                             </span>
                             {showTaskTime && (
                               <span
                                 className="opacity-70 block"
                                 style={{
                                   marginTop: `${Math.max(1, planningTaskFontSize * 0.12)}px`,
                                   fontSize: `${planningTaskTimeFontSize}px`,
                                   lineHeight: 1.1,
                                   whiteSpace: 'nowrap',
                                 }}
                               >
                                 {ev.startHour}h{ev.startMinute ? ev.startMinute.toString().padStart(2, '0') : '00'}
                               </span>
                             )}
                           </div>

                           {isSelected && (
                             <div 
                               data-block-drag-ignore="true"
                               className="absolute bottom-0 left-0 right-0 h-6 bg-black/20 hover:bg-black/30 cursor-ns-resize flex justify-center items-end pb-1.5 z-30"
                               style={{ touchAction: 'none' }}
                               onPointerDown={(e) => handleResizeStart(e, ev)}
                               onPointerMove={handleResizeMove}
                               onPointerUp={handleResizeEnd}
                               onPointerCancel={handleResizeEnd}
                               onClick={(e) => e.stopPropagation()}
                             >
                               <div className="w-8 h-1.5 bg-white rounded-full shadow-sm" />
                             </div>
                           )}

                           {isSelected && (
                             <div 
                               data-block-drag-ignore="true"
                               className="absolute left-1/2 -translate-x-1/2 w-[180px] max-w-[85vw] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] border-2 border-gray-800 p-3 flex flex-col gap-2 z-[1000] cursor-default"
                               style={popoverPosition}
                               onClick={(e) => e.stopPropagation()} 
                             >
                                <h4 className="font-black text-sm text-gray-900 leading-tight">{ev.title}</h4>
                                <p className="text-xs text-gray-600 font-bold">
                                   {ev.startHour}h{ev.startMinute ? ev.startMinute.toString().padStart(2, '0') : '00'} <br/>
                                   Durée : {formatDuration(ev.duration || 60)}
                                </p>
                                <div className="flex gap-2 mt-1">
                                  <button onClick={(e) => { e.stopPropagation(); openEditBlockModal(ev); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2 rounded-lg text-lg shadow-sm border border-gray-200">✏️</button>
                                  <button onClick={(e) => { e.stopPropagation(); deleteBlock(ev.id); }} className="flex-1 bg-red-100 hover:bg-red-200 text-red-600 font-bold py-2 rounded-lg text-lg shadow-sm border border-red-200">🗑️</button>
                                </div>
                             </div>
                           )}

                         </div>
                       </div>
                     );
                   })}
                 </div>
                 ))}
               </div>
             </div>
           </div>
           </div>

           {draggingBlockId && draggingBlockPreview && (
             <div className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[20000] bg-gray-950 text-white px-4 py-2.5 rounded-full shadow-2xl text-sm font-black pointer-events-none border border-white/20">
               ↔ {draggingBlockPreview.day} · {draggingBlockPreview.hour}h{draggingBlockPreview.minute.toString().padStart(2, '0')}
             </div>
           )}

           {/* Modal d'ajout / modification rapide */}
           {showBlockModal && (
             <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 backdrop-blur-sm">
               <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl animate-fade-in">
                 <h3 className="font-bold text-lg text-gray-800 border-b pb-2">
                   {editingBlockId
                     ? (blockKind === 'marker' ? 'Modifier le repère horaire' : 'Modifier la tâche')
                     : (blockKind === 'marker' ? 'Ajouter un repère horaire' : 'Planifier une tâche')}
                 </h3>
                 
                 <div className="grid grid-cols-2 gap-2">
                   <button
                     type="button"
                     onClick={() => setBlockKind('task')}
                     className={`py-2 px-3 rounded-xl text-sm font-bold border-2 transition-all ${blockKind === 'task' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}
                   >
                     🗓️ Tâche
                   </button>
                   <button
                     type="button"
                     onClick={() => setBlockKind('marker')}
                     className={`py-2 px-3 rounded-xl text-sm font-bold border-2 transition-all ${blockKind === 'marker' ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}
                   >
                     ➖ Repère horaire
                   </button>
                 </div>

                 {blockKind === 'marker' && (
                   <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-2">
                     Le repère est une barre fine placée exactement à l&apos;heure choisie. Il ne prend aucune durée dans le planning.
                   </p>
                 )}

                 <div className="flex gap-2">
                   <select 
                     value={blockDay} 
                     onChange={(e) => setBlockDay(e.target.value)} 
                     className="flex-1 border border-gray-300 p-2 rounded-xl text-black font-semibold bg-gray-50 focus:bg-white transition-colors"
                   >
                     {WEEK_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                   </select>
                   
                   <input 
                     type="time" 
                     min={`${PLANNING_START_HOUR.toString().padStart(2, '0')}:00`}
                     max={`${PLANNING_END_HOUR.toString().padStart(2, '0')}:45`}
                     step={900}
                     value={blockTime} 
                     onChange={(e) => setBlockTime(e.target.value)} 
                     className="flex-1 border border-gray-300 p-2 rounded-xl text-black font-semibold bg-gray-50 focus:bg-white transition-colors"
                   />
                 </div>

                 <input
                   type="text"
                   value={blockTitle}
                   onChange={(e) => setBlockTitle(e.target.value)}
                   placeholder={blockKind === 'marker' ? 'Ex: Horaire travail chérie' : 'Ex: Entraînement Muay Thai...'}
                   className="w-full border border-gray-300 p-3 rounded-xl text-black font-semibold bg-gray-50 focus:bg-white transition-colors"
                 />
                 
                 <div className="flex gap-2 w-full justify-between mt-1">
                   <button onClick={() => setBlockColor('blue')} className={`w-8 h-8 rounded-full bg-blue-500 border-2 transition-transform ${blockColor === 'blue' ? 'scale-110 border-gray-900' : 'border-transparent'}`}></button>
                   <button onClick={() => setBlockColor('green')} className={`w-8 h-8 rounded-full bg-green-500 border-2 transition-transform ${blockColor === 'green' ? 'scale-110 border-gray-900' : 'border-transparent'}`}></button>
                   <button onClick={() => setBlockColor('red')} className={`w-8 h-8 rounded-full bg-red-500 border-2 transition-transform ${blockColor === 'red' ? 'scale-110 border-gray-900' : 'border-transparent'}`}></button>
                   <button onClick={() => setBlockColor('gray')} className={`w-8 h-8 rounded-full bg-gray-500 border-2 transition-transform ${blockColor === 'gray' ? 'scale-110 border-gray-900' : 'border-transparent'}`}></button>
                 </div>
                 
                 <div className="flex gap-2 mt-2">
                   <button onClick={saveBlock} className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl shadow">
                     {editingBlockId ? 'Enregistrer' : (blockKind === 'marker' ? 'Ajouter le repère' : 'Ajouter')}
                   </button>
                   <button onClick={() => setShowBlockModal(false)} className="flex-1 bg-gray-200 text-gray-700 font-bold py-3 rounded-xl">Annuler</button>
                 </div>
               </div>
             </div>
           )}
         </div>
      )}

      {/* ================= VUE : NOTES ET RAPPELS ================= */}
      {mainMode === 'notes' && (
        <div className="animate-fade-in">
          <div className={`flex items-start sm:items-center mb-4 justify-between flex-col sm:flex-row gap-2`}>
            {!isFocusMode ? (
              <div className="flex flex-col gap-1">
                <button onClick={() => window.location.hash = 'hub'} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-2 transition-colors w-fit">← Menu Principal</button>
                <h1 className="text-xl font-bold text-gray-800">Mes Notes &amp; Rappels</h1>
              </div>
            ) : (
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-gray-800">Mode Focus 🎯</h1>
                <span className="text-xs font-bold text-gray-500 mt-1">Une seule tâche à la fois. Reste concentré.</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <button 
                onClick={() => { 
                  setSkippedFocusIds([]); 
                  setShowArchived(false); 
                  setFocusPhase('rouge'); 
                  window.location.hash = isFocusMode ? 'notes-list' : 'notes-focus';
                }} 
                className={`px-4 py-2 rounded-full text-sm font-bold shadow-md transition-all whitespace-nowrap bg-gray-800 text-white hover:bg-gray-700`}
              >
                {isFocusMode ? 'Quitter le Mode Focus' : '🎯 Mode Focus'}
              </button>
            </div>
          </div>

          {!isFocusMode && (
            <div className="flex bg-gray-200 rounded-xl p-1 mb-6 shadow-inner w-full max-w-md mx-auto">
              <button type="button" onClick={() => window.location.hash = 'notes-create'} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${activeTab === 'create' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}>✍️ Créer</button>
              <button type="button" onClick={() => window.location.hash = 'notes-list'} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${activeTab === 'notes' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}>📑 Notes</button>
            </div>
          )}

          {!isPushEnabled && (
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl mb-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2"><span className="text-xl">🔔</span><p className="text-blue-900 text-xs font-semibold">Active les alertes en arrière-plan.</p></div>
              <button onClick={subscribeToPush} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded-lg text-sm whitespace-nowrap shadow-md transition-colors">Activer</button>
            </div>
          )}

          {activeTab === 'create' && !isFocusMode && (
            <form onSubmit={addNote} className="flex flex-col gap-2 mb-6 p-3 rounded-lg shadow-md border bg-gray-50 border-gray-200">
              <div className="flex gap-2">
                <button type="button" onClick={() => setNoteMode('text')} className={`px-3 py-1.5 text-sm rounded-md font-semibold transition-colors ${noteMode === 'text' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>📝 Format Texte</button>
                <button type="button" onClick={() => setNoteMode('list')} className={`px-3 py-1.5 text-sm rounded-md font-semibold transition-colors ${noteMode === 'list' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>✅ Format Liste</button>
              </div>

              {noteMode === 'text' ? (
                <div className="flex flex-col gap-2">
                  <div className="relative flex items-center w-full">
                    <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre (Optionnel)" className="w-full border border-gray-300 p-3 pr-16 rounded-xl text-black font-semibold text-lg" disabled={loading || isAiProcessing} />
                    <button type="button" onClick={() => toggleDictation('title')} className={`absolute right-2 p-3 text-xl rounded-full shadow-md transition-all ${listeningMode === 'title' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                  </div>
                  <div className="relative w-full">
                    <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Écris le contenu de ta note ici..." className="w-full border border-gray-300 p-3 pr-16 rounded-xl text-black resize-y min-h-[120px] text-base" disabled={loading || isAiProcessing} />
                    <button type="button" onClick={() => toggleDictation('content')} className={`absolute top-2 right-2 p-3 text-xl rounded-full shadow-md transition-all ${listeningMode === 'content' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="relative flex items-center w-full">
                    <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre de ta liste (ex: Courses)..." className="w-full border border-gray-300 p-3 pr-16 rounded-xl text-black font-semibold text-lg" disabled={loading || isAiProcessing} />
                    <button type="button" onClick={() => toggleDictation('title')} className={`absolute right-2 p-3 text-xl rounded-full shadow-md transition-all ${listeningMode === 'title' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                  </div>
                  
                  <div className="bg-white border border-gray-300 rounded p-2 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs font-bold text-gray-700">Éléments de la liste :</span>
                    {newListItems.length > 0 && (
                      <ul className="flex flex-col gap-1 mb-1">
                        {newListItems.map((item, idx) => (
                          <li key={idx} className="flex justify-between items-center bg-gray-50 p-1.5 rounded border border-gray-200 text-xs text-black">
                            <span className="flex-1 mr-2">• {item}</span>
                            <button type="button" onClick={() => setNewListItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700 text-base font-bold leading-none px-2">×</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1 flex items-center">
                        <input type="text" value={currentNewListItem} onChange={(e) => setCurrentNewListItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (currentNewListItem.trim()) { setNewListItems(prev => [...prev, currentNewListItem.trim()]); setCurrentNewListItem(''); } } }} placeholder="Ajouter un élément..." className="w-full border border-gray-300 p-3 pr-16 rounded-xl text-black text-sm" disabled={loading || isAiProcessing} />
                        <button type="button" onClick={() => toggleDictation('list_item')} className={`absolute right-1 p-2 text-xl rounded-full shadow-md transition-all ${listeningMode === 'list_item' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                      </div>
                      <button type="button" onClick={() => { if (currentNewListItem.trim()) { setNewListItems(prev => [...prev, currentNewListItem.trim()]); setCurrentNewListItem(''); } }} className="bg-blue-100 text-blue-700 border border-blue-300 px-2 py-1.5 rounded-xl text-xs font-bold hover:bg-blue-200 transition-colors" disabled={loading || isAiProcessing || !currentNewListItem.trim()}>+ Ajouter</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center w-full mt-1">
                <select value={importance} onChange={(e) => setImportance(e.target.value as any)} disabled={isAiProcessing} className="w-full border border-gray-300 p-2 rounded text-black bg-white cursor-pointer text-sm font-bold">
                  <option value="vert">🟢 Priorité Normale</option>
                  <option value="orange">🟠 Priorité Importante</option>
                  <option value="rouge">🔴 Priorité Urgente</option>
                </select>
              </div>

              <div className="flex items-center gap-2 w-full p-2 rounded-lg border border-amber-200 bg-amber-50">
                <span className="text-xs font-bold text-amber-900 whitespace-nowrap">⏱ Durée :</span>
                <input type="number" min="0" max="168" placeholder="0" value={newDurationHours} onChange={(e) => setNewDurationHours(e.target.value)} disabled={isAiProcessing} className="w-14 p-1.5 border border-amber-300 rounded text-center text-black font-bold text-xs bg-white" />
                <span className="text-xs font-bold text-amber-900">h</span>
                <input type="number" min="0" max="59" placeholder="0" value={newDurationMinutes} onChange={(e) => setNewDurationMinutes(e.target.value)} disabled={isAiProcessing} className="w-14 p-1.5 border border-amber-300 rounded text-center text-black font-bold text-xs bg-white" />
                <span className="text-xs font-bold text-amber-900">min</span>
                <span className="ml-auto text-[10px] text-amber-700">optionnel</span>
              </div>

              <div className="border-b border-gray-200 pb-3 mt-1">
                <button type="button" onClick={() => toggleDictation('ai')} disabled={(listeningMode !== 'none' && listeningMode !== 'ai') || isAiProcessing} className={`w-full py-3 px-3 text-sm rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-md ${isAiProcessing ? 'bg-indigo-600 text-white animate-pulse' : listeningMode === 'ai' ? 'bg-purple-600 text-white animate-pulse scale-[1.02]' : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'}`}>
                  <span className="text-xl">🤖</span> {isAiProcessing ? 'L\'IA réfléchit...' : listeningMode === 'ai' ? 'Cliquer pour arrêter l\'analyse' : 'Dictée intelligente (IA tout-en-un)'}
                </button>
              </div>

              <div className="flex flex-col mt-2">
                <button type="button" onClick={() => setShowAdvancedSettings(!showAdvancedSettings)} className="w-full bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold py-2 px-3 rounded-lg text-sm flex justify-between items-center transition-colors">
                  <span>⚙️ Paramétrage de la note</span><span>{showAdvancedSettings ? '▲' : '▼'}</span>
                </button>
                {showAdvancedSettings && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 p-3 bg-gray-100 rounded-lg border border-gray-200">
                    <button type="button" onClick={() => setSendImmediateEmail(!sendImmediateEmail)} disabled={isAiProcessing} className={`p-2 rounded font-bold border transition-colors text-left text-xs flex items-center justify-between ${sendImmediateEmail ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}><span>📨 E-mail immédiat</span><span>{sendImmediateEmail ? 'ON' : 'OFF'}</span></button>
                    <div className="flex flex-col">
                      <button type="button" onClick={() => { setShowPopupConfig(!showPopupConfig); if (!showPopupConfig && 'Notification' in window) Notification.requestPermission(); }} disabled={isAiProcessing} className={`p-2 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${(showPopupConfig || popupHours || popupMinutes) ? 'bg-indigo-600 text-white border-indigo-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}><span>⏰ Alarme pop-up (Dans...)</span><span>{showPopupConfig ? '▲' : '▼'}</span></button>
                      {showPopupConfig && (
                        <div className="bg-indigo-50 border border-t-0 border-indigo-200 p-2 rounded-b flex flex-col items-center gap-2">
                          <div className="flex flex-wrap items-center gap-1 justify-center">
                            <span className="text-xs font-bold text-indigo-900">Dans:</span><input type="number" placeholder="0" min="0" value={popupHours} onChange={(e) => setPopupHours(e.target.value)} className="w-12 p-1 border border-indigo-300 rounded text-center text-black font-bold text-xs" /><span className="text-xs font-bold text-indigo-900">h</span><input type="number" placeholder="0" min="0" value={popupMinutes} onChange={(e) => setPopupMinutes(e.target.value)} className="w-12 p-1 border border-indigo-300 rounded text-center text-black font-bold text-xs" /><span className="text-xs font-bold text-indigo-900">min</span>
                          </div>
                          {(popupHours || popupMinutes) && (<button type="button" onClick={() => { setPopupHours(''); setPopupMinutes(''); setShowPopupConfig(false); }} className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold hover:bg-red-200 transition-colors">✖ Annuler</button>)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <button type="button" onClick={() => setShowDailyConfig(!showDailyConfig)} disabled={isAiProcessing} className={`p-2 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${(activateReminder || reminderPopupActive) ? 'bg-green-600 text-white border-green-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}><span>🔄 Relance quotidienne</span><span>{showDailyConfig ? '▲' : '▼'}</span></button>
                      {showDailyConfig && (
                        <div className="bg-green-50 border border-t-0 border-green-200 p-2 rounded-b flex flex-col gap-2">
                          <div className="flex flex-wrap gap-4 justify-center"><label className="flex items-center gap-1 cursor-pointer font-bold text-green-900 text-xs"><input type="checkbox" checked={activateReminder} onChange={(e) => setActivateReminder(e.target.checked)} className="accent-green-600"/> E-mail</label><label className="flex items-center gap-1 cursor-pointer font-bold text-green-900 text-xs"><input type="checkbox" checked={reminderPopupActive} onChange={(e) => setReminderPopupActive(e.target.checked)} className="accent-green-600"/> Pop-up</label></div>
                          <div className="flex items-center justify-center gap-2 pt-1 border-t border-green-200"><span className="text-xs font-bold text-green-900">À :</span><input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="p-1 border border-green-300 rounded text-black bg-white font-bold text-xs" /></div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <button type="button" onClick={() => setShowCalendarConfig(!showCalendarConfig)} disabled={isAiProcessing} className={`p-2 rounded font-bold border transition-colors text-left text-xs flex justify-between items-center ${targetDate ? 'bg-purple-600 text-white border-purple-600 rounded-b-none' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}><span>📅 Agenda / .ics</span><span>{showCalendarConfig ? '▲' : '▼'}</span></button>
                      {showCalendarConfig && (
                        <div className="bg-purple-50 border border-t-0 border-purple-200 p-2 rounded-b flex flex-col gap-2 items-center">
                          <input type="datetime-local" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="border border-purple-300 p-1 rounded text-black bg-white font-bold text-xs" />
                          <div className="flex flex-wrap gap-2 pt-1 justify-center"><label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-purple-900"><input type="checkbox" checked={enableGoogleCal} onChange={(e) => setEnableGoogleCal(e.target.checked)} className="accent-purple-600" /> Google Agenda</label><label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-purple-900"><input type="checkbox" checked={enableICal} onChange={(e) => setEnableICal(e.target.checked)} className="accent-purple-600" /> Fichier .ics</label></div>
                          {targetDate && (<button type="button" onClick={() => { setTargetDate(''); setShowCalendarConfig(false); }} className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold hover:bg-red-200 transition-colors">✖ Annuler date</button>)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {successMessage && (
                <div className="mt-2 p-2 bg-green-100 border border-green-300 text-green-800 text-center font-bold text-xs rounded-lg transition-all">
                  {successMessage}
                </div>
              )}

              <button type="submit" disabled={loading || isAiProcessing || (!newTitle.trim() && !newContent.trim() && newListItems.length === 0)} className="mt-2 bg-gray-900 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors w-full shadow-lg">{loading ? 'Création...' : isAiProcessing ? 'Patientez...' : 'Créer la note'}</button>
            </form>
          )}

          {/* ================= MODE FOCUS INTELLIGENT ================= */}
          {isFocusMode ? (
            <div className="flex flex-col items-center justify-center mt-6 mb-12 w-full">
              {focusStatus && currentFocusNote && (
                <div className="bg-gray-800 text-white px-4 py-2 rounded-full font-bold text-xs shadow-sm mb-6 flex items-center gap-1.5">
                  <span>🎯</span> {focusStatus}
                </div>
              )}

              {/* PHASES DE TRANSITION AVEC QUESTIONS */}
              {focusPhase === 'ask_orange' ? (
                <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl text-center flex flex-col items-center gap-4 border-2 border-orange-400">
                  <span className="text-5xl">🔥</span>
                  <h2 className="text-2xl font-black text-gray-800">Urgences terminées !</h2>
                  <p className="text-gray-600 font-medium">As-tu l'énergie de continuer sur les tâches importantes ?</p>
                  <div className="flex w-full gap-3 mt-4">
                    <button onClick={() => setFocusPhase('orange')} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-xl text-lg shadow-md transition-transform hover:scale-105 active:scale-95">Oui, on continue</button>
                    <button onClick={() => { setSkippedFocusIds([]); window.location.hash = 'notes-list'; }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-lg shadow-sm border border-gray-200 transition-transform hover:scale-105 active:scale-95">Non, stop</button>
                  </div>
                </div>
              ) : focusPhase === 'ask_vert' ? (
                <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl text-center flex flex-col items-center gap-4 border-2 border-green-400">
                  <span className="text-5xl">🔋</span>
                  <h2 className="text-2xl font-black text-gray-800">Tâches importantes finies !</h2>
                  <p className="text-gray-600 font-medium">Veux-tu terminer avec les tâches normales ?</p>
                  <div className="flex w-full gap-3 mt-4">
                    <button onClick={() => setFocusPhase('vert')} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-md transition-transform hover:scale-105 active:scale-95">Oui, on termine</button>
                    <button onClick={() => { setSkippedFocusIds([]); window.location.hash = 'notes-list'; }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-lg shadow-sm border border-gray-200 transition-transform hover:scale-105 active:scale-95">Non, stop</button>
                  </div>
                </div>
              ) : currentFocusNote ? (
                // AFFICHAGE D'UNE NOTE PENDANT LE FOCUS
                <div key={currentFocusNote.id} className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl flex flex-col items-center text-center gap-6 border border-gray-100">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm border ${currentFocusNote.importance === 'rouge' ? 'bg-red-50 text-red-600 border-red-200' : currentFocusNote.importance === 'orange' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-green-50 text-green-600 border-green-200'}`}>{currentFocusNote.importance === 'rouge' ? '🔴 Urgent' : currentFocusNote.importance === 'orange' ? '🟠 Important' : '🟢 Normal'}</span>
                  {currentFocusNote.title && <h2 className="text-2xl sm:text-3xl font-black text-gray-900 leading-tight">{currentFocusNote.title}</h2>}
                  {currentFocusNote.content && <p className="text-sm sm:text-base text-gray-600 font-medium whitespace-pre-wrap max-h-[30vh] overflow-y-auto w-full">{currentFocusNote.content}</p>}
                  {currentFocusNote.is_list && currentFocusNote.subtasks?.length > 0 && (
                    <div className="w-full bg-gray-50 p-3 rounded-xl text-left flex flex-col gap-2 mt-2 border border-gray-200">
                      {currentFocusNote.subtasks.map((st: Subtask) => (
                         <div key={st.id} className="flex items-center gap-3"><input type="checkbox" checked={st.completed} onChange={() => toggleSubtask(currentFocusNote!, st.id)} className="w-5 h-5 cursor-pointer accent-blue-600" /><span className={`text-sm font-bold ${st.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>{st.text}</span></div>
                      ))}
                    </div>
                  )}
                  <div className="flex w-full gap-3 mt-4">
                    <button onClick={() => updateNote(currentFocusNote!.id, 'completed', true)} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-lg transition-transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"><span>✓</span> Terminé</button>
                    <button onClick={() => setSkippedFocusIds(prev => [...prev, currentFocusNote!.id])} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-lg shadow-sm transition-transform hover:scale-105 active:scale-95 border border-gray-200">Plus tard</button>
                  </div>
                </div>
              ) : (
                // ÉCRAN DE FIN TOTALE
                <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-md text-center flex flex-col items-center gap-4 border-2 border-dashed border-gray-200">
                  <span className="text-6xl">🎉</span><h2 className="text-2xl font-black text-gray-800">Super, plus aucune note à traiter !</h2><p className="text-gray-500 font-medium text-sm">Tu as vidé ta liste de concentration.</p>
                  <button onClick={() => { setSkippedFocusIds([]); window.location.hash = 'notes-list'; }} className="mt-6 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-black transition-colors shadow-md">Quitter le Mode Focus</button>
                </div>
              )}
            </div>
          ) : activeTab === 'notes' && (
            <>
              <div className="flex items-center justify-between mb-6 w-full gap-2">
                <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  <button onClick={() => setShowArchived(false)} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === false ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>📂 Actif</button>
                  {hasSnoozedNotes && <button onClick={() => setShowArchived('snoozed')} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === 'snoozed' ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'}`}>💤 Masqué</button>}
                  <button onClick={() => setShowArchived(true)} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === true ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>📦 Archives</button>
                </div>
                <button onClick={() => openCleanupModal(showArchived === true ? 'archive' : 'actif')} className="text-gray-500 hover:text-gray-800 text-sm font-semibold flex items-center gap-1.5 transition-colors px-2 py-1 rounded whitespace-nowrap flex-shrink-0">🧹 Nettoyage {showArchived === true ? 'archive' : ''}</button>
              </div>

              {showArchived === true ? (
                <div className="flex flex-col bg-gray-50 p-3 rounded-xl border border-gray-200 shadow-inner">
                  <div className="w-full flex items-center justify-between mb-2 border-b border-gray-200 pb-1 text-gray-800"><span className="text-base font-bold">📦 Toutes les archives ({displayedNotes.length})</span></div>
                  <ul className="space-y-3">
                    {displayedNotes.length === 0 && <p className="text-gray-400 font-medium text-xs text-center py-4 bg-white rounded-lg border border-dashed border-gray-300">Dossier vide</p>}
                    {displayedNotes.map(renderNoteItem)}
                  </ul>
                </div>
              ) : (
                <div className={`grid items-start gap-4 grid-cols-1 lg:grid-cols-3`}>
                  {columns.map((col) => (
                    <div key={col.id} className="flex flex-col bg-gray-50 p-3 rounded-xl border border-gray-200 shadow-inner">
                      <button type="button" onClick={() => setCollapsedPriorities(prev => ({ ...prev, [col.id]: !prev[col.id] }))} className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-left mb-2 border-b border-gray-200 pb-1 text-gray-800 hover:text-gray-950 transition-colors" aria-expanded={!(collapsedPriorities[col.id] ?? false)}><span className="text-base font-bold">{(collapsedPriorities[col.id] ?? false) ? '▶' : '▼'} {col.title} ({col.notes.length})</span></button>
                      {!(collapsedPriorities[col.id] ?? false) && (
                      <ul className="space-y-3">
                        {col.notes.length === 0 && <p className="text-gray-400 font-medium text-xs text-center py-4 bg-white rounded-lg border border-dashed border-gray-300">Dossier vide</p>}
                        {col.notes.map(renderNoteItem)}
                      </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-12 mb-8 text-center">
                <button onClick={() => window.location.hash = 'notes-history'} className="text-gray-400 hover:text-gray-600 underline decoration-gray-300 font-semibold text-xs transition-colors tracking-wide">🕰️ Consulter l'historique des notes terminées</button>
              </div>
            </>
          )}

          {activeTab === 'history' && !isFocusMode && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center mb-2">
                 <button onClick={() => window.location.hash = 'notes-list'} className="text-blue-600 hover:underline font-bold text-sm">← Retour aux notes actives</button>
                 {historyNotes.length > 0 && <button onClick={deleteAllHistory} className="text-red-600 hover:text-red-800 hover:underline font-bold text-sm flex items-center gap-1">🗑️ Tout supprimer</button>}
              </div>
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex items-center gap-2">
                <span className="text-xl">🔍</span>
                <input type="text" placeholder="Rechercher dans l'historique..." value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="flex-1 border-none focus:ring-0 text-sm text-black font-semibold bg-transparent" />
                {historySearch && <button onClick={() => setHistorySearch('')} className="text-gray-400 hover:text-gray-600 font-bold px-2">✖</button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyNotes.length === 0 && <p className="col-span-full text-center text-gray-400 font-medium py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">Aucune note dans l'historique.</p>}
                {historyNotes.map(note => (
                  <div key={note.id} className="flex flex-col gap-2 p-3 rounded-lg shadow-sm bg-gray-100 border border-gray-300 opacity-80 grayscale">
                    <div className="font-bold text-gray-700 text-base line-through decoration-gray-400">{note.title || '(Sans titre)'}</div>
                    <div className="text-xs text-gray-500 whitespace-pre-wrap">{note.content}</div>
                    {typeof note.duration_minutes === 'number' && note.duration_minutes > 0 && (
                      <div className="text-[10px] font-bold text-gray-500">⏱ Durée : {formatDuration(note.duration_minutes)}</div>
                    )}
                    <div className="mt-2 pt-2 border-t border-gray-200 flex flex-col gap-1 text-[10px] text-gray-500 font-semibold">
                      <span>Créée le : {new Date(note.created_at || '').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      {note.completed_at && <span>Terminée le : {new Date(note.completed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                    </div>
                    <div className="flex justify-end gap-2 mt-1">
                      <button onClick={() => updateNote(note.id, 'completed', false)} className="bg-white border border-gray-300 text-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-50 hover:border-blue-200 transition-colors">↩ Réactiver</button>
                      <button onClick={() => deleteNote(note.id)} className="bg-white border border-gray-300 text-red-600 px-3 py-1 rounded text-xs font-bold hover:bg-red-50 hover:border-red-200 transition-colors">🗑️ Supprimer</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
