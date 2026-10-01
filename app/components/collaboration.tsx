'use client';

import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type SharedSpace = {
  id: string;
  name: string;
  owner_id: string;
  role: 'owner' | 'editor';
};

export type SharedMember = {
  user_id: string;
  role: 'owner' | 'editor';
  display_name: string;
};

type CollaborationNotification = {
  id: string;
  title: string;
  body: string;
  entity_type: 'note' | 'memo' | 'planning' | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type CollaborationContextValue = {
  user: User;
  displayName: string;
  spaces: SharedSpace[];
  activeSpace: SharedSpace | null;
  members: SharedMember[];
  unreadCount: number;
  setActiveSpaceId: (spaceId: string) => void;
  openPanel: () => void;
  refreshWorkspace: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

const friendlyAuthError = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return "Confirme d'abord ton adresse e-mail grâce au message reçu.";
  if (/user already registered/i.test(message)) return 'Un compte existe déjà avec cette adresse.';
  if (/password should be/i.test(message)) return 'Le mot de passe doit contenir au moins 8 caractères.';
  return message;
};

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || password.length < 8) {
      setMessage('Renseigne un e-mail valide et un mot de passe d’au moins 8 caractères.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        if (displayName.trim().length < 2) {
          setMessage('Indique le prénom qui sera affiché dans l’espace partagé.');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: displayName.trim().slice(0, 60) } },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage('Compte créé. Ouvre maintenant l’e-mail de confirmation reçu, puis connecte-toi.');
          setMode('login');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
      }
    } catch (error: any) {
      setMessage(friendlyAuthError(error?.message || 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setMessage("Indique d'abord ton adresse e-mail.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    setMessage(error ? friendlyAuthError(error.message) : 'Un lien de réinitialisation vient de t’être envoyé.');
  };

  return (
    <main className="min-h-screen bg-[#F6F2EA] px-4 py-8 flex items-center justify-center text-[#4A463F]">
      <div className="w-full max-w-sm rounded-[28px] border border-[#D8D0C4] bg-[#FBF9F4] p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-[#D8DEC9] flex items-center justify-center text-3xl">📝</div>
          <h1 className="text-2xl font-black text-[#46513F]">Mon espace</h1>
          <p className="mt-1 text-xs font-semibold text-[#81786C]">Tes notes restent privées tant que tu ne choisis pas de les partager.</p>
        </div>

        <div className="grid grid-cols-2 rounded-xl bg-[#EEE8DD] p-1 mb-5">
          <button type="button" onClick={() => { setMode('login'); setMessage(null); }} className={`rounded-lg py-2 text-xs font-black ${mode === 'login' ? 'bg-white text-[#46513F] shadow-sm' : 'text-[#81786C]'}`}>Connexion</button>
          <button type="button" onClick={() => { setMode('signup'); setMessage(null); }} className={`rounded-lg py-2 text-xs font-black ${mode === 'signup' ? 'bg-white text-[#46513F] shadow-sm' : 'text-[#81786C]'}`}>Créer un compte</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signup' && (
            <label className="text-xs font-black text-[#625A50]">
              Prénom affiché
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" className="mt-1.5 w-full rounded-xl border border-[#D8D0C4] bg-white px-3 py-3 text-sm font-semibold text-black focus:outline-none focus:ring-2 focus:ring-[#AEBCA2]" placeholder="Ex. : Joan" />
            </label>
          )}
          <label className="text-xs font-black text-[#625A50]">
            Adresse e-mail
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-xl border border-[#D8D0C4] bg-white px-3 py-3 text-sm font-semibold text-black focus:outline-none focus:ring-2 focus:ring-[#AEBCA2]" />
          </label>
          <label className="text-xs font-black text-[#625A50]">
            Mot de passe
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} className="mt-1.5 w-full rounded-xl border border-[#D8D0C4] bg-white px-3 py-3 text-sm font-semibold text-black focus:outline-none focus:ring-2 focus:ring-[#AEBCA2]" />
          </label>
          {message && <div className="rounded-xl border border-[#D8C8AE] bg-[#F5ECDD] px-3 py-2.5 text-xs font-bold leading-relaxed">{message}</div>}
          <button disabled={busy} className="mt-1 rounded-xl bg-[#5D6B53] px-4 py-3 text-sm font-black text-white shadow disabled:opacity-50">
            {busy ? 'Patiente…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
          {mode === 'login' && <button type="button" onClick={() => void resetPassword()} className="text-[11px] font-bold text-[#756E63] underline underline-offset-2">Mot de passe oublié</button>}
        </form>
      </div>
    </main>
  );
}

export function CollaborationProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('Utilisateur');
  const [spaces, setSpaces] = useState<SharedSpace[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState<string>('');
  const [members, setMembers] = useState<SharedMember[]>([]);
  const [notifications, setNotifications] = useState<CollaborationNotification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);
  const panelOpenRef = useRef(false);

  const openPanel = () => {
    if (panelOpenRef.current) return;
    panelOpenRef.current = true;
    setPanelOpen(true);
    if (typeof window !== 'undefined' && !window.history.state?.collaborationPanel) {
      window.history.pushState(
        { ...(window.history.state || {}), collaborationPanel: true },
        '',
        window.location.href
      );
    }
  };

  const closePanel = () => {
    if (!panelOpenRef.current) return;
    if (typeof window !== 'undefined' && window.history.state?.collaborationPanel) {
      window.history.back();
      return;
    }
    panelOpenRef.current = false;
    setPanelOpen(false);
  };

  useEffect(() => {
    const closePanelOnBack = () => {
      if (!panelOpenRef.current) return;
      panelOpenRef.current = false;
      setPanelOpen(false);
    };

    window.addEventListener('popstate', closePanelOnBack);
    return () => window.removeEventListener('popstate', closePanelOnBack);
  }, []);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const initialUser = data.session?.user || null;
      currentUserIdRef.current = initialUser?.id || null;
      setUser(initialUser);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user || null;
      const nextUserId = nextUser?.id || null;
      const accountChanged = currentUserIdRef.current !== nextUserId;
      currentUserIdRef.current = nextUserId;

      // TOKEN_REFRESHED est déclenché notamment quand l'application revient du
      // second plan. Le compte n'a alors pas changé : remettre workspaceReady à
      // false laisserait l'écran bloqué, car l'effet dépendant de user.id ne se
      // relance pas. On réinitialise uniquement lors d'un vrai changement de compte.
      if (accountChanged || event === 'SIGNED_OUT') {
        panelOpenRef.current = false;
        setPanelOpen(false);
        setWorkspaceReady(false);
      }

      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setSpaces([]);
        setMembers([]);
        setNotifications([]);
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadWorkspace = async () => {
    if (!user) return;

    try {
      await supabase.rpc('claim_legacy_data');
    } catch {
      // La fonction apparaît seulement après l'installation de la migration.
    }
    const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Utilisateur';
    await supabase.from('profiles').upsert({ id: user.id, display_name: fallbackName }, { onConflict: 'id' });

    const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    setDisplayName(profile?.display_name || fallbackName);

    const { data: membershipRows, error: membershipError } = await supabase
      .from('space_members')
      .select('space_id, role')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true });

    if (membershipError) {
      setSpaces([]);
    } else {
      const ids = (membershipRows || []).map(row => String(row.space_id));
      const { data: spaceRows } = ids.length
        ? await supabase.from('shared_spaces').select('id, name, owner_id').in('id', ids)
        : { data: [] as any[] };
      const roleBySpace = new Map((membershipRows || []).map(row => [String(row.space_id), row.role]));
      const loadedSpaces = (spaceRows || []).map(row => ({
        id: String(row.id),
        name: String(row.name),
        owner_id: String(row.owner_id),
        role: roleBySpace.get(String(row.id)) === 'owner' ? 'owner' as const : 'editor' as const,
      }));
      setSpaces(loadedSpaces);

      const storedSpaceId = window.localStorage.getItem(`active-space-${user.id}`) || '';
      setActiveSpaceIdState(current => {
        if (loadedSpaces.some(space => space.id === current)) return current;
        if (loadedSpaces.some(space => space.id === storedSpaceId)) return storedSpaceId;
        return loadedSpaces[0]?.id || '';
      });
    }

    const { data: notificationRows } = await supabase
      .from('collaboration_notifications')
      .select('id, title, body, entity_type, entity_id, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifications((notificationRows || []) as CollaborationNotification[]);
    setWorkspaceReady(true);
  };

  useEffect(() => {
    if (!user) return;
    void loadWorkspace().catch((error) => {
      // Une panne réseau ponctuelle ne doit pas condamner l'application à rester
      // indéfiniment sur l'écran de chargement. Les données seront resynchronisées
      // au prochain retour au premier plan ou via le temps réel Supabase.
      console.error('Chargement de l’espace impossible :', error);
      setWorkspaceReady(true);
    });
    // loadWorkspace est volontairement relancé uniquement quand le compte change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const activeSpace = spaces.find(space => space.id === activeSpaceId) || null;

  useEffect(() => {
    if (!user || !activeSpaceId) {
      setMembers([]);
      return;
    }
    window.localStorage.setItem(`active-space-${user.id}`, activeSpaceId);
    void (async () => {
      const { data: memberRows } = await supabase
        .from('space_members')
        .select('user_id, role')
        .eq('space_id', activeSpaceId)
        .order('joined_at', { ascending: true });
      const ids = (memberRows || []).map(row => String(row.user_id));
      const { data: profileRows } = ids.length
        ? await supabase.from('profiles').select('id, display_name').in('id', ids)
        : { data: [] as any[] };
      const names = new Map((profileRows || []).map(row => [String(row.id), String(row.display_name)]));
      setMembers((memberRows || []).map(row => ({
        user_id: String(row.user_id),
        role: row.role === 'owner' ? 'owner' : 'editor',
        display_name: names.get(String(row.user_id)) || 'Utilisateur',
      })));
    })();
  }, [activeSpaceId, user]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`collaboration-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'collaboration_notifications',
        filter: `recipient_id=eq.${user.id}`,
      }, () => void loadWorkspace())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setActiveSpaceId = (spaceId: string) => {
    if (spaceId) setActiveSpaceIdState(spaceId);
  };

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  const value = useMemo<CollaborationContextValue | null>(() => user ? ({
    user,
    displayName,
    spaces,
    activeSpace,
    members,
    unreadCount: notifications.filter(item => !item.read_at).length,
    setActiveSpaceId,
    openPanel,
    refreshWorkspace: loadWorkspace,
    getAccessToken,
  }) : null, [user, displayName, spaces, activeSpace, members, notifications]);

  if (!authReady) {
    return <main className="min-h-screen bg-[#F6F2EA] flex items-center justify-center text-4xl">📝</main>;
  }
  if (!user) return <AuthScreen />;
  if (!workspaceReady || !value) {
    return <main className="min-h-screen bg-[#F6F2EA] flex items-center justify-center text-[#4B5843] font-black">Chargement de ton espace…</main>;
  }

  return (
    <CollaborationContext.Provider value={value}>
      {children}
      <CollaborationPanel
        open={panelOpen}
        onClose={closePanel}
        notifications={notifications}
        setNotifications={setNotifications}
      />
    </CollaborationContext.Provider>
  );
}

export const useCollaboration = () => {
  const context = useContext(CollaborationContext);
  if (!context) throw new Error('useCollaboration doit être utilisé dans CollaborationProvider.');
  return context;
};

export function CollaborationButton() {
  const collaboration = useCollaboration();
  const initials = collaboration.displayName.trim().slice(0, 2).toUpperCase() || '👤';
  return (
    <button
      type="button"
      onClick={collaboration.openPanel}
      className="fixed right-4 top-[max(12px,env(safe-area-inset-top))] z-[9100] w-10 h-10 rounded-full border border-[#C8D0B8] bg-[#EEF1E8]/95 text-[#43503C] text-[11px] font-black shadow-md backdrop-blur flex items-center justify-center"
      aria-label="Compte, partage et notifications"
    >
      {initials}
      {collaboration.unreadCount > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#C96E5B] text-white text-[9px] flex items-center justify-center border-2 border-[#FBF9F4]">{Math.min(99, collaboration.unreadCount)}</span>}
    </button>
  );
}

function CollaborationPanel({
  open,
  onClose,
  notifications,
  setNotifications,
}: {
  open: boolean;
  onClose: () => void;
  notifications: CollaborationNotification[];
  setNotifications: (items: CollaborationNotification[]) => void;
}) {
  const collaboration = useCollaboration();
  const [spaceName, setSpaceName] = useState('Notre espace');
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showRemoveSpaceConfirm, setShowRemoveSpaceConfirm] = useState(false);

  if (!open) return null;

  const createSpace = async () => {
    const cleanSpaceName = spaceName.trim() || 'Notre espace';
    setBusy(true); setMessage(null);
    const { data, error } = await supabase.rpc('create_shared_space', { p_name: cleanSpaceName });
    if (error) setMessage(error.message);
    else {
      await collaboration.refreshWorkspace();
      if (data) collaboration.setActiveSpaceId(String(data));
      setInviteCode('');
      setSpaceName('Notre espace');
      setShowCreateSpace(false);
      setMessage(`L’espace « ${cleanSpaceName} » a été créé et sélectionné.`);
    }
    setBusy(false);
  };

  const createInvite = async () => {
    if (!collaboration.activeSpace) return;
    setBusy(true); setMessage(null);
    const { data, error } = await supabase.rpc('create_space_invite', { p_space_id: collaboration.activeSpace.id });
    if (error) setMessage(error.message);
    else setInviteCode(String(data || ''));
    setBusy(false);
  };

  const joinSpace = async () => {
    if (!joinCode.trim()) return;
    setBusy(true); setMessage(null);
    const { data, error } = await supabase.rpc('accept_space_invite', { p_code: joinCode.trim().toUpperCase() });
    if (error) setMessage(error.message);
    else {
      await collaboration.refreshWorkspace();
      if (data) collaboration.setActiveSpaceId(String(data));
      setJoinCode('');
      setInviteCode('');
      setMessage('Tu as rejoint ce nouvel espace partagé. Il est maintenant sélectionné.');
    }
    setBusy(false);
  };

  const removeActiveSpace = async () => {
    const space = collaboration.activeSpace;
    if (!space) return;

    setBusy(true);
    setMessage(null);
    try {
      if (space.role === 'owner') {
        const { error } = await supabase.from('shared_spaces').delete().eq('id', space.id);
        if (error) throw error;
      } else {
        // Les éléments créés par la personne qui quitte l'espace redeviennent
        // personnels avant de supprimer son appartenance au groupe.
        const unshareResults = await Promise.all([
          supabase.from('notes').update({ space_id: null, assigned_to: null }).eq('space_id', space.id).eq('owner_id', collaboration.user.id),
          supabase.from('memo_notes').update({ space_id: null }).eq('space_id', space.id).eq('owner_id', collaboration.user.id),
          supabase.from('planning_templates').update({ space_id: null }).eq('space_id', space.id).eq('owner_id', collaboration.user.id),
        ]);
        const unshareError = unshareResults.find(result => result.error)?.error;
        if (unshareError) throw unshareError;

        const { error } = await supabase
          .from('space_members')
          .delete()
          .eq('space_id', space.id)
          .eq('user_id', collaboration.user.id);
        if (error) throw error;
      }

      setInviteCode('');
      setShowRemoveSpaceConfirm(false);
      await collaboration.refreshWorkspace();
      setMessage(space.role === 'owner'
        ? `L’espace « ${space.name} » a été supprimé. Les éléments partagés sont redevenus personnels pour leurs propriétaires.`
        : `Tu as quitté l’espace « ${space.name} ».`);
    } catch (error: any) {
      setMessage('Impossible de modifier cet espace : ' + (error?.message || 'erreur inconnue'));
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter(item => !item.read_at).map(item => item.id);
    if (unreadIds.length === 0) return;
    const readAt = new Date().toISOString();
    await supabase.from('collaboration_notifications').update({ read_at: readAt }).in('id', unreadIds);
    setNotifications(notifications.map(item => item.read_at ? item : { ...item, read_at: readAt }));
  };

  const openNotification = async (notification: CollaborationNotification) => {
    if (!notification.read_at) {
      const readAt = new Date().toISOString();
      await supabase.from('collaboration_notifications').update({ read_at: readAt }).eq('id', notification.id);
      setNotifications(notifications.map(item => item.id === notification.id ? { ...item, read_at: readAt } : item));
    }
    onClose();
    const hash = notification.entity_type === 'note' && notification.entity_id
      ? `#note-${encodeURIComponent(notification.entity_id)}`
      : notification.entity_type === 'planning' ? '#planning' : '#notes';
    window.location.hash = hash;
  };

  return (
    <div data-collaboration-panel className="fixed inset-0 z-[16000] bg-black/35 backdrop-blur-[2px] p-4 flex items-start justify-end" onClick={onClose}>
      <section className="mt-[max(48px,env(safe-area-inset-top))] w-full max-w-sm max-h-[calc(100vh-80px)] overflow-y-auto rounded-[26px] border border-[#D8D0C4] bg-[#FBF9F4] p-5 text-[#4A463F] shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div><h2 className="text-lg font-black text-[#46513F]">Compte et partage</h2><p className="text-[11px] font-semibold text-[#81786C]">{collaboration.user.email}</p></div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-[#EEE8DD] font-black">✕</button>
        </div>

        {collaboration.spaces.length > 0 ? (
          <div className="rounded-2xl border border-[#CCD5C2] bg-[#EEF1E8] p-3 mb-4">
            <label className="text-[10px] uppercase tracking-wide font-black text-[#687260]">Espace partagé actif</label>
            <select
              value={collaboration.activeSpace?.id || ''}
              onChange={event => {
                collaboration.setActiveSpaceId(event.target.value);
                setInviteCode('');
                setMessage(null);
                setShowRemoveSpaceConfirm(false);
              }}
              className="mt-1.5 w-full rounded-xl border border-[#C8D0B8] bg-white px-3 py-2.5 text-sm font-black"
            >
              {collaboration.spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
            </select>
            <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-[#737C6B]">
              Les nouveaux partages seront envoyés uniquement aux membres de cet espace.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {collaboration.members.map(member => <span key={member.user_id} className="rounded-full bg-white/80 border border-[#D8DEC9] px-2.5 py-1 text-[10px] font-black">{member.display_name}{member.user_id === collaboration.user.id ? ' · moi' : ''}</span>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => void createInvite()} className="rounded-xl bg-[#5D6B53] px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Inviter</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowCreateSpace(value => !value);
                  setMessage(null);
                }}
                className="rounded-xl border border-[#C8D0B8] bg-white px-3 py-2.5 text-xs font-black text-[#4B5843] disabled:opacity-50"
              >
                + Nouvel espace
              </button>
            </div>
            {inviteCode && <div className="mt-2 rounded-xl border border-[#D8C8AE] bg-[#FFF7E8] p-3 text-center"><div className="text-[10px] font-black uppercase text-[#81786C]">Code valable 7 jours</div><div className="mt-1 text-2xl tracking-[0.18em] font-black text-[#4A463F]">{inviteCode}</div></div>}
            {showCreateSpace && (
              <div className="mt-3 rounded-xl border border-[#D8D0C4] bg-[#FBF9F4] p-3">
                <div className="text-xs font-black mb-2">Créer un autre espace</div>
                <input
                  value={spaceName}
                  onChange={event => setSpaceName(event.target.value)}
                  maxLength={80}
                  placeholder="Ex. : Couple, Famille, Travail"
                  className="w-full rounded-xl border border-[#D8D0C4] bg-white px-3 py-2.5 text-sm font-semibold"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => { setShowCreateSpace(false); setSpaceName('Notre espace'); }} className="rounded-xl bg-[#EEE8DD] px-3 py-2 text-xs font-black text-[#62594E] disabled:opacity-50">Annuler</button>
                  <button type="button" disabled={busy || !spaceName.trim()} onClick={() => void createSpace()} className="rounded-xl bg-[#5D6B53] px-3 py-2 text-xs font-black text-white disabled:opacity-50">Créer</button>
                </div>
              </div>
            )}
            {!showRemoveSpaceConfirm ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowRemoveSpaceConfirm(true); setMessage(null); }}
                className="mt-3 w-full rounded-xl px-3 py-2 text-[11px] font-black text-[#8A5B50] hover:bg-[#F3E2DD] disabled:opacity-50"
              >
                {collaboration.activeSpace?.role === 'owner' ? 'Supprimer cet espace' : 'Quitter cet espace'}
              </button>
            ) : (
              <div className="mt-3 rounded-xl border border-[#DEC0B9] bg-[#F8EDEA] p-3">
                <p className="text-xs font-black text-[#7B4E43]">
                  {collaboration.activeSpace?.role === 'owner'
                    ? `Supprimer définitivement « ${collaboration.activeSpace?.name} » ?`
                    : `Quitter « ${collaboration.activeSpace?.name} » ?`}
                </p>
                <p className="mt-1 text-[10px] font-semibold leading-relaxed text-[#80665E]">
                  {collaboration.activeSpace?.role === 'owner'
                    ? 'Les membres perdront l’accès à cet espace. Les notes, tâches et plannings ne seront pas effacés : ils redeviendront personnels pour leurs propriétaires.'
                    : 'Tu ne verras plus les éléments de cet espace. Ceux que tu as créés redeviendront personnels.'}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => setShowRemoveSpaceConfirm(false)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-[#62594E] disabled:opacity-50">Annuler</button>
                  <button type="button" disabled={busy} onClick={() => void removeActiveSpace()} className="rounded-xl bg-[#D9ADA2] px-3 py-2 text-xs font-black text-[#6F4036] disabled:opacity-50">
                    {busy ? 'Patiente…' : collaboration.activeSpace?.role === 'owner' ? 'Supprimer' : 'Quitter'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-[#D8D0C4] bg-[#F4F0E9] p-3 mb-4">
            <div className="text-xs font-black mb-2">Créer votre espace commun</div>
            <div className="flex gap-2"><input value={spaceName} onChange={event => setSpaceName(event.target.value)} maxLength={80} className="min-w-0 flex-1 rounded-xl border border-[#D8D0C4] bg-white px-3 py-2 text-sm font-semibold" /><button disabled={busy || !spaceName.trim()} type="button" onClick={() => void createSpace()} className="rounded-xl bg-[#5D6B53] px-3 py-2 text-xs font-black text-white disabled:opacity-50">Créer</button></div>
          </div>
        )}

        <div className="rounded-2xl border border-[#D8D0C4] bg-white/60 p-3 mb-4">
          <div className="text-xs font-black mb-2">Rejoindre avec un code</div>
          <div className="flex gap-2"><input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} maxLength={8} placeholder="CODE" className="min-w-0 flex-1 rounded-xl border border-[#D8D0C4] bg-white px-3 py-2 text-sm font-black uppercase tracking-widest" /><button disabled={busy || !joinCode.trim()} type="button" onClick={() => void joinSpace()} className="rounded-xl bg-[#E2D6C7] px-3 py-2 text-xs font-black disabled:opacity-40">Rejoindre</button></div>
        </div>

        {message && <div className="mb-4 rounded-xl bg-[#F5ECDD] border border-[#D8C8AE] px-3 py-2 text-xs font-bold">{message}</div>}

        <div className="border-t border-[#E2DBD0] pt-4">
          <div className="flex items-center justify-between gap-2 mb-2"><h3 className="text-xs font-black">Notifications reçues</h3>{notifications.some(item => !item.read_at) && <button type="button" onClick={() => void markAllRead()} className="text-[10px] font-black underline">Tout marquer comme lu</button>}</div>
          <div className="flex flex-col gap-2">
            {notifications.length === 0 && <p className="rounded-xl bg-[#F4F0E9] px-3 py-4 text-center text-[11px] font-semibold text-[#81786C]">Aucune notification partagée.</p>}
            {notifications.slice(0, 12).map(notification => (
              <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`rounded-xl border px-3 py-2.5 text-left ${notification.read_at ? 'border-[#E2DBD0] bg-white/45 opacity-70' : 'border-[#BFC9B4] bg-[#EEF1E8]'}`}>
                <div className="text-xs font-black">{notification.title}</div>
                {notification.body && <div className="mt-0.5 text-[11px] font-semibold text-[#756E63] line-clamp-2">{notification.body}</div>}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            void supabase.auth.signOut();
          }}
          className="mt-5 w-full rounded-xl border border-[#DEC0B9] bg-[#F3E2DD] px-3 py-2.5 text-xs font-black text-[#885C50]"
        >Se déconnecter</button>
      </section>
    </div>
  );
}
