import type { AppData, Project } from "../types";
import type { Access } from "./access";
import { isMine } from "./scope";

export interface Notice {
  id: string; // stable: the same event always has the same id
  at: string; // ISO time
  title: string;
  body: string;
  jobId: string;
  needsAction: boolean; // an approval waiting for this person
}

const jobLabel = (p: Project) => [p.number, p.name].filter(Boolean).join(" · ");

/** Whether this approval request is addressed to the signed-in person. */
function askedMe(p: Project, data: AppData, access: Access): boolean {
  const ap = p.approval;
  if (!ap) return false;
  if (ap.headId) return ap.headId === access.employeeId;
  // Requests made before approvers were linked to employees: match the name ("Meera Pillai (Media)").
  const me = data.employees.find((e) => e.id === access.employeeId);
  return !!me && (ap.head === me.name || ap.head.startsWith(`${me.name} (`));
}

/**
 * Notifications for the signed-in person:
 * - a job sent to them for approval (until they decide);
 * - their job approved or rejected;
 * - admins also see every approval that is still waiting.
 */
export function notifications(data: AppData, access: Access, user: string | null, myName: string): Notice[] {
  const out: Notice[] = [];
  for (const p of data.projects) {
    const ap = p.approval;
    if (!ap) continue;
    const client = data.clients.find((c) => c.id === p.clientId)?.name;
    if (ap.status === "pending") {
      const mine = askedMe(p, data, access);
      if (mine || access.admin) {
        out.push({
          id: `ask:${p.id}:${ap.askedAt ?? ""}`,
          at: ap.askedAt || p.createdAt,
          title: mine ? `${ap.askedBy || "Someone"} sent you a job to approve` : `Waiting for ${ap.head} to approve`,
          body: [jobLabel(p), client].filter(Boolean).join(" — "),
          jobId: p.id,
          needsAction: mine,
        });
      }
    } else {
      const askedByMe = (!!ap.askedBy && ap.askedBy === myName) || isMine(p, user, access.employeeId);
      const when = ap.decidedAt || ap.decidedDate || "";
      const recent = Date.now() - Date.parse(when) < 30 * 864e5; // decisions from the last 30 days
      if (askedByMe && recent && ap.decidedBy !== myName) {
        out.push({
          id: `decided:${p.id}:${ap.decidedAt ?? ap.decidedDate}`,
          at: ap.decidedAt || ap.decidedDate || p.createdAt,
          title: `${ap.decidedBy || ap.head} ${ap.status === "approved" ? "approved" : "rejected"} your job`,
          body: [jobLabel(p), client].filter(Boolean).join(" — "),
          jobId: p.id,
          needsAction: false,
        });
      }
    }
  }
  return out.sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || b.at.localeCompare(a.at));
}
