'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

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
  sort_order: number;
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

interface MemoListItem {
  id: string;
  text: string;
  completed: boolean;
}

type MemoColor = 'sage' | 'sand' | 'rose' | 'blue' | 'lavender' | 'white';

interface MemoEntry {
  id: string;
  title: string;
  content: string;
  memo_type: 'text' | 'list';
  items: MemoListItem[];
  color: MemoColor;
  pinned: boolean;
  archived: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

interface DragSlot {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  priority?: 'vert' | 'orange' | 'rouge';
}

interface AppConfirmDialog {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'sage';
  onConfirm: () => void | Promise<void>;
}

interface AppPromptDialog {
  title: string;
  message?: string;
  confirmLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  inputMode?: 'text' | 'numeric';
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

// Activé uniquement sur le projet Vercel de démonstration.
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

type MemoDndCardProps = {
  memo: MemoEntry;
  selected: boolean;
  disabled: boolean;
  hideOriginal: boolean;
  colorClass: string;
  onOpen: () => void;
  children: React.ReactNode;
};

function MemoDndCard({ memo, selected, disabled, hideOriginal, colorClass, onOpen, children }: MemoDndCardProps) {
  const draggable = useDraggable({ id: memo.id, disabled });
  const droppable = useDroppable({ id: memo.id, disabled });

  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  return (
    <article
      ref={setNodeRef}
      data-memo-card-id={memo.id}
      aria-selected={selected}
      onClick={onOpen}
      onContextMenu={(e) => e.preventDefault()}
      {...draggable.attributes}
      {...draggable.listeners}
      className={`relative rounded-[18px] border p-3 shadow-sm transition-[box-shadow,opacity,transform] duration-180 ease-out cursor-pointer select-none ${colorClass} ${selected ? 'ring-2 ring-[#6F7B64] ring-offset-2 ring-offset-[#F8F5EF] shadow-md' : ''} ${hideOriginal ? 'opacity-0 shadow-none' : 'active:scale-[0.985]'}`}
      style={{
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
    >
      {children}
    </article>
  );
}

function MemoTrashDroppable({ active, hovering }: { active: boolean; hovering: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'memo-trash', disabled: !active });
  if (!active) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[max(22px,env(safe-area-inset-bottom))] z-[12870] pointer-events-none">
      <div
        ref={setNodeRef}
        className={`pointer-events-auto min-w-[150px] h-14 px-5 rounded-full border-2 shadow-xl flex items-center justify-center gap-2 font-black text-sm transition-all duration-150 ${
          hovering
            ? 'bg-[#B85D55] border-[#9F4A43] text-white scale-110 shadow-[0_10px_28px_rgba(150,65,57,0.32)]'
            : 'bg-[#F7EBE7] border-[#D8AAA2] text-[#8A514A] scale-100'
        }`}
      >
        <span className={`text-xl transition-transform ${hovering ? 'scale-125' : ''}`}>🗑️</span>
        <span>{hovering ? 'Relâche pour supprimer' : 'Supprimer'}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [mainMode, setMainMode] = useState<'hub' | 'notes' | 'memos' | 'planning_home' | 'planning' | 'planning_gallery'>('hub');
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [demoResetting, setDemoResetting] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'notes' | 'history'>('create');
  const [noteMode, setNoteMode] = useState<'text' | 'list'>('text');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [importance, setImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [newListItems, setNewListItems] = useState<string[]>([]);
  const [currentNewListItem, setCurrentNewListItem] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Notes, Mémos & Listes : espace de conservation façon Google Keep.
  const [memoEntries, setMemoEntries] = useState<MemoEntry[]>([]);
  const [memoSearch, setMemoSearch] = useState('');
  const [showMemoArchived, setShowMemoArchived] = useState(false);
  const [memoEditorOpen, setMemoEditorOpen] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [memoDraftType, setMemoDraftType] = useState<'text' | 'list'>('text');
  const [memoDraftTitle, setMemoDraftTitle] = useState('');
  const [memoDraftContent, setMemoDraftContent] = useState('');
  const [memoDraftItems, setMemoDraftItems] = useState<MemoListItem[]>([]);
  const [memoNewItem, setMemoNewItem] = useState('');
  const [memoDraftColor, setMemoDraftColor] = useState<MemoColor>('sage');
  const [memoDraftPinned, setMemoDraftPinned] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set());
  const selectedMemoIdsRef = useRef<Set<string>>(new Set());
  const memoSelectionHistoryArmedRef = useRef(false);
  const memoEditorOpenRef = useRef(false);

  // Moteur DnD Kit : remplace la gestion tactile maison pour Notes/Mémos.
  // La sélection reste un appui long sans déplacement ; dès qu'on déplace,
  // DragOverlay prend le relais et DnD Kit garantit toujours une fin/cancel propre.
  const [memoDndMoved, setMemoDndMoved] = useState(false);
  const memoDndMovedRef = useRef(false);
  const memoDndSessionRef = useRef<{ id: string; originalEntries: MemoEntry[] } | null>(null);
  const memoDndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 12 } }),
  );

  // Réorganisation des mémos façon Google Keep : appui long, carte flottante,
  // réorganisation en direct puis sauvegarde de l'ordre dans Supabase.
  const [draggingMemoId, setDraggingMemoId] = useState<string | null>(null);
  const [, setMemoDragTargetId] = useState<string | null>(null);
  const [memoDragVisual, setMemoDragVisual] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [memoTrashHover, setMemoTrashHover] = useState(false);
  const memoTrashRef = useRef<HTMLDivElement | null>(null);
  const [memoColumnCount, setMemoColumnCount] = useState(2);
  const [memoCardHeights, setMemoCardHeights] = useState<Record<string, number>>({});
  const memoGhostRef = useRef<HTMLDivElement | null>(null);
  const memoLongPressTimerRef = useRef<number | null>(null);
  const memoDragLastPreviewRef = useRef('');
  const memoDragRef = useRef<{
    id: string;
    pointerId: number;
    pointerType: string;
    pointerCancelled: boolean;
    startX: number;
    startY: number;
    pressStartedAt: number;
    lastX: number;
    lastY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
    pinned: boolean;
    archived: boolean;
    originRect: { left: number; top: number; right: number; bottom: number };
    reorderUnlocked: boolean;
    lastReorderAt: number;
    lastReorderX: number;
    lastReorderY: number;
    candidateToken: string;
    candidateSince: number;
    slots: DragSlot[];
    acceptedToken: string;
    layoutLockedUntil: number;
    slotRefreshTimer: number | null;
    originalEntries: MemoEntry[];
    element: HTMLElement;
  } | null>(null);
  const memoEntriesRef = useRef<MemoEntry[]>([]);
  const memoSuppressClickIdsRef = useRef<Set<string>>(new Set());
  const memoSuppressAllClicksUntilRef = useRef(0);
  // Vrai FLIP : on capture les positions AVANT le changement d'ordre, puis
  // on anime les cartes depuis leur ancienne position APRÈS le rendu React.
  const memoPendingFlipRef = useRef<{ before: Map<string, DOMRect>; excludeId?: string } | null>(null);
  const memoFlipAnimationsRef = useRef<Map<string, Animation>>(new Map());

  // Réorganisation des tâches : même logique que pour les mémos, avec en plus
  // la possibilité de déposer une tâche dans une autre priorité.
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [taskDragVisual, setTaskDragVisual] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [taskDragHoverPriority, setTaskDragHoverPriority] = useState<'vert' | 'orange' | 'rouge' | null>(null);
  const taskGhostRef = useRef<HTMLDivElement | null>(null);
  const taskLongPressTimerRef = useRef<number | null>(null);
  const taskDragLastPreviewRef = useRef('');
  const taskDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    pressStartedAt: number;
    lastX: number;
    lastY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
    originalPriority: 'vert' | 'orange' | 'rouge';
    originRect: { left: number; top: number; right: number; bottom: number };
    reorderUnlocked: boolean;
    lastReorderAt: number;
    candidateToken: string;
    candidateSince: number;
    slots: DragSlot[];
    acceptedToken: string;
    layoutLockedUntil: number;
    slotRefreshTimer: number | null;
    pendingPriority: 'vert' | 'orange' | 'rouge';
    pendingTargetId: string | null;
    pendingInsertAfter: boolean;
    element: HTMLElement;
  } | null>(null);
  const notesRef = useRef<Note[]>([]);
  const taskPendingFlipRef = useRef<{ before: Map<string, DOMRect>; excludeId?: string } | null>(null);
  const taskFlipAnimationsRef = useRef<Map<string, Animation>>(new Map());
  
  // Animation de réorganisation façon Google Keep.
  // L'élément est déjà dans sa nouvelle place logique, mais l'animation WAAPI
  // le dessine d'abord à son ancienne position puis le fait glisser jusqu'à la nouvelle.
  useLayoutEffect(() => {
    const pending = memoPendingFlipRef.current;
    if (!pending) return;
    memoPendingFlipRef.current = null;

    document.querySelectorAll<HTMLElement>('[data-memo-card-id]').forEach((element) => {
      const id = element.dataset.memoCardId;
      if (!id || id === pending.excludeId) return;
      const previous = pending.before.get(id);
      if (!previous) return;
      const next = element.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75) return;

      memoFlipAnimationsRef.current.get(id)?.cancel();
      const animation = element.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 285,
          easing: 'cubic-bezier(0.20, 0.80, 0.20, 1)',
          fill: 'none',
        }
      );
      memoFlipAnimationsRef.current.set(id, animation);
      const clear = () => {
        if (memoFlipAnimationsRef.current.get(id) === animation) {
          memoFlipAnimationsRef.current.delete(id);
        }
      };
      animation.onfinish = clear;
      animation.oncancel = clear;
    });
  }, [memoEntries]);

  useLayoutEffect(() => {
    const pending = taskPendingFlipRef.current;
    if (!pending) return;
    taskPendingFlipRef.current = null;

    document.querySelectorAll<HTMLElement>('[data-task-card-id]').forEach((element) => {
      const id = element.dataset.taskCardId;
      if (!id || id === pending.excludeId) return;
      const previous = pending.before.get(id);
      if (!previous) return;
      const next = element.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75) return;

      taskFlipAnimationsRef.current.get(id)?.cancel();
      const animation = element.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.20, 0.80, 0.20, 1)',
          fill: 'none',
        }
      );
      taskFlipAnimationsRef.current.set(id, animation);
      const clear = () => {
        if (taskFlipAnimationsRef.current.get(id) === animation) {
          taskFlipAnimationsRef.current.delete(id);
        }
      };
      animation.onfinish = clear;
      animation.oncancel = clear;
    });
  }, [notes]);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [sendImmediateEmail, setSendImmediateEmail] = useState(false);
  const [showPopupConfig, setShowPopupConfig] = useState(false);
  const [popupScheduleMode, setPopupScheduleMode] = useState<'relative' | 'datetime'>('relative');
  const [popupHours, setPopupHours] = useState('');
  const [popupMinutes, setPopupMinutes] = useState('');
  const [popupDateTime, setPopupDateTime] = useState('');
  const [showNotesHelp, setShowNotesHelp] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<AppConfirmDialog | null>(null);
  const [confirmDialogLoading, setConfirmDialogLoading] = useState(false);
  const [appMessage, setAppMessage] = useState<string | null>(null);
  const [promptDialog, setPromptDialog] = useState<AppPromptDialog | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);
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

  // Navigation tactile entre Créer et Notes sauvegardées.
  // On mémorise seulement le point de départ : le changement de page n'est déclenché
  // que si le geste est clairement horizontal afin de ne pas gêner le scroll vertical.
  const notesSwipeStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
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
  const [showEditingAdvancedSettings, setShowEditingAdvancedSettings] = useState(false);
  const [editingSendImmediateEmail, setEditingSendImmediateEmail] = useState(false);
  const [showEditingPopupConfig, setShowEditingPopupConfig] = useState(false);
  const [editingPopupScheduleMode, setEditingPopupScheduleMode] = useState<'relative' | 'datetime'>('relative');
  const [editingPopupDateTime, setEditingPopupDateTime] = useState('');
  const [showEditingExactDateConfig, setShowEditingExactDateConfig] = useState(false);
  const [editingPopupHours, setEditingPopupHours] = useState('');
  const [editingPopupMinutes, setEditingPopupMinutes] = useState('');
  const [showEditingDailyConfig, setShowEditingDailyConfig] = useState(false);
  const [editingImportance, setEditingImportance] = useState<'vert' | 'orange' | 'rouge'>('vert');
  const [editingReminderActive, setEditingReminderActive] = useState(false);
  const [editingReminderPopupActive, setEditingReminderPopupActive] = useState(false);
  const [editingDailyTime, setEditingDailyTime] = useState('09:00');
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});

  const [listeningMode, setListeningMode] = useState<'none' | 'title' | 'content' | 'list_item' | 'ai' | 'memo_title' | 'memo_content' | 'memo_item'>('none');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const recognitionRef = useRef<any>(null);
  const [triggeredAlarm, setTriggeredAlarm] = useState<Note | null>(null);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);
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
  const [planningExitTarget, setPlanningExitTarget] = useState<'home' | 'gallery'>('home');
  const [showPlanningAbout, setShowPlanningAbout] = useState(false);
  const [showPlanningGestures, setShowPlanningGestures] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showExportHelp, setShowExportHelp] = useState(false);
  // Quand l'export est lancé depuis l'aperçu d'un planning sauvegardé, on exporte
  // directement ce modèle sans devoir l'ouvrir en édition ni modifier le brouillon courant.
  const [exportPlanningContext, setExportPlanningContext] = useState<{ name: string; blocks: WeeklyBlock[] } | null>(null);
  
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [blockDay, setBlockDay] = useState('Lundi');
  const [blockTime, setBlockTime] = useState('09:00'); 
  const [blockTitle, setBlockTitle] = useState('');
  const [blockColor, setBlockColor] = useState('blue');
  const [blockKind, setBlockKind] = useState<'task' | 'marker'>('task');
  const [blockDurationHours, setBlockDurationHours] = useState(1);
  const [blockDurationMinutes, setBlockDurationMinutes] = useState(0);

  // Déplacement par appui long : un appui simple ouvre la bulle, un appui maintenu
  // permet de faire glisser le bloc vers un autre jour ou une autre heure.
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [draggingBlockPreview, setDraggingBlockPreview] = useState<{ day: string; hour: number; minute: number } | null>(null);
  const draggingBlockPreviewRef = useRef<{ day: string; hour: number; minute: number } | null>(null);
  const [draggingBlockGhostMeta, setDraggingBlockGhostMeta] = useState<{ title: string; color: string; kind: 'task' | 'marker' } | null>(null);
  const draggingBlockGhostRef = useRef<HTMLDivElement | null>(null);
  const suppressedBlockClickIdsRef = useRef<Set<string>>(new Set());
  const activeBlockDragCleanupRef = useRef<(() => void) | null>(null);
  // Permet à une sortie déjà confirmée (Enregistrer / Ne pas enregistrer) de traverser
  // le routeur sans rouvrir immédiatement la demande de sauvegarde.
  const planningExitInProgressRef = useRef(false);

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
      const normalizedDuration = Math.round(Number.isFinite(rawDuration) ? rawDuration : 60);
      const duration =
        kind === 'marker'
          ? 0
          : Math.min(maxDuration, Math.max(1, normalizedDuration));

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


  // Répartit les tâches qui se chevauchent en colonnes côte à côte,
  // comme dans Google Calendar. Les repères horaires restent sur toute la largeur.
  const getTaskOverlapLayoutMap = (blocks: WeeklyBlock[]) => {
    const layouts = new Map<string, { columnIndex: number; columnCount: number }>();
    const tasksByDay = new Map<string, WeeklyBlock[]>();

    blocks
      .filter(block => block.kind !== 'marker')
      .forEach(block => {
        const dayTasks = tasksByDay.get(block.day) || [];
        dayTasks.push(block);
        tasksByDay.set(block.day, dayTasks);
      });

    const getStartMinutes = (block: WeeklyBlock) => block.startHour * 60 + (block.startMinute || 0);
    const getEndMinutes = (block: WeeklyBlock) => getStartMinutes(block) + Math.max(1, block.duration || 60);

    tasksByDay.forEach(dayTasks => {
      const sortedTasks = [...dayTasks].sort((a, b) => {
        const startDiff = getStartMinutes(a) - getStartMinutes(b);
        if (startDiff !== 0) return startDiff;
        return getEndMinutes(b) - getEndMinutes(a);
      });

      let currentGroup: WeeklyBlock[] = [];
      let currentGroupEnd = -Infinity;

      const assignCurrentGroup = () => {
        if (currentGroup.length === 0) return;

        const columnEnds: number[] = [];
        const assignments: Array<{ id: string; columnIndex: number }> = [];

        currentGroup.forEach(task => {
          const taskStart = getStartMinutes(task);
          const taskEnd = getEndMinutes(task);
          let columnIndex = columnEnds.findIndex(columnEnd => columnEnd <= taskStart);

          if (columnIndex === -1) {
            columnIndex = columnEnds.length;
            columnEnds.push(taskEnd);
          } else {
            columnEnds[columnIndex] = taskEnd;
          }

          assignments.push({ id: task.id, columnIndex });
        });

        const columnCount = Math.max(1, columnEnds.length);
        assignments.forEach(({ id, columnIndex }) => {
          layouts.set(id, { columnIndex, columnCount });
        });
      };

      sortedTasks.forEach(task => {
        const taskStart = getStartMinutes(task);
        const taskEnd = getEndMinutes(task);

        // Strictement inférieur : 10h-11h et 11h-12h ne se chevauchent pas.
        if (currentGroup.length === 0 || taskStart < currentGroupEnd) {
          currentGroup.push(task);
          currentGroupEnd = Math.max(currentGroupEnd, taskEnd);
        } else {
          assignCurrentGroup();
          currentGroup = [task];
          currentGroupEnd = taskEnd;
        }
      });

      assignCurrentGroup();
    });

    return layouts;
  };

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

        if (typeof draft.showAdvancedSettings === 'boolean') setShowAdvancedSettings(draft.showAdvancedSettings);
        if (typeof draft.sendImmediateEmail === 'boolean') setSendImmediateEmail(draft.sendImmediateEmail);
        if (typeof draft.showPopupConfig === 'boolean') setShowPopupConfig(draft.showPopupConfig);
        if (draft.popupScheduleMode === 'relative' || draft.popupScheduleMode === 'datetime') setPopupScheduleMode(draft.popupScheduleMode);
        if (typeof draft.popupHours === 'string') setPopupHours(draft.popupHours);
        if (typeof draft.popupMinutes === 'string') setPopupMinutes(draft.popupMinutes);
        if (typeof draft.popupDateTime === 'string') setPopupDateTime(draft.popupDateTime);
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
          showAdvancedSettings,
          sendImmediateEmail,
          showPopupConfig,
          popupScheduleMode,
          popupHours,
          popupMinutes,
          popupDateTime,
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
    showAdvancedSettings,
    sendImmediateEmail,
    showPopupConfig,
    popupScheduleMode,
    popupHours,
    popupMinutes,
    popupDateTime,
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
  const clearPlanningEditorState = () => {
    setWeeklyBlocks([]);
    setActiveTemplateId(null);
    setActiveTemplateName('');
    setPlanningSavedSnapshot(null);
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setPreviewTemplate(null);
    setShowBlockModal(false);
  };

  const appStateRef = useRef({
    showBlockModal, showCleanupModal, aiProposal, triggeredAlarm,
    openMenuId, editingId, isFocusMode, activeTab, mainMode, previewTemplate,
    activeTemplateId, isPlanningDirty, weeklyBlockCount: weeklyBlocks.length
  });

  useEffect(() => {
    appStateRef.current = {
      showBlockModal, showCleanupModal, aiProposal, triggeredAlarm,
      openMenuId, editingId, isFocusMode, activeTab, mainMode, previewTemplate,
      activeTemplateId, isPlanningDirty, weeklyBlockCount: weeklyBlocks.length
    };
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const routeState = appStateRef.current;

      const confirmedPlanningExit = planningExitInProgressRef.current;
      if (confirmedPlanningExit) planningExitInProgressRef.current = false;

      // Retour Android / navigateur depuis l'éditeur : s'il y a des changements,
      // on reste dans l'éditeur jusqu'au choix Enregistrer / Ne pas enregistrer.
      if (!confirmedPlanningExit && routeState.mainMode === 'planning' && hash !== '#planning-editor') {
        const hasUnsavedChanges = routeState.activeTemplateId
          ? routeState.isPlanningDirty
          : routeState.weeklyBlockCount > 0;

        if (hasUnsavedChanges) {
          setPlanningExitTarget(hash === '#planning-gallery' ? 'gallery' : 'home');
          setShowClosePlanningModal(true);

          if (hash === '#planning') {
            window.setTimeout(() => window.history.forward(), 0);
          } else {
            const editorUrl = `${window.location.pathname}${window.location.search}#planning-editor`;
            window.history.replaceState({ ...(window.history.state || {}), planningChild: true }, '', editorUrl);
          }
          return;
        }

        clearPlanningEditorState();
      } else if (confirmedPlanningExit || hash === '#planning' || hash === '#planning-gallery') {
        clearPlanningEditorState();
      }

      setShowBlockModal(false);
      setShowCleanupModal(false);
      setAiProposal(null);
      setTriggeredAlarm(null);
      setOpenMenuId(null);
      setEditingId(null);
      setEditingBlockId(null);
      setSelectedBlockId(null);
      setPreviewTemplate(null);
      setShowPlanningAbout(false);
      setShowPlanningGestures(false);
      setShowExportModal(false);
      setShowExportHelp(false);
      setShowNotesHelp(false);

      // Un volet de paramétrage ne doit pas rester ouvert après avoir quitté
      // Tâches & Rappels puis y être revenu. On replie uniquement l'interface :
      // les valeurs saisies du brouillon restent conservées.
      setShowAdvancedSettings(false);
      setShowPopupConfig(false);
      setShowDailyConfig(false);
      setShowCalendarConfig(false);
      setShowEditingAdvancedSettings(false);
      setShowEditingPopupConfig(false);
      setShowEditingDailyConfig(false);
      setShowEditingExactDateConfig(false);

      memoEditorOpenRef.current = false;
      setMemoEditorOpen(false);

      const directNoteMatch = /^#note-(.+)$/.exec(hash);
      if (directNoteMatch) {
        const noteId = decodeURIComponent(directNoteMatch[1]);
        setHighlightedNoteId(noteId);
        setShowArchived(false);
        setMainMode('notes');
        setActiveTab('notes');
        setIsFocusMode(false);
        return;
      }

      switch(hash) {
        case '#notes-create':
          setMainMode('notes'); setActiveTab('create'); setIsFocusMode(false); break;
        case '#notes-list':
          setMainMode('notes'); setActiveTab('notes'); setIsFocusMode(false); break;
        case '#notes-history':
          setMainMode('notes'); setActiveTab('history'); setIsFocusMode(false); break;
        case '#notes-focus':
          setMainMode('notes'); setIsFocusMode(true); break;
        case '#memos':
          setMainMode('memos'); setIsFocusMode(false); break;
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

    const handleMemoSelectionPopState = () => {
      // Dans Notes, Mémos & Listes, le bouton Retour ferme d'abord ce qui est
      // ouvert localement (éditeur ou sélection) au lieu de quitter l'application.
      if (memoEditorOpenRef.current) {
        memoEditorOpenRef.current = false;
        setMemoEditorOpen(false);
        resetMemoDraft();
        return;
      }

      if (selectedMemoIdsRef.current.size > 0) {
        selectedMemoIdsRef.current = new Set();
        setSelectedMemoIds(new Set());
        memoSelectionHistoryArmedRef.current = false;
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleMemoSelectionPopState);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleMemoSelectionPopState);
    };
  }, []);

  // Quand une notification ouvre #note-<id>, on ouvre la bonne priorité,
  // on fait défiler jusqu'à la note et on la met brièvement en évidence.
  useEffect(() => {
    if (!highlightedNoteId || mainMode !== 'notes' || activeTab !== 'notes') return;

    const note = notes.find(item => item.id === highlightedNoteId);
    if (!note) return;

    setCollapsedPriorities({
      rouge: note.importance !== 'rouge',
      orange: note.importance !== 'orange',
      vert: note.importance !== 'vert',
    });

    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`note-${highlightedNoteId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 180);

    const clearTimer = window.setTimeout(() => setHighlightedNoteId(null), 6000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightedNoteId, mainMode, activeTab, notes]);

  // Navigation propre de la partie Planning : on garde une seule entrée enfant
  // (éditeur OU galerie) dans l'historique. Passer plusieurs fois de l'un à l'autre
  // ne remplit donc plus le bouton Retour du téléphone avec toutes les étapes.
  const refreshRouteFromCurrentHash = () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const showAppMessage = (message: string) => {
    setAppMessage(message);
  };

  const askAppPrompt = (dialog: AppPromptDialog): Promise<string | null> =>
    new Promise((resolve) => {
      promptResolveRef.current = resolve;
      setPromptValue(dialog.defaultValue || '');
      setPromptDialog(dialog);
    });

  const cancelAppPrompt = () => {
    promptResolveRef.current?.(null);
    promptResolveRef.current = null;
    setPromptDialog(null);
  };

  const confirmAppPrompt = () => {
    promptResolveRef.current?.(promptValue);
    promptResolveRef.current = null;
    setPromptDialog(null);
  };

  const requestAppConfirmation = (dialog: AppConfirmDialog) => {
    setConfirmDialog(dialog);
  };

  const confirmAppDialog = async () => {
    if (!confirmDialog || confirmDialogLoading) return;
    setConfirmDialogLoading(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmDialogLoading(false);
    }
  };

  const requestDemoReset = () => {
    if (!DEMO_MODE || demoResetting) return;

    requestAppConfirmation({
      title: 'Réinitialiser la démonstration ?',
      message: 'Toutes les données créées pendant les tests seront supprimées et les exemples de départ seront restaurés.',
      confirmLabel: 'Réinitialiser',
      tone: 'sage',
      onConfirm: async () => {
        setDemoResetting(true);
        try {
          const response = await fetch('/api/demo-reset', { method: 'POST' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Réinitialisation impossible');

          localStorage.removeItem(NOTE_DRAFT_STORAGE_KEY);
          localStorage.removeItem(PLANNING_DRAFT_STORAGE_KEY);
          showAppMessage('✅ Démonstration réinitialisée.');
          window.setTimeout(() => window.location.reload(), 350);
        } catch (error: any) {
          showAppMessage('❌ ' + (error?.message || 'Réinitialisation impossible'));
        } finally {
          setDemoResetting(false);
        }
      },
    });
  };

  const demoFeatureUnavailable = (label = 'Cette fonction') => {
    showAppMessage(`ℹ️ ${label} est désactivée en mode démonstration.`);
  };

  // Navigation de Tâches & Rappels sans empiler chaque clic dans l'historique.
  const isNotesChildHash = (hash: string) =>
    hash === '#notes-list' || hash === '#notes-focus' || hash === '#notes-history' || hash.startsWith('#note-');

  const navigateNotesChild = (targetHash: '#notes-list' | '#notes-focus' | '#notes-history') => {
    const currentHash = window.location.hash;
    const targetUrl = `${window.location.pathname}${window.location.search}${targetHash}`;

    if (isNotesChildHash(currentHash)) {
      window.history.replaceState({ ...(window.history.state || {}), notesChild: true }, '', targetUrl);
      refreshRouteFromCurrentHash();
      return;
    }

    window.history.pushState({ ...(window.history.state || {}), notesChild: true }, '', targetUrl);
    refreshRouteFromCurrentHash();
  };

  const navigateNotesCreate = () => {
    const currentHash = window.location.hash;

    if (isNotesChildHash(currentHash) && window.history.state?.notesChild) {
      window.history.back();
      return;
    }

    const targetUrl = `${window.location.pathname}${window.location.search}#notes-create`;
    window.history.replaceState({ ...(window.history.state || {}), notesChild: false }, '', targetUrl);
    refreshRouteFromCurrentHash();
  };

  const navigateNotesHub = () => {
    const currentHash = window.location.hash;

    if (isNotesChildHash(currentHash) && window.history.state?.notesChild) {
      window.history.go(-2);
      return;
    }

    if (currentHash === '#notes-create') {
      window.history.back();
      return;
    }

    const targetUrl = `${window.location.pathname}${window.location.search}#hub`;
    window.history.replaceState({ ...(window.history.state || {}), notesChild: false }, '', targetUrl);
    refreshRouteFromCurrentHash();
  };

  const isNotesSwipeInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"], [role="button"], [data-no-notes-swipe]'
      )
    );
  };

  const handleNotesSwipeStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isFocusMode || activeTab === 'history' || e.touches.length !== 1) {
      notesSwipeStartRef.current = null;
      return;
    }

    const touch = e.touches[0];
    notesSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignore: isNotesSwipeInteractiveTarget(e.target),
    };
  };

  const handleNotesSwipeEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = notesSwipeStartRef.current;
    notesSwipeStartRef.current = null;

    if (!start || start.ignore || isFocusMode || activeTab === 'history' || e.changedTouches.length !== 1) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    // 70 px minimum et un mouvement nettement plus horizontal que vertical.
    if (horizontalDistance < 70 || horizontalDistance < verticalDistance * 1.35) return;

    if (deltaX < 0 && activeTab === 'create') {
      // Glisser vers la gauche : Créer -> Notes sauvegardées.
      navigateNotesChild('#notes-list');
    } else if (deltaX > 0 && activeTab === 'notes') {
      // Glisser vers la droite : Notes sauvegardées -> Créer.
      navigateNotesCreate();
    }
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
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur chargement notes :', error);
      return false;
    }

    const normalized = (data || []).map((row: any) => ({
      ...row,
      sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : 0,
    })) as Note[];
    notesRef.current = normalized;
    setNotes(normalized);
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

  const normalizeMemoItems = (value: unknown): MemoListItem[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
      if (!item || typeof item !== 'object') return [];
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text) return [];
      return [{
        id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        text,
        completed: Boolean(item.completed),
      }];
    });
  };

  const normalizeMemoEntry = (row: any): MemoEntry => ({
    id: String(row?.id || ''),
    title: typeof row?.title === 'string' ? row.title : '',
    content: typeof row?.content === 'string' ? row.content : '',
    memo_type: row?.memo_type === 'list' ? 'list' : 'text',
    items: normalizeMemoItems(row?.items),
    color: ['sage', 'sand', 'rose', 'blue', 'lavender', 'white'].includes(row?.color) ? row.color : 'sage',
    pinned: Boolean(row?.pinned),
    archived: Boolean(row?.archived),
    sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : 0,
    created_at: typeof row?.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row?.updated_at === 'string' ? row.updated_at : null,
  });

  const fetchMemos = async () => {
    const { data, error } = await supabase
      .from('memo_notes')
      .select('*')
      .order('pinned', { ascending: false })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Erreur chargement mémos :', error);
      return false;
    }

    const normalized = (data || []).map(normalizeMemoEntry);
    memoEntriesRef.current = normalized;
    setMemoEntries(normalized);
    return true;
  };

  useEffect(() => { 
    fetchNotes(); 
    fetchTemplates();
    fetchMemos();
  }, []);

  // Resynchronise les données quand l'utilisateur revient dans l'application.
  // C'est utile car les rappels peuvent être modifiés côté serveur pendant que
  // l'application est en arrière-plan.
  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchNotes();
      void fetchTemplates();
      void fetchMemos();
    };

    window.addEventListener('focus', syncWhenVisible);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return () => {
      window.removeEventListener('focus', syncWhenVisible);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
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
    if (DEMO_MODE) {
      demoFeatureUnavailable('Les notifications pop-up');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicVapidKey) return showAppMessage("Erreur : La clé VAPID publique manque dans Vercel.");

      const convertedVapidKey = urlBase64ToUint8Array(publicVapidKey);
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedVapidKey });
      const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });

      if (res.ok) {
        setIsPushEnabled(true);
        showAppMessage("✅ Téléphone connecté avec succès ! Tu recevras les alertes en arrière-plan.");
      } else {
        const err = await res.json();
        showAppMessage("Erreur de sauvegarde : " + err.error);
      }
    } catch (error: any) {
      showAppMessage(Notification.permission === 'denied' ? "❌ Tu as bloqué les notifications." : "❌ Erreur d'abonnement : " + error.message);
    }
  };



  useEffect(() => {
    memoEntriesRef.current = memoEntries;
  }, [memoEntries]);

  useEffect(() => {
    selectedMemoIdsRef.current = selectedMemoIds;
  }, [selectedMemoIds]);

  useEffect(() => {
    if (mainMode !== 'memos') {
      selectedMemoIdsRef.current = new Set();
      setSelectedMemoIds(prev => prev.size ? new Set() : prev);
      memoSelectionHistoryArmedRef.current = false;
    }
  }, [mainMode]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // Nombre de colonnes proche de Google Keep. Les cartes gardent leur hauteur
  // naturelle : une note courte reste petite, une note longue grandit jusqu'aux
  // limites d'affichage définies dans la carte.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateColumns = () => {
      const width = window.innerWidth;
      setMemoColumnCount(width >= 1024 ? 4 : width >= 768 ? 3 : 2);
    };
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  // Mesure les hauteurs naturelles. ResizeObserver continue de suivre une carte
  // si son contenu change, sans forcer une hauteur uniforme.
  useEffect(() => {
    if (mainMode !== 'memos' || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next: Record<string, number> = {};
        document.querySelectorAll<HTMLElement>('[data-memo-card-id]').forEach((element) => {
          const id = element.dataset.memoCardId;
          if (!id) return;
          next[id] = Math.max(1, Math.round(element.getBoundingClientRect().height));
        });
        setMemoCardHeights(prev => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length === nextKeys.length && nextKeys.every(id => Math.abs((prev[id] || 0) - next[id]) <= 1)) return prev;
          return next;
        });
      });
    };

    const observer = new ResizeObserver(measure);
    document.querySelectorAll<HTMLElement>('[data-memo-card-id]').forEach(element => observer.observe(element));
    measure();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [mainMode, memoEntries.length, memoSearch, showMemoArchived, memoColumnCount]);

  // Pendant un vrai déplacement, on neutralise la sélection de texte et le
  // geste natif du navigateur. Cela évite les sélections / menus contextuels
  // qui rendaient l'appui long instable sur Android.
  useEffect(() => {
    if (!draggingMemoId && !draggingTaskId) return;
    const body = document.body;
    const previousUserSelect = body.style.userSelect;
    const previousWebkitUserSelect = (body.style as any).webkitUserSelect || '';
    const previousOverscroll = body.style.overscrollBehavior;
    body.style.userSelect = 'none';
    (body.style as any).webkitUserSelect = 'none';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.userSelect = previousUserSelect;
      (body.style as any).webkitUserSelect = previousWebkitUserSelect;
      body.style.overscrollBehavior = previousOverscroll;
    };
  }, [draggingMemoId, draggingTaskId]);

  const estimateMemoCardHeight = (memo: MemoEntry) => {
    let height = 30; // padding + marge de sécurité
    if (memo.title) height += 18 * Math.min(3, Math.max(1, memo.title.split('\n').length + Math.floor(memo.title.length / 24)));
    if (memo.content) height += 17 * Math.min(6, Math.max(1, memo.content.split('\n').length + Math.floor(memo.content.length / 28))) + 6;
    if (memo.memo_type === 'list' && memo.items.length) height += Math.min(6, memo.items.length) * 18 + (memo.items.length > 6 ? 14 : 0) + 8;
    return Math.max(44, height);
  };

  const buildMemoMasonryColumns = (entries: MemoEntry[]) => {
    const count = Math.max(1, memoColumnCount);
    const columns = Array.from({ length: count }, () => [] as MemoEntry[]);
    const heights = Array.from({ length: count }, () => 0);

    entries.forEach(memo => {
      let targetColumn = 0;
      for (let index = 1; index < count; index += 1) {
        if (heights[index] < heights[targetColumn]) targetColumn = index;
      }
      columns[targetColumn].push(memo);
      heights[targetColumn] += (memoCardHeights[memo.id] || estimateMemoCardHeight(memo)) + 10;
    });

    return columns;
  };

  const nextMemoSortOrder = (pinned: boolean, archived: boolean, excludeId?: string) => {
    const orders = memoEntriesRef.current
      .filter(memo => memo.id !== excludeId && memo.pinned === pinned && memo.archived === archived)
      .map(memo => Number.isFinite(memo.sort_order) ? memo.sort_order : 0);
    return orders.length ? Math.max(...orders) + 1 : 0;
  };

  const persistMemoGroupOrder = async (orderedGroup: MemoEntry[]) => {
    const updates = orderedGroup.map((memo, index) =>
      supabase
        .from('memo_notes')
        .update({ sort_order: index })
        .eq('id', memo.id)
    );

    const results = await Promise.all(updates);
    const failed = results.find(result => result.error);
    if (failed?.error) {
      showAppMessage("L'ordre a été modifié à l'écran mais n'a pas pu être enregistré : " + failed.error.message);
      await fetchMemos();
      return false;
    }
    return true;
  };

  const captureMemoLayout = (excludeId?: string) => {
    const rects = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>('[data-memo-card-id]').forEach((element) => {
      const id = element.dataset.memoCardId;
      if (!id || id === excludeId) return;
      rects.set(id, element.getBoundingClientRect());
    });
    return rects;
  };


  const previewMemoReorder = (sourceId: string, targetId: string | null, insertAfter = false) => {
    const current = memoEntriesRef.current;
    const source = current.find(memo => memo.id === sourceId);
    if (!source) return;

    const group = current
      .filter(memo => memo.pinned === source.pinned && memo.archived === source.archived)
      .sort((a, b) => a.sort_order - b.sort_order || String(a.updated_at || '').localeCompare(String(b.updated_at || '')));

    const withoutSource = group.filter(memo => memo.id !== sourceId);
    let insertIndex = withoutSource.length;

    if (targetId) {
      const target = withoutSource.find(memo => memo.id === targetId);
      if (!target || target.pinned !== source.pinned || target.archived !== source.archived) return;
      const targetIndex = withoutSource.findIndex(memo => memo.id === targetId);
      insertIndex = Math.max(0, Math.min(withoutSource.length, targetIndex + (insertAfter ? 1 : 0)));
    }

    const reordered = [...withoutSource];
    reordered.splice(insertIndex, 0, source);

    const currentIds = group.map(memo => memo.id).join('|');
    const nextIds = reordered.map(memo => memo.id).join('|');
    if (currentIds === nextIds) return;

    const before = captureMemoLayout(sourceId);
    const orderMap = new Map(reordered.map((memo, index) => [memo.id, index]));
    const next = current.map(memo => orderMap.has(memo.id) ? { ...memo, sort_order: orderMap.get(memo.id)! } : memo);
    // Important : on mémorise les anciennes coordonnées avant le setState.
    // useLayoutEffect jouera ensuite le vrai glissement entre les deux layouts.
    memoPendingFlipRef.current = { before, excludeId: sourceId };
    memoEntriesRef.current = next;
    setMemoEntries(next);
  };

  const persistCurrentMemoDragGroup = async (sourceId: string) => {
    const source = memoEntriesRef.current.find(memo => memo.id === sourceId);
    if (!source) return;
    const group = memoEntriesRef.current
      .filter(memo => memo.pinned === source.pinned && memo.archived === source.archived)
      .sort((a, b) => a.sort_order - b.sort_order);
    await persistMemoGroupOrder(group);
  };

  const clearMemoLongPressTimer = () => {
    if (memoLongPressTimerRef.current !== null) {
      window.clearTimeout(memoLongPressTimerRef.current);
      memoLongPressTimerRef.current = null;
    }
  };

  const autoScrollDuringDrag = (clientY: number) => {
    const edge = 84;
    if (clientY < edge) window.scrollBy({ top: -18, behavior: 'auto' });
    else if (clientY > window.innerHeight - edge) window.scrollBy({ top: 18, behavior: 'auto' });
  };

  const memoWindowListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    touchMove: (event: TouchEvent) => void;
    touchEnd: (event: TouchEvent) => void;
    touchCancel: (event: TouchEvent) => void;
  } | null>(null);

  const detachMemoWindowListeners = () => {
    const listeners = memoWindowListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.up);
    window.removeEventListener('pointercancel', listeners.cancel);
    window.removeEventListener('touchmove', listeners.touchMove);
    window.removeEventListener('touchend', listeners.touchEnd);
    window.removeEventListener('touchcancel', listeners.touchCancel);
    memoWindowListenersRef.current = null;
  };

  const captureMemoSlots = (drag: NonNullable<typeof memoDragRef.current>) => {
    const slots: DragSlot[] = [];
    document.querySelectorAll<HTMLElement>('[data-memo-card-id]').forEach((element) => {
      const id = element.dataset.memoCardId;
      if (!id) return;
      const memo = memoEntriesRef.current.find(item => item.id === id);
      if (!memo || memo.pinned !== drag.pinned || memo.archived !== drag.archived) return;
      const rect = element.getBoundingClientRect();
      slots.push({
        id,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      });
    });
    return slots;
  };

  const refreshMemoDragSlotsSoon = (drag: NonNullable<typeof memoDragRef.current>, delay = 225) => {
    if (drag.slotRefreshTimer !== null) window.clearTimeout(drag.slotRefreshTimer);
    drag.slotRefreshTimer = window.setTimeout(() => {
      const current = memoDragRef.current;
      if (!current || current !== drag || !current.active) return;
      current.slots = captureMemoSlots(current);
      current.layoutLockedUntil = 0;
      current.slotRefreshTimer = null;
    }, delay);
  };

  const findMemoDropCandidate = (drag: NonNullable<typeof memoDragRef.current>, centerX: number, centerY: number) => {
    let best: { slot: DragSlot; distance: number } | null = null;
    for (const slot of drag.slots) {
      if (slot.id === drag.id) continue;
      const dx = centerX < slot.left ? slot.left - centerX : centerX > slot.right ? centerX - slot.right : 0;
      const dy = centerY < slot.top ? slot.top - centerY : centerY > slot.bottom ? centerY - slot.bottom : 0;
      const outsideDistance = Math.hypot(dx, dy);
      if (outsideDistance > 58) continue;
      const centerDistance = Math.hypot(centerX - slot.centerX, centerY - slot.centerY);
      const score = outsideDistance * 4 + centerDistance * 0.22;
      if (!best || score < best.distance) best = { slot, distance: score };
    }
    if (!best) return null;
    const slot = best.slot;
    const upperThreshold = slot.top + slot.height * 0.42;
    const lowerThreshold = slot.top + slot.height * 0.58;
    if (centerY > upperThreshold && centerY < lowerThreshold) return null;
    return { targetId: slot.id, insertAfter: centerY >= lowerThreshold };
  };

  const isMemoPointerOverTrash = (clientX: number, clientY: number) => {
    const trash = memoTrashRef.current;
    if (!trash) return false;
    const rect = trash.getBoundingClientRect();

    // Zone volontairement un peu plus généreuse sur mobile. La suppression est
    // considérée comme ciblée soit lorsque le doigt entre dans la poubelle, soit
    // lorsque la carte flottante la recouvre nettement. Cela évite d'avoir à
    // descendre le doigt jusqu'au dernier pixel de l'écran.
    const marginX = 18;
    const marginY = 14;
    const fingerInside =
      clientX >= rect.left - marginX &&
      clientX <= rect.right + marginX &&
      clientY >= rect.top - marginY &&
      clientY <= rect.bottom + marginY;
    if (fingerInside) return true;

    const drag = memoDragRef.current;
    if (!drag?.active) return false;
    const ghostLeft = clientX - drag.offsetX;
    const ghostTop = clientY - drag.offsetY;
    const ghostWidth = drag.originRect.right - drag.originRect.left;
    const ghostHeight = drag.originRect.bottom - drag.originRect.top;
    const ghostRight = ghostLeft + ghostWidth;
    const ghostBottom = ghostTop + ghostHeight;
    const overlapX = Math.max(0, Math.min(ghostRight, rect.right) - Math.max(ghostLeft, rect.left));
    const overlapY = Math.max(0, Math.min(ghostBottom, rect.bottom) - Math.max(ghostTop, rect.top));
    const overlapArea = overlapX * overlapY;
    const ghostArea = Math.max(1, ghostWidth * ghostHeight);
    return overlapArea / ghostArea >= 0.18;
  };

  const processMemoDragMove = (clientX: number, clientY: number, pointerId: number, preventDefault?: () => void) => {
    const drag = memoDragRef.current;
    if (!drag || drag.pointerId !== pointerId || !drag.active) return;

    preventDefault?.();
    autoScrollDuringDrag(clientY);
    drag.lastX = clientX;
    drag.lastY = clientY;

    const ghostLeft = clientX - drag.offsetX;
    const ghostTop = clientY - drag.offsetY;
    const ghostWidth = drag.originRect.right - drag.originRect.left;
    const ghostHeight = drag.originRect.bottom - drag.originRect.top;
    const centerX = ghostLeft + ghostWidth / 2;
    const centerY = ghostTop + ghostHeight / 2;

    if (memoGhostRef.current) {
      memoGhostRef.current.style.left = `${ghostLeft}px`;
      memoGhostRef.current.style.top = `${ghostTop}px`;
    }

    const overTrash = isMemoPointerOverTrash(clientX, clientY);
    setMemoTrashHover(overTrash);
    if (overTrash) {
      setMemoDragTargetId(null);
      return;
    }

    if (!drag.reorderUnlocked) {
      const insetX = Math.min(18, ghostWidth * 0.12);
      const insetY = Math.min(18, ghostHeight * 0.12);
      const stillInOrigin =
        centerX >= drag.originRect.left + insetX &&
        centerX <= drag.originRect.right - insetX &&
        centerY >= drag.originRect.top + insetY &&
        centerY <= drag.originRect.bottom - insetY;
      if (stillInOrigin) {
        setMemoDragTargetId(null);
        return;
      }
      drag.reorderUnlocked = true;
      drag.acceptedToken = '';
      drag.slots = captureMemoSlots(drag);
    }

    if (performance.now() < drag.layoutLockedUntil) return;

    const candidate = findMemoDropCandidate(drag, centerX, centerY);
    if (!candidate) {
      setMemoDragTargetId(null);
      return;
    }

    const token = `${candidate.targetId}:${candidate.insertAfter ? 'after' : 'before'}`;
    setMemoDragTargetId(candidate.targetId);
    if (token === drag.acceptedToken) return;

    drag.acceptedToken = token;
    drag.layoutLockedUntil = performance.now() + 300;
    previewMemoReorder(drag.id, candidate.targetId, candidate.insertAfter);
    refreshMemoDragSlotsSoon(drag, 305);
  };

  const finishMemoDrag = (pointerId: number, preventDefault?: () => void, stopPropagation?: () => void) => {
    clearMemoLongPressTimer();
    const drag = memoDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;

    const droppedOnTrash = drag.active && isMemoPointerOverTrash(drag.lastX, drag.lastY);
    const sourceMemo = drag.originalEntries.find(memo => memo.id === drag.id);

    memoDragRef.current = null;
    detachMemoWindowListeners();
    if (drag.slotRefreshTimer !== null) window.clearTimeout(drag.slotRefreshTimer);
    if (drag.active) {
      preventDefault?.();
      stopPropagation?.();
      const sourceId = drag.id;
      setDraggingMemoId(null);
      setMemoDragTargetId(null);
      setMemoDragVisual(null);
      setMemoTrashHover(false);
      memoDragLastPreviewRef.current = '';

      if (droppedOnTrash && sourceMemo) {
        // Les réorganisations pendant le drag n'ont pas encore été persistées.
        // On remet donc l'ordre d'origine avant la suppression directe.
        memoPendingFlipRef.current = null;
        memoFlipAnimationsRef.current.forEach(animation => animation.cancel());
        memoFlipAnimationsRef.current.clear();
        memoEntriesRef.current = drag.originalEntries;
        setMemoEntries(drag.originalEntries);
        window.setTimeout(() => memoSuppressClickIdsRef.current.delete(sourceId), 500);
        void deleteMemoImmediately(sourceMemo);
        return;
      }

      // Appui long sans vrai déplacement = sélection, comme Google Keep.
      // Le même geste sert donc soit à saisir/déplacer la carte, soit à entrer
      // dans le mode multisélection si on relâche sans l'avoir déplacée.
      const travelled = Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY);
      if (!drag.reorderUnlocked && travelled < 16) {
        memoPendingFlipRef.current = null;
        memoFlipAnimationsRef.current.forEach(animation => animation.cancel());
        memoFlipAnimationsRef.current.clear();
        memoEntriesRef.current = drag.originalEntries;
        setMemoEntries(drag.originalEntries);
        selectMemo(sourceId);
        window.setTimeout(() => memoSuppressClickIdsRef.current.delete(sourceId), 500);
        return;
      }

      void persistCurrentMemoDragGroup(sourceId);
      window.setTimeout(() => memoSuppressClickIdsRef.current.delete(sourceId), 500);
    }
  };

  const attachMemoWindowListeners = () => {
    detachMemoWindowListeners();
    const move = (event: PointerEvent) => {
      const drag = memoDragRef.current;
      if (!drag || drag.pointerCancelled) return;
      // Sur mobile, les TouchEvents deviennent la source principale dès que le
      // drag est actif. Cela évite les pointercancel intempestifs d'Android.
      if (drag.pointerType === 'touch') return;
      processMemoDragMove(event.clientX, event.clientY, event.pointerId, () => event.preventDefault());
    };
    const up = (event: PointerEvent) => {
      const drag = memoDragRef.current;
      if (!drag || drag.pointerCancelled) return;
      if (drag.pointerType === 'touch') return;
      finishMemoDrag(event.pointerId, () => event.preventDefault(), () => event.stopPropagation());
    };
    const cancel = (event: PointerEvent) => {
      const drag = memoDragRef.current;
      if (drag?.active && drag.pointerId === event.pointerId && drag.pointerType === 'touch') {
        // Ne termine pas le drag ici : Android peut annuler le PointerEvent
        // pendant un mouvement vertical. Le TouchEvent continue, lui.
        drag.pointerCancelled = true;
        return;
      }
      cancelMemoLongPress(event.pointerId);
    };
    const touchMove = (event: TouchEvent) => {
      const drag = memoDragRef.current;
      if (!drag?.active || drag.pointerType !== 'touch' || event.touches.length === 0) return;
      if (event.cancelable) event.preventDefault();
      const touch = event.touches[0];
      processMemoDragMove(touch.clientX, touch.clientY, drag.pointerId);
    };
    const touchEnd = (event: TouchEvent) => {
      const drag = memoDragRef.current;
      if (!drag?.active || drag.pointerType !== 'touch') return;
      if (event.cancelable) event.preventDefault();
      finishMemoDrag(drag.pointerId);
    };
    const touchCancel = (event: TouchEvent) => {
      const drag = memoDragRef.current;
      if (!drag) return;
      // Un touchcancel ne doit jamais laisser une carte flottante bloquée.
      if (drag.active && drag.pointerType === 'touch') {
        if (event.cancelable) event.preventDefault();
        finishMemoDrag(drag.pointerId);
        return;
      }
      cancelMemoLongPress(drag.pointerId);
    };
    memoWindowListenersRef.current = { move, up, cancel, touchMove, touchEnd, touchCancel };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('touchend', touchEnd, { passive: false });
    window.addEventListener('touchcancel', touchCancel);
  };

  const activateMemoDrag = (drag: NonNullable<typeof memoDragRef.current>) => {
    if (drag.active) return;
    const currentRect = drag.element.getBoundingClientRect();
    drag.active = true;
    memoSuppressClickIdsRef.current.add(drag.id);
    memoDragLastPreviewRef.current = '';
    setDraggingMemoId(drag.id);
    setMemoDragTargetId(null);
    setMemoTrashHover(false);
    drag.originRect = { left: currentRect.left, top: currentRect.top, right: currentRect.right, bottom: currentRect.bottom };
    drag.reorderUnlocked = false;
    drag.lastReorderAt = 0;
    drag.lastReorderX = drag.lastX;
    drag.lastReorderY = drag.lastY;
    drag.candidateToken = '';
    drag.candidateSince = 0;
    drag.acceptedToken = '';
    drag.layoutLockedUntil = 0;
    drag.slots = captureMemoSlots(drag);
    setMemoDragVisual({ x: currentRect.left, y: currentRect.top, width: currentRect.width, height: currentRect.height });
    attachMemoWindowListeners();
    if ('vibrate' in navigator) navigator.vibrate(16);
  };

  const beginMemoLongPress = (e: React.PointerEvent<HTMLElement>, memo: MemoEntry) => {
    if (selectedMemoIdsRef.current.size > 0) return;
    if (memoSearch.trim()) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;

    clearMemoLongPressTimer();
    const rect = e.currentTarget.getBoundingClientRect();
    memoDragRef.current = {
      id: memo.id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      pointerCancelled: false,
      startX: e.clientX,
      startY: e.clientY,
      pressStartedAt: performance.now(),
      lastX: e.clientX,
      lastY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      active: false,
      pinned: memo.pinned,
      archived: memo.archived,
      originRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      reorderUnlocked: false,
      lastReorderAt: 0,
      lastReorderX: e.clientX,
      lastReorderY: e.clientY,
      candidateToken: '',
      candidateSince: 0,
      slots: [],
      acceptedToken: '',
      layoutLockedUntil: 0,
      slotRefreshTimer: null,
      originalEntries: memoEntriesRef.current,
      element: e.currentTarget,
    };

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}

    memoLongPressTimerRef.current = window.setTimeout(() => {
      const drag = memoDragRef.current;
      if (!drag || drag.id !== memo.id || drag.pointerId !== e.pointerId) return;
      activateMemoDrag(drag);
    }, 180);
  };

  const moveMemoLongPress = (e: React.PointerEvent<HTMLElement>) => {
    const drag = memoDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.active) return;

    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    const heldFor = performance.now() - drag.pressStartedAt;

    // Si l'utilisateur a déjà marqué un vrai appui long, on autorise le départ
    // immédiat du drag même s'il bouge vite. Cela évite l'impression de freeze.
    if (distance > 10 && heldFor >= 115) {
      clearMemoLongPressTimer();
      activateMemoDrag(drag);
      processMemoDragMove(e.clientX, e.clientY, e.pointerId, () => e.preventDefault());
      return;
    }

    // Avant 115 ms, un grand mouvement reste interprété comme un scroll normal.
    if (distance > 56 && heldFor < 115) {
      clearMemoLongPressTimer();
      try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
      memoDragRef.current = null;
    }
  };

  const endMemoLongPress = (e: React.PointerEvent<HTMLElement>) => {
    const drag = memoDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) return; // le listener window termine le drag
    clearMemoLongPressTimer();
    try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
    memoDragRef.current = null;
  };

  const cancelMemoLongPress = (pointerId?: number) => {
    clearMemoLongPressTimer();
    const drag = memoDragRef.current;
    if (drag && pointerId !== undefined && drag.pointerId !== pointerId) return;
    memoDragRef.current = null;
    detachMemoWindowListeners();
    if (drag?.slotRefreshTimer !== null && drag?.slotRefreshTimer !== undefined) window.clearTimeout(drag.slotRefreshTimer);
    if (drag) {
      try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
      if (drag.active) window.setTimeout(() => memoSuppressClickIdsRef.current.delete(drag.id), 500);
    }
    setDraggingMemoId(null);
    setMemoDragTargetId(null);
    setMemoDragVisual(null);
    setMemoTrashHover(false);
    memoDragLastPreviewRef.current = '';
  };

  const memoDndCollisionDetection = (args: any) => {
    const pointerHits = pointerWithin(args);
    const trash = pointerHits.find((hit: any) => String(hit.id) === 'memo-trash');
    if (trash) return [trash];
    if (pointerHits.length) return pointerHits;
    return closestCenter(args);
  };

  const handleMemoDndStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (selectedMemoIdsRef.current.size > 0 || memoSearch.trim()) return;
    const memo = memoEntriesRef.current.find(item => item.id === id);
    if (!memo) return;

    memoDndSessionRef.current = { id, originalEntries: memoEntriesRef.current };
    memoDndMovedRef.current = false;
    setMemoDndMoved(false);
    setDraggingMemoId(id);
    setMemoTrashHover(false);
    memoSuppressClickIdsRef.current.add(id);
    if ('vibrate' in navigator) navigator.vibrate(12);
  };

  const handleMemoDndMove = (event: DragMoveEvent) => {
    const distance = Math.hypot(event.delta.x, event.delta.y);
    if (!memoDndMovedRef.current && distance >= 7) {
      memoDndMovedRef.current = true;
      setMemoDndMoved(true);
    }
  };

  const handleMemoDndOver = (event: DragOverEvent) => {
    if (!memoDndMovedRef.current) return;
    const sourceId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    setMemoTrashHover(overId === 'memo-trash');
    if (!overId || overId === 'memo-trash' || overId === sourceId) return;

    const source = memoEntriesRef.current.find(item => item.id === sourceId);
    const target = memoEntriesRef.current.find(item => item.id === overId);
    if (!source || !target) return;
    if (source.pinned !== target.pinned || source.archived !== target.archived) return;

    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect;
    const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : 0;
    const targetCenterY = overRect ? overRect.top + overRect.height / 2 : 0;
    previewMemoReorder(sourceId, overId, activeCenterY >= targetCenterY);
  };

  const resetMemoDndUi = () => {
    setDraggingMemoId(null);
    setMemoTrashHover(false);
    setMemoDndMoved(false);
    memoDndMovedRef.current = false;
    memoDndSessionRef.current = null;
  };

  const handleMemoDndEnd = (event: DragEndEvent) => {
    const sourceId = String(event.active.id);
    const session = memoDndSessionRef.current;
    const moved = memoDndMovedRef.current || Math.hypot(event.delta.x, event.delta.y) >= 7;
    const overId = event.over ? String(event.over.id) : '';

    // Empêche le click synthétique post-drag d'ouvrir la note.
    memoSuppressAllClicksUntilRef.current = performance.now() + 420;
    window.setTimeout(() => memoSuppressClickIdsRef.current.delete(sourceId), 450);

    if (!moved) {
      resetMemoDndUi();
      toggleMemoSelection(sourceId);
      return;
    }

    if (overId === 'memo-trash') {
      const memo = memoEntriesRef.current.find(item => item.id === sourceId)
        || session?.originalEntries.find(item => item.id === sourceId);
      resetMemoDndUi();
      if (memo) void deleteMemoImmediately(memo);
      return;
    }

    resetMemoDndUi();
    void persistCurrentMemoDragGroup(sourceId);
  };

  const handleMemoDndCancel = (_event: DragCancelEvent) => {
    const session = memoDndSessionRef.current;
    if (session) {
      memoEntriesRef.current = session.originalEntries;
      setMemoEntries(session.originalEntries);
      memoSuppressAllClicksUntilRef.current = performance.now() + 300;
      window.setTimeout(() => memoSuppressClickIdsRef.current.delete(session.id), 350);
    }
    resetMemoDndUi();
  };

  // ---------- Réorganisation des tâches et changement de priorité ----------
  const clearTaskLongPressTimer = () => {
    if (taskLongPressTimerRef.current !== null) {
      window.clearTimeout(taskLongPressTimerRef.current);
      taskLongPressTimerRef.current = null;
    }
  };

  const taskIsDragEligible = (note: Note) => {
    if (note.completed || note.is_archived) return false;
    const snoozed = !!note.snooze_until && getSafeTime(note.snooze_until) > currentTime;
    return !snoozed;
  };

  const nextTaskSortOrder = (priority: 'vert' | 'orange' | 'rouge') => {
    const orders = notesRef.current
      .filter(note => taskIsDragEligible(note) && note.importance === priority)
      .map(note => Number.isFinite(note.sort_order) ? note.sort_order : 0);
    return orders.length ? Math.max(...orders) + 1 : 0;
  };

  const captureTaskLayout = () => {
    const rects = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>('[data-task-card-id]').forEach((element) => {
      const id = element.dataset.taskCardId;
      if (!id) return;
      rects.set(id, element.getBoundingClientRect());
    });
    return rects;
  };


  const captureTaskSlots = (priority: 'vert' | 'orange' | 'rouge') => {
    const slots: DragSlot[] = [];
    document.querySelectorAll<HTMLElement>(`[data-task-card-id][data-task-priority="${priority}"]`).forEach((element) => {
      const id = element.dataset.taskCardId;
      if (!id) return;
      const rect = element.getBoundingClientRect();
      slots.push({
        id,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        priority,
      });
    });
    return slots;
  };

  const previewTaskReorder = (sourceId: string, targetPriority: 'vert' | 'orange' | 'rouge', targetId: string | null, insertAfter = false) => {
    const current = notesRef.current;
    const source = current.find(note => note.id === sourceId);
    if (!source || !taskIsDragEligible(source)) return;
    const originalPriority = source.importance;

    const oldGroup = current
      .filter(note => taskIsDragEligible(note) && note.importance === originalPriority && note.id !== sourceId)
      .sort((a, b) => a.sort_order - b.sort_order || getSafeTime(b.created_at) - getSafeTime(a.created_at));

    const targetBase = current
      .filter(note => taskIsDragEligible(note) && note.importance === targetPriority && note.id !== sourceId)
      .sort((a, b) => a.sort_order - b.sort_order || getSafeTime(b.created_at) - getSafeTime(a.created_at));

    let insertIndex = targetBase.length;
    if (targetId) {
      const targetIndex = targetBase.findIndex(note => note.id === targetId);
      if (targetIndex < 0) return;
      insertIndex = Math.max(0, Math.min(targetBase.length, targetIndex + (insertAfter ? 1 : 0)));
    }

    const movedSource: Note = { ...source, importance: targetPriority };
    const targetGroup = [...targetBase];
    targetGroup.splice(insertIndex, 0, movedSource);

    const patchMap = new Map<string, Partial<Note>>();
    targetGroup.forEach((note, index) => patchMap.set(note.id, { importance: targetPriority, sort_order: index }));
    if (originalPriority !== targetPriority) {
      oldGroup.forEach((note, index) => patchMap.set(note.id, { sort_order: index }));
    }

    const next = current.map(note => {
      const patch = patchMap.get(note.id);
      return patch ? { ...note, ...patch } : note;
    });

    const before = captureTaskLayout();
    taskPendingFlipRef.current = { before, excludeId: sourceId };
    notesRef.current = next;
    setNotes(next);
  };

  const persistTaskPriorities = async (priorities: Array<'vert' | 'orange' | 'rouge'>) => {
    const unique = Array.from(new Set(priorities));
    const updates: PromiseLike<any>[] = [];

    unique.forEach(priority => {
      const group = notesRef.current
        .filter(note => taskIsDragEligible(note) && note.importance === priority)
        .sort((a, b) => a.sort_order - b.sort_order || getSafeTime(b.created_at) - getSafeTime(a.created_at));
      group.forEach((note, index) => {
        note.sort_order = index;
        updates.push(
          supabase.from('notes').update({ importance: priority, sort_order: index }).eq('id', note.id)
        );
      });
    });

    const results = await Promise.all(updates);
    const failed = results.find((result: any) => result?.error);
    if (failed?.error) {
      showAppMessage("L'ordre des tâches n'a pas pu être enregistré : " + failed.error.message);
      await fetchNotes();
      return false;
    }
    setNotes([...notesRef.current]);
    return true;
  };

  const taskWindowListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    touchMove: (event: TouchEvent) => void;
  } | null>(null);

  const detachTaskWindowListeners = () => {
    const listeners = taskWindowListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.up);
    window.removeEventListener('pointercancel', listeners.cancel);
    window.removeEventListener('touchmove', listeners.touchMove);
    taskWindowListenersRef.current = null;
  };

  const refreshTaskDragSlotsSoon = (drag: NonNullable<typeof taskDragRef.current>, delay = 220) => {
    if (drag.slotRefreshTimer !== null) window.clearTimeout(drag.slotRefreshTimer);
    drag.slotRefreshTimer = window.setTimeout(() => {
      const current = taskDragRef.current;
      if (!current || current !== drag || !current.active) return;
      current.slots = captureTaskSlots(current.originalPriority);
      current.layoutLockedUntil = 0;
      current.slotRefreshTimer = null;
    }, delay);
  };

  const findTaskDropCandidate = (drag: NonNullable<typeof taskDragRef.current>, centerY: number) => {
    let best: { slot: DragSlot; distance: number } | null = null;
    for (const slot of drag.slots) {
      if (slot.id === drag.id) continue;
      const dy = centerY < slot.top ? slot.top - centerY : centerY > slot.bottom ? centerY - slot.bottom : 0;
      if (dy > 48) continue;
      const score = dy * 4 + Math.abs(centerY - slot.centerY) * 0.18;
      if (!best || score < best.distance) best = { slot, distance: score };
    }
    if (!best) return null;
    const slot = best.slot;
    const upper = slot.top + slot.height * 0.42;
    const lower = slot.top + slot.height * 0.58;
    if (centerY > upper && centerY < lower) return null;
    return { targetId: slot.id, insertAfter: centerY >= lower };
  };

  const processTaskDragMove = (clientX: number, clientY: number, pointerId: number, preventDefault?: () => void) => {
    const drag = taskDragRef.current;
    if (!drag || drag.pointerId !== pointerId || !drag.active) return;

    preventDefault?.();
    autoScrollDuringDrag(clientY);
    drag.lastX = clientX;
    drag.lastY = clientY;

    const ghostLeft = clientX - drag.offsetX;
    const ghostTop = clientY - drag.offsetY;
    const ghostWidth = drag.originRect.right - drag.originRect.left;
    const ghostHeight = drag.originRect.bottom - drag.originRect.top;
    const centerX = ghostLeft + ghostWidth / 2;
    const centerY = ghostTop + ghostHeight / 2;

    if (taskGhostRef.current) {
      taskGhostRef.current.style.left = `${ghostLeft}px`;
      taskGhostRef.current.style.top = `${ghostTop}px`;
    }

    if (!drag.reorderUnlocked) {
      const insetX = Math.min(14, ghostWidth * 0.1);
      const insetY = Math.min(14, ghostHeight * 0.1);
      const stillInOrigin =
        centerX >= drag.originRect.left + insetX &&
        centerX <= drag.originRect.right - insetX &&
        centerY >= drag.originRect.top + insetY &&
        centerY <= drag.originRect.bottom - insetY;
      if (stillInOrigin) return;
      drag.reorderUnlocked = true;
      drag.slots = captureTaskSlots(drag.originalPriority);
      drag.acceptedToken = '';
    }

    const beneath = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const zone = beneath?.closest<HTMLElement>('[data-task-priority-zone]') || null;
    const card = beneath?.closest<HTMLElement>('[data-task-card-id]') || null;
    const priorityValue = card?.dataset.taskPriority || zone?.dataset.taskPriorityZone;
    if (priorityValue !== 'vert' && priorityValue !== 'orange' && priorityValue !== 'rouge') return;
    const targetPriority = priorityValue as 'vert' | 'orange' | 'rouge';

    setTaskDragHoverPriority(targetPriority);
    drag.pendingPriority = targetPriority;

    if (targetPriority !== drag.originalPriority) {
      const targetId = card?.dataset.taskCardId && card.dataset.taskCardId !== drag.id ? card.dataset.taskCardId : null;
      let insertAfter = false;
      if (card && targetId) {
        const rect = card.getBoundingClientRect();
        insertAfter = centerY > rect.top + rect.height / 2;
      }
      drag.pendingTargetId = targetId;
      drag.pendingInsertAfter = insertAfter;
      return;
    }

    if (performance.now() < drag.layoutLockedUntil) return;
    const candidate = findTaskDropCandidate(drag, centerY);
    if (!candidate) return;

    drag.pendingTargetId = candidate.targetId;
    drag.pendingInsertAfter = candidate.insertAfter;
    const token = `${candidate.targetId}:${candidate.insertAfter ? 'after' : 'before'}`;
    if (token === drag.acceptedToken) return;

    drag.acceptedToken = token;
    drag.layoutLockedUntil = performance.now() + 275;
    previewTaskReorder(drag.id, drag.originalPriority, candidate.targetId, candidate.insertAfter);
    refreshTaskDragSlotsSoon(drag, 280);
  };

  const finishTaskDrag = (pointerId: number, preventDefault?: () => void, stopPropagation?: () => void) => {
    clearTaskLongPressTimer();
    const drag = taskDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;

    taskDragRef.current = null;
    detachTaskWindowListeners();
    if (drag.slotRefreshTimer !== null) window.clearTimeout(drag.slotRefreshTimer);

    if (drag.active) {
      preventDefault?.();
      stopPropagation?.();
      try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}

      const finalPriority = drag.pendingPriority || drag.originalPriority;
      if (finalPriority !== drag.originalPriority) {
        previewTaskReorder(drag.id, finalPriority, drag.pendingTargetId, drag.pendingInsertAfter);
      }

      setDraggingTaskId(null);
      setTaskDragVisual(null);
      setTaskDragHoverPriority(null);
      taskDragLastPreviewRef.current = '';
      void persistTaskPriorities([drag.originalPriority, finalPriority]);
    }
  };

  const cancelActiveTaskDrag = (pointerId?: number) => {
    clearTaskLongPressTimer();
    const drag = taskDragRef.current;
    if (drag && pointerId !== undefined && drag.pointerId !== pointerId) return;
    taskDragRef.current = null;
    detachTaskWindowListeners();
    if (drag?.slotRefreshTimer !== null && drag?.slotRefreshTimer !== undefined) window.clearTimeout(drag.slotRefreshTimer);
    if (drag?.active) {
      try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
    }
    setDraggingTaskId(null);
    setTaskDragVisual(null);
    setTaskDragHoverPriority(null);
    taskDragLastPreviewRef.current = '';
  };

  const attachTaskWindowListeners = () => {
    detachTaskWindowListeners();
    const move = (event: PointerEvent) => processTaskDragMove(event.clientX, event.clientY, event.pointerId, () => event.preventDefault());
    const up = (event: PointerEvent) => finishTaskDrag(event.pointerId, () => event.preventDefault(), () => event.stopPropagation());
    const cancel = (event: PointerEvent) => cancelActiveTaskDrag(event.pointerId);
    const touchMove = (event: TouchEvent) => {
      if (taskDragRef.current?.active && event.cancelable) event.preventDefault();
    };
    taskWindowListenersRef.current = { move, up, cancel, touchMove };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
  };

  const activateTaskDrag = (drag: NonNullable<typeof taskDragRef.current>) => {
    if (drag.active) return;
    const currentRect = drag.element.getBoundingClientRect();
    drag.active = true;
    taskDragLastPreviewRef.current = '';
    setDraggingTaskId(drag.id);
    setTaskDragHoverPriority(drag.originalPriority);
    drag.originRect = { left: currentRect.left, top: currentRect.top, right: currentRect.right, bottom: currentRect.bottom };
    drag.reorderUnlocked = false;
    drag.lastReorderAt = 0;
    drag.candidateToken = '';
    drag.candidateSince = 0;
    drag.acceptedToken = '';
    drag.layoutLockedUntil = 0;
    drag.slots = captureTaskSlots(drag.originalPriority);
    drag.pendingPriority = drag.originalPriority;
    drag.pendingTargetId = null;
    drag.pendingInsertAfter = false;
    setTaskDragVisual({ x: currentRect.left, y: currentRect.top, width: currentRect.width, height: currentRect.height });
    attachTaskWindowListeners();
    if ('vibrate' in navigator) navigator.vibrate(14);
  };

  const beginTaskLongPress = (e: React.PointerEvent<HTMLElement>, note: Note) => {
    if (showArchived !== false || activeTab !== 'notes' || editingId === note.id || !taskIsDragEligible(note)) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, label')) return;

    clearTaskLongPressTimer();
    const rect = e.currentTarget.getBoundingClientRect();
    taskDragRef.current = {
      id: note.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      pressStartedAt: performance.now(),
      lastX: e.clientX,
      lastY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      active: false,
      originalPriority: note.importance,
      originRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      reorderUnlocked: false,
      lastReorderAt: 0,
      candidateToken: '',
      candidateSince: 0,
      slots: [],
      acceptedToken: '',
      layoutLockedUntil: 0,
      slotRefreshTimer: null,
      pendingPriority: note.importance,
      pendingTargetId: null,
      pendingInsertAfter: false,
      element: e.currentTarget,
    };

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}

    taskLongPressTimerRef.current = window.setTimeout(() => {
      const drag = taskDragRef.current;
      if (!drag || drag.id !== note.id || drag.pointerId !== e.pointerId) return;
      activateTaskDrag(drag);
    }, 185);
  };

  const moveTaskLongPress = (e: React.PointerEvent<HTMLElement>) => {
    const drag = taskDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) return;

    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (distance > 28) {
      clearTaskLongPressTimer();
      try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
      taskDragRef.current = null;
    }
  };

  const endTaskLongPress = (e: React.PointerEvent<HTMLElement>) => {
    const drag = taskDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) return; // le listener window conclut le déplacement
    clearTaskLongPressTimer();
    try { drag.element.releasePointerCapture(drag.pointerId); } catch (_) {}
    taskDragRef.current = null;
  };

  const cancelTaskLongPress = (e?: React.PointerEvent<HTMLElement>) => {
    cancelActiveTaskDrag(e?.pointerId);
  };

  const armMemoEditorHistory = () => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#memos' || window.history.state?.memoEditor) return;
    window.history.pushState({ ...(window.history.state || {}), memoEditor: true }, '', window.location.href);
  };

  const closeMemoEditor = (consumeHistory = true) => {
    memoEditorOpenRef.current = false;
    setMemoEditorOpen(false);
    resetMemoDraft();

    if (consumeHistory && typeof window !== 'undefined' && window.history.state?.memoEditor) {
      window.history.back();
    }
  };

  const armMemoSelectionHistory = () => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#memos' || window.history.state?.memoSelection) return;
    window.history.pushState({ ...(window.history.state || {}), memoSelection: true }, '', window.location.href);
    memoSelectionHistoryArmedRef.current = true;
  };

  const clearMemoSelection = (consumeHistory = true) => {
    selectedMemoIdsRef.current = new Set();
    setSelectedMemoIds(new Set());
    if (consumeHistory && typeof window !== 'undefined' && window.history.state?.memoSelection) {
      window.history.back();
    } else {
      memoSelectionHistoryArmedRef.current = false;
    }
  };

  const selectMemo = (id: string) => {
    if (selectedMemoIdsRef.current.size === 0) armMemoSelectionHistory();
    const next = new Set(selectedMemoIdsRef.current);
    next.add(id);
    selectedMemoIdsRef.current = next;
    setSelectedMemoIds(next);

    // Empêche le relâchement d'un appui long de produire ensuite un clic
    // sur une autre carte située sous le doigt après le changement d'état.
    memoSuppressAllClicksUntilRef.current = performance.now() + 420;
  };

  const toggleMemoSelection = (id: string) => {
    const next = new Set(selectedMemoIdsRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);

    if (next.size === 0) {
      clearMemoSelection(true);
      return;
    }

    if (selectedMemoIdsRef.current.size === 0) armMemoSelectionHistory();
    selectedMemoIdsRef.current = next;
    setSelectedMemoIds(next);
  };

  const openMemoCard = (memo: MemoEntry) => {
    if (performance.now() < memoSuppressAllClicksUntilRef.current) return;
    if (memoSuppressClickIdsRef.current.has(memo.id)) return;
    if (selectedMemoIdsRef.current.size > 0) {
      toggleMemoSelection(memo.id);
      return;
    }
    openMemoEditor(memo);
  };

  const resetMemoDraft = (type: 'text' | 'list' = 'text') => {
    setEditingMemoId(null);
    setMemoDraftType(type);
    setMemoDraftTitle('');
    setMemoDraftContent('');
    setMemoDraftItems([]);
    setMemoNewItem('');
    setMemoDraftColor('sage');
    setMemoDraftPinned(false);
  };

  const openNewMemo = (type: 'text' | 'list') => {
    resetMemoDraft(type);
    armMemoEditorHistory();
    memoEditorOpenRef.current = true;
    setMemoEditorOpen(true);
  };

  const openMemoEditor = (memo: MemoEntry) => {
    setEditingMemoId(memo.id);
    setMemoDraftType(memo.memo_type);
    setMemoDraftTitle(memo.title);
    setMemoDraftContent(memo.content);
    setMemoDraftItems(normalizeMemoItems(memo.items));
    setMemoNewItem('');
    setMemoDraftColor(memo.color);
    setMemoDraftPinned(memo.pinned);
    armMemoEditorHistory();
    memoEditorOpenRef.current = true;
    setMemoEditorOpen(true);
  };

  const addMemoDraftItem = () => {
    const text = memoNewItem.trim();
    if (!text) return;
    setMemoDraftItems(prev => [...prev, { id: crypto.randomUUID(), text, completed: false }]);
    setMemoNewItem('');
  };

  const saveMemo = async () => {
    const title = memoDraftTitle.trim();
    const content = memoDraftContent.trim();
    const items = memoDraftType === 'list'
      ? memoDraftItems.map(item => ({ ...item, text: item.text.trim() })).filter(item => item.text)
      : [];

    if (!title && !content && items.length === 0) {
      showAppMessage('Ajoute un titre, du texte ou au moins un élément avant de sauvegarder.');
      return;
    }

    setLoading(true);
    try {
      const existingMemo = editingMemoId ? memoEntriesRef.current.find(memo => memo.id === editingMemoId) : null;
      const targetArchived = existingMemo?.archived ?? false;
      const keepExistingOrder = existingMemo && existingMemo.pinned === memoDraftPinned;
      const sortOrder = keepExistingOrder
        ? existingMemo.sort_order
        : nextMemoSortOrder(memoDraftPinned, targetArchived, editingMemoId || undefined);

      const payload = {
        title,
        content,
        memo_type: memoDraftType,
        items,
        color: memoDraftColor,
        pinned: memoDraftPinned,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      };

      const query = editingMemoId
        ? supabase.from('memo_notes').update(payload).eq('id', editingMemoId)
        : supabase.from('memo_notes').insert([{ ...payload, archived: false }]);

      const { error } = await query;
      if (error) throw error;

      closeMemoEditor(true);
      await fetchMemos();
    } catch (error: any) {
      showAppMessage('Erreur lors de la sauvegarde du mémo : ' + (error?.message || 'erreur inconnue'));
    } finally {
      setLoading(false);
    }
  };

  const updateMemo = async (id: string, payload: Partial<Pick<MemoEntry, 'pinned' | 'archived' | 'items' | 'sort_order'>>) => {
    const currentMemo = memoEntriesRef.current.find(memo => memo.id === id);
    const nextPayload: Partial<MemoEntry> = { ...payload };

    if (currentMemo && (
      (typeof payload.pinned === 'boolean' && payload.pinned !== currentMemo.pinned) ||
      (typeof payload.archived === 'boolean' && payload.archived !== currentMemo.archived)
    )) {
      const nextPinned = typeof payload.pinned === 'boolean' ? payload.pinned : currentMemo.pinned;
      const nextArchived = typeof payload.archived === 'boolean' ? payload.archived : currentMemo.archived;
      nextPayload.sort_order = nextMemoSortOrder(nextPinned, nextArchived, id);
    }

    const { error } = await supabase
      .from('memo_notes')
      .update({ ...nextPayload, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      showAppMessage('Erreur de mise à jour du mémo : ' + error.message);
      return false;
    }

    await fetchMemos();
    return true;
  };

  const deleteMemoImmediately = async (memo: MemoEntry) => {
    // Suppression par glisser-déposer vers la poubelle : volontairement directe,
    // sans confirmation. On retire la carte immédiatement pour garder un geste
    // fluide, puis on restaure l'état si Supabase renvoie une erreur.
    const previousEntries = memoEntriesRef.current;
    const nextEntries = previousEntries.filter(item => item.id !== memo.id);
    memoEntriesRef.current = nextEntries;
    setMemoEntries(nextEntries);

    const { error } = await supabase.from('memo_notes').delete().eq('id', memo.id);
    if (error) {
      memoEntriesRef.current = previousEntries;
      setMemoEntries(previousEntries);
      showAppMessage('Erreur lors de la suppression du mémo : ' + error.message);
      return false;
    }
    return true;
  };

  const deleteMemo = (memo: MemoEntry) => {
    requestAppConfirmation({
      title: 'Supprimer ce mémo ?',
      message: `« ${memo.title || 'Sans titre'} » sera supprimé définitivement.`,
      confirmLabel: 'Supprimer',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('memo_notes').delete().eq('id', memo.id);
        if (error) {
          showAppMessage('Erreur lors de la suppression du mémo : ' + error.message);
          return;
        }
        await fetchMemos();
      },
    });
  };

  const getSelectedMemos = () => {
    const ids = selectedMemoIdsRef.current;
    return memoEntriesRef.current.filter(memo => ids.has(memo.id));
  };

  const deleteSelectedMemos = async () => {
    const ids = Array.from(selectedMemoIdsRef.current);
    if (!ids.length) return;

    // Comme le glisser vers la poubelle : suppression directe. La confirmation
    // reste réservée à la poubelle située dans l'éditeur d'un mémo ouvert.
    const previousEntries = memoEntriesRef.current;
    const nextEntries = previousEntries.filter(memo => !selectedMemoIdsRef.current.has(memo.id));
    memoEntriesRef.current = nextEntries;
    setMemoEntries(nextEntries);
    clearMemoSelection();

    const { error } = await supabase.from('memo_notes').delete().in('id', ids);
    if (error) {
      memoEntriesRef.current = previousEntries;
      setMemoEntries(previousEntries);
      showAppMessage('Erreur lors de la suppression des mémos : ' + error.message);
    }
  };

  const setSelectedMemosPinned = async () => {
    const selected = getSelectedMemos();
    if (!selected.length) return;
    const selectedIds = new Set(selected.map(memo => memo.id));
    const targetPinned = !selected.every(memo => memo.pinned);
    const now = new Date().toISOString();

    // Un compteur par état d'archive pour conserver un ordre propre dans chaque groupe.
    const nextOrderByArchive = new Map<boolean, number>();
    for (const archived of [false, true]) {
      const max = memoEntriesRef.current
        .filter(memo => !selectedIds.has(memo.id) && memo.archived === archived && memo.pinned === targetPinned)
        .reduce((value, memo) => Math.max(value, Number.isFinite(memo.sort_order) ? memo.sort_order : 0), -1);
      nextOrderByArchive.set(archived, max + 1);
    }

    const results = await Promise.all(selected.map(memo => {
      const order = nextOrderByArchive.get(memo.archived) ?? 0;
      nextOrderByArchive.set(memo.archived, order + 1);
      return supabase.from('memo_notes').update({
        pinned: targetPinned,
        sort_order: order,
        updated_at: now,
      }).eq('id', memo.id);
    }));

    const error = results.find(result => result.error)?.error;
    if (error) {
      showAppMessage('Erreur lors de la mise à jour des mémos : ' + error.message);
      clearMemoSelection();
      await fetchMemos();
      return;
    }
    clearMemoSelection();
    await fetchMemos();
  };

  const setSelectedMemosArchived = async () => {
    const selected = getSelectedMemos();
    if (!selected.length) return;
    const selectedIds = new Set(selected.map(memo => memo.id));
    const targetArchived = !showMemoArchived;
    const now = new Date().toISOString();

    // Les mémos épinglés/non épinglés conservent leurs groupes respectifs.
    const nextOrderByPinned = new Map<boolean, number>();
    for (const pinned of [false, true]) {
      const max = memoEntriesRef.current
        .filter(memo => !selectedIds.has(memo.id) && memo.archived === targetArchived && memo.pinned === pinned)
        .reduce((value, memo) => Math.max(value, Number.isFinite(memo.sort_order) ? memo.sort_order : 0), -1);
      nextOrderByPinned.set(pinned, max + 1);
    }

    const results = await Promise.all(selected.map(memo => {
      const order = nextOrderByPinned.get(memo.pinned) ?? 0;
      nextOrderByPinned.set(memo.pinned, order + 1);
      return supabase.from('memo_notes').update({
        archived: targetArchived,
        sort_order: order,
        updated_at: now,
      }).eq('id', memo.id);
    }));

    const error = results.find(result => result.error)?.error;
    if (error) {
      showAppMessage('Erreur lors de la mise à jour des mémos : ' + error.message);
      clearMemoSelection();
      await fetchMemos();
      return;
    }
    clearMemoSelection();
    await fetchMemos();
  };

  const transferMemoToTasks = (memo: MemoEntry) => {
    const listItems = memo.memo_type === 'list'
      ? (memo.items.some(item => !item.completed) ? memo.items.filter(item => !item.completed) : memo.items)
      : [];
    const listText = listItems.map(item => `☐ ${item.text}`).join('\n');
    const content = [memo.content.trim(), listText].filter(Boolean).join('\n\n');

    setNoteMode('text');
    setNewTitle(memo.title);
    setNewContent(content);
    setNewListItems([]);
    setCurrentNewListItem('');
    setImportance('vert');
    setSendImmediateEmail(false);
    setShowPopupConfig(false);
    setPopupScheduleMode('relative');
    setPopupHours('');
    setPopupMinutes('');
    setPopupDateTime('');
    setShowDailyConfig(false);
    setActivateReminder(false);
    setReminderPopupActive(false);
    setShowCalendarConfig(false);
    setTargetDate('');
    setShowAdvancedSettings(false);

    const targetUrl = `${window.location.pathname}${window.location.search}#notes-create`;
    window.history.pushState({ fromMemo: memo.id }, '', targetUrl);
    refreshRouteFromCurrentHash();
    setSuccessMessage('Mémo copié dans Tâches & Rappels. Ajoute maintenant le rappel si nécessaire.');
    window.setTimeout(() => setSuccessMessage(null), 4500);
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
    setBlockDurationHours(1);
    setBlockDurationMinutes(0);
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
    const existingDuration = block.kind === 'marker' ? 0 : Math.max(1, Math.round(block.duration || 60));
    setBlockDurationHours(Math.floor(existingDuration / 60));
    setBlockDurationMinutes(existingDuration % 60);
    setShowBlockModal(true);
  };

  const saveBlock = () => {
    if (!blockTitle.trim()) return;

    const [hStr, mStr] = blockTime.split(':');
    const parsedHour = parseInt(hStr, 10);
    const parsedMinute = parseInt(mStr, 10);

    if (!Number.isFinite(parsedHour) || !Number.isFinite(parsedMinute)) {
      showAppMessage("Heure invalide.");
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
    const maxDuration = Math.max(1, planningEndMinutes - safeStartMinutes);

    const requestedDuration =
      Math.max(0, Math.floor(Number(blockDurationHours) || 0)) * 60 +
      Math.max(0, Math.floor(Number(blockDurationMinutes) || 0));

    if (blockKind === 'task' && requestedDuration <= 0) {
      showAppMessage("Indique une durée supérieure à 0 minute.");
      return;
    }

    const chosenDuration =
      blockKind === 'marker'
        ? 0
        : Math.min(maxDuration, Math.max(1, requestedDuration));

    if (editingBlockId) {
      setWeeklyBlocks(prev => prev.map(b => {
        if (b.id !== editingBlockId) return b;
        const safeDuration = chosenDuration;
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
        duration: chosenDuration,
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
    requestAppConfirmation({
      title: 'Supprimer cet élément ?',
      message: 'La tâche ou le repère sera retiré du planning.',
      confirmLabel: 'Supprimer',
      tone: 'danger',
      onConfirm: () => {
        setWeeklyBlocks(prev => prev.filter(b => b.id !== id));
        setSelectedBlockId(null);
      },
    });
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

  const positionDraggingBlockGhost = (clientX: number, clientY: number) => {
    const ghost = draggingBlockGhostRef.current;
    if (!ghost) return;
    ghost.style.transform = `translate3d(${Math.round(clientX + 14)}px, ${Math.round(clientY + 14)}px, 0)`;
  };

  const setBlockDragPreview = (next: { day: string; hour: number; minute: number }) => {
    const previous = draggingBlockPreviewRef.current;
    if (
      previous &&
      previous.day === next.day &&
      previous.hour === next.hour &&
      previous.minute === next.minute
    ) {
      return;
    }
    draggingBlockPreviewRef.current = next;
    setDraggingBlockPreview(next);
  };

  const updateDraggedBlockPosition = (block: WeeklyBlock, clientX: number, clientY: number) => {
    // Le fantôme suit le doigt directement dans le DOM : aucun recalcul de la grille à
    // chaque pixel, ce qui évite les gels quand plusieurs tâches se chevauchent.
    positionDraggingBlockGhost(clientX, clientY);

    const scroller = daysScrollRef.current;
    if (!scroller) return draggingBlockPreviewRef.current;

    const scrollerRect = scroller.getBoundingClientRect();
    const horizontalEdge = Math.min(55, scrollerRect.width * 0.18);
    if (clientX < scrollerRect.left + horizontalEdge) {
      scroller.scrollLeft -= 16;
    } else if (clientX > scrollerRect.right - horizontalEdge) {
      scroller.scrollLeft += 16;
    }

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
    if (!dayColumn || !targetDay || !WEEK_DAYS.includes(targetDay)) {
      return draggingBlockPreviewRef.current;
    }

    const rect = dayColumn.getBoundingClientRect();
    const relativeY = clientY - rect.top - PLANNING_HEADER_HEIGHT;
    const rawStartMinutes = PLANNING_START_HOUR * 60 + (relativeY / currentHourHeight.current) * 60;

    const planningStartMinutes = PLANNING_START_HOUR * 60;
    const planningEndMinutes = (PLANNING_END_HOUR + 1) * 60;
    const effectiveDuration = block.kind === 'marker' ? 15 : Math.max(15, block.duration || 60);
    const latestStartMinutes = Math.max(planningStartMinutes, planningEndMinutes - effectiveDuration);
    const snappedMinutes = Math.round(rawStartMinutes / 15) * 15;
    const safeStartMinutes = Math.min(
      latestStartMinutes,
      Math.max(planningStartMinutes, snappedMinutes)
    );

    const next = {
      day: targetDay,
      hour: Math.floor(safeStartMinutes / 60),
      minute: safeStartMinutes % 60,
    };

    setBlockDragPreview(next);
    return next;
  };

  const commitDraggedBlockPosition = (blockId: string) => {
    const finalPosition = draggingBlockPreviewRef.current;
    if (!finalPosition) return;

    // La vraie tâche ne change de jour/heure qu'au relâchement. Ainsi le calcul des
    // chevauchements côte-à-côte ne peut plus réorganiser la grille sous le doigt.
    setWeeklyBlocks(prev => prev.map(item =>
      item.id === blockId
        ? {
            ...item,
            day: finalPosition.day,
            startHour: finalPosition.hour,
            startMinute: finalPosition.minute,
          }
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
      setDraggingBlockGhostMeta({ title: block.title, color: block.color, kind: block.kind || 'task' });
      const initial = { day: block.day, hour: block.startHour, minute: block.startMinute || 0 };
      draggingBlockPreviewRef.current = initial;
      setDraggingBlockPreview(initial);
      suppressNextBlockClick(block.id);
      requestAnimationFrame(() => positionDraggingBlockGhost(startX, startY));
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
        commitDraggedBlockPosition(block.id);
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
        draggingBlockPreviewRef.current = null;
        setDraggingBlockGhostMeta(null);
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
      setDraggingBlockGhostMeta({ title: block.title, color: block.color, kind: block.kind || 'task' });
      const initial = { day: block.day, hour: block.startHour, minute: block.startMinute || 0 };
      draggingBlockPreviewRef.current = initial;
      setDraggingBlockPreview(initial);
      suppressNextBlockClick(block.id);
      requestAnimationFrame(() => positionDraggingBlockGhost(startX, startY));
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
      if (active) {
        updateDraggedBlockPosition(block, event.clientX, event.clientY);
        commitDraggedBlockPosition(block.id);
      }
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
        draggingBlockPreviewRef.current = null;
        setDraggingBlockGhostMeta(null);
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
      showAppMessage("Ton planning est vide ! Ajoute des tâches ou des repères avant de sauvegarder.");
      return false;
    }

    const normalizedBlocks = normalizeWeeklyBlocks(weeklyBlocks);

    // Un planning déjà chargé doit être MIS À JOUR, jamais dupliqué silencieusement.
    if (activeTemplateId) {
      if (!isPlanningDirty) {
        showAppMessage("✓ Ce planning est déjà à jour.");
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
        showAppMessage(`✅ « ${activeTemplateName || 'Planning'} » a été mis à jour.`);
        return true;
      } catch (error: any) {
        showAppMessage("Erreur de sauvegarde : " + (error?.message || "erreur inconnue"));
        return false;
      } finally {
        setLoading(false);
      }
    }

    // Aucun modèle chargé : on crée un nouveau planning une seule fois,
    // puis il devient le planning actif pour les sauvegardes suivantes.
    const name = await askAppPrompt({
      title: 'Nom du planning',
      message: "Donne un nom à ce planning (ex. : Semaine d'école ou Vacances).",
      placeholder: 'Nom du planning',
      confirmLabel: 'Enregistrer',
    });
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
      showAppMessage("✅ Planning sauvegardé ! Les prochaines modifications mettront à jour ce même planning.");
      return true;
    } catch (error: any) {
      showAppMessage("Erreur de sauvegarde : " + (error?.message || "erreur inconnue"));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const finishPlanningExit = (target: 'home' | 'gallery') => {
    planningExitInProgressRef.current = true;
    clearPlanningEditorState();
    setShowClosePlanningModal(false);

    if (target === 'gallery') {
      navigatePlanningChild('#planning-gallery');
    } else {
      navigatePlanningHome();
    }
  };

  const requestPlanningExit = (target: 'home' | 'gallery') => {
    const hasUnsavedChanges = activeTemplateId ? isPlanningDirty : weeklyBlocks.length > 0;
    setPlanningExitTarget(target);

    if (hasUnsavedChanges) {
      setShowClosePlanningModal(true);
      return;
    }

    finishPlanningExit(target);
  };

  const saveAndExitPlanning = async () => {
    const saved = await saveTemplateToDB();
    if (saved) finishPlanningExit(planningExitTarget);
  };

  const cancelPlanningExit = () => {
    setShowClosePlanningModal(false);

    if (window.location.hash !== '#planning-editor' && mainMode === 'planning') {
      const editorUrl = `${window.location.pathname}${window.location.search}#planning-editor`;
      window.history.replaceState({ ...(window.history.state || {}), planningChild: true }, '', editorUrl);
    }
  };

  const editSavedTemplate = (template: PlanningTemplate) => {
    const loadedBlocks = normalizeWeeklyBlocks(template.blocks);
    setWeeklyBlocks(loadedBlocks);
    setActiveTemplateId(template.id);
    setActiveTemplateName(template.name);
    setPlanningSavedSnapshot(getPlanningSnapshot(loadedBlocks));
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setPreviewTemplate(null);
    navigatePlanningChild('#planning-editor');
  };

  const openBlankPlanning = () => {
    setWeeklyBlocks([]);
    setActiveTemplateId(null);
    setActiveTemplateName('');
    setPlanningSavedSnapshot(null);
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setPreviewTemplate(null);
    navigatePlanningChild('#planning-editor');
  };

  const startNewPlanning = () => {
    if (weeklyBlocks.length === 0) {
      openBlankPlanning();
      return;
    }

    requestAppConfirmation({
      title: 'Commencer un nouveau planning ?',
      message:
        activeTemplateId && isPlanningDirty
          ? `Les modifications non enregistrées de « ${activeTemplateName || 'ton planning'} » seront abandonnées.`
          : 'Le planning sauvegardé actuel restera intact.',
      confirmLabel: 'Nouveau planning',
      tone: 'sage',
      onConfirm: openBlankPlanning,
    });
  };

  const duplicateSavedTemplate = async (template: PlanningTemplate) => {
    const proposedName = `${template.name} - copie`;
    const name = await askAppPrompt({
      title: 'Dupliquer le planning',
      message: 'Choisis le nom de la copie.',
      defaultValue: proposedName,
      confirmLabel: 'Dupliquer',
    });
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
      showAppMessage("Erreur lors de la duplication : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const renameSavedTemplate = async (template: PlanningTemplate) => {
    const nextName = await askAppPrompt({
      title: 'Renommer le planning',
      defaultValue: template.name,
      confirmLabel: 'Renommer',
    });
    const cleanName = nextName?.trim();
    if (!cleanName || cleanName === template.name) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('planning_templates')
        .update({ name: cleanName })
        .eq('id', template.id);

      if (error) throw error;

      if (activeTemplateId === template.id) {
        setActiveTemplateName(cleanName);
      }
      if (previewTemplate?.id === template.id) {
        setPreviewTemplate({ ...previewTemplate, name: cleanName });
      }

      await fetchTemplates();
    } catch (error: any) {
      showAppMessage("Erreur lors du renommage : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const deleteSavedTemplate = (id: string) => {
    requestAppConfirmation({
      title: 'Supprimer ce planning ?',
      message: 'Ce planning sauvegardé sera supprimé définitivement.',
      confirmLabel: 'Supprimer',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('planning_templates').delete().eq('id', id);

        if (error) {
          showAppMessage("Erreur lors de la suppression du planning : " + error.message);
          return;
        }

        if (previewTemplate?.id === id) setPreviewTemplate(null);
        if (activeTemplateId === id) {
          setActiveTemplateId(null);
          setActiveTemplateName('');
          setPlanningSavedSnapshot(null);
        }
        await fetchTemplates();
      },
    });
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

  const buildWeeklyICSContent = (blocks: WeeklyBlock[] = weeklyBlocks) => {
    const exportableBlocks = blocks.filter(block => block.kind !== 'marker');
    if (exportableBlocks.length === 0) return null;

    const daysMap: Record<string, number> = {
      'Dimanche': 0,
      'Lundi': 1,
      'Mardi': 2,
      'Mercredi': 3,
      'Jeudi': 4,
      'Vendredi': 5,
      'Samedi': 6,
    };

    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatICSDate = (d: Date) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'PRODID:-//Planning semaines types//FR',
    ].join('\n') + '\n';

    exportableBlocks.forEach(block => {
      const today = new Date();
      const targetDay = daysMap[block.day];
      const date = new Date(today);
      date.setDate(date.getDate() + ((targetDay + 7 - date.getDay()) % 7 || 7));
      date.setHours(block.startHour, block.startMinute || 0, 0, 0);

      const end = new Date(date);
      end.setMinutes(date.getMinutes() + (block.duration || 60));

      icsContent += [
        'BEGIN:VEVENT',
        `SUMMARY:${escapeICS(block.title)}`,
        `DTSTART:${formatICSDate(date)}`,
        `DTEND:${formatICSDate(end)}`,
        'END:VEVENT',
      ].join('\n') + '\n';
    });

    icsContent += 'END:VCALENDAR';
    return icsContent.replace(/\n/g, '\r\n');
  };

  const getExportPlanning = () => ({
    blocks: exportPlanningContext?.blocks ?? weeklyBlocks,
    name: exportPlanningContext?.name || activeTemplateName || 'Ma semaine type',
  });

  const closeExportModal = () => {
    setShowExportModal(false);
    setExportPlanningContext(null);
    setShowExportHelp(false);
  };

  const exportWeeklyICS = () => {
    const planning = getExportPlanning();
    const icsContent = buildWeeklyICSContent(planning.blocks);
    if (!icsContent) {
      showAppMessage("Le planning ne contient aucune tâche à exporter. Les repères horaires seuls ne sont pas exportés.");
      return;
    }

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = planning.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'ma_semaine_type';
    link.href = url;
    link.download = `${safeName}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    closeExportModal();
  };

  const addWeeklyDirectlyToCalendar = async () => {
    const planning = getExportPlanning();
    const icsContent = buildWeeklyICSContent(planning.blocks);
    if (!icsContent) {
      showAppMessage("Le planning ne contient aucune tâche à ajouter au calendrier.");
      return;
    }

    const safeName = planning.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'ma_semaine_type';
    const file = new File([icsContent], `${safeName}.ics`, { type: 'text/calendar' });

    try {
      if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: planning.name,
          text: 'Ajouter ce planning à mon calendrier',
          files: [file],
        });
        closeExportModal();
        return;
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      console.warn('Partage calendrier indisponible :', error);
    }

    exportWeeklyICS();
    showAppMessage("L'ajout direct n'est pas pris en charge par ce navigateur : le fichier .ics a été préparé à la place.");
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
      showAppMessage("Erreur pendant le nettoyage : " + (error?.message || "erreur inconnue"));
    }
  };

  const deleteAllHistory = () => {
    requestAppConfirmation({
      title: 'Supprimer tout l’historique ?',
      message: 'Toutes les tâches terminées seront supprimées définitivement.',
      confirmLabel: 'Tout supprimer',
      tone: 'danger',
      onConfirm: async () => {
        setLoading(true);
        try {
          const { error } = await supabase.from('notes').delete().eq('completed', true);
          if (error) throw error;
          await fetchNotes();
        } catch (error: any) {
          showAppMessage("Erreur lors de la suppression : " + (error?.message || "erreur inconnue"));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const addNote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) return;

    setLoading(true);

    try {
      let finalTargetDate = '';
      let finalPopupActive = false;

      if (showPopupConfig && popupScheduleMode === 'relative' && (popupHours || popupMinutes)) {
        const hours = Math.max(0, Number.parseInt(popupHours || '0', 10) || 0);
        const minutes = Math.max(0, Number.parseInt(popupMinutes || '0', 10) || 0);
        const totalMinutes = hours * 60 + minutes;

        if (totalMinutes > 0) {
          finalTargetDate = new Date(Date.now() + totalMinutes * 60 * 1000).toISOString();
          finalPopupActive = true;
        }
      } else if (showPopupConfig && popupScheduleMode === 'datetime' && popupDateTime) {
        const popupTime = getSafeTime(popupDateTime);
        if (!popupTime) {
          showAppMessage("La date et l'heure du pop-up ne sont pas valides.");
          return;
        }
        if (popupTime <= Date.now()) {
          showAppMessage("La date et l'heure du pop-up doivent être dans le futur.");
          return;
        }
        finalTargetDate = new Date(popupTime).toISOString();
        finalPopupActive = true;
      } else if (showCalendarConfig && targetDate) {
        const calendarTime = getSafeTime(targetDate);
        if (!calendarTime) {
          showAppMessage("La date choisie n'est pas valide.");
          return;
        }
        finalTargetDate = new Date(calendarTime).toISOString();
      }

      const safeDailyTime = /^\d{2}:\d{2}$/.test(dailyTime) ? dailyTime : '09:00';

      const { error } = await supabase.from('notes').insert([{
        title: newTitle.trim(),
        content: newContent.trim(),
        importance,
        subtasks: [],
        is_list: false,
        reminder_active: activateReminder,
        reminder_popup_active: reminderPopupActive,
        daily_reminder_time: safeDailyTime,
        target_date: finalTargetDate,
        popup_active: finalPopupActive,
        sort_order: nextTaskSortOrder(importance),
      }]);

      if (error) throw error;

      if (sendImmediateEmail && !DEMO_MODE) {
        try {
          const mailRes = await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: newTitle.trim() ? newTitle.trim() : "Nouvelle tâche",
              importance,
            }),
          });

          if (!mailRes.ok) {
            const mailError = await mailRes.json().catch(() => ({}));
            showAppMessage(
              "La tâche a été créée, mais l'e-mail n'a pas pu être envoyé : " +
              (mailError.error || "erreur inconnue")
            );
          }
        } catch (mailError: any) {
          showAppMessage(
            "La tâche a été créée, mais l'e-mail n'a pas pu être envoyé : " +
            (mailError?.message || "erreur réseau")
          );
        }
      }

      setNewTitle('');
      setNewContent('');
      setImportance('vert');
      setNewListItems([]);
      setCurrentNewListItem('');
      setSendImmediateEmail(false);
      setShowPopupConfig(false);
      setPopupScheduleMode('relative');
      setPopupHours('');
      setPopupMinutes('');
      setPopupDateTime('');
      setShowDailyConfig(false);
      setActivateReminder(false);
      setReminderPopupActive(false);
      setShowCalendarConfig(false);
      setTargetDate('');
      setShowAdvancedSettings(false);
      setCollapsedPriorities(prev => ({ ...prev, [importance]: false }));

      await fetchNotes();
      navigateNotesChild('#notes-list');
      setSuccessMessage('✅ Tâche créée avec succès !');
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      showAppMessage("Erreur Supabase : " + (error?.message || "erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = (id: string) => {
    requestAppConfirmation({
      title: 'Supprimer cette tâche ?',
      message: 'La tâche sera supprimée définitivement.',
      confirmLabel: 'Supprimer',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('notes').delete().eq('id', id);

        if (error) {
          showAppMessage("Erreur lors de la suppression : " + error.message);
          return;
        }

        await fetchNotes();
      },
    });
  };

  const triggerImmediateEmail = (note: Note) => {
    if (DEMO_MODE) {
      demoFeatureUnavailable('L’envoi d’e-mail');
      return;
    }
    requestAppConfirmation({
      title: 'Envoyer le rappel par e-mail ?',
      message: 'L’e-mail sera envoyé immédiatement à ton adresse de rappel.',
      confirmLabel: 'Envoyer',
      tone: 'sage',
      onConfirm: async () => {
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

          showAppMessage('E-mail envoyé avec succès !');
        } catch (e: any) {
          showAppMessage("Échec de l'envoi de l'e-mail : " + e.message);
        }
      },
    });
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
      showAppMessage("Erreur de mise à jour : " + error.message);
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
      showAppMessage("Erreur lors de l'annulation de la date : " + error.message);
      return;
    }

    locallyTriggeredAlarmIdsRef.current.delete(id);
    await fetchNotes();
  };

  const processAiNote = async (finalTranscript: string) => {
    if (DEMO_MODE) {
      demoFeatureUnavailable('L’analyse IA');
      return;
    }
    if (!finalTranscript.trim()) {
      showAppMessage("❌ Le micro n'a rien enregistré.");
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
      showAppMessage("❌ Erreur IA/réseau : " + (e?.message || "erreur inconnue"));
    } finally {
      setIsAiProcessing(false);
    }
  };

  const toggleDictation = (mode: 'title' | 'content' | 'list_item' | 'ai' | 'memo_title' | 'memo_content' | 'memo_item') => {
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
    if (!SpeechRecognition) return showAppMessage("Ton navigateur ne supporte pas la dictée vocale.");
    
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
      else if (mode === 'memo_title') setMemoDraftTitle(prev => (prev ? prev + ' ' : '') + newText.trim());
      else if (mode === 'memo_content') setMemoDraftContent(prev => (prev ? prev + ' ' : '') + newText.trim());
      else if (mode === 'memo_item') setMemoNewItem(prev => (prev ? prev + ' ' : '') + newText.trim());
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


  useEffect(() => {
    if (memoEditorOpen) return;
    if (!['memo_title', 'memo_content', 'memo_item'].includes(listeningMode)) return;
    if (recognitionRef.current) {
      recognitionRef.current.manuallyStopped = true;
      try { recognitionRef.current.stop(); } catch (_) {}
    }
    setListeningMode('none');
  }, [memoEditorOpen]);

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
        showAppMessage("L'IA a proposé une heure de rappel invalide. Modifie la proposition manuellement.");
        return;
      }

      if (!data?.popup_time && data?.calendar_time && !calendarIso) {
        showAppMessage("L'IA a proposé une date de calendrier invalide. Modifie la proposition manuellement.");
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

      const aiListText = isList ? listItems.map(text => `☐ ${text}`).join('\n') : '';
      const aiContent = [
        typeof data?.content === 'string' ? data.content.trim() : '',
        aiListText,
      ].filter(Boolean).join('\n\n');

      const { error } = await supabase.from('notes').insert([{
        title: typeof data?.title === 'string' ? data.title.trim() : '',
        content: aiContent,
        importance: safeImportance,
        subtasks: [],
        is_list: false,
        reminder_active: dailyReminderActive && reminderChannels.email,
        reminder_popup_active: dailyReminderActive && reminderChannels.popup,
        daily_reminder_time: dailyReminderTime,
        target_date: targetDateValue,
        popup_active: isPopupActive,
        sort_order: nextTaskSortOrder(safeImportance),
      }]);

      if (error) throw error;

      if (data?.send_email && !DEMO_MODE) {
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
            showAppMessage(
              "La tâche a été créée, mais l'e-mail n'a pas pu être envoyé : " +
              (mailError.error || "erreur inconnue")
            );
          }
        } catch (mailError: any) {
          showAppMessage(
            "La tâche a été créée, mais l'e-mail n'a pas pu être envoyé : " +
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
      navigateNotesChild('#notes-list');
      setSuccessMessage('✅ Tâche créée avec succès par IA !');
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      showAppMessage("Erreur lors de la création IA : " + (e?.message || "erreur inconnue"));
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
    const listItems = normalizeAiListItems(data?.list_items);
    const listText = listItems.length > 0 ? listItems.map(item => `☐ ${item}`).join('\n') : '';
    const proposalContent = [typeof data?.content === 'string' ? data.content : '', listText].filter(Boolean).join('\n\n');
    setNewContent(proposalContent);
    setNoteMode('text');
    setNewListItems([]);

    if (data?.importance === 'vert' || data?.importance === 'orange' || data?.importance === 'rouge') {
      setImportance(data.importance);
    }

    if (data?.send_email && !DEMO_MODE) {
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
    navigateNotesCreate();
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
    const dates = formatDatesForCalendar(note.target_date || '');
    if (!dates) return '#';

    const title = encodeURIComponent(note.title || 'Note');
    const details = encodeURIComponent(note.content || '');
    const timeZone = encodeURIComponent(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'
    );

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates.start}/${dates.end}&details=${details}&ctz=${timeZone}`;
  };

  const downloadICS = (note: Note) => {
    const dates = formatDatesForCalendar(note.target_date || '');
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

    if (showEditingPopupConfig && editingPopupScheduleMode === 'relative' && (editingPopupHours || editingPopupMinutes)) {
      const hours = Math.max(0, Number.parseInt(editingPopupHours || '0', 10) || 0);
      const minutes = Math.max(0, Number.parseInt(editingPopupMinutes || '0', 10) || 0);
      const totalMinutes = hours * 60 + minutes;

      if (totalMinutes > 0) {
        finalTargetDate = new Date(Date.now() + totalMinutes * 60 * 1000).toISOString();
        finalPopupActive = true;
      }
    } else if (showEditingPopupConfig && editingPopupScheduleMode === 'datetime' && editingPopupDateTime) {
      const popupTime = getSafeTime(editingPopupDateTime);
      if (!popupTime) {
        showAppMessage("La date et l'heure du pop-up ne sont pas valides.");
        return;
      }
      if (popupTime <= Date.now()) {
        showAppMessage("La date et l'heure du pop-up doivent être dans le futur.");
        return;
      }
      finalTargetDate = new Date(popupTime).toISOString();
      finalPopupActive = true;
    } else if (finalTargetDate) {
      const normalized = toValidIso(finalTargetDate);
      if (!normalized) {
        showAppMessage("La date choisie n'est pas valide.");
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

    const updatePayload: Record<string, any> = {
      title: editingTitle.trim(),
      content: editingContent.trim(),
      target_date: finalTargetDate,
      popup_active: finalPopupActive,
      importance: editingImportance,
      sort_order: previousNote && previousNote.importance !== editingImportance
        ? nextTaskSortOrder(editingImportance)
        : (previousNote?.sort_order ?? nextTaskSortOrder(editingImportance)),
      reminder_active: editingReminderActive,
      reminder_popup_active: editingReminderPopupActive,
      daily_reminder_time: safeDailyTime,
    };

    // Si l'utilisateur active un canal ou change l'heure de relance, on remet
    // son horodatage à zéro afin que la nouvelle configuration puisse être
    // prise en compte le jour même.
    if (emailReminderChanged) updatePayload.last_email_reminded_at = null;
    if (popupReminderChanged) updatePayload.last_popup_reminded_at = null;

    const { error } = await supabase.from('notes').update(updatePayload).eq('id', id);

    if (error) {
      showAppMessage("Erreur lors de l'enregistrement : " + error.message);
      return;
    }

    if (editingSendImmediateEmail && !DEMO_MODE) {
      try {
        const mailRes = await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editingTitle.trim() || 'Rappel de note',
            importance: editingImportance,
          }),
        });

        if (!mailRes.ok) {
          const mailError = await mailRes.json().catch(() => ({}));
          showAppMessage("La note a été enregistrée, mais l'e-mail n'a pas pu être envoyé : " + (mailError.error || 'erreur inconnue'));
        }
      } catch (mailError: any) {
        showAppMessage("La note a été enregistrée, mais l'e-mail n'a pas pu être envoyé : " + (mailError?.message || 'erreur réseau'));
      }
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
    setShowEditingAdvancedSettings(false);
    setEditingSendImmediateEmail(false);
    setShowEditingPopupConfig(false); setShowEditingDailyConfig(false); setShowEditingExactDateConfig(false);
    setEditingPopupHours(''); setEditingPopupMinutes('');
    setEditingPopupScheduleMode(note.popup_active && note.target_date ? 'datetime' : 'relative');
    if (note.popup_active && note.target_date) {
      const ts = getSafeTime(note.target_date);
      if (ts) {
        const d = new Date(ts);
        const pad = (n: number) => n.toString().padStart(2, '0');
        setEditingPopupDateTime(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
      } else {
        setEditingPopupDateTime('');
      }
    } else {
      setEditingPopupDateTime('');
    }
  };

  const snoozeNote = async (id: string, days: number) => {
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + days);

    const { error } = await supabase
      .from('notes')
      .update({ snooze_until: snoozeDate.toISOString() })
      .eq('id', id);

    if (error) {
      showAppMessage("Erreur lors du masquage : " + error.message);
      return;
    }

    await fetchNotes();
  };

  const handleSnoozeClick = async (id: string) => {
    const result = await askAppPrompt({
      title: 'Masquer la note',
      message: 'Pendant combien de jours veux-tu masquer cette note ?',
      defaultValue: '3',
      inputMode: 'numeric',
      confirmLabel: 'Masquer',
    });

    if (result !== null) {
      const days = parseInt(result, 10);
      if (!isNaN(days) && days > 0) await snoozeNote(id, days);
      else showAppMessage("Veuillez entrer un nombre de jours valide.");
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
      showAppMessage("Erreur lors de la mise à jour de la liste : " + error.message);
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
      showAppMessage("Erreur lors de l'ajout : " + error.message);
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
      showAppMessage("Erreur lors de la suppression : " + error.message);
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
  }).sort((a, b) => a.sort_order - b.sort_order || getSafeTime(b.created_at) - getSafeTime(a.created_at));

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

  const memoColorClasses = (color: MemoColor) => ({
    sage: 'bg-[#E6ECDD] border-[#CAD5BE] text-[#43503C]',
    sand: 'bg-[#F1E4D2] border-[#DEC9AD] text-[#64523F]',
    rose: 'bg-[#F2DEDA] border-[#DEC0B9] text-[#6C4E49]',
    blue: 'bg-[#DFE8EC] border-[#C2D3DA] text-[#435B64]',
    lavender: 'bg-[#E9E2EF] border-[#D3C6DE] text-[#5E5167]',
    white: 'bg-[#FBFAF7] border-[#DED7CC] text-[#4A463F]',
  }[color]);

  const normalizedMemoSearch = memoSearch.trim().toLocaleLowerCase('fr-FR');
  const visibleMemos = memoEntries.filter(memo => {
    if (memo.archived !== showMemoArchived) return false;
    if (!normalizedMemoSearch) return true;
    const searchable = [memo.title, memo.content, ...memo.items.map(item => item.text)]
      .join(' ')
      .toLocaleLowerCase('fr-FR');
    return searchable.includes(normalizedMemoSearch);
  });
  const pinnedMemos = visibleMemos
    .filter(memo => memo.pinned)
    .sort((a, b) => a.sort_order - b.sort_order);
  const otherMemos = visibleMemos
    .filter(memo => !memo.pinned)
    .sort((a, b) => a.sort_order - b.sort_order);
  const pinnedMemoColumns = buildMemoMasonryColumns(pinnedMemos);
  const otherMemoColumns = buildMemoMasonryColumns(otherMemos);

  const renderMemoCard = (memo: MemoEntry) => {
    const isSelected = selectedMemoIds.has(memo.id);
    const hideOriginal = draggingMemoId === memo.id && memoDndMoved;
    const dragDisabled = selectedMemoIds.size > 0 || !!memoSearch.trim();

    return (
      <MemoDndCard
        key={memo.id}
        memo={memo}
        selected={isSelected}
        disabled={dragDisabled}
        hideOriginal={hideOriginal}
        colorClass={memoColorClasses(memo.color)}
        onOpen={() => openMemoCard(memo)}
      >
        {isSelected && (
          <span className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-[#6F7B64] text-white border-2 border-[#F8F5EF] shadow flex items-center justify-center text-[12px] font-black">✓</span>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {memo.title && <h3 className="font-black text-[14px] leading-tight whitespace-pre-wrap break-words">{memo.title}</h3>}
            {memo.content && (
              <p className="text-[12px] mt-1.5 whitespace-pre-wrap leading-[1.35] opacity-85 break-words line-clamp-6">{memo.content}</p>
            )}
          </div>
          {memo.pinned && <span className="text-xs flex-shrink-0" title="Épinglé">📌</span>}
        </div>

        {memo.memo_type === 'list' && memo.items.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1">
            {memo.items.slice(0, 6).map(item => (
              <div key={item.id} className="flex items-start gap-1.5 text-[11px] font-semibold leading-tight">
                <span className="mt-[-1px] flex-shrink-0 opacity-70">{item.completed ? '☑' : '☐'}</span>
                <span className={`break-words ${item.completed ? 'line-through opacity-45' : ''}`}>{item.text}</span>
              </div>
            ))}
            {memo.items.length > 6 && (
              <span className="text-[9px] font-bold opacity-50 mt-0.5">+ {memo.items.length - 6} autre{memo.items.length - 6 > 1 ? 's' : ''}</span>
            )}
          </div>
        )}
      </MemoDndCard>
    );
  };

  const renderNoteItem = (note: Note) => (
    <li
      id={`note-${note.id}`}
      key={note.id}
      data-task-card-id={note.id}
      data-task-priority={note.importance}
      onPointerDown={(e) => beginTaskLongPress(e, note)}
      onPointerMove={moveTaskLongPress}
      onPointerUp={endTaskLongPress}
      onPointerCancel={cancelTaskLongPress}
      onContextMenu={(e) => e.preventDefault()}
      draggable={false}
      style={{
        touchAction: draggingTaskId === note.id ? 'none' : 'pan-y',
        pointerEvents: draggingTaskId === note.id ? 'none' : 'auto',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
      className={`flex flex-col gap-2 p-3 rounded shadow border-l-4 transition-[box-shadow,opacity,border-color,background-color] duration-150 scroll-mt-24 select-none ${draggingTaskId === note.id ? 'opacity-0' : ''} ${highlightedNoteId === note.id ? 'ring-4 ring-[#AEBB9E] ring-offset-2' : ''} ${
      showArchived === true ? 'border-[#D6D0C7] bg-[#F3F0EA]' : 
      note.importance === 'rouge' ? 'border-[#D5A195] bg-[#FAECE7]' : 
      note.importance === 'orange' ? 'border-[#D6B384] bg-[#F6EAD9]' : 'border-[#AAB99D] bg-[#EDF1E7]'
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
              <input type="text" value={editingTitle} onFocus={() => setShowEditingAdvancedSettings(false)} onChange={(e) => setEditingTitle(e.target.value)} className="w-full border border-gray-400 p-1.5 rounded text-black font-semibold text-sm" autoFocus />
            ) : (
              <>
                <input type="text" value={editingTitle} onFocus={() => setShowEditingAdvancedSettings(false)} onChange={(e) => setEditingTitle(e.target.value)} placeholder="Titre (optionnel)" className="w-full border border-gray-400 p-1.5 rounded text-black font-semibold text-sm" />
                <textarea value={editingContent} onFocus={() => setShowEditingAdvancedSettings(false)} onChange={(e) => setEditingContent(e.target.value)} className="w-full border border-gray-400 p-1.5 rounded text-black resize-y min-h-[60px] text-sm" />
              </>
            )}
            
            <select value={editingImportance} onChange={(e) => setEditingImportance(e.target.value as any)} className="border border-gray-400 p-1.5 rounded text-black text-sm w-full font-bold">
              <option value="vert">🟢 Priorité Normale</option>
              <option value="orange">🟠 Priorité Importante</option>
              <option value="rouge">🔴 Priorité Urgente</option>
            </select>

            <div className="flex flex-col mt-1">
              <button
                type="button"
                onClick={() => setShowEditingAdvancedSettings(!showEditingAdvancedSettings)}
                className="w-full bg-[#EEE8DD] text-[#5F584F] hover:bg-[#E5DED2] font-black py-2 px-2.5 rounded-xl text-xs flex justify-between items-center transition-colors border border-[#DED5C8]"
              >
                <span>⚙️ Paramétrage des rappels</span><span>{showEditingAdvancedSettings ? '▲' : '▼'}</span>
              </button>

              {showEditingAdvancedSettings && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 p-2.5 bg-[#F6F2EB] rounded-xl border border-[#E1D9CE]">
                  <button
                    type="button"
                    onClick={() => DEMO_MODE ? demoFeatureUnavailable('L’envoi d’e-mail') : setEditingSendImmediateEmail(!editingSendImmediateEmail)}
                    className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex items-center justify-between ${editingSendImmediateEmail ? 'bg-[#D9E2CF] text-[#3D4B37] border-[#BECBB1]' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                  >
                    <span>📨 E-mail immédiat</span><span>{editingSendImmediateEmail ? 'ON' : 'OFF'}</span>
                  </button>

                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showEditingPopupConfig;
                        setShowEditingPopupConfig(next);
                        if (next) {
                          setShowEditingDailyConfig(false);
                          setShowEditingExactDateConfig(false);
                          if ('Notification' in window) Notification.requestPermission();
                        }
                      }}
                      className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${(showEditingPopupConfig || editingPopupActive || editingPopupHours || editingPopupMinutes || editingPopupDateTime) ? 'bg-[#DDDCE8] text-[#514F66] border-[#C9C7D8] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                    >
                      <span>⏰ Alarme pop-up</span><span>{showEditingPopupConfig ? '▲' : '▼'}</span>
                    </button>
                    {showEditingPopupConfig && (
                      <div className="bg-[#F3F2F8] border border-t-0 border-[#D8D5E3] p-2.5 rounded-b-xl flex flex-col gap-2.5">
                        <div className="grid grid-cols-2 gap-1.5 bg-white/70 p-1 rounded-xl border border-[#E0DDE8]">
                          <button
                            type="button"
                            onClick={() => setEditingPopupScheduleMode('relative')}
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-black transition-colors ${editingPopupScheduleMode === 'relative' ? 'bg-[#DDDCE8] text-[#4E4B62]' : 'text-[#746F80] hover:bg-[#F0EEF5]'}`}
                          >
                            Dans…
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPopupScheduleMode('datetime')}
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-black transition-colors ${editingPopupScheduleMode === 'datetime' ? 'bg-[#DDDCE8] text-[#4E4B62]' : 'text-[#746F80] hover:bg-[#F0EEF5]'}`}
                          >
                            Date et heure
                          </button>
                        </div>

                        {editingPopupScheduleMode === 'relative' ? (
                          <div className="flex flex-wrap items-center gap-1 justify-center">
                            <span className="text-xs font-bold text-[#5C5870]">Dans :</span>
                            <input type="number" placeholder="0" min="0" value={editingPopupHours} onChange={(e) => setEditingPopupHours(e.target.value)} className="w-12 p-1.5 border border-[#CDC9DB] rounded-lg text-center text-black font-bold text-xs bg-white" />
                            <span className="text-xs font-bold text-[#5C5870]">h</span>
                            <input type="number" placeholder="0" min="0" value={editingPopupMinutes} onChange={(e) => setEditingPopupMinutes(e.target.value)} className="w-12 p-1.5 border border-[#CDC9DB] rounded-lg text-center text-black font-bold text-xs bg-white" />
                            <span className="text-xs font-bold text-[#5C5870]">min</span>
                          </div>
                        ) : (
                          <input
                            type="datetime-local"
                            value={editingPopupDateTime}
                            onChange={(e) => setEditingPopupDateTime(e.target.value)}
                            className="w-full border border-[#CDC9DB] p-2 rounded-lg text-black bg-white font-bold text-xs"
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setEditingPopupActive(false);
                            if (editingTargetDate === note.target_date) setEditingTargetDate('');
                            setEditingPopupHours('');
                            setEditingPopupMinutes('');
                            setEditingPopupDateTime('');
                            setShowEditingPopupConfig(false);
                          }}
                          className="self-center bg-[#F0DDD7] text-[#885C50] px-2.5 py-1 rounded-lg text-[11px] font-bold hover:bg-[#E8CEC6] transition-colors"
                        >
                          ✖ Désactiver l'alarme
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showEditingDailyConfig;
                        setShowEditingDailyConfig(next);
                        if (next) { setShowEditingPopupConfig(false); setShowEditingExactDateConfig(false); }
                      }}
                      className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${(editingReminderActive || editingReminderPopupActive) ? 'bg-[#D9E2CF] text-[#3D4B37] border-[#BECBB1] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                    >
                      <span>🔄 Relance quotidienne</span><span>{showEditingDailyConfig ? '▲' : '▼'}</span>
                    </button>
                    {showEditingDailyConfig && (
                      <div className="bg-[#F0F4EC] border border-t-0 border-[#D4DDCB] p-2.5 rounded-b-xl flex flex-col gap-2">
                        <div className="flex flex-wrap gap-4 justify-center">
                          <label className="flex items-center gap-1 cursor-pointer font-bold text-[#46513F] text-xs"><input type="checkbox" checked={editingReminderActive} onChange={(e) => { if (DEMO_MODE && e.target.checked) { demoFeatureUnavailable('Les relances par e-mail'); return; } setEditingReminderActive(e.target.checked); }} className="accent-[#7E9071]"/> E-mail</label>
                          <label className="flex items-center gap-1 cursor-pointer font-bold text-[#46513F] text-xs"><input type="checkbox" checked={editingReminderPopupActive} onChange={(e) => setEditingReminderPopupActive(e.target.checked)} className="accent-[#7E9071]"/> Pop-up</label>
                        </div>
                        <div className="flex items-center justify-center gap-2 pt-1 border-t border-[#D4DDCB]"><span className="text-xs font-bold text-[#46513F]">À :</span><input type="time" value={editingDailyTime} onChange={(e) => setEditingDailyTime(e.target.value)} className="p-1.5 border border-[#C8D2BC] rounded-lg text-black bg-white font-bold text-xs" /></div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showEditingExactDateConfig;
                        setShowEditingExactDateConfig(next);
                        if (next) { setShowEditingPopupConfig(false); setShowEditingDailyConfig(false); }
                      }}
                      className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${editingTargetDate && !editingPopupActive ? 'bg-[#E6DDD2] text-[#5B4C40] border-[#D6C8B8] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                    >
                      <span>📅 Agenda / .ics</span><span>{showEditingExactDateConfig ? '▲' : '▼'}</span>
                    </button>
                    {showEditingExactDateConfig && (
                      <div className="bg-[#F6F0EA] border border-t-0 border-[#E0D3C5] p-2.5 rounded-b-xl flex flex-col gap-2 items-center">
                        <input type="datetime-local" value={editingTargetDate ? (() => {
                          const ts = getSafeTime(editingTargetDate); if (!ts) return '';
                          const d = new Date(ts); const pad = (n: number) => n.toString().padStart(2, '0');
                          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        })() : ''} onChange={(e) => { setEditingTargetDate(e.target.value ? new Date(e.target.value).toISOString() : ''); }} className="w-full p-2 border border-[#D8C8B6] rounded-lg text-black text-xs bg-white font-bold" />
                        <div className="flex flex-wrap gap-3 pt-1 justify-center">
                          <label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-[#5B4C40]"><input type="checkbox" checked={enableGoogleCal} onChange={(e) => setEnableGoogleCal(e.target.checked)} className="accent-[#9B8068]" /> Google Agenda</label>
                          <label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-[#5B4C40]"><input type="checkbox" checked={enableICal} onChange={(e) => setEnableICal(e.target.checked)} className="accent-[#9B8068]" /> Fichier .ics</label>
                        </div>
                        {editingTargetDate && !editingPopupActive && (
                          <button type="button" onClick={() => { setEditingTargetDate(''); setShowEditingExactDateConfig(false); }} className="bg-[#F0DDD7] text-[#885C50] px-2.5 py-1 rounded-lg text-[11px] font-bold hover:bg-[#E8CEC6] transition-colors">✖ Annuler la date</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
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

  const planningTaskOverlapLayouts = getTaskOverlapLayoutMap(weeklyBlocks);
  const previewTaskOverlapLayouts = previewTemplate
    ? getTaskOverlapLayoutMap(previewTemplate.blocks || [])
    : new Map<string, { columnIndex: number; columnCount: number }>();
  const savedTemplateOverlapLayouts = new Map(
    savedTemplates.map(template => [template.id, getTaskOverlapLayoutMap(template.blocks || [])])
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
                <div className="text-center text-xs font-bold text-gray-500 uppercase tracking-widest">Tâche {currentCleanupIndex + 1} sur {cleanupNotes.length}</div>
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
                <p className="text-sm text-gray-500">Il n'y a plus aucune tâche à trier pour cette durée.</p>
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

      {/* AIDE : OPTIONS NOTES & RAPPELS */}
      {showNotesHelp && (
        <div className="fixed inset-0 bg-black/35 z-[12500] flex items-center justify-center p-4 backdrop-blur-[2px]" onClick={() => setShowNotesHelp(false)}>
          <div className="w-full max-w-md rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-black text-[#46513F]">{activeTab === 'notes' ? 'Tâches enregistrées' : 'Options de Tâches &amp; Rappels'}</h2>
              <button onClick={() => setShowNotesHelp(false)} className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black">×</button>
            </div>

            {activeTab === 'notes' ? (
              <div className="space-y-3 text-sm text-[#655E54] leading-relaxed">
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#4E5847]">↕️ Déplacer et classer</strong>
                  <p className="mt-1">Maintiens une tâche puis déplace-la pour changer son ordre. Tu peux aussi la déposer dans une autre priorité pour la passer en Urgente, Importante ou Normale.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#55516A]">✏️ Modifier une tâche</strong>
                  <p className="mt-1">Ouvre une tâche puis utilise Modifier pour changer son contenu, sa priorité ou ajouter et ajuster ses rappels : pop-up, relance quotidienne, e-mail et agenda.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#67574A]">🎯 Mode Focus</strong>
                  <p className="mt-1">Le mode Focus affiche une seule tâche à la fois, en commençant par les urgentes puis les importantes et les normales. Tu peux la terminer ou la remettre à plus tard pour passer à la suivante.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#4E5847]">✅ Terminer / archiver</strong>
                  <p className="mt-1">Une tâche terminée quitte la liste active. Tu peux ensuite la retrouver dans l'historique, la réactiver ou la supprimer.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-[#655E54] leading-relaxed">
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#4E5847]">📨 E-mail immédiat</strong>
                  <p className="mt-1">Envoie immédiatement un e-mail de rappel à ton adresse. Pratique pour retrouver la tâche directement dans ta boîte mail, par exemple à ton arrivée au bureau.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#55516A]">⏰ Alarme pop-up</strong>
                  <p className="mt-1">Programme une notification sur ton smartphone. Tu peux choisir un délai « Dans… » ou définir précisément une date et une heure.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#4E5847]">🔄 Relance quotidienne</strong>
                  <p className="mt-1">Répète le rappel tous les jours à l'heure choisie jusqu'à ce que tu le désactives. La relance peut être envoyée par e-mail, par pop-up, ou par les deux.</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#E1D9CE] p-3">
                  <strong className="text-[#67574A]">📅 Agenda / .ics</strong>
                  <p className="mt-1">Associe une date et une heure à la tâche pour l'ajouter à ton calendrier. Google Agenda ouvre un événement prérempli. Le fichier .ics est téléchargé sur ton appareil : tu peux ensuite le conserver ou l'envoyer à quelqu'un pour qu'il l'importe dans son propre calendrier.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SAISIE INTERNE DE L'APPLICATION — remplace les prompts du navigateur */}
      {promptDialog && (
        <div
          className="fixed inset-0 bg-black/35 z-[13200] flex items-center justify-center p-4 backdrop-blur-[2px]"
          onClick={cancelAppPrompt}
        >
          <div
            className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-[#46513F]">{promptDialog.title}</h2>
                {promptDialog.message && (
                  <p className="text-sm leading-relaxed text-[#6A6258] mt-1">{promptDialog.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={cancelAppPrompt}
                className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black flex-shrink-0"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <input
              autoFocus
              type={promptDialog.inputMode === 'numeric' ? 'number' : 'text'}
              inputMode={promptDialog.inputMode === 'numeric' ? 'numeric' : 'text'}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmAppPrompt();
                }
              }}
              placeholder={promptDialog.placeholder || ''}
              className="w-full mt-4 rounded-xl border border-[#D8D0C4] bg-white p-3 text-[#4A463F] font-semibold focus:outline-none focus:ring-2 focus:ring-[#C8D2BC]"
            />

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={cancelAppPrompt}
                className="flex-1 rounded-xl bg-[#EEE8DD] hover:bg-[#E5DED2] text-[#62594E] font-black py-3 px-3 text-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAppPrompt}
                className="flex-1 rounded-xl bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F] font-black py-3 px-3 text-sm"
              >
                {promptDialog.confirmLabel || 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MESSAGE INTERNE DE L'APPLICATION — remplace les alertes natives du navigateur */}
      {appMessage && (
        <div
          className="fixed inset-0 bg-black/35 z-[13100] flex items-center justify-center p-4 backdrop-blur-[2px]"
          onClick={() => setAppMessage(null)}
        >
          <div
            className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-[#46513F]">Information</h2>
                <p className="text-sm leading-relaxed text-[#6A6258] mt-2 whitespace-pre-wrap">{appMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => setAppMessage(null)}
                className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black flex-shrink-0"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAppMessage(null)}
              className="w-full mt-5 rounded-xl bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F] font-black py-3 px-3 text-sm"
            >
              D'accord
            </button>
          </div>
        </div>
      )}

      {/* MODALE DE CONFIRMATION GÉNÉRIQUE */}
      {confirmDialog && (
        <div
          className="fixed inset-0 bg-black/35 z-[13000] flex items-center justify-center p-4 backdrop-blur-[2px]"
          onClick={() => !confirmDialogLoading && setConfirmDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-black text-[#46513F]">{confirmDialog.title}</h2>
                <p className="text-sm leading-relaxed text-[#6A6258] mt-1">{confirmDialog.message}</p>
              </div>
              <button
                type="button"
                onClick={() => !confirmDialogLoading && setConfirmDialog(null)}
                className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black flex-shrink-0"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                disabled={confirmDialogLoading}
                onClick={() => setConfirmDialog(null)}
                className="flex-1 rounded-xl bg-[#EEE8DD] hover:bg-[#E5DED2] text-[#62594E] font-black py-3 px-3 text-sm disabled:opacity-60"
              >
                {confirmDialog.cancelLabel || 'Annuler'}
              </button>
              <button
                type="button"
                disabled={confirmDialogLoading}
                onClick={() => void confirmAppDialog()}
                className={`flex-1 rounded-xl font-black py-3 px-3 text-sm disabled:opacity-60 ${
                  confirmDialog.tone === 'danger'
                    ? 'bg-[#E6C9C1] hover:bg-[#DDB9AE] text-[#7B4E43]'
                    : 'bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F]'
                }`}
              >
                {confirmDialogLoading ? 'Patiente…' : (confirmDialog.confirmLabel || 'Confirmer')}
              </button>
            </div>
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
                          const overlapLayout = previewTaskOverlapLayouts.get(ev.id) || { columnIndex: 0, columnCount: 1 };
                          const columnWidth = 100 / overlapLayout.columnCount;

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
                            <div
                              key={ev.id}
                              className="absolute p-0.5"
                              style={{
                                top: `${topPercent}%`,
                                height: `${heightPercent}%`,
                                left: `calc(${overlapLayout.columnIndex * columnWidth}% + 1px)`,
                                width: `calc(${columnWidth}% - 2px)`,
                              }}
                            >
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setExportPlanningContext({ name: previewTemplate.name, blocks: previewTemplate.blocks || [] });
                  setShowExportHelp(false);
                  setShowExportModal(true);
                }}
                className="w-full bg-[#E1D3C3] hover:bg-[#D7C5B1] text-[#59493B] font-black py-3 rounded-xl transition-colors"
              >
                Exporter
              </button>
              <button onClick={() => editSavedTemplate(previewTemplate)} className="w-full bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F] font-black py-3 rounded-xl transition-colors">
                Éditer le planning
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
              {aiProposal.list_items?.length > 0 && (
                <div className="bg-white border border-purple-200 rounded-lg p-3">
                  <strong className="text-purple-700">Éléments détectés :</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                    {aiProposal.list_items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                  </ul>
                  <p className="text-[11px] text-purple-500 mt-2">Ils seront ajoutés au texte de la tâche.</p>
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

      {/* MODALE : QUITTER L'ÉDITION DU PLANNING */}
      {showClosePlanningModal && (
        <div className="fixed inset-0 bg-black/45 z-[12000] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#FBF9F4] border border-[#DDD5C7] rounded-[26px] shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-black text-[#46513F]">Enregistrer les modifications ?</h2>
              <p className="text-sm text-[#6A6258] font-semibold mt-2">
                {activeTemplateId
                  ? <>Tu as modifié <strong>« {activeTemplateName || 'ce planning'} »</strong>. Veux-tu enregistrer les modifications avant de quitter l&apos;édition ?</>
                  : <>Ce nouveau planning n&apos;est pas encore sauvegardé. Veux-tu l&apos;enregistrer avant de quitter l&apos;édition ?</>}
              </p>
            </div>

            <button
              onClick={() => void saveAndExitPlanning()}
              disabled={loading}
              className="w-full bg-[#C8D2BC] hover:bg-[#BAC7AD] disabled:opacity-60 text-[#35412F] font-black py-3 rounded-xl"
            >
              {loading ? 'Enregistrement…' : '💾 Enregistrer'}
            </button>

            <button
              onClick={() => finishPlanningExit(planningExitTarget)}
              disabled={loading}
              className="w-full bg-[#E9DDD0] hover:bg-[#DFCFBE] disabled:opacity-60 text-[#684F3D] font-black py-3 rounded-xl border border-[#DCCBBC]"
            >
              Ne pas enregistrer
            </button>

            <button
              onClick={cancelPlanningExit}
              disabled={loading}
              className="w-full bg-[#EEE9E0] hover:bg-[#E5DED4] disabled:opacity-60 text-[#665F55] font-bold py-3 rounded-xl"
            >
              Annuler
            </button>
          </div>
        </div>
      )}


      {/* AIDE : À QUOI SERT LE PLANNING */}
      {showPlanningAbout && (
        <div className="fixed inset-0 bg-black/35 z-[12500] flex items-center justify-center p-4 backdrop-blur-[2px]" onClick={() => setShowPlanningAbout(false)}>
          <div className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-black text-[#46513F]">À quoi sert Planning ?</h2>
              <button onClick={() => setShowPlanningAbout(false)} className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black">×</button>
            </div>
            <p className="text-sm leading-relaxed text-[#6A6258]">
              Crée des semaines types, adapte-les rapidement, puis garde-les comme modèles. Tu peux aussi exporter les tâches vers ton calendrier pour transformer un planning type en vraie semaine planifiée.
            </p>
          </div>
        </div>
      )}

      {/* AIDE : GESTES DU PLANNING */}
      {showPlanningGestures && (
        <div className="fixed inset-0 bg-black/35 z-[12500] flex items-center justify-center p-4 backdrop-blur-[2px]" onClick={() => setShowPlanningGestures(false)}>
          <div className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-black text-[#46513F]">Gestes du planning</h2>
              <button onClick={() => setShowPlanningGestures(false)} className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black">×</button>
            </div>
            <div className="space-y-2 text-sm font-semibold text-[#655E54]">
              <p>☝️ <strong>1 doigt :</strong> faire défiler le planning.</p>
              <p>✋ <strong>Appui long :</strong> déplacer une tâche ou un repère.</p>
              <p>↔️ <strong>2 doigts horizontalement :</strong> zoomer sur les jours.</p>
              <p>↕️ <strong>2 doigts verticalement :</strong> zoomer sur les heures.</p>
            </div>
          </div>
        </div>
      )}

      {/* MODALE : EXPORT CALENDRIER */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/35 z-[12500] flex items-center justify-center p-4 backdrop-blur-[2px]" onClick={closeExportModal}>
          <div className="w-full max-w-sm rounded-[28px] bg-[#FBF9F4] border border-[#DDD5C7] shadow-2xl p-5 text-[#4A463F]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-[#46513F]">Exporter le planning</h2>
                <button
                  onClick={() => setShowExportHelp(v => !v)}
                  className="w-6 h-6 rounded-full border border-[#B9B09F] text-[#756C60] text-xs font-black bg-white"
                  aria-label="Différence entre les deux options"
                >?</button>
              </div>
              <button onClick={closeExportModal} className="w-8 h-8 rounded-full bg-[#EAE4D9] text-[#62594E] font-black">×</button>
            </div>

            {showExportHelp && (
              <div className="mb-4 rounded-2xl bg-[#F1ECE3] border border-[#DED5C8] p-3 text-xs leading-relaxed text-[#6D6458]">
                <p><strong>Fichier .ics :</strong> format universel que tu peux conserver, envoyer ou importer plus tard dans Google Agenda, Apple Calendrier ou Outlook.</p>
                <p className="mt-2"><strong>Ajouter au calendrier :</strong> le téléphone tente d'ouvrir directement son menu de partage/import vers une application calendrier. Si le navigateur ne le permet pas, l'app revient automatiquement au fichier .ics.</p>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <button onClick={exportWeeklyICS} className="w-full rounded-2xl bg-[#E1D3C3] hover:bg-[#D7C5B1] text-[#59493B] font-black py-3 px-4 transition-colors text-sm">
                Télécharger le fichier .ics
              </button>
              <button onClick={() => void addWeeklyDirectlyToCalendar()} className="w-full rounded-2xl bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F] font-black py-3 px-4 transition-colors text-sm">
                Ajouter directement au calendrier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= VUE : HUB PRINCIPAL ================= */}
      {mainMode === 'hub' && (
        <div className="relative min-h-[80vh] w-full flex flex-col items-center justify-center animate-fade-in py-8">
          <h1
            className="text-[40px] sm:text-[48px] leading-none text-[#4B5843] text-center mb-10 font-semibold"
            style={{ fontFamily: '"URW Chancery L", "Apple Chancery", "Segoe Script", cursive' }}
          >
            Mes outils
          </h1>

          <div className="w-full max-w-sm flex flex-col gap-3">
            <button
              onClick={() => window.location.hash = 'notes-create'}
              className="w-full bg-[#D8DEC9] hover:bg-[#CCD5BC] text-[#394433] px-5 py-4 rounded-[22px] shadow-[0_5px_18px_rgba(78,88,66,0.10)] transition-all active:scale-[0.98] flex items-center gap-4 text-left border border-[#C8D0B8]"
            >
              <span className="w-11 h-11 rounded-full bg-white/60 flex items-center justify-center text-xl flex-shrink-0">📝</span>
              <span className="flex flex-col min-w-0">
                <span className="text-base font-black">Tâches &amp; Rappels</span>
                <span className="text-xs font-semibold text-[#687260] mt-0.5">Planifier une action et recevoir le bon rappel</span>
              </span>
            </button>

            <button
              onClick={() => window.location.hash = 'planning'}
              className="w-full bg-[#E7D9C9] hover:bg-[#DDCDBA] text-[#58493C] px-5 py-4 rounded-[22px] shadow-[0_5px_18px_rgba(92,74,57,0.09)] transition-all active:scale-[0.98] flex items-center gap-4 text-left border border-[#DAC9B5]"
            >
              <span className="w-11 h-11 rounded-full bg-white/55 flex items-center justify-center text-xl flex-shrink-0">📅</span>
              <span className="flex flex-col min-w-0">
                <span className="text-base font-black">Planning</span>
                <span className="text-xs font-semibold text-[#786858] mt-0.5">Créer et réutiliser tes semaines types</span>
              </span>
            </button>

            <button
              onClick={() => window.location.hash = 'memos'}
              className="w-full bg-[#DFE8E3] hover:bg-[#D2E0D9] text-[#40574E] px-5 py-4 rounded-[22px] shadow-[0_5px_18px_rgba(67,91,81,0.08)] transition-all active:scale-[0.98] flex items-center gap-4 text-left border border-[#C9D8D1]"
            >
              <span className="w-11 h-11 rounded-full bg-white/60 flex items-center justify-center text-xl flex-shrink-0">📌</span>
              <span className="flex flex-col min-w-0">
                <span className="text-base font-black">Notes, Mémos &amp; Listes</span>
                <span className="text-xs font-semibold text-[#687B73] mt-0.5">Conserver tes idées, mémos et listes réutilisables</span>
              </span>
            </button>
          </div>

          {DEMO_MODE && (
            <div className="w-full max-w-sm mt-5 rounded-[22px] border border-[#D7D0C4] bg-[#F7F3EC] px-4 py-3 text-[#625B52] shadow-[0_4px_14px_rgba(78,70,58,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#7B725F]">Mode démonstration</p>
                  <p className="text-[11px] font-semibold text-[#81786C] mt-1">Données fictives uniquement. E-mail, notifications et IA sont désactivés.</p>
                </div>
                <button
                  type="button"
                  disabled={demoResetting}
                  onClick={requestDemoReset}
                  className="flex-shrink-0 rounded-xl bg-[#D8DEC9] hover:bg-[#CCD5BC] text-[#3F4938] px-3 py-2 text-xs font-black border border-[#C8D0B8] disabled:opacity-50"
                >
                  {demoResetting ? 'Patiente…' : '↻ Réinitialiser'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= VUE : NOTES, MÉMOS & LISTES ================= */}
      {mainMode === 'memos' && (
        <DndContext
          sensors={memoDndSensors}
          collisionDetection={memoDndCollisionDetection}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleMemoDndStart}
          onDragMove={handleMemoDndMove}
          onDragOver={handleMemoDndOver}
          onDragEnd={handleMemoDndEnd}
          onDragCancel={handleMemoDndCancel}
        >
        <div className="animate-fade-in text-[#4A463F] w-full max-w-5xl mx-auto">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-5">
            <button
              type="button"
              onClick={() => window.location.hash = 'hub'}
              className="justify-self-start text-[#756E63] hover:text-[#4F4A43] font-bold text-sm"
            >
              ← Menu
            </button>
            <h1
              className="text-[31px] sm:text-[38px] leading-none text-[#4B5843] text-center font-semibold"
              style={{ fontFamily: '"URW Chancery L", "Apple Chancery", "Segoe Script", cursive' }}
            >
              Notes, Mémos &amp; Listes
            </h1>
            <div />
          </div>

          {selectedMemoIds.size > 0 && (
            <div className="fixed left-1/2 -translate-x-1/2 top-[max(10px,env(safe-area-inset-top))] z-[12950] bg-[#EEF1E8]/95 backdrop-blur-md border border-[#C9D1C0] rounded-2xl shadow-[0_8px_28px_rgba(66,76,58,0.22)] px-2 py-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void setSelectedMemosPinned()}
                className="w-11 h-11 rounded-xl bg-white border border-[#D3DACB] text-[#56614E] text-[19px] font-black shadow-sm active:scale-95 flex items-center justify-center"
                aria-label={getSelectedMemos().every(memo => memo.pinned) ? 'Désépingler' : 'Épingler'}
                title={getSelectedMemos().every(memo => memo.pinned) ? 'Désépingler' : 'Épingler'}
              >
                📌
              </button>
              <button
                type="button"
                onClick={() => void setSelectedMemosArchived()}
                className="w-11 h-11 rounded-xl bg-white border border-[#D3DACB] text-[#56614E] text-[19px] font-black shadow-sm active:scale-95 flex items-center justify-center"
                aria-label={showMemoArchived ? 'Restaurer' : 'Archiver'}
                title={showMemoArchived ? 'Restaurer' : 'Archiver'}
              >
                {showMemoArchived ? '↩️' : '📦'}
              </button>
              <button
                type="button"
                onClick={() => void deleteSelectedMemos()}
                className="w-11 h-11 rounded-xl bg-[#F3DEDA] border border-[#DFBBB4] text-[#94554D] text-[19px] font-black shadow-sm active:scale-95 flex items-center justify-center"
                aria-label="Supprimer"
                title="Supprimer"
              >
                🗑️
              </button>
            </div>
          )}

          <div className="bg-[#F7F4ED] border border-[#E0D8CB] rounded-[22px] p-2.5 mb-4 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-50">🔎</span>
                <input
                  type="text"
                  value={memoSearch}
                  onChange={(e) => setMemoSearch(e.target.value)}
                  placeholder="Rechercher dans Notes, Mémos & Listes"
                  className="w-full bg-white border border-[#DED5C8] rounded-full pl-9 pr-3 py-2.5 text-sm font-semibold text-[#4A463F] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C8D2BC]"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowMemoArchived(prev => !prev)}
                className={`flex-shrink-0 h-10 px-3 rounded-xl text-xs font-black border transition-colors ${showMemoArchived ? 'bg-[#E2D6C7] text-[#59493B] border-[#D7C7B5]' : 'bg-white text-[#6A6258] border-[#DED5C8] hover:bg-[#F1ECE3]'}`}
              >
                {showMemoArchived ? '↩ Actifs' : '📦 Archives'}
              </button>
            </div>
          </div>

          {!showMemoArchived && (
            <div className="flex items-center justify-center mb-3 h-12">
              <button
                type="button"
                onClick={() => openNewMemo('text')}
                className={`w-12 h-12 rounded-full bg-[#D8DEC9] hover:bg-[#CCD5BC] text-[#394433] border border-[#C8D0B8] text-[27px] leading-none font-light shadow-[0_4px_14px_rgba(78,88,66,0.14)] active:scale-[0.94] transition-[transform,opacity] flex items-center justify-center ${selectedMemoIds.size > 0 ? 'invisible pointer-events-none' : ''}`}
                aria-label="Créer une note, une liste ou un dessin"
                title="Créer"
              >
                ＋
              </button>
            </div>
          )}

          {visibleMemos.length === 0 ? (
            <div className="rounded-[26px] border-2 border-dashed border-[#D8D0C4] bg-[#FBFAF7] py-14 px-5 text-center text-[#7B7368]">
              <div className="text-4xl mb-3">{showMemoArchived ? '📦' : '🗒️'}</div>
              <p className="font-black text-sm">{memoSearch ? 'Aucun résultat' : showMemoArchived ? 'Aucune note archivée' : 'Aucun mémo pour le moment'}</p>
              {!memoSearch && !showMemoArchived && <p className="text-xs font-semibold mt-1">Crée une note, un mémo ou une liste que tu pourras garder et réutiliser.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-7">
              {pinnedMemos.length > 0 && (
                <section>
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#82796C] mb-2 px-1">Épinglés</div>
                  <div
                    data-memo-drop-zone={`${showMemoArchived ? 'archived' : 'active'}-pinned`}
                    className="flex items-start gap-[10px]"
                  >
                    {pinnedMemoColumns.map((column, columnIndex) => (
                      <div key={`pinned-column-${columnIndex}`} className="flex-1 min-w-0 flex flex-col gap-[10px]">
                        {column.map(renderMemoCard)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {otherMemos.length > 0 && (
                <section>
                  {pinnedMemos.length > 0 && <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#82796C] mb-2 px-1">Autres</div>}
                  <div
                    data-memo-drop-zone={`${showMemoArchived ? 'archived' : 'active'}-other`}
                    className="flex items-start gap-[10px]"
                  >
                    {otherMemoColumns.map((column, columnIndex) => (
                      <div key={`other-column-${columnIndex}`} className="flex-1 min-w-0 flex flex-col gap-[10px]">
                        {column.map(renderMemoCard)}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <MemoTrashDroppable
            active={!!draggingMemoId && memoDndMoved && selectedMemoIds.size === 0}
            hovering={memoTrashHover}
          />

          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
            {draggingMemoId && memoDndMoved && (() => {
              const memo = memoEntries.find(item => item.id === draggingMemoId);
              if (!memo) return null;
              return (
                <div className={`pointer-events-none rounded-[18px] border p-3 shadow-2xl scale-[1.025] ${memoColorClasses(memo.color)}`} style={{ width: 'min(46vw, 380px)' }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {memo.title && <h3 className="font-black text-[14px] leading-tight whitespace-pre-wrap break-words">{memo.title}</h3>}
                      {memo.content && <p className="text-[12px] mt-1.5 whitespace-pre-wrap leading-[1.35] opacity-85 break-words line-clamp-6">{memo.content}</p>}
                    </div>
                    {memo.pinned && <span className="text-xs flex-shrink-0">📌</span>}
                  </div>
                  {memo.memo_type === 'list' && memo.items.length > 0 && (
                    <div className="mt-2.5 flex flex-col gap-1">
                      {memo.items.slice(0, 6).map(item => (
                        <div key={item.id} className="flex items-start gap-1.5 text-[11px] font-semibold leading-tight">
                          <span className="mt-[-1px] flex-shrink-0 opacity-70">{item.completed ? '☑' : '☐'}</span>
                          <span className={`break-words ${item.completed ? 'line-through opacity-45' : ''}`}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={`absolute left-1/2 -translate-x-1/2 -bottom-7 whitespace-nowrap rounded-full text-white px-2.5 py-1 text-[9px] font-black shadow-lg ${memoTrashHover ? 'bg-[#B85D55]' : 'bg-[#4B5843]'}`}>
                    {memoTrashHover ? 'Relâche pour supprimer' : 'Relâche pour placer'}
                  </div>
                </div>
              );
            })()}
          </DragOverlay>

          {memoEditorOpen && (
            <div
              className="fixed inset-0 z-[12600] bg-black/35 backdrop-blur-[2px] flex items-center justify-center p-4"
              onClick={() => closeMemoEditor(true)}
            >
              <div
                className={`w-full max-w-lg rounded-[28px] border shadow-2xl p-5 max-h-[90vh] overflow-y-auto ${memoColorClasses(memoDraftColor)}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMemoDraftType('text')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black border ${memoDraftType === 'text' ? 'bg-white/75 border-black/10' : 'bg-white/30 border-transparent'}`}
                    >📝 Note</button>
                    <button
                      type="button"
                      onClick={() => setMemoDraftType('list')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black border ${memoDraftType === 'list' ? 'bg-white/75 border-black/10' : 'bg-white/30 border-transparent'}`}
                    >☑ Liste</button>
                    <button
                      type="button"
                      onClick={() => showAppMessage('DrawNote arrive à l’étape suivante.')}
                      className="px-3 py-1.5 rounded-xl text-xs font-black border bg-white/30 border-transparent hover:bg-white/55"
                      title="DrawNote sera ajouté à l'étape suivante"
                    >✏️ DrawNote</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => closeMemoEditor(true)}
                    className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/85 font-black"
                  >×</button>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={memoDraftTitle}
                    onChange={(e) => setMemoDraftTitle(e.target.value)}
                    placeholder="Titre"
                    className="w-full bg-white/70 border border-black/10 rounded-xl pl-3 pr-14 py-2.5 text-lg font-black text-inherit placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleDictation('memo_title')}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-base shadow-sm transition-all ${listeningMode === 'memo_title' ? 'bg-red-500 text-white animate-pulse scale-105' : 'bg-white/70 text-[#6F685E] hover:bg-white'}`}
                    aria-label="Dicter le titre"
                  >🎙️</button>
                </div>

                {memoDraftType === 'text' ? (
                  <div className="relative mt-2">
                    <textarea
                      value={memoDraftContent}
                      onChange={(e) => setMemoDraftContent(e.target.value)}
                      placeholder="Écris ton mémo ici..."
                      className="w-full min-h-[190px] bg-white/55 border border-black/10 rounded-xl p-3 pr-14 text-sm font-semibold text-inherit resize-y placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleDictation('memo_content')}
                      className={`absolute right-2 top-2 w-9 h-9 rounded-full flex items-center justify-center text-base shadow-sm transition-all ${listeningMode === 'memo_content' ? 'bg-red-500 text-white animate-pulse scale-105' : 'bg-white/70 text-[#6F685E] hover:bg-white'}`}
                      aria-label="Dicter le contenu"
                    >🎙️</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {memoDraftItems.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-2 bg-white/50 rounded-xl p-2 border border-black/5">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={() => setMemoDraftItems(prev => prev.map(current => current.id === item.id ? { ...current, completed: !current.completed } : current))}
                          className="accent-[#829076]"
                        />
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => setMemoDraftItems(prev => prev.map(current => current.id === item.id ? { ...current, text: e.target.value } : current))}
                          className={`flex-1 bg-transparent border-none outline-none text-sm font-semibold ${item.completed ? 'line-through opacity-55' : ''}`}
                        />
                        <button type="button" onClick={() => setMemoDraftItems(prev => prev.filter((_, i) => i !== index))} className="w-7 h-7 rounded-full hover:bg-white/70 text-[#875E55] font-black">×</button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={memoNewItem}
                          onChange={(e) => setMemoNewItem(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemoDraftItem(); } }}
                          placeholder="Ajouter un élément..."
                          className="w-full bg-white/65 border border-black/10 rounded-xl pl-3 pr-12 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-black/10"
                        />
                        <button
                          type="button"
                          onClick={() => toggleDictation('memo_item')}
                          className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm transition-all ${listeningMode === 'memo_item' ? 'bg-red-500 text-white animate-pulse' : 'bg-white/70 text-[#6F685E] hover:bg-white'}`}
                          aria-label="Dicter un élément de liste"
                        >🎙️</button>
                      </div>
                      <button type="button" onClick={addMemoDraftItem} className="w-10 h-10 rounded-xl bg-white/70 hover:bg-white text-lg font-black">＋</button>
                    </div>
                    <textarea
                      value={memoDraftContent}
                      onChange={(e) => setMemoDraftContent(e.target.value)}
                      placeholder="Note complémentaire (optionnel)"
                      className="w-full min-h-[80px] bg-white/45 border border-black/10 rounded-xl p-3 text-xs font-semibold resize-y placeholder:text-black/30 focus:outline-none"
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setMemoDraftPinned(prev => !prev)}
                    aria-pressed={memoDraftPinned}
                    aria-label={memoDraftPinned ? 'Désépingler la note' : 'Épingler la note'}
                    title={memoDraftPinned ? 'Désépingler' : 'Épingler'}
                    className={`w-10 h-10 rounded-xl text-lg font-black border flex items-center justify-center transition-all active:scale-95 ${memoDraftPinned ? 'bg-[#819076] text-white border-[#74836A] shadow-sm' : 'bg-white/35 border-black/5 hover:bg-white/65'}`}
                  >📌</button>

                  <div className="flex items-center gap-1.5">
                    {(['sage', 'sand', 'rose', 'blue', 'lavender', 'white'] as MemoColor[]).map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setMemoDraftColor(color)}
                        aria-label={`Couleur ${color}`}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${memoColorClasses(color).split(' ').slice(0,2).join(' ')} ${memoDraftColor === color ? 'scale-110 ring-2 ring-black/20 ring-offset-1' : 'opacity-80'}`}
                      />
                    ))}
                  </div>
                </div>

                {editingMemoId && (() => {
                  const originalMemo = memoEntries.find(memo => memo.id === editingMemoId);
                  if (!originalMemo) return null;
                  return (
                    <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
                      <button
                        type="button"
                        onClick={() => { closeMemoEditor(true); transferMemoToTasks(originalMemo); }}
                        className="min-w-0 py-2.5 px-3 rounded-xl bg-white/55 hover:bg-white/80 border border-black/10 text-[11px] font-black truncate"
                      >
                        → Envoyer vers Tâches &amp; Rappels
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          closeMemoEditor(true);
                          await updateMemo(originalMemo.id, { archived: !originalMemo.archived });
                        }}
                        className="w-10 h-10 rounded-xl bg-white/55 hover:bg-white/80 border border-black/10 text-sm font-black"
                        title={originalMemo.archived ? 'Désarchiver' : 'Archiver'}
                      >{originalMemo.archived ? '↩' : '📦'}</button>
                      <button
                        type="button"
                        onClick={() => { closeMemoEditor(true); deleteMemo(originalMemo); }}
                        className="w-10 h-10 rounded-xl bg-white/55 hover:bg-[#F0DDD7] border border-black/10 text-sm font-black"
                        title="Supprimer"
                      >🗑</button>
                    </div>
                  );
                })()}

                <div className="flex gap-2 mt-5">
                  <button
                    type="button"
                    onClick={() => closeMemoEditor(true)}
                    className="flex-1 py-3 rounded-xl bg-white/45 hover:bg-white/70 border border-black/10 text-xs font-black"
                  >Annuler</button>
                  <button
                    type="button"
                    onClick={() => void saveMemo()}
                    disabled={loading}
                    className="flex-1 py-3 rounded-xl bg-[#819076] hover:bg-[#74836A] text-white text-xs font-black shadow-sm disabled:opacity-50"
                  >{loading ? 'Enregistrement…' : editingMemoId ? 'Enregistrer' : 'Créer'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
        </DndContext>
      )}

      {/* ================= VUE : ACCUEIL PLANNING ================= */}
      {mainMode === 'planning_home' && (
        <div className="relative min-h-[78vh] w-full flex flex-col items-center animate-fade-in pt-4 sm:pt-8">
          <div className="w-full max-w-xl flex items-center justify-between mb-6">
            <button
              onClick={() => window.location.hash = 'hub'}
              className="text-[#756E63] hover:text-[#4F4A43] font-bold text-sm flex items-center gap-2 transition-colors"
            >
              ← Menu Principal
            </button>
            <button
              onClick={() => setShowPlanningAbout(true)}
              className="w-8 h-8 rounded-full bg-[#EEE8DD] hover:bg-[#E5DED2] border border-[#D9D0C2] text-[#71695E] font-black shadow-sm transition-colors"
              aria-label="À quoi sert l'application Planning ?"
            >?</button>
          </div>

          <h1
            className="text-[42px] sm:text-[48px] leading-none text-[#4B5843] text-center mb-10 font-semibold"
            style={{ fontFamily: '"URW Chancery L", "Apple Chancery", "Segoe Script", cursive' }}
          >
            Planning
          </h1>

          <div className="w-full max-w-sm flex flex-col gap-3">
            <button
              onClick={startNewPlanning}
              className="w-full bg-[#D8DEC9] hover:bg-[#CCD5BC] text-[#394433] px-5 py-4 rounded-[22px] shadow-[0_5px_18px_rgba(78,88,66,0.10)] transition-all active:scale-[0.98] flex items-center gap-4 text-left border border-[#C8D0B8]"
            >
              <span className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center text-xl flex-shrink-0">＋</span>
              <span className="flex flex-col min-w-0">
                <span className="text-base font-black">Nouveau planning</span>
                <span className="text-xs font-semibold text-[#687260] mt-0.5">Commencer une semaine vide</span>
              </span>
            </button>

            <button
              onClick={() => navigatePlanningChild('#planning-gallery')}
              className="w-full bg-[#E7D9C9] hover:bg-[#DDCDBA] text-[#58493C] px-5 py-4 rounded-[22px] shadow-[0_5px_18px_rgba(92,74,57,0.09)] transition-all active:scale-[0.98] flex items-center gap-4 text-left border border-[#DAC9B5]"
            >
              <span className="w-10 h-10 rounded-full bg-white/55 flex items-center justify-center text-lg flex-shrink-0">▤</span>
              <span className="flex flex-col min-w-0">
                <span className="text-base font-black">Plannings sauvegardés</span>
                <span className="text-xs font-semibold text-[#786858] mt-0.5">{savedTemplates.length} planning{savedTemplates.length > 1 ? 's' : ''}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ================= NOUVELLE VUE : GALERIE DES PLANNINGS ================= */}
      {mainMode === 'planning_gallery' && (
        <div className="flex flex-col gap-4 animate-fade-in w-full">
           <div className="grid grid-cols-[1fr_auto_1fr] items-center mb-3 gap-2">
             <button onClick={navigatePlanningHome} className="justify-self-start text-[#756E63] hover:text-[#4F4A43] font-bold text-sm flex items-center gap-2 transition-colors">← Accueil</button>
             <h1 className="text-2xl font-black text-[#4B5843] text-center">Mes plannings</h1>
             <div />
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
                   className="bg-[#FBFAF7] rounded-2xl shadow-sm border border-[#DED7CC] overflow-hidden flex flex-col transition-transform hover:shadow-md cursor-grab active:cursor-grabbing"
                   draggable={true}
                   onDragStart={(e) => handleDragStart(e, index)}
                   onDragOver={(e) => e.preventDefault()}
                   onDrop={(e) => handleDrop(e, index)}
                 >
                   {/* En-tête de la carte */}
                   <div className="bg-[#D8DEC9] text-[#394433] px-3 py-2.5 flex justify-between items-center gap-2">
                     <div className="min-w-0 flex items-center gap-2">
                       <button
                         type="button"
                         draggable={false}
                         onPointerDown={(e) => e.stopPropagation()}
                         onClick={(e) => { e.stopPropagation(); void renameSavedTemplate(tmpl); }}
                         className="font-bold text-sm truncate text-left hover:underline decoration-dotted underline-offset-2"
                         title="Cliquer pour renommer ce planning"
                       >
                         {tmpl.name}
                       </button>
                     </div>
                     <span className="text-[#7B856F] cursor-grab px-1">⣿</span>
                   </div>

                   {/* La miniature EST l'aperçu : un toucher l'ouvre en grand. */}
                   <button
                     type="button"
                     draggable={false}
                     onPointerDown={(e) => e.stopPropagation()}
                     onClick={(e) => { e.stopPropagation(); setPreviewTemplate(tmpl); }}
                     className="h-32 bg-gray-50 w-full relative flex border-b border-gray-200 p-1 cursor-pointer hover:bg-[#F7F4ED] transition-colors text-left"
                     aria-label={`Ouvrir l'aperçu de ${tmpl.name}`}
                   >
                     {WEEK_DAYS.map((dayName, dIdx) => (
                       <div key={dIdx} className="flex-1 border-r border-gray-200/50 last:border-0 relative h-full pointer-events-none">
                         {tmpl.blocks?.filter((b: any) => b.day === dayName).map((ev: any) => {
                           const topPercent = ((ev.startHour - PLANNING_START_HOUR) + (ev.startMinute || 0) / 60) / hoursOfDay.length * 100;
                           const colorClass = ev.color === 'blue' ? 'bg-blue-500' : ev.color === 'green' ? 'bg-green-500' : ev.color === 'red' ? 'bg-red-500' : 'bg-gray-500';
                           const overlapLayout = savedTemplateOverlapLayouts.get(tmpl.id)?.get(ev.id) || { columnIndex: 0, columnCount: 1 };
                           const columnWidth = 100 / overlapLayout.columnCount;

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
                               className={`absolute rounded-[2px] opacity-80 ${colorClass}`}
                               style={{
                                 top: `${topPercent}%`,
                                 height: `${heightPercent}%`,
                                 left: `calc(${overlapLayout.columnIndex * columnWidth}% + 1px)`,
                                 width: `calc(${columnWidth}% - 2px)`,
                               }}
                             />
                           );
                         })}
                       </div>
                     ))}
                   </button>

                   {/* Actions secondaires : l'ouverture et l'édition passent par la miniature. */}
                   <div className="p-2 flex items-center justify-end gap-1.5 bg-[#F4F0E9]">
                     <button onClick={() => duplicateSavedTemplate(tmpl)} className="px-2.5 py-1.5 bg-[#E2D6C7] hover:bg-[#D7C7B5] text-[#59493B] font-black text-[10px] rounded-lg transition-colors" aria-label="Dupliquer" title="Dupliquer">⧉</button>
                     <button onClick={() => deleteSavedTemplate(tmpl.id)} className="px-2.5 py-1.5 bg-[#F0DDD7] hover:bg-[#E8CEC6] text-[#885C50] font-black text-[10px] rounded-lg transition-colors" aria-label="Supprimer" title="Supprimer">🗑</button>
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
           <div className="grid grid-cols-[1fr_auto_1fr] items-start mb-1 gap-2">
             <button onClick={() => requestPlanningExit('home')} className="justify-self-start text-[#756E63] hover:text-[#4F4A43] font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors pt-1.5">✕ Fermer</button>
             <div className="text-center min-w-0">
               <h1 className="text-xl font-black text-[#4B5843]">Ma semaine</h1>
               {activeTemplateId && (
                 <p className={`text-[10px] font-bold truncate ${isPlanningDirty ? 'text-[#A4764F]' : 'text-[#718064]'}`}>
                   {activeTemplateName}{isPlanningDirty ? ' · modifié' : ''}
                 </p>
               )}
             </div>
             <button
               onClick={() => setShowPlanningGestures(true)}
               className="justify-self-end w-8 h-8 rounded-full bg-[#EEE8DD] hover:bg-[#E5DED2] border border-[#D9D0C2] text-[#71695E] font-black shadow-sm"
               aria-label="Aide sur les gestes du planning"
             >?</button>
           </div>

           {/* Barre d'actions compacte */}
           <div className="bg-[#F7F4ED] px-2.5 py-2.5 rounded-2xl border border-[#E0D8CB] shadow-sm">
             <div className="flex items-stretch gap-2">
               <button
                 onClick={saveTemplateToDB}
                 disabled={Boolean(activeTemplateId) && !isPlanningDirty}
                 className={`flex-1 min-w-0 font-black py-2.5 px-2 rounded-xl text-[11px] sm:text-xs transition-colors ${
                   activeTemplateId && !isPlanningDirty
                     ? 'bg-[#E2E7D9] text-[#718064] cursor-default'
                     : 'bg-[#C8D2BC] text-[#35412F] hover:bg-[#BAC7AD]'
                 }`}
               >
                 Sauvegarder le planning
               </button>

               <button
                 onClick={() => requestPlanningExit('gallery')}
                 className="flex-1 min-w-0 bg-[#E2D6C7] hover:bg-[#D7C7B5] text-[#59493B] font-black py-2.5 px-2 rounded-xl text-[11px] sm:text-xs transition-colors"
               >
                 Plannings sauvegardés
               </button>

               <button
                 onClick={() => { setExportPlanningContext(null); setShowExportHelp(false); setShowExportModal(true); }}
                 className="flex-shrink-0 bg-[#DCE2D2] hover:bg-[#CFD8C3] text-[#4A5741] font-black py-2.5 px-3 rounded-xl text-[11px] sm:text-xs transition-colors"
                 aria-label="Exporter vers un calendrier"
               >
                 Exporter
               </button>
             </div>
           </div>

           {/* Nouveau planning, volontairement séparé des actions du planning courant */}
           <div className="flex justify-center -mt-1 mb-1">
             <button
               onClick={startNewPlanning}
               className="w-10 h-10 rounded-full bg-[#ECE5DA] hover:bg-[#E2D8CA] border border-[#D8CDBE] text-[#64594D] text-xl font-light shadow-sm transition-transform active:scale-95"
               title="Nouveau planning"
               aria-label="Créer un nouveau planning"
             >＋</button>
           </div>

           {/* LIGNE DES JOURS FIGÉE : reste visible pendant le scroll vertical, façon Excel */}
           <div className="sticky top-0 z-[200] h-10 flex w-full bg-[#FBFAF7] rounded-t-2xl border border-[#E0D8CB] shadow-sm overflow-hidden">
             {/* Coin au-dessus de la colonne des heures */}
             <div className="flex-shrink-0 w-12 h-10 bg-[#F4F0E9] border-r border-[#E0D8CB]"></div>

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
                     className="flex-1 min-w-0 h-10 flex items-center justify-center border-r border-[#E0D8CB] last:border-r-0 bg-[#FBFAF7] overflow-hidden"
                   >
                     <span className="font-black text-[#4B5843] whitespace-nowrap px-1 leading-none" style={{ fontSize: `${dayHeaderFontSize}px` }}>{dayName}</span>
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
             className="bg-white rounded-2xl shadow-sm border border-[#E0D8CB] overflow-hidden relative flex w-full" 
             style={{ height: `${hoursOfDay.length * hourHeight + PLANNING_HEADER_HEIGHT}px`, touchAction: 'pan-x pan-y' }}
           >
             
             {/* Colonne des heures (Fixée à gauche) */}
             <div className="flex-shrink-0 z-20 flex flex-col w-12 bg-[#F7F4ED] border-r border-[#E0D8CB] shadow-[2px_0_5px_rgba(0,0,0,0.04)] pointer-events-none">
               <div className="h-10 border-b border-[#E0D8CB] bg-[#F7F4ED] sticky top-0 z-30" style={{ flexShrink: 0 }}></div> {/* Coin vide */}
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
                   
                   {/* Espace d'alignement sous l'en-tête sticky. Le nom du jour n'est affiché qu'une seule fois, dans la barre figée au-dessus. */}
                   <div className="h-10 border-b border-[#E8E3DA] bg-white" style={{ flexShrink: 0 }} aria-hidden="true" />

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
                     const overlapLayout = planningTaskOverlapLayouts.get(ev.id) || { columnIndex: 0, columnCount: 1 };
                     const taskColumnWidth = 100 / overlapLayout.columnCount;
                     // Évite que la bulle soit rognée sous la colonne des heures ou hors du bord droit.
                     const popoverHorizontalClass =
                       dayName === 'Lundi' || dayName === 'Mardi'
                         ? 'left-0 translate-x-0'
                         : dayName === 'Samedi' || dayName === 'Dimanche'
                           ? 'right-0 left-auto translate-x-0'
                           : 'left-1/2 -translate-x-1/2';

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
                             } ${isSelected ? 'ring-2 ring-black ring-offset-1' : ''} ${isDragging ? 'opacity-30' : ''}`}
                           />

                           {isSelected && (
                             <div
                               data-block-drag-ignore="true"
                               className={`absolute ${popoverHorizontalClass} w-[190px] max-w-[85vw] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] border-2 border-gray-800 p-3 flex flex-col gap-2 z-[1000] cursor-default`}
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
                         className={`absolute p-0.5 ${isDragging ? 'z-[850]' : isSelected ? 'z-[400]' : 'z-10'}`}
                         style={{
                           top: `${topPx + PLANNING_HEADER_HEIGHT}px`,
                           height: `${heightPx}px`,
                           left: `calc(${overlapLayout.columnIndex * taskColumnWidth}% + 2px)`,
                           width: `calc(${taskColumnWidth}% - 4px)`,
                         }} 
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
                           className={`relative h-full w-full rounded-lg shadow-sm border transition-all cursor-pointer select-none ${ev.color === 'blue' ? 'bg-blue-100 border-blue-300 text-blue-900' : ev.color === 'green' ? 'bg-green-100 border-green-300 text-green-900' : ev.color === 'red' ? 'bg-red-100 border-red-300 text-red-900' : 'bg-gray-100 border-gray-300 text-gray-900'} ${isSelected ? 'ring-2 ring-black shadow-md' : 'overflow-hidden'} ${isDragging ? 'opacity-30 cursor-grabbing' : ''}`}
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
                               className={`absolute ${popoverHorizontalClass} w-[180px] max-w-[85vw] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] border-2 border-gray-800 p-3 flex flex-col gap-2 z-[1000] cursor-default`}
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

           {draggingBlockId && draggingBlockGhostMeta && (
             <div
               ref={draggingBlockGhostRef}
               className="fixed left-0 top-0 z-[21000] pointer-events-none will-change-transform"
               style={{ transform: 'translate3d(-9999px, -9999px, 0)' }}
             >
               {draggingBlockGhostMeta.kind === 'marker' ? (
                 <div className={`w-36 h-[6px] rounded-full shadow-xl ${
                   draggingBlockGhostMeta.color === 'blue' ? 'bg-blue-500' :
                   draggingBlockGhostMeta.color === 'green' ? 'bg-green-500' :
                   draggingBlockGhostMeta.color === 'red' ? 'bg-red-500' : 'bg-gray-500'
                 }`} />
               ) : (
                 <div className={`min-w-[120px] max-w-[190px] rounded-xl border-2 shadow-2xl px-3 py-2 font-black text-xs ${
                   draggingBlockGhostMeta.color === 'blue' ? 'bg-blue-100 border-blue-400 text-blue-900' :
                   draggingBlockGhostMeta.color === 'green' ? 'bg-green-100 border-green-400 text-green-900' :
                   draggingBlockGhostMeta.color === 'red' ? 'bg-red-100 border-red-400 text-red-900' : 'bg-gray-100 border-gray-400 text-gray-900'
                 }`}>
                   {draggingBlockGhostMeta.title || 'Tâche'}
                 </div>
               )}
             </div>
           )}

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

                 {blockKind === 'task' && (
                   <div className="rounded-xl border border-[#DDD5C9] bg-[#F8F5EF] p-3">
                     <div className="text-xs font-black text-[#625A50] mb-2">Durée de la tâche</div>
                     <div className="flex items-center gap-2">
                       <input
                         type="number"
                         min={0}
                         max={16}
                         inputMode="numeric"
                         value={blockDurationHours}
                         onFocus={(e) => e.currentTarget.select()}
                         onClick={(e) => e.currentTarget.select()}
                         onChange={(e) => setBlockDurationHours(Math.max(0, Math.min(16, Number(e.target.value) || 0)))}
                         className="w-20 border border-[#D8D0C4] p-2 rounded-lg text-black font-semibold bg-white text-center"
                         aria-label="Durée en heures"
                       />
                       <span className="text-sm font-bold text-[#756D62]">h</span>
                       <input
                         type="number"
                         min={0}
                         max={59}
                         inputMode="numeric"
                         value={blockDurationMinutes}
                         onFocus={(e) => e.currentTarget.select()}
                         onClick={(e) => e.currentTarget.select()}
                         onChange={(e) => setBlockDurationMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                         className="w-20 border border-[#D8D0C4] p-2 rounded-lg text-black font-semibold bg-white text-center"
                         aria-label="Durée en minutes"
                       />
                       <span className="text-sm font-bold text-[#756D62]">min</span>
                     </div>
                   </div>
                 )}

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

      {/* ================= VUE : TÂCHES ET RAPPELS ================= */}
      {mainMode === 'notes' && (
        <div
          className="animate-fade-in text-[#4A463F]"
          onTouchStart={handleNotesSwipeStart}
          onTouchEnd={handleNotesSwipeEnd}
        >
          <div className="relative mb-5">
            {!isFocusMode ? (
              <>
                <button onClick={navigateNotesHub} className="absolute left-0 top-1 text-[#756E63] hover:text-[#4F4A43] font-bold text-sm flex items-center gap-2 transition-colors">← Menu</button>
                <h1
                  className="text-[34px] sm:text-[40px] leading-none text-[#4B5843] text-center font-semibold px-14"
                  style={{ fontFamily: '"URW Chancery L", "Apple Chancery", "Segoe Script", cursive' }}
                >
                  Tâches &amp; Rappels
                </h1>
              </>
            ) : (
              <div className="flex flex-col items-center">
                <h1 className="text-2xl font-black text-[#4B5843]">Mode Focus 🎯</h1>
                <span className="text-xs font-bold text-[#756E63] mt-1">Une seule tâche à la fois.</span>
              </div>
            )}

            <div className="flex justify-end mt-3">
              <button
                onClick={() => {
                  setSkippedFocusIds([]);
                  setShowArchived(false);
                  setFocusPhase('rouge');
                  if (isFocusMode) navigateNotesChild('#notes-list');
                  else navigateNotesChild('#notes-focus');
                }}
                className="min-w-[132px] h-14 px-5 rounded-2xl text-sm font-black shadow-md transition-all whitespace-nowrap bg-[#D8DEC9] hover:bg-[#CCD5BC] text-[#394433] border border-[#C8D0B8] flex items-center justify-center active:scale-95"
              >
                {isFocusMode ? 'Quitter Focus' : '🎯 Focus'}
              </button>
            </div>
          </div>

          {!isFocusMode && (
            <div className="flex bg-[#EEE8DD] rounded-2xl p-1 mb-6 w-full max-w-md mx-auto border border-[#DED5C8]">
              <button type="button" onClick={navigateNotesCreate} className={`flex-1 py-2.5 text-sm font-black rounded-xl transition-all ${activeTab === 'create' ? 'bg-[#D8DEC9] text-[#394433] shadow-sm' : 'text-[#756E63] hover:text-[#4F4A43]'}`}>✍️ Créer</button>
              <button type="button" onClick={() => navigateNotesChild('#notes-list')} className={`flex-1 py-2.5 text-sm font-black rounded-xl transition-all ${activeTab === 'notes' ? 'bg-[#D8DEC9] text-[#394433] shadow-sm' : 'text-[#756E63] hover:text-[#4F4A43]'}`}>📑 Tâches</button>
            </div>
          )}

          {!isPushEnabled && (
            <div className="bg-[#EDF1E7] border border-[#CCD5BC] p-3 rounded-2xl mb-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2"><span className="text-xl">🔔</span><p className="text-[#4B5843] text-xs font-semibold">Active les alertes en arrière-plan.</p></div>
              <button onClick={subscribeToPush} className="bg-[#C8D2BC] hover:bg-[#BAC7AD] text-[#35412F] font-black py-1.5 px-3 rounded-lg text-sm whitespace-nowrap transition-colors">Activer</button>
            </div>
          )}

          {activeTab === 'create' && !isFocusMode && (
            <form onSubmit={addNote} className="flex flex-col gap-2 mb-6 p-4 rounded-[24px] border bg-[#FBFAF7] border-[#DED7CC] shadow-[0_6px_24px_rgba(89,73,59,0.06)]">
              <div className="flex flex-col gap-2">
                <div className="relative flex items-center w-full">
                  <input type="text" value={newTitle} onFocus={() => setShowAdvancedSettings(false)} onChange={(e) => setNewTitle(e.target.value)} placeholder="Titre (optionnel)" className="w-full border border-[#D8D0C4] p-3 pr-16 rounded-xl text-[#4A463F] font-semibold text-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C8D2BC]" disabled={loading || isAiProcessing} />
                  <button type="button" onClick={() => toggleDictation('title')} className={`absolute right-2 p-3 text-xl rounded-full shadow-md transition-all ${listeningMode === 'title' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                </div>
                <div className="relative w-full">
                  <textarea value={newContent} onFocus={() => setShowAdvancedSettings(false)} onChange={(e) => setNewContent(e.target.value)} placeholder="Décris ta tâche ou ton rappel ici..." className="w-full border border-[#D8D0C4] p-3 pr-16 rounded-xl text-[#4A463F] resize-y min-h-[120px] text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#C8D2BC]" disabled={loading || isAiProcessing} />
                  <button type="button" onClick={() => toggleDictation('content')} className={`absolute top-2 right-2 p-3 text-xl rounded-full shadow-md transition-all ${listeningMode === 'content' ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>🎙️</button>
                </div>
              </div>

              <div className="flex items-center w-full mt-1">
                <select value={importance} onChange={(e) => setImportance(e.target.value as any)} disabled={isAiProcessing} className="w-full border border-[#D8D0C4] p-2.5 rounded-xl text-[#4A463F] bg-white cursor-pointer text-sm font-bold">
                  <option value="vert">🟢 Priorité Normale</option>
                  <option value="orange">🟠 Priorité Importante</option>
                  <option value="rouge">🔴 Priorité Urgente</option>
                </select>
              </div>

              <div className="border-b border-gray-200 pb-3 mt-1">
                <button type="button" onClick={() => toggleDictation('ai')} disabled={(listeningMode !== 'none' && listeningMode !== 'ai') || isAiProcessing} className={`w-full py-3 px-3 text-sm rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-md ${isAiProcessing ? 'bg-[#8E8796] text-white animate-pulse' : listeningMode === 'ai' ? 'bg-[#8E8796] text-white animate-pulse scale-[1.02]' : 'bg-[#ECE8EF] text-[#5F5867] border border-[#D8D1DE] hover:bg-[#E3DDE8]'}`}>
                  <span className="text-xl">🤖</span> {isAiProcessing ? 'L\'IA réfléchit...' : listeningMode === 'ai' ? 'Cliquer pour arrêter l\'analyse' : 'Dictée intelligente (IA tout-en-un)'}
                </button>
              </div>

              <div className="flex flex-col mt-2">
                <button type="button" onClick={() => setShowAdvancedSettings(!showAdvancedSettings)} className="w-full bg-[#EEE8DD] text-[#5F584F] hover:bg-[#E5DED2] font-black py-2.5 px-3 rounded-xl text-sm flex justify-between items-center transition-colors border border-[#DED5C8]">
                  <span>⚙️ Paramétrage des rappels</span><span>{showAdvancedSettings ? '▲' : '▼'}</span>
                </button>
                {showAdvancedSettings && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 p-3 bg-[#F6F2EB] rounded-xl border border-[#E1D9CE]">
                    <button
                      type="button"
                      onClick={() => DEMO_MODE ? demoFeatureUnavailable('L’envoi d’e-mail') : setSendImmediateEmail(!sendImmediateEmail)}
                      disabled={isAiProcessing}
                      className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex items-center justify-between ${sendImmediateEmail ? 'bg-[#D9E2CF] text-[#3D4B37] border-[#BECBB1]' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                    >
                      <span>📨 E-mail immédiat</span><span>{sendImmediateEmail ? 'ON' : 'OFF'}</span>
                    </button>

                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !showPopupConfig;
                          setShowPopupConfig(next);
                          if (next) {
                            setShowDailyConfig(false);
                            setShowCalendarConfig(false);
                            if ('Notification' in window) Notification.requestPermission();
                          }
                        }}
                        disabled={isAiProcessing}
                        className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${(showPopupConfig || popupHours || popupMinutes || popupDateTime) ? 'bg-[#DDDCE8] text-[#514F66] border-[#C9C7D8] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                      >
                        <span>⏰ Alarme pop-up</span><span>{showPopupConfig ? '▲' : '▼'}</span>
                      </button>
                      {showPopupConfig && (
                        <div className="bg-[#F3F2F8] border border-t-0 border-[#D8D5E3] p-2.5 rounded-b-xl flex flex-col gap-2.5">
                          <div className="grid grid-cols-2 gap-1.5 bg-white/70 p-1 rounded-xl border border-[#E0DDE8]">
                            <button
                              type="button"
                              onClick={() => setPopupScheduleMode('relative')}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-black transition-colors ${popupScheduleMode === 'relative' ? 'bg-[#DDDCE8] text-[#4E4B62]' : 'text-[#746F80] hover:bg-[#F0EEF5]'}`}
                            >
                              Dans…
                            </button>
                            <button
                              type="button"
                              onClick={() => setPopupScheduleMode('datetime')}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-black transition-colors ${popupScheduleMode === 'datetime' ? 'bg-[#DDDCE8] text-[#4E4B62]' : 'text-[#746F80] hover:bg-[#F0EEF5]'}`}
                            >
                              Date et heure
                            </button>
                          </div>

                          {popupScheduleMode === 'relative' ? (
                            <div className="flex flex-wrap items-center gap-1 justify-center">
                              <span className="text-xs font-bold text-[#5C5870]">Dans :</span>
                              <input type="number" placeholder="0" min="0" value={popupHours} onChange={(e) => setPopupHours(e.target.value)} className="w-12 p-1.5 border border-[#CDC9DB] rounded-lg text-center text-black font-bold text-xs bg-white" />
                              <span className="text-xs font-bold text-[#5C5870]">h</span>
                              <input type="number" placeholder="0" min="0" value={popupMinutes} onChange={(e) => setPopupMinutes(e.target.value)} className="w-12 p-1.5 border border-[#CDC9DB] rounded-lg text-center text-black font-bold text-xs bg-white" />
                              <span className="text-xs font-bold text-[#5C5870]">min</span>
                            </div>
                          ) : (
                            <input
                              type="datetime-local"
                              value={popupDateTime}
                              onChange={(e) => setPopupDateTime(e.target.value)}
                              className="w-full border border-[#CDC9DB] p-2 rounded-lg text-black bg-white font-bold text-xs"
                            />
                          )}

                          {(popupHours || popupMinutes || popupDateTime) && (
                            <button
                              type="button"
                              onClick={() => { setPopupHours(''); setPopupMinutes(''); setPopupDateTime(''); setShowPopupConfig(false); }}
                              className="self-center bg-[#F0DDD7] text-[#885C50] px-2.5 py-1 rounded-lg text-[11px] font-bold hover:bg-[#E8CEC6] transition-colors"
                            >
                              ✖ Annuler l'alarme
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !showDailyConfig;
                          setShowDailyConfig(next);
                          if (next) { setShowPopupConfig(false); setShowCalendarConfig(false); }
                        }}
                        disabled={isAiProcessing}
                        className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${(activateReminder || reminderPopupActive) ? 'bg-[#D9E2CF] text-[#3D4B37] border-[#BECBB1] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                      >
                        <span>🔄 Relance quotidienne</span><span>{showDailyConfig ? '▲' : '▼'}</span>
                      </button>
                      {showDailyConfig && (
                        <div className="bg-[#F0F4EC] border border-t-0 border-[#D4DDCB] p-2.5 rounded-b-xl flex flex-col gap-2">
                          <div className="flex flex-wrap gap-4 justify-center">
                            <label className="flex items-center gap-1 cursor-pointer font-bold text-[#46513F] text-xs"><input type="checkbox" checked={activateReminder} onChange={(e) => { if (DEMO_MODE && e.target.checked) { demoFeatureUnavailable('Les relances par e-mail'); return; } setActivateReminder(e.target.checked); }} className="accent-[#7E9071]"/> E-mail</label>
                            <label className="flex items-center gap-1 cursor-pointer font-bold text-[#46513F] text-xs"><input type="checkbox" checked={reminderPopupActive} onChange={(e) => setReminderPopupActive(e.target.checked)} className="accent-[#7E9071]"/> Pop-up</label>
                          </div>
                          <div className="flex items-center justify-center gap-2 pt-1 border-t border-[#D4DDCB]"><span className="text-xs font-bold text-[#46513F]">À :</span><input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="p-1.5 border border-[#C8D2BC] rounded-lg text-black bg-white font-bold text-xs" /></div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !showCalendarConfig;
                          setShowCalendarConfig(next);
                          if (next) { setShowPopupConfig(false); setShowDailyConfig(false); }
                        }}
                        disabled={isAiProcessing}
                        className={`p-2.5 rounded-xl font-bold border transition-colors text-left text-xs flex justify-between items-center ${targetDate ? 'bg-[#E6DDD2] text-[#5B4C40] border-[#D6C8B8] rounded-b-none' : 'bg-white text-[#625B52] border-[#DED5C8] hover:bg-[#F5F1EA]'}`}
                      >
                        <span>📅 Agenda / .ics</span><span>{showCalendarConfig ? '▲' : '▼'}</span>
                      </button>
                      {showCalendarConfig && (
                        <div className="bg-[#F6F0EA] border border-t-0 border-[#E0D3C5] p-2.5 rounded-b-xl flex flex-col gap-2 items-center">
                          <input type="datetime-local" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-full border border-[#D8C8B6] p-2 rounded-lg text-black bg-white font-bold text-xs" />
                          <div className="flex flex-wrap gap-3 pt-1 justify-center">
                            <label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-[#5B4C40]"><input type="checkbox" checked={enableGoogleCal} onChange={(e) => setEnableGoogleCal(e.target.checked)} className="accent-[#9B8068]" /> Google Agenda</label>
                            <label className="flex items-center gap-1 cursor-pointer text-xs font-bold text-[#5B4C40]"><input type="checkbox" checked={enableICal} onChange={(e) => setEnableICal(e.target.checked)} className="accent-[#9B8068]" /> Fichier .ics</label>
                          </div>
                          {targetDate && (<button type="button" onClick={() => { setTargetDate(''); setShowCalendarConfig(false); }} className="bg-[#F0DDD7] text-[#885C50] px-2.5 py-1 rounded-lg text-[11px] font-bold hover:bg-[#E8CEC6] transition-colors">✖ Annuler la date</button>)}
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

              <button type="submit" disabled={loading || isAiProcessing || (!newTitle.trim() && !newContent.trim())} className="mt-2 bg-[#AEBB9E] text-[#2F3A2B] px-4 py-2.5 rounded-xl font-black text-sm hover:bg-[#A2B292] disabled:opacity-50 transition-colors w-full shadow-sm border border-[#9FAC90]">{loading ? 'Création...' : isAiProcessing ? 'Patientez...' : 'Créer la tâche'}</button>
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
                    <button onClick={() => { setSkippedFocusIds([]); navigateNotesChild('#notes-list'); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-lg shadow-sm border border-gray-200 transition-transform hover:scale-105 active:scale-95">Non, stop</button>
                    <button onClick={() => setFocusPhase('orange')} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-xl text-lg shadow-md transition-transform hover:scale-105 active:scale-95">Oui, on continue</button>
                  </div>
                </div>
              ) : focusPhase === 'ask_vert' ? (
                <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl text-center flex flex-col items-center gap-4 border-2 border-green-400">
                  <span className="text-5xl">🔋</span>
                  <h2 className="text-2xl font-black text-gray-800">Tâches importantes finies !</h2>
                  <p className="text-gray-600 font-medium">Veux-tu terminer avec les tâches normales ?</p>
                  <div className="flex w-full gap-3 mt-4">
                    <button onClick={() => { setSkippedFocusIds([]); navigateNotesChild('#notes-list'); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-lg shadow-sm border border-gray-200 transition-transform hover:scale-105 active:scale-95">Non, stop</button>
                    <button onClick={() => setFocusPhase('vert')} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-md transition-transform hover:scale-105 active:scale-95">Oui, on termine</button>
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
                  <span className="text-6xl">🎉</span><h2 className="text-2xl font-black text-gray-800">Super, plus aucune tâche à traiter !</h2><p className="text-gray-500 font-medium text-sm">Tu as vidé ta liste de concentration.</p>
                  <button onClick={() => { setSkippedFocusIds([]); navigateNotesChild('#notes-list'); }} className="mt-6 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-black transition-colors shadow-md">Quitter le Mode Focus</button>
                </div>
              )}
            </div>
          ) : activeTab === 'notes' && (
            <>
              <div className="flex items-center justify-between mb-6 w-full gap-2">
                <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  <button onClick={() => setShowArchived(false)} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === false ? 'bg-[#C8D2BC] text-[#35412F]' : 'bg-[#EEE8DD] text-[#756E63] hover:bg-[#E5DED2]'}`}>📂 Actif</button>
                  {hasSnoozedNotes && <button onClick={() => setShowArchived('snoozed')} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === 'snoozed' ? 'bg-[#E6D8AE] text-[#66562F]' : 'bg-[#F3EDD6] text-[#786B43] hover:bg-[#EAE1C2]'}`}>💤 Masqué</button>}
                  <button onClick={() => setShowArchived(true)} className={`whitespace-nowrap px-4 py-2 text-sm rounded font-bold transition-colors ${showArchived === true ? 'bg-[#E2D6C7] text-[#59493B]' : 'bg-[#EEE8DD] text-[#756E63] hover:bg-[#E5DED2]'}`}>📦 Archives</button>
                </div>
                <button onClick={() => openCleanupModal(showArchived === true ? 'archive' : 'actif')} className="text-gray-500 hover:text-gray-800 text-sm font-semibold flex items-center gap-1.5 transition-colors px-2 py-1 rounded whitespace-nowrap flex-shrink-0">🧹 Nettoyage {showArchived === true ? 'archive' : ''}</button>
              </div>

              {showArchived === true ? (
                <div className="flex flex-col bg-[#F8F5EF] p-3 rounded-2xl border border-[#E1D9CE]">
                  <div className="w-full flex items-center justify-between mb-2 border-b border-gray-200 pb-1 text-gray-800"><span className="text-base font-bold">📦 Toutes les archives ({displayedNotes.length})</span></div>
                  <ul className="space-y-3">
                    {displayedNotes.length === 0 && <p className="text-gray-400 font-medium text-xs text-center py-4 bg-white rounded-lg border border-dashed border-gray-300">Dossier vide</p>}
                    {displayedNotes.map(renderNoteItem)}
                  </ul>
                </div>
              ) : (
                <>
                  {displayedNotes.length > 1 && (
                    <p className="text-center text-[10px] font-bold text-[#8A8175] mb-3">Maintiens une tâche puis déplace-la pour changer son ordre ou sa priorité.</p>
                  )}
                  <div className={`grid items-start gap-4 grid-cols-1 lg:grid-cols-3`}>
                  {columns.map((col) => (
                    <div
                      key={col.id}
                      data-task-priority-zone={col.id}
                      className={`flex flex-col bg-[#F8F5EF] p-3 rounded-2xl border transition-all ${taskDragHoverPriority === col.id ? 'border-[#8E9D80] ring-2 ring-[#B9C5AD] bg-[#F3F6EF]' : 'border-[#E1D9CE]'}`}
                    >
                      <button type="button" onClick={() => setCollapsedPriorities(prev => ({
                        rouge: true,
                        orange: true,
                        vert: true,
                        [col.id]: !(prev[col.id] ?? false),
                      }))} className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-left mb-2 border-b border-gray-200 pb-1 text-gray-800 hover:text-gray-950 transition-colors" aria-expanded={!(collapsedPriorities[col.id] ?? false)}><span className="text-base font-bold">{(collapsedPriorities[col.id] ?? false) ? '▶' : '▼'} {col.title} ({col.notes.length})</span></button>
                      {!(collapsedPriorities[col.id] ?? false) && (
                      <ul className="space-y-3">
                        {col.notes.length === 0 && <p className="text-gray-400 font-medium text-xs text-center py-4 bg-white rounded-lg border border-dashed border-gray-300">Dossier vide</p>}
                        {col.notes.map(renderNoteItem)}
                      </ul>
                      )}
                    </div>
                  ))}
                  </div>

                  {draggingTaskId && taskDragVisual && (() => {
                    const task = notes.find(item => item.id === draggingTaskId);
                    if (!task) return null;
                    const palette = task.importance === 'rouge'
                      ? 'border-[#D5A195] bg-[#FAECE7]'
                      : task.importance === 'orange'
                        ? 'border-[#D6B384] bg-[#F6EAD9]'
                        : 'border-[#AAB99D] bg-[#EDF1E7]';
                    return (
                      <div
                        ref={taskGhostRef}
                        className={`fixed z-[12860] pointer-events-none rounded-xl border-l-4 border p-3 shadow-2xl scale-[1.025] ${palette}`}
                        style={{ left: taskDragVisual.x, top: taskDragVisual.y, width: taskDragVisual.width }}
                      >
                        <div className="text-[10px] font-black uppercase tracking-wide opacity-60 mb-1">
                          {task.importance === 'rouge' ? '🔴 Urgente' : task.importance === 'orange' ? '🟠 Importante' : '🟢 Normale'}
                        </div>
                        <div className="font-black text-sm text-[#443F39] break-words">{task.title || '(Sans titre)'}</div>
                        {task.content && <div className="text-xs mt-1 text-[#6A6258] line-clamp-3 whitespace-pre-wrap">{task.content}</div>}
                        <div className="absolute left-1/2 -translate-x-1/2 -bottom-7 whitespace-nowrap rounded-full bg-[#4B5843] text-white px-2.5 py-1 text-[9px] font-black shadow-lg">
                          Relâche pour placer
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              <div className="mt-12 mb-8 text-center">
                <button onClick={() => navigateNotesChild('#notes-history')} className="text-gray-400 hover:text-gray-600 underline decoration-gray-300 font-semibold text-xs transition-colors tracking-wide">🕰️ Consulter l'historique des tâches terminées</button>
              </div>
            </>
          )}

          {activeTab === 'history' && !isFocusMode && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center mb-2">
                 <button onClick={() => navigateNotesChild('#notes-list')} className="text-blue-600 hover:underline font-bold text-sm">← Retour aux tâches actives</button>
                 {historyNotes.length > 0 && <button onClick={deleteAllHistory} className="text-red-600 hover:text-red-800 hover:underline font-bold text-sm flex items-center gap-1">🗑️ Tout supprimer</button>}
              </div>
              <div className="bg-[#FBFAF7] p-3 rounded-2xl border border-[#DED7CC] flex items-center gap-2">
                <span className="text-xl">🔍</span>
                <input type="text" placeholder="Rechercher dans l'historique..." value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="flex-1 border-none focus:ring-0 text-sm text-black font-semibold bg-transparent" />
                {historySearch && <button onClick={() => setHistorySearch('')} className="text-gray-400 hover:text-gray-600 font-bold px-2">✖</button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyNotes.length === 0 && <p className="col-span-full text-center text-gray-400 font-medium py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">Aucune tâche dans l'historique.</p>}
                {historyNotes.map(note => (
                  <div key={note.id} className="flex flex-col gap-2 p-3 rounded-2xl bg-[#F2EEE7] border border-[#D9D1C5] opacity-85">
                    <div className="font-bold text-gray-700 text-base line-through decoration-gray-400">{note.title || '(Sans titre)'}</div>
                    <div className="text-xs text-gray-500 whitespace-pre-wrap">{note.content}</div>
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

          {!isFocusMode && (
            <div className="flex justify-center mt-10 mb-3">
              <button
                type="button"
                onClick={() => setShowNotesHelp(true)}
                className="w-9 h-9 rounded-full bg-[#EEE8DD] hover:bg-[#E5DED2] border border-[#D9D0C2] text-[#71695E] font-black shadow-sm transition-colors"
                aria-label="Aide sur Tâches & Rappels"
                title="Aide sur les options de Tâches & Rappels"
              >
                ?
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
