'use client';
// Workflow store: the snapshot from the server, firm members and the signed-in user, kept in one reducer.
// Mutations are not applied optimistically: each one waits for the server and applies the record it returns.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { clear, peek } from '../../../core/client/handover';
import { callModule } from '../../../core/client/api';
import { wf } from '../shared/client';
import type { DealInput, WorkflowAction, WorkflowActions } from '../shared/contract';
import {
  todayIST,
  type Client,
  type DealTracker,
  type Matter,
  type MatterBilling,
  type Milestone,
  type PersonKey,
  type Snapshot,
  type Task,
  type WorkflowCapabilities,
} from '../shared/types';
import { errorMessage, errorStatus, type MeInfo, type Member } from './lib';

export const CONFLICT_MESSAGE = 'Someone else changed this. The latest version has been loaded.';
const POLL_MS = 20_000;

type Phase = 'loading' | 'ready' | 'error' | 'not-member';
interface State {
  phase: Phase;
  error: string;
  snap: Snapshot | null;
  members: Member[];
  me: MeInfo | null;
  today: string;
}

type Act =
  | { type: 'loaded'; snap: Snapshot; members: Member[] | null; me: MeInfo | null; today: string }
  | { type: 'phase'; phase: Phase; error?: string; me?: MeInfo | null }
  | { type: 'client'; client: Client }
  | { type: 'clientGone'; id: string }
  | { type: 'matter'; matter: Matter }
  | { type: 'matterGone'; id: string }
  | { type: 'task'; task: Task }
  | { type: 'taskGone'; id: string }
  | { type: 'milestone'; milestone: Milestone }
  | { type: 'milestoneGone'; id: string }
  | { type: 'billing'; billing: MatterBilling }
  | { type: 'members'; members: Member[] };

const upsert = <T extends { id: string; deletedAt?: number | null }>(list: T[], item: T) =>
  item.deletedAt
    ? list.filter((x) => x.id !== item.id)
    : list.some((x) => x.id === item.id)
      ? list.map((x) => (x.id === item.id ? item : x))
      : [...list, item];

const live = <T extends { deletedAt?: number | null }>(list: T[]) => list.filter((x) => !x.deletedAt);

function reducer(state: State, a: Act): State {
  if (a.type === 'loaded')
    return {
      phase: 'ready',
      error: '',
      today: a.today,
      me: a.me ?? state.me,
      members: a.members ?? state.members,
      snap: {
        ...a.snap,
        clients: live(a.snap.clients),
        matters: live(a.snap.matters),
        tasks: live(a.snap.tasks),
      },
    };
  if (a.type === 'phase') return { ...state, phase: a.phase, error: a.error || '', me: a.me ?? state.me };
  if (a.type === 'members') return { ...state, members: a.members };
  const s = state.snap;
  if (!s) return state;
  const next = (patch: Partial<Snapshot>) => ({ ...state, snap: { ...s, ...patch } });
  switch (a.type) {
    case 'client':
      return next({ clients: upsert(s.clients, a.client) });
    case 'clientGone':
      return next({
        clients: s.clients.filter((c) => c.id !== a.id),
        matters: s.matters.filter((m) => m.clientId !== a.id),
      });
    case 'matter':
      return next({ matters: upsert(s.matters, a.matter) });
    case 'matterGone':
      return next({ matters: s.matters.filter((m) => m.id !== a.id) });
    case 'task':
      return next({ tasks: upsert(s.tasks, a.task) });
    case 'taskGone':
      return next({ tasks: s.tasks.filter((t) => t.id !== a.id) });
    case 'milestone':
      return next({ milestones: upsert(s.milestones, a.milestone) });
    case 'milestoneGone':
      return next({ milestones: s.milestones.filter((m) => m.id !== a.id) });
    case 'billing':
      return next({
        billing: s.billing.some((b) => b.matterId === a.billing.matterId)
          ? s.billing.map((b) => (b.matterId === a.billing.matterId ? a.billing : b))
          : [...s.billing, a.billing],
      });
  }
  return state;
}

export interface RunOptions {
  // Shows the error next to the control instead of as a notification.
  onError?: (message: string) => void;
}

export interface DealDraft {
  base: DealTracker;
  draft: DealInput;
}

const NO_CAPS: WorkflowCapabilities = {
  manageMatters: false,
  viewBilling: false,
  editBilling: false,
  reviewPeople: false,
  logTimeForOthers: false,
  exportFirmTime: false,
  importData: false,
};

function useWorkflowValue(shellNotify: (message: string) => void, page: string) {
  // The shell passes a new notify function on each render; keep a stable wrapper.
  const notifyRef = useRef(shellNotify);
  useEffect(() => {
    notifyRef.current = shellNotify;
  });
  const notify = useCallback((message: string) => notifyRef.current(message), []);
  const [state, dispatch] = useReducer(reducer, {
    phase: 'loading',
    error: '',
    snap: null,
    members: [],
    me: null,
    today: '',
  });
  // Page-level selections shared across pages (for example "open this mandate").
  // Another module (for example a Scribe note) may have asked for a mandate to be opened.
  const [arrival] = useState(() => peek('workflow.matter'));
  useEffect(() => clear('workflow.matter'), []);
  const [focusMatter, setFocusMatter] = useState<string | null>(arrival?.matterId ?? null);
  // The tab to show when that mandate opens; MatterDetail takes it once.
  const [matterTab, setMatterTab] = useState<string | null>(arrival?.tab ?? null);
  const [focusDeal, setFocusDeal] = useState<string | null>(null);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  // A mandate opened from another page stays open after the page changes; arriving at Clients and
  // Mandates any other way (for example from the navigation) shows the list.
  const [seenPage, setSeenPage] = useState(page);
  const [keepFocus, setKeepFocus] = useState(false);
  if (page !== seenPage) {
    setSeenPage(page);
    if (!keepFocus) setFocusMatter(null);
    setKeepFocus(false);
  }
  const goToMatter = useCallback((id: string) => {
    setFocusMatter(id);
    setKeepFocus(true);
  }, []);
  // Unsaved deal tracker edits survive switching pages until saved or discarded.
  const [dealDrafts, setDealDrafts] = useState<Record<string, DealDraft>>({});

  // Warn before the tab is closed while a deal tracker has unsaved edits.
  const unsavedDeal = Object.values(dealDrafts).some(dealDirty);
  useEffect(() => {
    if (!unsavedDeal) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedDeal]);

  const load = useCallback(
    async (initial: boolean) => {
      const [me, snap, members] = await Promise.allSettled([
        initial ? callModule<MeInfo>('core', 'me') : Promise.resolve(null),
        wf('snapshot', {}),
        callModule<Member[]>('core', 'members.list'),
      ]);
      const meValue = me.status === 'fulfilled' ? me.value : null;
      if (snap.status === 'rejected') {
        const status = errorStatus(snap.reason);
        const message = errorMessage(snap.reason);
        if (status === 403 && /not a member/i.test(message))
          dispatch({ type: 'phase', phase: 'not-member', error: message, me: meValue });
        else if (initial) dispatch({ type: 'phase', phase: 'error', error: message, me: meValue });
        else notify(message);
        return;
      }
      dispatch({
        type: 'loaded',
        snap: snap.value,
        members: members.status === 'fulfilled' ? members.value : null,
        me: meValue,
        today: todayIST(),
      });
    },
    [notify],
  );

  const reload = useCallback(() => load(false), [load]);
  const retry = useCallback(() => {
    dispatch({ type: 'phase', phase: 'loading' });
    void load(true);
  }, [load]);

  const initialLoad = useEffectEvent(() => void load(true));
  useEffect(() => initialLoad(), []);

  const version = state.snap?.version;
  const poll = useEffectEvent(async () => {
    if (document.visibilityState !== 'visible' || state.phase !== 'ready') return;
    try {
      const v = await wf('version', {});
      if (v.version !== version) await load(false);
    } catch {
      // A failed poll is retried on the next tick; the user is told only when an action fails.
    }
  });
  useEffect(() => {
    const id = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const run = useCallback(
    async <A extends WorkflowAction>(
      action: A,
      payload: WorkflowActions[A]['payload'],
      opts: RunOptions = {},
    ): Promise<WorkflowActions[A]['result'] | undefined> => {
      try {
        return await wf(action, payload);
      } catch (e) {
        const status = errorStatus(e);
        let message = errorMessage(e);
        if (status === 409 && 'baseRevision' in (payload as object)) {
          // A revision conflict: load the latest data. Other 409s (for example a duplicate name) keep
          // the server's own message.
          if (/changed since/i.test(message)) message = CONFLICT_MESSAGE;
          await load(false);
        } else if (status === 403 && /not a member/i.test(message)) {
          dispatch({ type: 'phase', phase: 'not-member', error: message });
          return undefined;
        }
        if (opts.onError) opts.onError(message);
        else notify(message);
        return undefined;
      }
    },
    [load, notify],
  );

  const runCore = useCallback(
    async <T,>(action: string, payload: object, opts: RunOptions = {}): Promise<T | undefined> => {
      try {
        return await callModule<T>('core', action, payload);
      } catch (e) {
        const message = errorMessage(e);
        if (opts.onError) opts.onError(message);
        else notify(message);
        return undefined;
      }
    },
    [notify],
  );

  const reloadMembers = useCallback(async () => {
    const members = await runCore<Member[]>('members.list', {});
    if (members) dispatch({ type: 'members', members });
  }, [runCore]);

  const snap = state.snap;
  const lookups = useMemo(() => {
    const clients = snap?.clients ?? [];
    const matters = snap?.matters ?? [];
    const tasks = snap?.tasks ?? [];
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const matterById = new Map(matters.map((m) => [m.id, m]));
    const billingByMatter = new Map((snap?.billing ?? []).map((b) => [b.matterId, b]));
    // Only matters whose client is visible are shown.
    const visibleMatters = matters.filter((m) => clientById.has(m.clientId));
    const visibleIds = new Set(visibleMatters.map((m) => m.id));
    return {
      clients: [...clients].sort((a, b) => a.name.localeCompare(b.name)),
      matters: visibleMatters,
      tasks: tasks.filter((t) => visibleIds.has(t.matterId)),
      milestones: (snap?.milestones ?? []).filter((m) => visibleIds.has(m.matterId)),
      clientById,
      matterById,
      billingByMatter,
    };
  }, [snap]);

  const meEmail: PersonKey = state.me?.member?.email || state.me?.email || '';
  return {
    ...state,
    ...lookups,
    caps: snap?.capabilities ?? NO_CAPS,
    meEmail,
    isAdmin: !!state.me?.member?.isAdmin,
    dispatch,
    run,
    runCore,
    reload,
    retry,
    reloadMembers,
    notify,
    focusMatter,
    setFocusMatter,
    matterTab,
    setMatterTab,
    goToMatter,
    focusDeal,
    setFocusDeal,
    focusTask,
    setFocusTask,
    dealDrafts,
    setDealDrafts,
  };
}

export type WorkflowStore = ReturnType<typeof useWorkflowValue>;
const Ctx = createContext<WorkflowStore | null>(null);

export function WorkflowProvider({
  notify,
  page,
  children,
}: {
  notify: (message: string) => void;
  page: string;
  children: (store: WorkflowStore) => ReactNode;
}) {
  const value = useWorkflowValue(notify, page);
  return <Ctx.Provider value={value}>{children(value)}</Ctx.Provider>;
}

export function useWF() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWF must be used inside WorkflowProvider');
  return v;
}

// Mandate label used in selects and rows: "Client: Mandate".
export function useMatterLabel() {
  const { matterById, clientById } = useWF();
  return useCallback(
    (matterId: string) => {
      const m = matterById.get(matterId);
      if (!m) return 'Unknown mandate';
      return `${clientById.get(m.clientId)?.name ?? 'Unknown client'}: ${m.title}`;
    },
    [matterById, clientById],
  );
}

// Fetches data that is not part of the snapshot (feedback, time, invoices, activity). `key` identifies
// the request; change it (or call reload) to fetch again.
export function useRemote<T>(key: string | null, fetcher: () => Promise<T | undefined>) {
  const [result, setResult] = useState<{ key: string; data: T | undefined }>({ key: '', data: undefined });
  const [nonce, setNonce] = useState(0);
  const fullKey = key === null ? null : `${key}#${nonce}`;
  const fetchNow = useEffectEvent(() => fetcher());
  useEffect(() => {
    if (fullKey === null) return;
    let alive = true;
    void fetchNow().then((data) => {
      if (alive) setResult({ key: fullKey, data });
    });
    return () => {
      alive = false;
    };
  }, [fullKey]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const loading = fullKey !== null && result.key !== fullKey;
  // Keep showing the previous data for the same request while a refresh is in flight.
  const data = key !== null && result.key.startsWith(key + '#') ? result.data : undefined;
  return { data, loading, reload };
}

export function matterInput(m: Matter) {
  return {
    clientId: m.clientId,
    title: m.title,
    type: m.type,
    status: m.status,
    stage: m.stage,
    priority: m.priority,
    note: m.note,
    team: m.team,
    restricted: m.restricted,
    peerFeedbackVisible: m.peerFeedbackVisible,
    isDeal: m.isDeal,
  };
}

export const dealInput = (d: DealTracker): DealInput => ({
  dealValue: d.dealValue,
  representing: d.representing,
  targetCompany: d.targetCompany,
  targetDocs: d.targetDocs,
  counterparties: d.counterparties,
});
export const dealDirty = (x: DealDraft | undefined) =>
  !!x && JSON.stringify(x.draft) !== JSON.stringify(dealInput(x.base));

export function taskInput(t: Task) {
  return {
    matterId: t.matterId,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    preparedBy: t.preparedBy,
    reviewedBy: t.reviewedBy,
    dueDate: t.dueDate,
    priority: t.priority,
    notes: t.notes,
    steps: t.steps,
  };
}
