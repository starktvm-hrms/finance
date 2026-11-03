import type { LineItem } from "../types";
import { uid } from "../lib/util";

/** An empty line for an estimate or invoice. */
export const newLine = (): LineItem => ({ id: uid(), description: "", quantity: 1, rate: 0 });
