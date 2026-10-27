'use client';
// Mail view state shared by the pages: the Outlook account, firm members and visible mandates (for the
// pickers), and unsaved draft edits. Edits are kept per draft in memory for as long as the tab is open.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { callModule } from '../../../core/client/api';
import type { MailSetup } from '../shared/contract';
import { mail } from '../shared/client';
import type { Address, MailAccount } from '../shared/types';
import { errorMessage, type Member, type Nav, type Target } from './lib';

export interface DraftEdit {
  body: string;
  to: Address[];
  cc: Address[];
  replyAll: boolean;
  revision: number; // the draft revision these edits started from
}

// Outlives the view, so edits survive moving between pages and modules within the tab.
const edits = new Map<string, DraftEdit>();

export interface AccountState {
  phase: 'loading' | 'ready' | 'error';
  account: MailAccount | null;
  setup: MailSetup | null;
  error: string;
}

interface MailStore {
  navigate: Nav;
  notify: (message: string) => void;
  account: AccountState;
  reloadAccount: () => Promise<void>;
  setAccount: (a: MailAccount | null) => void;
  members: Member[];
  targets: Target[];
  targetsLoaded: boolean;
  memberName: (email: string) => string;
  targetById: Map<string, Target>;
  getEdit: (draftId: string) => DraftEdit | undefined;
  setEdit: (draftId: string, edit: DraftEdit | null) => void;
  unsavedCount: number;
}

const Ctx = createContext<MailStore | null>(null);

export function useMail() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useMail outside MailProvider');
  return s;
}

export function MailProvider({
  navigate,
  notify,
  children,
}: {
  navigate: Nav;
  notify: (message: string) => void;
  children: ReactNode;
}) {
  const [account, setAccountState] = useState<AccountState>({
    phase: 'loading',
    account: null,
    setup: null,
    error: '',
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [unsavedCount, setUnsavedCount] = useState(edits.size);

  const reloadAccount = useCallback(async () => {
    try {
      const r = await mail('account.get', {});
      setAccountState({ phase: 'ready', account: r.account, setup: r.setup, error: '' });
    } catch (e) {
      setAccountState((s) => ({ ...s, phase: 'error', error: errorMessage(e) }));
    }
  }, []);
  const setAccount = useCallback(
    (a: MailAccount | null) => setAccountState((s) => ({ ...s, phase: 'ready', account: a, error: '' })),
    [],
  );

  useEffect(() => {
    void reloadAccount();
    // Pickers only; a failure leaves them empty and the rest of Mail works.
    callModule<Member[]>('core', 'members.list', {})
      .then((list) => setMembers(list.filter((m) => m.active)))
      .catch(() => {});
    callModule<Target[]>('workflow', 'meetings.targets', {})
      .then(setTargets)
      .catch(() => {})
      .finally(() => setTargetsLoaded(true));
  }, [reloadAccount]);

  // Warn before the tab closes while draft edits are unsaved.
  useEffect(() => {
    if (!unsavedCount) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedCount]);

  const value = useMemo<MailStore>(() => {
    const byEmail = new Map(members.map((m) => [m.email, m]));
    return {
      navigate,
      notify,
      account,
      reloadAccount,
      setAccount,
      members,
      targets,
      targetsLoaded,
      memberName: (email) => byEmail.get(email)?.name ?? email,
      targetById: new Map(targets.map((t) => [t.matterId, t])),
      getEdit: (id) => edits.get(id),
      setEdit: (id, edit) => {
        if (edit) edits.set(id, edit);
        else edits.delete(id);
        setUnsavedCount(edits.size);
      },
      unsavedCount,
    };
  }, [navigate, notify, account, reloadAccount, setAccount, members, targets, targetsLoaded, unsavedCount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
