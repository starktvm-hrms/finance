import type { Settings } from "../types";

const base = import.meta.env.BASE_URL;
/** Agency logo shipped with the app; used until another one is uploaded in Settings. */
export const DEFAULT_LOGO = `${base}brand-logo.png`;
/** The round mark on its own, for the sidebar and browser tab. */
export const BRAND_MARK = `${base}brand-mark.png`;

export const logoSrc = (s: Pick<Settings, "logo">) => s.logo || DEFAULT_LOGO;
/** The default logo already spells out the agency name, so it isn't repeated next to it. */
export const logoShowsName = (s: Pick<Settings, "logo" | "logoIncludesName">) => (s.logo ? s.logoIncludesName !== false : true);
