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
}

export interface Client {
  id: ID;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
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

export type ProjectStatus = "lead" | "active" | "on_hold" | "completed" | "cancelled";

export interface Project {
  id: ID;
  clientId: ID;
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
  createdAt: string;
}

export type EstimateStatus = "draft" | "sent" | "approved" | "rejected" | "invoiced";

/** A quote sent to the client for approval; once approved it becomes an invoice. */
export interface Estimate {
  id: ID;
  number: string;
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
  invoiceId: ID | ""; // set once converted
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
  createdAt: string;
}

export interface AppData {
  version: 1;
  settings: Settings;
  clients: Client[];
  vendors: Vendor[];
  projects: Project[];
  estimates: Estimate[];
  invoices: Invoice[];
  expenses: Expense[];
}
