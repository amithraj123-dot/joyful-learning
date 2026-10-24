// Workflow module: action contract between browser and server (POST /api/modules, module "workflow").
// Every mutation of a revisioned record takes `baseRevision` and fails with 409 when the record changed
// since it was read, so concurrent edits never overwrite each other silently. Mutations return the saved
// record. Deletes are soft (deletedAt) and restorable unless stated.
//
// Permission rules (server-enforced; "Manager+" means Assistant Manager and above, as in the earlier app;
// admins have every right):
//   read          any active member; restricted matters only for their team, Directors, Partners, admins
//   clients/matters create, edit, delete, restore: Manager+
//   tasks         create: any member who can see the matter; edit: the matter team, the assignee, the
//                 creator, or Manager+; delete: the creator or Manager+
//                 sign-off: moving to "Sent to Client" or "Completed" when preparedBy is set requires a
//                 reviewedBy who is a different person; reviewedAt is stamped by the server
//   milestones    Manager+
//   time          own entries: any member; others' entries: Manager+; edit/delete own entries within 30
//                 days of recording them, others' with Manager+
//   billing       view and edit: Manager+
//   feedback      self: the member writes their own; review: Manager+ writes, the member reads their own;
//                 others' self-reflections: Manager+, or team members when peerFeedbackVisible
//   deal tracker  read: anyone who can see the matter; save: the matter team or Manager+
//   import        admins only
import type {
  Client,
  Counterparty,
  DealDoc,
  DealTracker,
  Feedback,
  Invoice,
  Matter,
  MatterBilling,
  Milestone,
  PersonKey,
  Snapshot,
  Task,
  TimeEntry,
} from './types';

type Rev = { baseRevision: number };
export type ClientInput = Pick<Client, 'name' | 'notes'>;
export type MatterInput = Pick<
  Matter,
  | 'clientId'
  | 'title'
  | 'type'
  | 'status'
  | 'stage'
  | 'priority'
  | 'note'
  | 'team'
  | 'restricted'
  | 'peerFeedbackVisible'
  | 'isDeal'
>;
export type TaskInput = Pick<
  Task,
  | 'matterId'
  | 'title'
  | 'status'
  | 'assignee'
  | 'preparedBy'
  | 'reviewedBy'
  | 'dueDate'
  | 'priority'
  | 'notes'
  | 'steps'
>;
export type TimeInput = Pick<
  TimeEntry,
  'matterId' | 'person' | 'date' | 'minutes' | 'description' | 'billable'
>;
export type MilestoneInput = Pick<Milestone, 'matterId' | 'title' | 'kind' | 'dueDate' | 'done' | 'owner'>;
export type BillingInput = Pick<MatterBilling, 'elStatus' | 'invoiceStatus' | 'feePaise' | 'adminNotes'>;
export type InvoiceInput = Pick<Invoice, 'invoiceNo' | 'date' | 'amountPaise' | 'entity' | 'notes'>;
export type DealInput = Pick<
  DealTracker,
  'dealValue' | 'representing' | 'targetCompany' | 'targetDocs' | 'counterparties'
>;

export interface LegacyPreview {
  clients: number;
  matters: number;
  tasks: number;
  timeEntries: number;
  milestones: number;
  invoices: number;
  dealTrackers: number;
  // Initials found in the legacy data, with the name/designation from its roster where known and the
  // member email they will map to (an existing member with the same initials, if any).
  people: { initials: string; name: string; designation: string; email: string | null }[];
  warnings: string[];
}

export interface WorkflowActions {
  // Reading
  snapshot: { payload: Record<string, never>; result: Snapshot };
  version: { payload: Record<string, never>; result: { version: number } };
  'time.list': {
    payload: { from: string; to: string; matterId?: string; person?: PersonKey }; // others' time: Manager+
    result: TimeEntry[];
  };
  'invoices.list': { payload: { matterId: string }; result: Invoice[] }; // billing viewers
  'deal.get': { payload: { matterId: string }; result: DealTracker }; // defaults when none saved (revision 0)
  'feedback.list': { payload: { matterId: string }; result: Feedback[] }; // filtered by the rules above
  trash: { payload: Record<string, never>; result: { clients: Client[]; matters: Matter[]; tasks: Task[] } };

  // Clients and matters
  'client.create': { payload: { client: ClientInput }; result: Client };
  'client.update': { payload: { id: string; client: ClientInput } & Rev; result: Client };
  'client.delete': { payload: { id: string } & Rev; result: true }; // also hides its matters
  'client.restore': { payload: { id: string }; result: Client };
  'matter.create': { payload: { matter: MatterInput }; result: Matter };
  'matter.update': { payload: { id: string; matter: MatterInput } & Rev; result: Matter };
  'matter.delete': { payload: { id: string } & Rev; result: true };
  'matter.restore': { payload: { id: string }; result: Matter };

  // Tasks
  'task.create': { payload: { task: TaskInput }; result: Task };
  'task.update': { payload: { id: string; task: TaskInput } & Rev; result: Task };
  'task.delete': { payload: { id: string } & Rev; result: true };
  'task.restore': { payload: { id: string }; result: Task };

  // Milestones (hard delete)
  'milestone.create': { payload: { milestone: MilestoneInput }; result: Milestone };
  'milestone.update': { payload: { id: string; milestone: MilestoneInput } & Rev; result: Milestone };
  'milestone.delete': { payload: { id: string }; result: true };

  // Time (hard delete)
  'time.create': { payload: { entry: TimeInput }; result: TimeEntry };
  'time.update': { payload: { id: string; entry: TimeInput }; result: TimeEntry };
  'time.delete': { payload: { id: string }; result: true };
  // CSV text. group: raw | client | matter | person. Formula-injection safe, UTF-8 BOM, CRLF.
  'time.export': {
    payload: { from: string; to: string; group: 'raw' | 'client' | 'matter' | 'person'; clientId?: string };
    result: { filename: string; csv: string };
  };

  // Billing
  'billing.update': { payload: { matterId: string; billing: BillingInput } & Rev; result: MatterBilling };
  'invoice.create': { payload: { matterId: string; invoice: InvoiceInput }; result: Invoice };
  'invoice.delete': { payload: { id: string }; result: true };

  // Deal tracker (whole tracker saved with a revision check)
  'deal.save': { payload: { matterId: string; deal: DealInput } & Rev; result: DealTracker };

  // Feedback
  'feedback.save': {
    payload: {
      matterId: string;
      member: PersonKey;
      kind: 'self' | 'review';
      text: string;
      rating: number | null;
    } & Rev;
    result: Feedback;
  };

  // Import from the earlier Google Sheet app (admins). Source is either the Apps Script web-app URL
  // (fetched by the server) or the JSON it returns, pasted or uploaded.
  'import.preview': { payload: { url?: string; json?: string }; result: LegacyPreview };
  'import.run': {
    payload: { url?: string; json?: string; people: { initials: string; email: string | null }[] };
    result: LegacyPreview; // counts actually imported
  };
}

export type WorkflowAction = keyof WorkflowActions;
export type { Counterparty, DealDoc };
