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

export const EXPENSE_CATEGORIES = [
  "Salaries",
  "Freelancers",
  "Software & Tools",
  "Advertising",
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
  projects: Project[];
  invoices: Invoice[];
  expenses: Expense[];
}
