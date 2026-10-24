// Reads data from the earlier Google Sheet app (untrusted JSON) and plans the records to import. Pure:
// no database access. Ids are derived from the legacy ids, so planning the same data twice gives the
// same records and a second import skips what the first created.
import { CloudError } from '../../../lib/cloud-store.ts';
import {
  DOC_STATUSES,
  EL_STATUSES,
  INVOICE_STATUSES,
  MATTER_STAGES,
  RESIDENCY,
  TARGET_DOC_DEFAULTS,
  TASK_STATUSES,
  todayIST,
  type Client,
  type Counterparty,
  type DealDoc,
  type DealTracker,
  type DocStatus,
  type Feedback,
  type Invoice,
  type Matter,
  type MatterStatus,
  type Milestone,
  type PersonKey,
  type Task,
  type TimeEntry,
} from '../shared/types.ts';
import type { BillingRow } from './db.ts';
import { isDate, MAX_PAISE } from './validate.ts';

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const asList = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(asObj).filter((x): x is Obj => !!x) : []);
const str = (v: unknown, max: number) =>
  (typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : '').slice(0, max);
const num = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/,/g, '')) : NaN;
const stamp = (v: unknown, fallback: number) => (num(v) > 0 && num(v) < 1e14 ? Math.round(num(v)) : fallback);
const legacyInitials = (v: unknown) => {
  const s = str(v, 20).toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(s) ? s : '';
};

export interface LegacyData {
  clients: Obj[];
  roster: Obj[];
}

export function parseLegacy(json: string): LegacyData {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new CloudError(
      'The data is not valid JSON. If you used the web app address, check that it is deployed with access for anyone.',
    );
  }
  if (Array.isArray(data)) return { clients: asList(data), roster: [] };
  const o = asObj(data);
  if (o && Array.isArray(o.clients)) return { clients: asList(o.clients), roster: asList(o.teamMembers) };
  if (o && 'error' in o) throw new CloudError('The Apps Script returned an error instead of workflow data.');
  throw new CloudError(
    'This does not look like data from the earlier Workflow app: expected a list of clients, or an object with "clients".',
  );
}

const projectsOf = (data: LegacyData) => data.clients.flatMap((c) => asList(c.projects));

// Everyone the data mentions, by initials, with the roster name and designation where known.
export function legacyPeople(data: LegacyData) {
  const roster = new Map<string, { name: string; designation: string }>();
  const addRoster = (m: Obj) => {
    const initials = legacyInitials(m.initials);
    if (initials && !roster.has(initials))
      roster.set(initials, { name: str(m.name, 120), designation: str(m.designation, 40) });
  };
  data.roster.forEach(addRoster);
  const used = new Set<string>();
  const mention = (v: unknown) => {
    const i = legacyInitials(v);
    if (i) used.add(i);
  };
  for (const p of projectsOf(data)) {
    (Array.isArray(p.team) ? p.team : []).forEach(mention);
    for (const m of asList(p.teamMembers)) {
      addRoster(m);
      mention(m.initials);
    }
    for (const t of asList(p.todos)) [t.assignee, t.preparedBy, t.reviewedBy].forEach(mention);
    asList(p.hoursLog).forEach((h) => mention(h.who));
    for (const f of asList(p.feedbacks)) [f.member, f.updatedBy].forEach(mention);
  }
  const all = [...new Set([...roster.keys(), ...used])].sort();
  return all.map((initials) => ({
    initials,
    ...(roster.get(initials) ?? { name: '', designation: '' }),
    used: used.has(initials),
    known: roster.has(initials),
  }));
}

const MATTER_STATUS: Record<string, MatterStatus> = {
  active: 'active',
  urgent: 'urgent',
  onhold: 'on_hold',
  on_hold: 'on_hold',
  closed: 'closed',
};
const STAGE = new Map<string, Matter['stage']>([
  ...MATTER_STAGES.map((s) => [s.toLowerCase(), s] as const),
  ['term sheet & structuring', 'Term Sheet and Structuring'],
  ['definitive docs', 'Definitive Documents'],
  ['signing & closing', 'Signing and Closing'],
  ['post-transaction integration', 'Post-Transaction'],
]);
const DOC_STATUS = new Map<string, DocStatus>([
  ...DOC_STATUSES.map((s) => [s.toLowerCase(), s] as const),
  ['draft closed/ finalised', 'Finalised'],
  ['draft closed/finalised', 'Finalised'],
  ['n/a', 'Not Applicable'],
  ['draft shared', 'In Review'],
  ['negotiating', 'Comments Shared'],
  ['closed', 'Executed'],
]);
const docStatus = (v: unknown): DocStatus => DOC_STATUS.get(str(v, 60).toLowerCase()) ?? 'Not Started';
// Deal Room document names, in the vocabulary of the deal tracker.
const DOC_NAME = new Map([
  ['spa', 'SPA'],
  ['ssa', 'SSA'],
  ['captable', 'Capitalisation Table'],
  ['cap table', 'Capitalisation Table'],
  ['valuation reports', 'Valuation Report'],
  ['tax cps - 499', 'Tax CPs (s.499)'],
  ['computation', 'Tax Computation'],
]);

// Gives each record an id from its legacy id ("lg-" + the id, made safe), unique within its table.
function namer() {
  const used = new Set<string>();
  return (legacyId: unknown, fallback: string) => {
    const base = 'lg-' + (str(legacyId, 60).replace(/[^A-Za-z0-9_-]/g, '_') || fallback);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

export interface ImportPlan {
  clients: Client[];
  matters: Matter[];
  billing: BillingRow[];
  invoices: Invoice[];
  tasks: Task[];
  time: TimeEntry[];
  milestones: Milestone[];
  feedback: Feedback[];
  deals: DealTracker[];
  warnings: string[];
}

// Plans every record. `person` maps legacy initials to a person key; `actor` is the importing admin.
export function planImport(
  data: LegacyData,
  person: (initials: string) => PersonKey,
  actor: PersonKey,
  now: number,
): ImportPlan {
  const plan: ImportPlan = {
    clients: [],
    matters: [],
    billing: [],
    invoices: [],
    tasks: [],
    time: [],
    milestones: [],
    feedback: [],
    deals: [],
    warnings: [],
  };
  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const ids = {
    client: namer(),
    matter: namer(),
    invoice: namer(),
    task: namer(),
    time: namer(),
    milestone: namer(),
  };
  const key = (v: unknown) => {
    const i = legacyInitials(v);
    return i ? person(i) : null;
  };
  const today = todayIST(now);
  const clientNames = new Set<string>();
  let mixedFeedback = false;

  data.clients.forEach((c, ci) => {
    let name = str(c.name, 190) || 'Unnamed client';
    if (clientNames.has(name.toLowerCase())) {
      const original = name;
      for (let n = 2; clientNames.has(name.toLowerCase()); n++) name = `${original} (${n})`;
      plan.warnings.push(
        `The client name "${original}" appears more than once; it was imported as "${name}".`,
      );
    }
    clientNames.add(name.toLowerCase());
    const client: Client = {
      id: ids.client(c.id, `client-${ci + 1}`),
      name,
      notes: '',
      createdAt: stamp(c.createdAt, now),
      updatedAt: now,
      revision: 1,
      deletedAt: null,
    };
    plan.clients.push(client);
    const titles = new Set<string>();

    asList(c.projects).forEach((p, pi) => {
      let title = str(p.title, 190) || 'Untitled matter';
      if (titles.has(title.toLowerCase())) {
        const original = title;
        for (let n = 2; titles.has(title.toLowerCase()); n++) title = `${original} (${n})`;
        plan.warnings.push(
          `The matter title "${original}" appears more than once under ${name}; it was imported as "${title}".`,
        );
      }
      titles.add(title.toLowerCase());
      const type = str(p.type, 80) || 'Other';
      const status = MATTER_STATUS[str(p.status, 20).toLowerCase()];
      if (!status) plan.warnings.push(`${title} had no recognised status and was imported as Active.`);
      const teamInitials = [
        ...(Array.isArray(p.team) ? p.team : []),
        ...asList(p.teamMembers).map((m) => m.initials),
      ];
      const matter: Matter = {
        id: ids.matter(p.id, `${client.id.slice(3)}-matter-${pi + 1}`),
        clientId: client.id,
        title,
        type,
        status: status ?? 'active',
        stage: STAGE.get(str(p.stage, 80).toLowerCase()) ?? 'Term Sheet and Structuring',
        priority: p.isPriority === true,
        note: str(p.note, 5000),
        team: [...new Set(teamInitials.map(key).filter((k): k is string => !!k))].slice(0, 50),
        restricted: false,
        peerFeedbackVisible: p.allowTeamFeedbackVisibility === true,
        isDeal: /\bdeal\b/i.test(type),
        createdAt: stamp(p.createdAt, now),
        updatedAt: now,
        revision: 1,
        deletedAt: null,
      };
      plan.matters.push(matter);
      const local = matter.id.slice(3);

      // Billing and invoices. The legacy billed amount survives as an opening invoice when no invoice
      // entries explain it.
      const admin = asObj(p.admin);
      if (admin) {
        const fee = Math.round(num(admin.budgetAmount) * 100);
        plan.billing.push({
          matterId: matter.id,
          elStatus: EL_STATUSES.find((s) => s === admin.elStatus) ?? 'Not Started',
          invoiceStatus: INVOICE_STATUSES.find((s) => s === admin.invoiceStatus) ?? 'Not Invoiced',
          feePaise: fee > 0 && fee <= MAX_PAISE ? fee : null,
          adminNotes: str(admin.adminNotes, 2000),
          revision: 1,
          updatedAt: now,
        });
        let invoiced = 0;
        asList(admin.invoiceLogs).forEach((log, li) => {
          const amount = Math.round(num(log.amount) * 100);
          if (!(amount > 0 && amount <= MAX_PAISE))
            return skip(`invoice entries with no valid amount on ${title}`);
          const createdAt = stamp(log.createdAt, now);
          const date = str(log.date, 10);
          plan.invoices.push({
            id: ids.invoice(log.id, `${local}-invoice-${li + 1}`),
            matterId: matter.id,
            invoiceNo: str(log.invoiceNo, 60),
            date: isDate(date) ? date : todayIST(createdAt),
            amountPaise: amount,
            entity: str(log.entityRaisedOn, 200),
            notes: str(log.notes, 1000),
            createdBy: actor,
            createdAt,
          });
          invoiced += amount;
        });
        const billed = Math.round(num(admin.billedAmount) * 100);
        if (billed > 0 && billed <= MAX_PAISE && !invoiced)
          plan.invoices.push({
            id: ids.invoice(null, `${local}-opening`),
            matterId: matter.id,
            invoiceNo: '',
            date: today,
            amountPaise: billed,
            entity: '',
            notes: 'Opening balance (imported)',
            createdBy: actor,
            createdAt: now,
          });
        else if (billed > 0 && invoiced && billed !== invoiced)
          plan.warnings.push(
            `The billed amount on ${title} differed from its invoices; the billed amount is now the invoice total.`,
          );
      }

      asList(p.todos).forEach((t, ti) => {
        const taskTitle = str(t.text, 300);
        if (!taskTitle) return skip(`tasks with no text on ${title}`);
        const stepIds = new Set<string>();
        const steps = asList(t.steps)
          .slice(0, 100)
          .map((s, si) => {
            let id = str(s.id, 60).replace(/[^A-Za-z0-9_-]/g, '_') || `s${si + 1}`;
            while (stepIds.has(id)) id = `${id}-${si + 1}`;
            stepIds.add(id);
            return { id, text: str(s.text, 300), done: s.done === true };
          })
          .filter((s) => s.text);
        const due = str(t.dueDate, 10);
        plan.tasks.push({
          id: ids.task(t.id, `${local}-task-${ti + 1}`),
          matterId: matter.id,
          title: taskTitle,
          status:
            TASK_STATUSES.find((s) => s === t.workflowStatus) ??
            (t.done === true ? 'Completed' : 'Preparing'),
          assignee: key(t.assignee),
          preparedBy: key(t.preparedBy),
          reviewedBy: key(t.reviewedBy),
          reviewedAt: null,
          dueDate: isDate(due) ? due : null,
          priority: t.isPriority === true,
          notes: str(t.notes, 5000),
          steps,
          createdBy: actor,
          createdAt: stamp(t.createdAt, now),
          updatedAt: now,
          revision: 1,
          deletedAt: null,
        });
      });

      asList(p.hoursLog).forEach((h, hi) => {
        const who = key(h.who);
        const date = str(h.date, 10);
        const minutes = Math.round(num(h.hours) * 60);
        if (!who || !isDate(date) || !(minutes >= 1 && minutes <= 1440))
          return skip(`time entries with no person, date or valid hours on ${title}`);
        plan.time.push({
          id: ids.time(h.id, `${local}-time-${hi + 1}`),
          matterId: matter.id,
          person: who,
          date,
          minutes,
          description: str(h.description, 500),
          billable: true,
          createdBy: actor,
          createdAt: now,
          updatedAt: now,
        });
      });

      asList(p.milestones).forEach((m, mi) => {
        const milestoneTitle = str(m.title, 200);
        const due = str(m.dueDate, 10);
        if (!milestoneTitle || !isDate(due)) return skip(`milestones with no title or date on ${title}`);
        plan.milestones.push({
          id: ids.milestone(m.id, `${local}-milestone-${mi + 1}`),
          matterId: matter.id,
          title: milestoneTitle,
          kind: 'Deadline',
          dueDate: due,
          done: m.done === true,
          owner: null,
          createdAt: now,
          updatedAt: now,
          revision: 1,
        });
      });

      // Legacy feedback is one record per member holding both the self-reflection and the reviewer's
      // rating; it becomes a self record (text) and a review record (rating).
      const seen = new Set<string>();
      for (const f of asList(p.feedbacks)) {
        const member = key(f.member);
        if (!member || seen.has(member)) continue;
        seen.add(member);
        const author = key(f.updatedBy);
        const updatedAt = stamp(f.updatedAt, now);
        const text = str(f.feedbackText, 5000);
        const rating = Math.round(num(f.rating));
        const base = { matterId: matter.id, member, updatedAt, revision: 1 };
        const fid = `lg-${local}-${member.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 76);
        if (text)
          plan.feedback.push({
            ...base,
            id: fid + '-s',
            kind: 'self',
            text,
            rating: null,
            author: author ?? member,
          });
        if (rating >= 1 && rating <= 5)
          plan.feedback.push({
            ...base,
            id: fid + '-r',
            kind: 'review',
            text: '',
            rating,
            author: author ?? actor,
          });
        mixedFeedback ||= !!text || (rating >= 1 && rating <= 5);
      }

      const deal = planDeal(p, matter.id, now, (w) => plan.warnings.push(`${title}: ${w}`));
      if (deal) plan.deals.push(deal);
    });
  });

  for (const [what, n] of skipped) plan.warnings.push(`Skipped ${what} (${n}).`);
  if (mixedFeedback)
    plan.warnings.push(
      "The earlier app kept each member's self-reflection and the reviewer's rating in one record. The text was imported as the member's self-reflection and the rating as a review without text; check them on each matter.",
    );
  return plan;
}

// One deal tracker from the Deal Room (sellers and their documents) and the Live Deal Tracker. Parties
// are merged by name; the Live Deal Tracker wins where both list the same document.
function planDeal(p: Obj, matterId: string, now: number, warn: (w: string) => void): DealTracker | null {
  const live = asObj(p.liveDealTracker);
  const roomDocs = asList(p.dealDocuments);
  const sellers = Array.isArray(p.sellers) ? p.sellers : [];
  if (!live && !roomDocs.length && !sellers.length) return null;
  let n = 0;
  let truncated = false;
  const addDoc = (list: DealDoc[], name: unknown, status: unknown, notes: unknown) => {
    const docName = str(name, 120);
    if (!docName || list.some((d) => d.name.toLowerCase() === docName.toLowerCase())) return;
    if (list.length >= 50) {
      truncated = true;
      return;
    }
    list.push({ id: `d${++n}`, name: docName, status: docStatus(status), notes: str(notes, 1000) });
  };
  const residency = (v: unknown) => RESIDENCY.find((r) => r === v) ?? 'Resident';
  const parties = new Map<string, Counterparty>();
  const party = (name: unknown) => {
    const partyName = str(name, 200);
    if (!partyName) return null;
    const k = partyName.toLowerCase();
    if (!parties.has(k)) {
      if (parties.size >= 100) {
        truncated = true;
        return null;
      }
      parties.set(k, { id: `p${++n}`, name: partyName, incomeTax: 'Resident', fema: 'Resident', docs: [] });
    }
    return parties.get(k)!;
  };

  const targetDocs: DealDoc[] = [];
  if (live) {
    addDoc(targetDocs, 'SSA', live.ssaStatus, live.ssaNotes);
    addDoc(targetDocs, 'Capitalisation Table', live.captableStatus, live.captableNotes);
    addDoc(targetDocs, 'Valuation Report', live.valuationStatus, live.valuationNotes);
    for (const d of asList(live.customDocs)) addDoc(targetDocs, d.name, d.status, d.notes);
    for (const c of asList(live.counterparties)) {
      const cp = party(c.name);
      if (!cp) continue;
      cp.incomeTax = residency(c.incomeTax);
      cp.fema = residency(c.fema);
      addDoc(cp.docs, 'SPA', c.spaStatus, c.spaNotes);
      addDoc(cp.docs, 'Tax CPs (s.499)', c.taxCpStatus, c.taxCpNotes);
      addDoc(cp.docs, 'Tax Computation', c.computationStatus, c.computationNotes);
      for (const d of asList(c.customDocs)) addDoc(cp.docs, d.name, d.status, d.notes);
    }
  } else TARGET_DOC_DEFAULTS.forEach((name) => addDoc(targetDocs, name, 'Draft Pending', ''));
  sellers.forEach(party);
  for (const d of roomDocs) {
    const name = DOC_NAME.get(str(d.name, 120).toLowerCase()) ?? d.name;
    const cp = party(d.sellerName);
    addDoc(cp ? cp.docs : targetDocs, name, d.status, d.notes);
  }
  if (truncated)
    warn('the deal tracker had more documents or parties than can be kept; the extra ones were left out.');
  return {
    matterId,
    dealValue: str(live?.dealValue, 120),
    representing: live?.representing === 'Sell Side' ? 'Sell Side' : 'Buy Side',
    targetCompany: str(live?.companyName, 200),
    targetDocs,
    counterparties: [...parties.values()],
    revision: 1,
    updatedAt: now,
  };
}
