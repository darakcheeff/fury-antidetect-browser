// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useEffect, useRef, useState } from "react";
import { api, type Extension, type Profile, type Usage } from "../api";
import { useI18n } from "../i18n";

/** Extensions in one profile, and how much disk the profile takes.
 *
 *  Both halves of this dialog are interfaces to code that has existed since
 *  07.08.2026 and was reachable from nothing: ext.rs parses CRX3 and pins the
 *  extension's id so a clone keeps its logins, usage.rs measures and trims a
 *  profile — and the desktop had no button for either. To an operator that is
 *  indistinguishable from the feature not existing, and the market review of
 *  12.09.2026 (docs/12) listed "extensions" as a gap in a product that had
 *  them.
 *
 *  Why the two share a dialog: they are the two things one does to a profile
 *  that are neither its identity (the editor) nor its account (cookies,
 *  logins). Both concern what is on disk beside the browser data.
 *
 *  The file is read here, in the webview. The shell has no native file dialog,
 *  so what a chosen .crx is to this side is bytes, and bytes are what the
 *  agent is handed. */
export function Extensions({
  profile,
  running,
  onClose,
}: {
  profile: Profile;
  /** Trimming is refused while the browser holds its caches open; saying so
   *  before the click beats saying so after it. */
  running: boolean;
  onClose: () => void;
}) {
  const { t, say } = useI18n();
  const [list, setList] = useState<Extension[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      const [l, u] = await Promise.all([api.extensions(profile.id), api.profileUsage(profile.id)]);
      setList(l);
      setUsage(u);
    } catch (e) {
      setError(say(e));
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const install = async (f: File) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const b64 = await toBase64(f);
      const installed = await api.installExtension(profile.id, b64);
      setNote(t("ext.installed", { name: installed.name, version: installed.version }));
      await reload();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ height: "auto", maxHeight: "88vh" }} role="dialog" aria-modal="true">
        <div className="modalHead">
          <h2>{t("ext.title", { name: profile.name })}</h2>
        </div>

        <div className="form" style={{ paddingTop: "var(--s-5)", overflowY: "auto" }}>
          <div className="field">
            <label>{t("ext.installedHeading")}</label>
            <div>
              {list === null ? (
                <p className="hint">{t("ext.loading")}</p>
              ) : list.length === 0 ? (
                <p className="hint">{t("ext.none")}</p>
              ) : (
                <table className="plain">
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.name}</strong>{" "}
                          <span className="muted">{x.version}</span>
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {x.id}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="ghost danger"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                await api.removeExtension(profile.id, x.id);
                                await reload();
                              } catch (e) {
                                setError(say(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {t("ext.remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="hint">{t("ext.hint")}</p>
              {running && <p className="hint">{t("ext.restartHint")}</p>}
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
              <button disabled={busy} onClick={() => file.current?.click()}>
                {busy ? t("ck.working") : t("ext.add")}
              </button>
            </div>
          </div>

          <div className="field">
            <label>{t("ext.diskHeading")}</label>
            <div>
              {usage === null ? (
                <p className="hint">{t("ext.loading")}</p>
              ) : (
                <>
                  <p>
                    {t("ext.disk", {
                      total: mb(usage.total),
                      cache: mb(usage.cache),
                      keep: mb(usage.keep),
                    })}
                  </p>
                  <p className="hint">{t("ext.diskHint")}</p>
                  <button
                    disabled={busy || running || usage.cache === 0}
                    title={running ? t("ext.trimWhileOpen") : undefined}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      setNote(null);
                      try {
                        const r = await api.trimProfile(profile.id);
                        setNote(t("ext.trimmed", { mb: mb(r.bytes), n: r.removed.length }));
                        await reload();
                      } catch (e) {
                        setError(say(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {running ? t("ext.trimWhileOpen") : t("ext.trim")}
                  </button>
                </>
              )}
            </div>
          </div>

          {note && <p>{note}</p>}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="modalFoot">
          <div className="spacer" />
          <button onClick={onClose}>{t("ui.close")}</button>
        </div>
      </div>
    </div>
  );
}

/** One decimal above 10 MB is noise; below it, the decimal is the number. */
function mb(bytes: number): string {
  const m = bytes / (1024 * 1024);
  return m >= 10 ? Math.round(m).toString() : m.toFixed(1);
}

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    // A data: URL is "data:<type>;base64,<payload>"; the payload is what the
    // agent wants.
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.readAsDataURL(f);
  });
}
