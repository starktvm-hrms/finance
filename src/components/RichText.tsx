import { useEffect, useRef } from "react";
import Quill from "quill";
import { cleanHtml, isEmpty } from "./SafeHtml";

const TOOLBAR = [
  [{ header: 1 }, { header: 2 }],
  [{ font: [] }, { size: ["small", false, "large", "huge"] }],
  ["bold", "italic", "underline", "strike", "blockquote"],
  [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
  ["link", "image"],
  ["clean"],
];

const MAX_IMAGE_BYTES = 300 * 1024;

export default function RichTextEditor({ value, onChange, placeholder, label }: { value: string; onChange: (html: string) => void; placeholder?: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const quill = useRef<Quill | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current || quill.current) return;
    const el = document.createElement("div");
    host.current.appendChild(el);
    const q = new Quill(el, {
      theme: "snow",
      placeholder,
      modules: {
        toolbar: {
          container: TOOLBAR,
          handlers: {
            // Keep embedded images small: they are stored with the estimate.
            image() {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/png,image/jpeg,image/gif,image/webp";
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                if (file.size > MAX_IMAGE_BYTES) return alert("Please use an image under 300 KB.");
                const r = new FileReader();
                r.onload = () => {
                  const range = q.getSelection(true);
                  q.insertEmbed(range.index, "image", r.result as string, "user");
                };
                r.readAsDataURL(file);
              };
              input.click();
            },
          },
        },
      },
    });
    q.root.setAttribute("aria-label", label);
    q.clipboard.dangerouslyPasteHTML(cleanHtml(value || ""));
    q.on("text-change", () => {
      const html = q.root.innerHTML;
      onChangeRef.current(isEmpty(html) ? "" : cleanHtml(html));
    });
    quill.current = q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="rte" ref={host} />;
}

