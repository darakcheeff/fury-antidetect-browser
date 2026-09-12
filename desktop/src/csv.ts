// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** A CSV reader that copes with what spreadsheets export: quoted fields with
 *  commas and newlines inside, doubled quotes, a comma or semicolon or tab as
 *  the separator (chosen by counting in the first line), CRLF. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** The profile fields a CSV can carry, and the headings that mean them —
 *  English, Russian, and what the two most-copied competitors export. */
export type Field = "name" | "proxy" | "tags" | "status" | "notes" | "start_urls" | "timezone" | "languages" | "persona";

const HEADINGS: Record<Field, string[]> = {
  name: ["name", "profile", "profile name", "title", "имя", "название", "профиль"],
  proxy: ["proxy", "proxy url", "прокси", "proxy_url"],
  tags: ["tags", "tag", "метки", "теги", "group", "группа"],
  status: ["status", "stage", "статус", "стадия"],
  notes: ["notes", "note", "comment", "remark", "заметки", "заметка", "комментарий", "примечание"],
  start_urls: ["start_urls", "start url", "start urls", "url", "urls", "site", "sites", "platform", "сайт", "сайты", "ссылки"],
  timezone: ["timezone", "time zone", "tz", "часовой пояс", "пояс"],
  languages: ["languages", "language", "lang", "языки", "язык"],
  persona: ["persona", "persona_id", "device", "персона", "устройство"],
};

/** Map header cells to fields. Unknown headings are kept as null so the
 *  preview can say "ignored" beside them rather than silently dropping them. */
export function mapHeader(header: string[]): (Field | null)[] {
  return header.map((h) => {
    const k = h.trim().toLowerCase();
    for (const f of Object.keys(HEADINGS) as Field[]) if (HEADINGS[f].includes(k)) return f;
    return null;
  });
}

/** Does the first row look like a header rather than data? */
export function looksLikeHeader(row: string[]): boolean {
  return mapHeader(row).filter(Boolean).length >= Math.max(1, Math.ceil(row.length / 2));
}

/** Split a multi-valued cell: tags, URLs, languages. */
export function splitMulti(s: string): string[] {
  return s.split(/[;|\n]|,\s*/).map((x) => x.trim()).filter(Boolean);
}
