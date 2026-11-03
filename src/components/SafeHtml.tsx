import DOMPurify from "dompurify";
import "quill/dist/quill.snow.css"; // styles for headings, lists and indents in stored rich text

/**
 * Rich-text HTML is shared between everyone who uses the app, so it is always
 * sanitised: when the editor saves it and again before it is displayed.
 * (We read the editor's own DOM, not Quill's HTML-export helper.)
 */
const PURIFY = {
  ALLOWED_TAGS: ["p", "br", "h1", "h2", "strong", "b", "em", "i", "u", "s", "blockquote", "ol", "ul", "li", "a", "img", "span", "sub", "sup"],
  ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "class", "data-list"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
};
export const cleanHtml = (html: string) => DOMPurify.sanitize(html, PURIFY);

export const isEmpty = (html: string) => !html || html.replace(/<(?!img)[^>]*>/g, "").trim() === "";


/** Display stored rich text (sanitised again on the way out). */
export function RichTextView({ html, className = "" }: { html?: string; className?: string }) {
  if (!html || isEmpty(html)) return null;
  return <div className={`rte-view ql-editor ${className}`} dangerouslySetInnerHTML={{ __html: cleanHtml(html) }} />;
}
