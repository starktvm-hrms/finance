export type ID = string;

export interface Settings {
  agencyName: string;
  agencyEmail: string;
  agencyAddress: string;
  taxId: string;
  currency: string; // ISO code, e.g. INR, USD
  locale: string; // e.g. en-IN
  defaultTaxRate: number; // percent
  invoicePrefix: string;
  nextInvoiceNumber: number;
  estimatePrefix: string;
  nextEstimateNumber: number;
  estimateValidDays: number;
  paymentTermsDays: number;
  jobPrefix: string;
  nextJobNumber: number;
  // Job number layout (see lib/jobno.ts): code-serial-date HLL0417041126 (default),
  // code-date-serial HLL0411260417, client HLL26110417, prefix JOB-0001
  jobNumberStyle?: "code-serial-date" | "code-date-serial" | "client" | "prefix";
  departmentHeads: string[]; // people who can approve new jobs
  logo: string; // uploaded data-URL logo ("" = the logo shipped with the app)
  logoIncludesName?: boolean; // uploaded logo already shows the agency name (default true)
  letterheadFilled?: boolean; // the agency's letterhead details were filled in once (see seed.ts)
  // Letterhead (printed on estimates)
  agencyPhone: string;
  agencyFax: string;
  agencyWebsite: string;
  agencyPan: string;
  agencyCin: string;
  stateCode: string; // GST state code, e.g. 32 (Kerala); blank = first 2 digits of the GSTIN
  // Bank details printed in the estimate footer
  bankAccountName: string;
  bankName: string;
  bankBranch: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankSwift: string;
  estimateTerms: string; // one per line; {days} = validity, {agency} = agency name
  invoiceTerms?: string; // one per line; {days} = payment terms, {agency} = agency name
  signatureLabels: string; // comma-separated, printed above the signature lines
  productionEstimatePrefix: string; // PE → PE/26-27/369
  mediaEstimatePrefix: string; // ME → ME/26-27/370
}

/** Countries an estimate can be billed in; sets the currency and number format. */
export const COUNTRIES = [
  { code: "IN", label: "India", currency: "INR", locale: "en-IN" },
  { code: "AE", label: "United Arab Emirates", currency: "AED", locale: "en-AE" },
  { code: "US", label: "United States", currency: "USD", locale: "en-US" },
  { code: "GB", label: "United Kingdom", currency: "GBP", locale: "en-GB" },
  { code: "SG", label: "Singapore", currency: "SGD", locale: "en-SG" },
  { code: "AU", label: "Australia", currency: "AUD", locale: "en-AU" },
  { code: "CA", label: "Canada", currency: "CAD", locale: "en-CA" },
  { code: "EU", label: "Eurozone", currency: "EUR", locale: "de-DE" },
] as const;
export type CountryCode = (typeof COUNTRIES)[number]["code"];

export interface ClientProduct {
  name: string;
  subProducts: string[];
}

export interface Client {
  id: ID;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
  pan?: string;
  code?: string; // 2-4 letters used in job numbers (HLL, DT), set by an admin; suggested from the name when blank
  products?: ClientProduct[]; // brands/products the agency works on for this client
  notes: string;
  createdAt: string;
}

/** Vendor lists under "Clients & Vendors" (media owners and suppliers). */
export const VENDOR_CATEGORIES = [
  { id: "publications", label: "Publications", one: "publication", hint: "Newspapers and magazines" },
  { id: "suppliers", label: "Suppliers", one: "supplier", hint: "Printers, production houses, freelancers and other suppliers" },
  { id: "channels", label: "Channels", one: "channel", hint: "TV channels and networks" },
  { id: "radio", label: "Radio", one: "radio station", hint: "Radio stations" },
  { id: "out_of_home", label: "Out Of Home", one: "OOH vendor", hint: "Hoardings, transit and other outdoor media" },
  { id: "websites", label: "Websites", one: "website", hint: "Websites and publishers selling ad space" },
  { id: "digital", label: "Digital", one: "digital platform", hint: "Ad platforms and networks (Meta, Google, etc.)" },
  { id: "theatres", label: "Theatres", one: "theatre", hint: "Cinema and theatre advertising" },
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]["id"];

export interface Vendor {
  id: ID;
  category: VendorCategory;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string; // city / location for OOH, theatres etc.
  taxId: string;
  paymentTermsDays: number;
  notes: string;
  active: boolean;
  createdAt: string;
}

export interface Department {
  id: ID;
  name: string;
  description: string;
  createdAt: string;
}

export interface Branch {
  id: ID;
  name: string;
  address: string;
  phone: string;
  createdAt: string;
}

export interface Employee {
  id: ID;
  name: string;
  email: string;
  phone: string;
  designation: string;
  departmentId: ID | "";
  branchId: ID | "";
  isHead: boolean; // department head: can approve new jobs
  active: boolean;
  createdAt: string;
}

/** Departments every new agency starts with (editable). */
export const DEFAULT_DEPARTMENTS = [
  "Admin", "Finance", "Production", "Media", "Social Media", "Service(T)", "Service(NT)", "Management", "Human Resources",
];

export type ProjectStatus = "lead" | "active" | "on_hold" | "completed" | "cancelled";

export interface JobApproval {
  head: string; // department head asked to approve
  headId?: ID; // their employee record (their login gets the notification)
  status: "pending" | "approved" | "rejected";
  decidedDate: string;
  askedBy?: string; // name of the person who asked (shown in the job's timeline)
  askedAt?: string; // ISO time
  decidedBy?: string;
  decidedAt?: string;
}

/** A job handed to another department (e.g. Finance, to estimate it). */
export interface JobForward {
  departmentId: ID;
  by: string; // name
  at: string; // ISO time
}

/** A job (shown as "Jobs"; named Project in code). `name` is the job title. */
export interface Project {
  id: ID;
  number?: string; // JOB-0001 or the agency's own (e.g. HLL26100417); missing on jobs made before numbering
  jobType?: string; // e.g. Brochure Printing; carried onto the job's estimates
  category?: EstimateType; // Creative, Production, Media… (the tabs); carried onto its estimates
  clientId: ID;
  contactPerson?: string;
  product?: string;
  subProduct?: string;
  approval?: JobApproval;
  departmentId?: ID; // department the job belongs to (default: its creator's)
  forwards?: JobForward[];
  createdBy?: string; // login that created it (blank on records made before tracking)
  createdById?: ID; // employee linked to that login
  name: string;
  status: ProjectStatus;
  budget: number;
  startDate: string;
  endDate: string;
  notes: string;
  createdAt: string;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";

export interface LineItem {
  id: ID;
  description: string;
  quantity: number;
  rate: number;
  platform?: string; // media estimates: publication / channel / platform the line is booked with
  unit?: string; // media estimates: unit shown next to the quantity (e.g. 1, 10 sec, 25x4 cm)
}

export interface Invoice {
  id: ID;
  number: string;
  clientId: ID;
  projectId: ID | "";
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  items: LineItem[];
  taxRate: number; // percent
  discount: number; // flat amount
  notes: string;
  paidDate: string;
  country?: CountryCode;
  roundOff?: boolean;
  estimateId?: ID; // the estimate it bills (part or full)
  billing?: "full" | "part" | "balance"; // how much of that estimate it bills
  // Same printed fields as estimates (copied from the estimate it was raised from)
  type?: EstimateType;
  title?: string;
  jobType?: string;
  productLabel?: string;
  clientAddress?: string;
  header?: string;
  remarks?: string;
  discountPct?: number;
  createdBy?: string; // login that created it (blank on records made before tracking)
  createdById?: ID; // employee linked to that login
  createdAt: string;
}

/** Estimates and invoices share one sheet layout (form and print). */
export type SheetDoc = Estimate | Invoice;
export type SheetKind = "estimate" | "invoice";

/** Estimate types, shown as tabs on the Estimates page. */
export const ESTIMATE_TYPES = [
  { id: "creative", label: "Creative", hint: "Concepts, design, copy and campaign creative" },
  { id: "production", label: "Production", hint: "Print, video and other production" },
  { id: "media", label: "Media", hint: "Media buying: print, TV, radio, outdoor, digital" },
  { id: "shoot", label: "Shoot", hint: "Photo and video shoots" },
  { id: "events", label: "Events", hint: "Events, activations and launches" },
  { id: "retainer", label: "Retainer", hint: "Monthly or ongoing retainers" },
  { id: "project", label: "Project", hint: "One-off projects and everything else" },
] as const;
export type EstimateType = (typeof ESTIMATE_TYPES)[number]["id"];

export type EstimateStatus = "draft" | "sent" | "approved" | "rejected" | "invoiced";

/** A quote sent to the client for approval; once approved it becomes an invoice. */
export interface Estimate {
  id: ID;
  number: string;
  type?: EstimateType; // missing on estimates made before types existed → "project"
  clientId: ID;
  projectId: ID | "";
  issueDate: string;
  validUntil: string;
  status: EstimateStatus;
  items: LineItem[];
  taxRate: number;
  discount: number;
  notes: string;
  decidedDate: string; // approved / rejected on
  decidedAt?: string; // ISO time of that decision
  decidedBy?: string; // name of the person who recorded it
  invoiceId: ID | ""; // set once converted
  title?: string;
  jobType?: string; // printed as "Job Type", e.g. Brochure Printing
  productLabel?: string; // printed as "Product"; defaults to the job's product + sub-product
  header?: string; // sanitised rich-text HTML shown above the line items
  remarks?: string; // sanitised rich-text HTML shown below the totals
  clientAddress?: string; // billing address as printed on this estimate
  country?: CountryCode; // billing country → currency (default: agency currency)
  discountPct?: number; // when set, discount = subtotal × pct
  roundOff?: boolean; // round the grand total to a whole unit
  createdBy?: string; // login that created it (blank on records made before tracking)
  createdById?: ID; // employee linked to that login
  createdAt: string;
}

export const EXPENSE_CATEGORIES = [
  "Salaries",
  "Freelancers",
  "Software & Tools",
  "Advertising",
  "Media",
  "Rent & Utilities",
  "Hardware",
  "Travel",
  "Taxes & Fees",
  "Office",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: ID;
  date: string;
  vendor: string;
  vendorId?: ID; // set when the payee is in a vendor list
  category: ExpenseCategory;
  amount: number;
  projectId: ID | "";
  description: string;
  recurring: boolean;
  departmentId?: ID; // default: the job's department
  createdBy?: string; // login that created it (blank on records made before tracking)
  createdById?: ID; // employee linked to that login
  createdAt: string;
}

/** Money received against a job before (or without) the invoice being fully paid. */
export interface Payment {
  id: ID;
  projectId: ID;
  amount: number;
  date: string;
  note: string;
  createdBy?: string;
  createdById?: ID;
  createdAt: string;
}

/** A post in a job's conversation (sanitised rich text). */
export interface Message {
  id: ID;
  projectId: ID;
  html: string;
  createdBy?: string;
  createdById?: ID;
  createdAt: string;
}

/** A file uploaded to a job. The file itself is stored on the server. */
export interface Attachment {
  id: ID;
  projectId: ID;
  name: string;
  size: number;
  type: string;
  createdBy?: string;
  createdById?: ID;
  createdAt: string;
}

export interface AppData {
  version: 1;
  settings: Settings;
  clients: Client[];
  vendors: Vendor[];
  employees: Employee[];
  departments: Department[];
  branches: Branch[];
  projects: Project[];
  estimates: Estimate[];
  invoices: Invoice[];
  expenses: Expense[];
  payments: Payment[];
  messages: Message[];
  attachments: Attachment[];
}
