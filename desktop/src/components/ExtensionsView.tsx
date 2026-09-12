// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ExtensionEverywhere, type Profile } from "../api";
import { useI18n } from "../i18n";

/** Every extension on this machine, and which profiles carry it.
 *
 *  The per-profile dialog answers "what does this profile have"; this section
 *  answers the question an operator with forty profiles actually asks — "which
 *  of them have the wallet, and which are missing it" — and lets a .crx go into
 *  many at once. Proposed 12.09.2026 after the AdsPower audit (docs/12, 5.30).
 *
 *  No catalogue here yet. What a catalogue should hold, and why installing by
 *  Web Store id is a decision rather than a feature, is written in docs/12
 *  under 5.31; until that decision the file comes from disk. */
export function ExtensionsView({ profiles }: { profiles: Profile[] }) {
  const { t, say } = useI18n();
  const [rows, setRows] = useState<ExtensionEverywhere[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which profiles the next .crx goes into. Starts as every local profile:
  // "install everywhere" is the common case, unticking is the exception.
  const local = profiles.filter((p) => p.origin === "local");
  const [targets, setTargets] = useState<Set<string>>(() => new Set(local.map((p) => p.id)));
  const [picking, setPicking] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.allExtensions());
      setError(null);
    } catch (e) {
      setError(say(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (f: File) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(r.error);
        r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
        r.readAsDataURL(f);
      });
      const r = await api.installExtensionMany([...targets], b64);
      const skippedOpen = r.skipped.filter((s) => s.reason === "open").length;
      setNote(
        [
          t("exv.installed", { name: r.extension?.name ?? f.name, n: r.installed.length }),
          skippedOpen > 0 ? t("exv.skippedOpen", { n: skippedOpen }) : "",
          r.skipped.length - skippedOpen > 0
            ? r.skipped.filter((s) => s.reason !== "open").map((s) => s.reason).join("; ")
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setPicking(false);
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;

  return (
    <>
      <div className="toolbar">
        <button className="primary" disabled={busy || local.length === 0} onClick={() => setPicking((v) => !v)}>
          {t("exv.add")}
        </button>
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          {t("bar.refresh")}
        </button>
      </div>

      {picking && (
        <div className="notice" style={{ display: "block" }}>
          <p style={{ margin: "0 0 var(--s-2)" }}>{t("exv.pickTargets", { n: targets.size })}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-4)", marginBottom: "var(--s-3)" }}>
            {local.map((p) => (
              <label key={p.id} className="row">
                <input
                  type="checkbox"
                  style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                  checked={targets.has(p.id)}
                  onChange={(e) =>
                    setTargets((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <span>{p.name}</span>
                {p.running && <span className="muted small">{t("exv.open")}</span>}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="linky" onClick={() => setTargets(new Set(local.map((p) => p.id)))}>{t("exv.all")}</button>
            <button className="linky" onClick={() => setTargets(new Set())}>{t("exv.clear")}</button>
            <div className="spacer" />
            <input
              ref={file}
              type="file"
              accept=".crx"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void install(f);
              }}
            />
            <button className="primary" disabled={busy || targets.size === 0} onClick={() => file.current?.click()}>
              {busy ? t("ck.working") : t("exv.chooseFile", { n: targets.size })}
            </button>
          </div>
          <p className="hint">{t("ext.hint")}</p>
        </div>
      )}

      {note && <div className="notice">{note}</div>}
      {error && <div className="notice warnBar">{error}</div>}

      <div className="tableWrap">
        {rows === null ? (
          <p className="empty pad">{t("ext.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="empty pad">{t("exv.none")}</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("exv.extension")}</th>
                <th>{t("exv.inProfiles")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <div className="name">
                      {x.name} <span className="muted">{x.version}</span>
                    </div>
                    <div className="muted small mono">{x.id}</div>
                  </td>
                  <td>
                    <div className="tags">
                      {x.profiles.map((p) => (
                        <span key={p.id} title={p.version !== x.version ? t("exv.older", { v: p.version }) : undefined}>
                          {nameOf(p.id)}
                          {p.version !== x.version && ` · ${p.version}`}
                        </span>
                      ))}
                    </div>
                    {local.length > x.profiles.length && (
                      <div className="muted small" style={{ marginTop: "var(--s-1)" }}>
                        {t("exv.missingFrom", { n: local.length - x.profiles.length })}
                      </div>
                    )}
                  </td>
                  <td className="actions">
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          for (const p of x.profiles) {
                            await api.removeExtension(p.id, x.id);
                          }
                          setNote(t("exv.removed", { name: x.name, n: x.profiles.length }));
                          await load();
                        } catch (e) {
                          setError(say(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("exv.removeEverywhere")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
