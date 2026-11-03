import type { AppData, Client, Project } from "../types";

const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const TEST_MARK = "(test GSTIN/PAN)";

/** GSTIN check character (15th) for the first 14 characters. */
export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

/** Small deterministic generator so a client always gets the same test numbers. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Valid-format test PAN (AAACx9999A: 4th letter C = company, 5th = first letter
 * of the name) and GSTIN (state + PAN + 1Z + check character).
 */
export function testTaxIds(client: Pick<Client, "id" | "name">, stateCode = "32") {
  const rnd = seeded(client.id + client.name);
  const L = () => LETTERS[Math.floor(rnd() * 26)];
  const D = () => String(Math.floor(rnd() * 10));
  const initial = (client.name.match(/[A-Za-z]/)?.[0] ?? "X").toUpperCase();
  const pan = `${L()}${L()}${L()}C${initial}${D()}${D()}${D()}${D()}${L()}`;
  const body = `${stateCode.padStart(2, "0")}${pan}1Z`;
  return { pan, gstin: body + gstinCheckChar(body) };
}

export function fillTestTaxIds(data: AppData, stateCode: string): Client[] {
  return data.clients
    .filter((c) => !c.taxId?.trim() || !c.pan?.trim())
    .map((c) => {
      const ids = testTaxIds(c, stateCode);
      return {
        ...c,
        taxId: c.taxId?.trim() || ids.gstin,
        pan: c.pan?.trim() || ids.pan,
        notes: c.notes?.includes(TEST_MARK) ? c.notes : `${c.notes ? c.notes + "\n" : ""}${TEST_MARK}`,
      };
    });
}

export function removeTestTaxIds(data: AppData, stateCode: string): Client[] {
  return data.clients
    .filter((c) => c.notes?.includes(TEST_MARK))
    .map((c) => {
      const ids = testTaxIds(c, stateCode);
      return {
        ...c,
        taxId: c.taxId === ids.gstin ? "" : c.taxId,
        pan: c.pan === ids.pan ? "" : c.pan,
        notes: c.notes.replace(`\n${TEST_MARK}`, "").replace(TEST_MARK, "").trim(),
      };
    });
}

/** Jobs without a number get the next ones in the series (oldest first). */
export function numberJobs(data: AppData): { jobs: Project[]; next: number } {
  const s = data.settings;
  let next = s.nextJobNumber;
  const jobs = [...data.projects]
    .filter((p) => !p.number?.trim())
    .sort((a, b) => (a.startDate || a.createdAt).localeCompare(b.startDate || b.createdAt))
    .map((p) => ({ ...p, number: `${s.jobPrefix}${String(next++).padStart(4, "0")}` }));
  return { jobs, next };
}

/** Jobs without a type take the job type of their latest estimate, else "General". */
export function typeJobs(data: AppData): Project[] {
  return data.projects
    .filter((p) => !p.jobType?.trim())
    .map((p) => {
      const est = data.estimates
        .filter((e) => e.projectId === p.id && e.jobType)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
      return { ...p, jobType: est?.jobType || "General" };
    });
}
