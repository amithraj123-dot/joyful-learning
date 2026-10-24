// Workflow module: shared vocabulary and record shapes used by both the server and the browser.
// People are referenced by a "person key": a member email, or "legacy:XX" for initials imported from the
// earlier Google Sheet app that have not been mapped to a member yet.

export type PersonKey = string;

export const MATTER_STATUSES = ['active', 'urgent', 'on_hold', 'closed'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];
export const MATTER_STATUS_LABELS: Record<MatterStatus, string> = {
  active: 'Active',
  urgent: 'Urgent',
  on_hold: 'On hold',
  closed: 'Closed',
};

export const MATTER_STAGES = [
  'NDA / Teaser',
  'Due Diligence',
  'Information Memorandum',
  'Term Sheet and Structuring',
  'Definitive Documents',
  'Signing and Closing',
  'Post-Transaction',
] as const;
export type MatterStage = (typeof MATTER_STAGES)[number];

export const MATTER_TYPES = [
  'Deal (Buy Side)',
  'Deal (Sell Side)',
  'Structuring',
  'MSOP',
  'LP Working',
  'Anti-Dilution',
  'Compliance',
  'Other',
] as const;

export const TASK_STATUSES = [
  'Awaiting Data',
  'Preparing',
  'In Review',
  'Sent to Client',
  'Completed',
  'On Hold',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
// Statuses that need maker-checker sign-off when the task has a preparer.
export const SIGN_OFF_STATUSES: TaskStatus[] = ['Sent to Client', 'Completed'];

export const EL_STATUSES = ['Not Started', 'Drafting', 'Sent for Signature', 'Fully Executed'] as const;
export type ElStatus = (typeof EL_STATUSES)[number];

export const INVOICE_STATUSES = [
  'Not Invoiced',
  'Partially Invoiced',
  'Invoiced',
  'Paid',
  'Written Off',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// One vocabulary for every deal document (replaces the two lists in the earlier app).
export const DOC_STATUSES = [
  'Not Started',
  'Draft Pending',
  'In Review',
  'Comments Shared',
  'Finalised',
  'Executed',
  'Not Applicable',
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const RESIDENCY = ['Resident', 'Non-Resident'] as const;
export type Residency = (typeof RESIDENCY)[number];

export const MILESTONE_KINDS = [
  'Deadline',
  'Statutory Filing',
  'Client Meeting',
  'Signing',
  'Other',
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export interface Client {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  deletedAt: number | null; // soft delete; restorable by Manager and above
}

export interface Matter {
  id: string;
  clientId: string;
  title: string;
  type: string; // one of MATTER_TYPES, or a custom type
  status: MatterStatus;
  stage: MatterStage;
  priority: boolean;
  note: string; // status note / executive summary
  team: PersonKey[];
  // Restricted ("ethical wall"): only the team, Directors, Partners and admins can see the matter.
  restricted: boolean;
  // Team members may read each other's self-reflections on this matter.
  peerFeedbackVisible: boolean;
  isDeal: boolean; // shows the deal tracker
  createdAt: number;
  updatedAt: number;
  revision: number;
  deletedAt: number | null;
}

// Engagement and billing data; only returned to members who may see billing.
export interface MatterBilling {
  matterId: string;
  elStatus: ElStatus;
  invoiceStatus: InvoiceStatus;
  feePaise: number | null; // agreed fee, in paise
  billedPaise: number; // derived: sum of the matter's invoices (read-only)
  adminNotes: string;
  revision: number;
  updatedAt: number;
}

export interface Invoice {
  id: string;
  matterId: string;
  invoiceNo: string;
  date: string; // YYYY-MM-DD
  amountPaise: number;
  entity: string; // entity the invoice was raised on
  notes: string;
  createdBy: PersonKey;
  createdAt: number;
}

export interface TaskStep {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  matterId: string;
  title: string;
  status: TaskStatus; // "done" is derived: status === 'Completed'
  assignee: PersonKey | null; // currently with
  preparedBy: PersonKey | null;
  reviewedBy: PersonKey | null;
  reviewedAt: number | null;
  dueDate: string | null; // YYYY-MM-DD
  priority: boolean;
  notes: string;
  steps: TaskStep[];
  createdBy: PersonKey;
  createdAt: number;
  updatedAt: number;
  revision: number;
  deletedAt: number | null;
}

export interface TimeEntry {
  id: string;
  matterId: string;
  person: PersonKey;
  date: string; // YYYY-MM-DD in India time
  minutes: number;
  description: string;
  billable: boolean;
  createdBy: PersonKey;
  createdAt: number;
  updatedAt: number;
}

export interface Milestone {
  id: string;
  matterId: string;
  title: string;
  kind: MilestoneKind;
  dueDate: string; // YYYY-MM-DD
  done: boolean;
  owner: PersonKey | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface DealDoc {
  id: string;
  name: string;
  status: DocStatus;
  notes: string;
}
export interface Counterparty {
  id: string;
  name: string;
  incomeTax: Residency;
  fema: Residency;
  docs: DealDoc[];
}
export interface DealTracker {
  matterId: string;
  dealValue: string; // free text, e.g. "INR 45 crore"
  representing: 'Buy Side' | 'Sell Side';
  targetCompany: string;
  targetDocs: DealDoc[];
  counterparties: Counterparty[];
  revision: number;
  updatedAt: number;
}

// Feedback is two separate records per member per matter: the member's own self-reflection and the
// reviewer's (Manager and above) review with a rating.
export interface Feedback {
  id: string;
  matterId: string;
  member: PersonKey;
  kind: 'self' | 'review';
  text: string;
  rating: number | null; // 1 to 5, reviews only
  author: PersonKey;
  updatedAt: number;
  revision: number;
}

// What the signed-in member may do; computed on the server and sent with the snapshot so the UI can
// hide controls. The server enforces the same rules on every action.
export interface WorkflowCapabilities {
  manageMatters: boolean; // create/edit/close clients and matters, milestones
  viewBilling: boolean;
  editBilling: boolean;
  reviewPeople: boolean; // write reviews and ratings, see all feedback
  logTimeForOthers: boolean;
  exportFirmTime: boolean;
  importData: boolean;
}

export interface Snapshot {
  version: number; // highest updatedAt across workflow data; poll workflow.version and reload when it changes
  clients: Client[];
  matters: Matter[];
  tasks: Task[];
  milestones: Milestone[];
  billing: MatterBilling[]; // empty unless viewBilling
  capabilities: WorkflowCapabilities;
}

// Suggested deal documents. Target-level documents apply once per deal; counterparty documents per
// seller or buyer, with extra documents suggested by residency.
export const TARGET_DOC_DEFAULTS = ['SSA', 'Capitalisation Table', 'Valuation Report'];
export const COUNTERPARTY_DOC_DEFAULTS = ['SPA', 'Tax CPs (s.499)', 'Tax Computation'];
export const NON_RESIDENT_TAX_DOCS = ['Form 10F / TRC', 'Withholding computation and Form 15CA/CB'];
export const NON_RESIDENT_FEMA_DOCS = ['FEMA pricing valuation', 'Form FC-TRS'];

export const docCounts = (d: Pick<DealTracker, 'targetDocs' | 'counterparties'>) => {
  const all = [...d.targetDocs, ...d.counterparties.flatMap((c) => c.docs)];
  const applicable = all.filter((x) => x.status !== 'Not Applicable');
  const executed = applicable.filter((x) => x.status === 'Executed').length;
  return {
    total: applicable.length,
    executed,
    percent: applicable.length ? Math.round((executed / applicable.length) * 100) : 0,
  };
};

// Today's date in India time (YYYY-MM-DD); timesheet and due dates are Indian calendar dates.
export const todayIST = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);

export const formatINR = (paise: number | null | undefined) =>
  paise == null
    ? '-'
    : '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
