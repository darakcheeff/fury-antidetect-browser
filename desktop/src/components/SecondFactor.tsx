// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useCallback, useEffect, useState } from "react";
import { api, type SessionRow } from "../api";
import { useI18n } from "../i18n";

/** My second factor and my sessions — the part of team security that belongs
 *  to the person, not the organisation. Lives in Settings → Team server.
 *
 *  Enrolment is the standard three steps: a secret, the authenticator scans or
 *  types it, a code proves it took. The URI is shown as text as well as the
 *  secret, because a QR code needs a renderer this shell does not carry and a
 *  string every authenticator can take by hand. */
export function SecondFactor() {
  const { t, say } = useI18n();
  const [status, setStatus] = useState<{ enabled: boolean; pending: boolean; required_by_org: string } | null>(null);
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.totpStatus());
      setSessions(await api.sessions(false));
      setError(null);
    } catch (e) {
      setError(say(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mustEnrol = sessionStorage.getItem("fury.mustEnrolTotp") === "1";

  return (
    <div className="settingsGroup">
      <h2>{t("sf.title")}</h2>
      {error && <p className="error">{error}</p>}
      {status && (
        <>
          {mustEnrol && !status.enabled && <div className="verdict bad">{t("sf.mustEnrol")}</div>}
          <p>
            {status.enabled ? t("sf.enabled") : t("sf.disabled")}
            {status.required_by_org !== "off" && (
              <span className="muted"> · {t("sf.required", { level: t(`sec.sf${status.required_by_org === "always" ? "Always" : "NewDevice"}` as never) })}</span>
            )}
          </p>
          {!status.enabled && !setup && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  setSetup(await api.totpSetup());
                  setCode("");
                } catch (e) {
                  setError(say(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("sf.enable")}
            </button>
          )}
          {setup && (
            <div style={{ marginTop: "var(--s-2)" }}>
              <p className="hint">{t("sf.scan")}</p>
              <p className="mono small" style={{ wordBreak: "break-all" }}>{setup.uri}</p>
              <p>
                <span className="muted">{t("sf.secret")}: </span>
                <span className="mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span>
              </p>
              <div className="row">
                <input
                  inputMode="numeric"
                  placeholder={t("auth.code")}
                  value={code}
                  maxLength={6}
                  style={{ width: 120 }}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  className="primary"
                  disabled={busy || code.length !== 6}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api.totpConfirm(code);
                      sessionStorage.removeItem("fury.mustEnrolTotp");
                      setSetup(null);
                      await load();
                    } catch (e) {
                      setError(say(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("sf.confirm")}
                </button>
                <button className="ghost" onClick={() => setSetup(null)}>{t("ui.cancel")}</button>
              </div>
            </div>
          )}
          {status.enabled && (
            <div className="row" style={{ marginTop: "var(--s-2)" }}>
              <input
                inputMode="numeric"
                placeholder={t("auth.code")}
                value={code}
                maxLength={6}
                style={{ width: 120 }}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button
                className="ghost danger"
                disabled={busy || code.length !== 6}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.totpDisable(code);
                    setCode("");
                    await load();
                  } catch (e) {
                    setError(say(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("sf.disable")}
              </button>
              <span className="hint">{t("sf.disableHint")}</span>
            </div>
          )}
        </>
      )}

      <h3 style={{ marginTop: "var(--s-5)" }}>{t("sf.mySessions")}</h3>
      {sessions.length === 0 ? (
        <p className="hint">{t("ext.loading")}</p>
      ) : (
        <table className="grid">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.machine_name || "—"}
                  {s.current && <span className="muted small"> · {t("sec.thisSession")}</span>}
                </td>
                <td className="mono small">{s.ip ?? "—"}</td>
                <td className="muted small">{new Date(s.last_seen_at).toLocaleString()}</td>
                <td className="actions">
                  {!s.current && (
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.revokeSession(s.id);
                          await load();
                        } catch (e) {
                          setError(say(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("sec.endSession")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
