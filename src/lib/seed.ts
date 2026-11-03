import type { AppData, Settings } from "../types";
import { addDays, uid } from "./util";

export const defaultSettings: Settings = {
  agencyName: "My Agency",
  agencyEmail: "accounts@myagency.com",
  agencyAddress: "",
  taxId: "",
  currency: "INR",
  locale: "en-IN",
  defaultTaxRate: 18,
  invoicePrefix: "INV-",
  nextInvoiceNumber: 1,
  estimatePrefix: "EST-",
  nextEstimateNumber: 1,
  estimateValidDays: 30,
  paymentTermsDays: 15,
};

export function emptyData(): AppData {
  return { version: 1, settings: { ...defaultSettings }, clients: [], vendors: [], projects: [], estimates: [], invoices: [], expenses: [] };
}

/** Sample data so the dashboard isn't empty on first run. Clear it from Settings. */
export function sampleData(): AppData {
  const now = new Date();
  const iso = (monthsAgo: number, day: number) =>
    new Date(now.getFullYear(), now.getMonth() - monthsAgo, day).toISOString().slice(0, 10);
  const created = new Date().toISOString();

  const c1 = uid(), c2 = uid(), c3 = uid();
  const p1 = uid(), p2 = uid(), p3 = uid(), p4 = uid(), p5 = uid(), p6 = uid(), p7 = uid(), p8 = uid();

  const data = emptyData();
  data.clients = [
    { id: c1, name: "Brightleaf Foods", contactName: "Anita Rao", email: "anita@brightleaf.example", phone: "", address: "Bengaluru", taxId: "", notes: "", createdAt: created },
    { id: c2, name: "Northwind Realty", contactName: "Rahul Mehta", email: "rahul@northwind.example", phone: "", address: "Mumbai", taxId: "", notes: "", createdAt: created },
    { id: c3, name: "Kite Fintech", contactName: "Sara Thomas", email: "sara@kite.example", phone: "", address: "Kochi", taxId: "", notes: "", createdAt: created },
  ];
  data.projects = [
    { id: p1, clientId: c1, name: "Website redesign", status: "completed", budget: 700000, startDate: iso(5, 3), endDate: iso(2, 20), notes: "", createdAt: created },
    { id: p2, clientId: c1, name: "Social media retainer", status: "active", budget: 60000 * 12, startDate: iso(4, 1), endDate: "", notes: "Monthly retainer", createdAt: created },
    { id: p3, clientId: c2, name: "Lead-gen campaign", status: "active", budget: 300000, startDate: iso(2, 10), endDate: "", notes: "", createdAt: created },
    { id: p4, clientId: c3, name: "Brand identity", status: "active", budget: 250000, startDate: iso(3, 1), endDate: "", notes: "", createdAt: created },
    { id: p5, clientId: c3, name: "Annual report design", status: "lead", budget: 0, startDate: "", endDate: "", notes: "Needs an estimate", createdAt: created },
    { id: p6, clientId: c2, name: "SEO audit", status: "lead", budget: 0, startDate: "", endDate: "", notes: "", createdAt: created },
    { id: p7, clientId: c2, name: "Landing page sprint", status: "lead", budget: 0, startDate: "", endDate: "", notes: "", createdAt: created },
    { id: p8, clientId: c1, name: "Festive campaign", status: "active", budget: 0, startDate: iso(0, 1), endDate: "", notes: "", createdAt: created },
  ];

  let n = 1;
  const inv = (clientId: string, projectId: string, monthsAgo: number, items: [string, number, number][], status: "draft" | "sent" | "paid") => {
    const issue = iso(monthsAgo, 5);
    return {
      id: uid(),
      number: `INV-${String(n++).padStart(4, "0")}`,
      clientId,
      projectId,
      issueDate: issue,
      dueDate: addDays(issue, 15),
      status,
      items: items.map(([description, quantity, rate]) => ({ id: uid(), description, quantity, rate })),
      taxRate: 18,
      discount: 0,
      notes: "",
      paidDate: status === "paid" ? addDays(issue, 10) : "",
      createdAt: created,
    };
  };
  data.invoices = [
    inv(c1, p1, 5, [["Discovery & UX", 1, 250000]], "paid"),
    inv(c1, p1, 3, [["Design & development", 1, 300000]], "paid"),
    inv(c1, p1, 2, [["Launch & QA", 1, 150000]], "paid"),
    inv(c3, p4, 3, [["Brand strategy workshop", 1, 125000]], "paid"),
    inv(c3, p4, 1, [["Logo & identity system", 1, 125000]], "paid"),
    inv(c1, p2, 4, [["Social retainer", 1, 60000]], "paid"),
    inv(c1, p2, 3, [["Social retainer", 1, 60000]], "paid"),
    inv(c1, p2, 2, [["Social retainer", 1, 60000]], "paid"),
    inv(c1, p2, 1, [["Social retainer", 1, 60000]], "paid"),
    inv(c2, p3, 2, [["Campaign setup", 1, 80000], ["Ad creatives", 6, 7500]], "paid"),
    inv(c2, p3, 1, [["Campaign management", 1, 90000]], "sent"),
    inv(c1, p2, 0, [["Social retainer", 1, 60000]], "draft"),
  ];
  data.settings.nextInvoiceNumber = n;

  const exp = (monthsAgo: number, vendor: string, category: AppData["expenses"][number]["category"], amount: number, projectId = "", recurring = false) => ({
    id: uid(), date: iso(monthsAgo, 2), vendor, category, amount, projectId, description: "", recurring, createdAt: created,
  });
  const est = (type: AppData["estimates"][number]["type"], num: number, clientId: string, projectId: string, monthsAgo: number, items: [string, number, number][], status: AppData["estimates"][number]["status"]) => {
    const issue = iso(monthsAgo, 1);
    return {
      id: uid(),
      type,
      number: `EST-${String(num).padStart(4, "0")}`,
      clientId,
      projectId,
      issueDate: issue,
      validUntil: addDays(issue, 30),
      status,
      items: items.map(([description, quantity, rate]) => ({ id: uid(), description, quantity, rate })),
      taxRate: 18,
      discount: 0,
      notes: "",
      decidedDate: status === "approved" || status === "rejected" || status === "invoiced" ? addDays(issue, 4) : "",
      invoiceId: status === "invoiced" ? data.invoices[0].id : "",
      createdAt: created,
    };
  };
  data.estimates = [
    est("project", 1, c1, p1, 5, [["Website redesign: discovery, design, build, launch", 1, 700000]], "invoiced"),
    est("creative", 2, c2, p7, 0, [["Landing page design", 1, 45000], ["Development", 1, 60000]], "sent"),
    est("media", 3, c1, p8, 0, [["Festive campaign creatives", 8, 6000], ["Media planning", 1, 25000]], "approved"),
    est("creative", 4, c3, p4, 3, [["Brand identity (premium package)", 1, 400000]], "rejected"),
  ];
  data.settings.nextEstimateNumber = 5;

  const v = (category: AppData["vendors"][number]["category"], name: string, contactName = "", address = "") => ({
    id: uid(), category, name, contactName, email: "", phone: "", address, taxId: "", paymentTermsDays: 30, notes: "", active: true, createdAt: created,
  });
  data.vendors = [
    v("publications", "The Daily Courier", "Ad sales desk", "Bengaluru"),
    v("publications", "Metro Weekly", "", "Mumbai"),
    v("suppliers", "Freelance developer", "Arjun"),
    v("suppliers", "PrintPro Offset", "", "Kochi"),
    v("channels", "Star Regional TV"),
    v("radio", "City FM 91.1", "", "Bengaluru"),
    v("out_of_home", "Skyline Hoardings", "", "MG Road, Bengaluru"),
    v("websites", "TechNews Daily"),
    v("digital", "Meta Ads"),
    v("digital", "Google Ads"),
    v("theatres", "Cineplex Screens", "", "Kochi"),
  ];
  const vid = (name: string) => data.vendors.find((x) => x.name === name)?.id;

  data.expenses = [];
  for (let m = 5; m >= 0; m--) {
    data.expenses.push(exp(m, "Team payroll", "Salaries", 95000, "", true));
    data.expenses.push(exp(m, "Cowork Space", "Rent & Utilities", 25000, "", true));
    data.expenses.push(exp(m, "Figma / Google Workspace / Adobe", "Software & Tools", 12000, "", true));
  }
  data.expenses.push({ ...exp(3, "Freelance developer", "Freelancers", 70000, p1), vendorId: vid("Freelance developer") });
  data.expenses.push({ ...exp(2, "Meta Ads", "Media", 45000, p3), vendorId: vid("Meta Ads") });
  data.expenses.push({ ...exp(1, "Meta Ads", "Media", 52000, p3), vendorId: vid("Meta Ads") });
  data.expenses.push({ ...exp(1, "City FM 91.1", "Media", 38000, p3), vendorId: vid("City FM 91.1") });
  data.expenses.push(exp(1, "MacBook Air", "Hardware", 110000));
  return data;
}
