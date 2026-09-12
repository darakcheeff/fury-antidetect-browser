// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useI18n } from "../i18n";
import { Icon, IconButton } from "./Icon";
import type { Me, Profile } from "../api";
import { platformOf } from "../platform";
import { assess } from "../consistency";

/** Every row's controls follow the permissions the SERVER resolved. Hiding a
 *  button is presentation, not protection — the server refuses regardless — but
 *  showing a control that will always fail is its own kind of lie.
 *
 *  In local mode there are no permissions to resolve, and the state that
 *  matters is different: not "who holds this" but "is it open right now". */
/** Is this profile open on THIS machine, right now?
 *
 *  Two different questions behind one answer, and which one applies depends on
 *  where the profile lives. A local profile is open when its browser process is
 *  running here, which the agent reports. A team profile is open when the
 *  server's lock is held by this user ON THIS MACHINE — matching on the user
 *  alone was wrong, because the same person signed in on a laptop and a desktop
 *  would see the laptop's live lock labelled "open here", with a Close button
 *  that worked and released a lock whose browser was still running elsewhere.
 *
 *  Exported because the window outside this table needs the same answer — a
 *  notice about a launch has to stop being shown when that launch has ended —
 *  and two spellings of "is it open" would drift the first time one changed. */
export function isOpenHere(
  p: Profile,
  where: { local: boolean; userId?: string; machine: string },
): boolean {
  if (where.local) return p.running;
  return (
    p.lock !== null &&
    p.lock.user_id === where.userId &&
    p.lock.machine_name === where.machine
  );
}

export function ProfileTable({
  profiles,
  me,
  thisMachine,
  local,
  busy,
  onLaunch,
  onStop,
  onEdit,
  onDelete,
  onExtensions,
  onNetwork,
  onClone,
  personas,
  sharing,
  selected,
  onToggle,
  onToggleAll,
  showProject,
}: {
  profiles: Profile[];
  me: Me | null;
  thisMachine: string;
  local: boolean;
  busy: boolean;
  onLaunch: (p: Profile, force?: boolean) => void;
  onStop: (p: Profile) => void;
  /** Local mode only: with a server, editing belongs where the permissions
   *  live, and that screen does not exist yet. */
  onEdit?: (p: Profile) => void;
  onDelete?: (p: Profile) => void;
  /** Extensions and disk usage — the two things beside the browser data. */
  onExtensions?: (p: Profile) => void;
  /** What network this profile is on, step by step. Opens from the proxy cell. */
  onNetwork?: (p: Profile) => void;
  /** Copies of this one — the same dialog the selection bar opens (5.24). */
  onClone?: (p: Profile) => void;
  /** The catalogue's persona ids, so a row on a persona that no longer exists
   *  says so before Open is pressed. Null while unknown. */
  personas?: Set<string> | null;
  /** Profile id → how many profiles come out of the same exit (consistency.ts). */
  sharing?: Map<string, number>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  /** Shown when the list spans projects — inside one, the column would repeat
   *  the same value on every row. */
  showProject: boolean;
}) {
  const { t } = useI18n();
  // Marked whenever there IS a server and the row is not on it.
  //
  // The first rule was "only when the list holds both kinds", and it was wrong
  // the moment somebody signed up: a brand new organisation has no profiles, so
  // the list was entirely local, nothing was marked, and the one row on screen
  // gave no hint that it was invisible to the team. The question the badge
  // answers is "is this on the server", and that question exists as soon as
  // there is a server.
  const hasServer = !local;
  if (profiles.length === 0) {
    return <p className="empty pad">{t("row.emptyProject")}</p>;
  }

  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="checkCol">
            <input
              type="checkbox"
              aria-label="select all"
              checked={selected.size > 0 && selected.size === profiles.length}
              // Neither on nor off: some rows are picked. Without this the box
              // reads as "nothing selected" while a bulk action is armed.
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < profiles.length;
              }}
              onChange={onToggleAll}
            />
          </th>
          <th>{t("col.name")}</th>
          {/* Only when the list spans projects. Inside one project the column
              would repeat the same value on every row. */}
          {showProject && <th>{t("col.project")}</th>}
          <th>{t("col.proxy")}</th>
          <th>{t("col.status")}</th>
          <th>{t("col.lastOpened")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => {
          const canLaunch = p.permissions.includes("launch");
          const canForce = p.permissions.includes("manage_access");
          const canReveal = p.permissions.includes("reveal_secrets");
          const canDelete = p.permissions.includes("delete_profile");
          const canEdit = p.permissions.includes("edit_profile");
          const locked = p.lock !== null;
          const open = isOpenHere(p, { local, userId: me?.user_id, machine: thisMachine });
          // What the row says about itself (docs/12 B). A red verdict disables
          // Open with the reason: the contradiction is the ban, not the
          // fingerprint, and a warning that scrolls past is not a guard.
          const shared = sharing?.get(p.id) ?? 0;
          const verdict = assess(p, personas ?? null, shared);
          const verdictText = verdict.notes.map((n) => t(n.key, n.vars)).join(" · ");

          return (
            <tr key={p.id} className={selected.has(p.id) ? "picked" : undefined}>
              <td className="checkCol">
                <input
                  type="checkbox"
                  aria-label={p.name}
                  checked={selected.has(p.id)}
                  onChange={() => onToggle(p.id)}
                />
              </td>
              <td>
                <div className="name">
                  {/* Where the profile opens, as a two-letter badge in the
                      platform's colour, so a list of forty scans by platform.
                      Derived from the start URLs, never fetched: see
                      platform.ts for why a favicon request would be a leak. */}
                  {(() => {
                    const pl = platformOf(p.start_urls);
                    return pl ? (
                      <span
                        className="platform"
                        title={pl.name}
                        style={{ background: `hsl(${pl.hue} 45% 30%)`, color: `hsl(${pl.hue} 80% 88%)` }}
                      >
                        {pl.mark}
                      </span>
                    ) : null;
                  })()}
                  {p.name}
                  {/* Only the local ones are marked, and only when the list is
                      mixed. Connected to a server, every row without this badge
                      is the team's; on a machine with no server every row would
                      carry it, which is noise rather than information. */}
                  {/* Marks rather than words. A row is read at a glance and a
                      list of them is read as a column, so two glyphs in a fixed
                      place carry more than two labels of different lengths
                      pushing the name around. Both keep their sentence on
                      hover. */}
                  {hasServer && p.origin === "local" && (
                    <span className="mark" title={t("col.onlyHereWhy")}>
                      <Icon name="laptop" size={13} />
                    </span>
                  )}
                  {p.shared_with > 0 && (
                    <span
                      className="mark"
                      title={t("col.sharedWith", { n: String(p.shared_with) })}
                    >
                      <Icon name="people" size={13} />
                      <span className="markN">{p.shared_with}</span>
                    </span>
                  )}
                  {/* The consistency verdict, only when there is one to give.
                      A tick on every consistent row would be a column of
                      ticks; silence is the tick. */}
                  {verdict.level !== "ok" && (
                    <span className={`mark verdict ${verdict.level}`} title={verdictText}>
                      <Icon name="alert" size={13} />
                    </span>
                  )}
                </div>
                {p.tags.length > 0 && (
                  <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
                )}
              </td>
              {showProject && (
                <td className="muted">
                  {p.project_name ?? <span className="dim">{t("col.noProject")}</span>}
                </td>
              )}
              <td
                className={p.proxy && onNetwork ? "clickable" : undefined}
                title={p.proxy && onNetwork ? t("net.current") : undefined}
                onClick={() => p.proxy && onNetwork?.(p)}
              >
                {p.proxy ? (
                  <>
                    <div className="mono">{p.proxy.display}</div>
                    {/* A country appears once the proxy has been checked. Until
                        then the line says so — it used to render a bare "?",
                        which reads as a broken value rather than a fact not yet
                        known. */}
                    <div className="muted small">
                      {p.proxy.country ?? t("row.proxyUnchecked")}
                      {/* The server masks the host for anyone without
                          reveal_secrets; say so, or a masked value reads like a
                          bug rather than a boundary. */}
                      {!canReveal && ` · ${t("row.masked")}`}
                      {/* How many profiles a site sees from this exit (docs/12 C).
                          Said from two; coloured from three. */}
                      {shared >= 2 && (
                        <span className={shared >= 3 ? "warn" : undefined}> · {t("row.sharedExit", { n: shared })}</span>
                      )}
                    </div>
                  </>
                ) : (
                  // Not cosmetic: the agent refuses to launch without one,
                  // because everything the core does goes through the relay.
                  <span className="warn">{t("row.noProxy")}</span>
                )}
              </td>
              <td>
                {/* A state, not an instruction.
                    This cell rendered `row.open` — the label on the button two
                    columns to the right — so a profile that was open said
                    "Open" in the column headed Status, next to a Close button.
                    Read as an offer to do something, which is what an
                    imperative is, and it was reported as exactly that: "if it
                    means it is open somewhere, then it is not Open". */}
                {open && <span className="state mineLock">{t("row.openHere")}</span>}
                {!open && locked && (
                  <span className="state lock">
                    {t("row.inUse", { who: p.lock!.user_email, machine: p.lock!.machine_name })}
                  </span>
                )}
                {!open && !locked && <span className="state free">{t("row.idle")}</span>}
              </td>
              <td className="muted small">
                {/* docs/12: the metric that matters to someone running accounts
                    is which profiles have gone stale. A profile untouched for
                    two months behaves differently from a live one. */}
                {p.last_opened_at ? new Date(p.last_opened_at).toLocaleString() : t("row.never")}
              </td>
              <td className="actions">
                <div>
                {!open && !locked && canLaunch && (
                  <button
                    disabled={busy || verdict.level === "block"}
                    title={verdict.level === "block" ? `${t("row.fixFirst")}: ${verdictText}` : undefined}
                    onClick={() => onLaunch(p)}
                  >
                    {t("row.open")}
                  </button>
                )}
                {open && (
                  <button className="ghost" disabled={busy} onClick={() => onStop(p)}>
                    {t("row.close")}
                  </button>
                )}
                {!open && locked && canForce && (
                  <button className="danger" disabled={busy} onClick={() => onLaunch(p, true)}>
                    {t("row.takeOver")}
                  </button>
                )}
                {!open && locked && !canForce && (
                  <span className="muted small">{t("row.askThem")}</span>
                )}
                {/* Edit and delete are icons; open keeps its word.
                    Three text buttons on every row read as three equal
                    choices, and they are not: opening a profile is what
                    somebody came to do, editing is occasional and deleting is
                    rare and irreversible. The icons carry title and aria-label,
                    so the name is a hover away and a screen reader still gets
                    a word rather than a glyph. */}
                {onExtensions && canEdit && (
                  <IconButton icon="puzzle" label={t("ext.extensions")} disabled={busy} onClick={() => onExtensions(p)} />
                )}
                {onEdit && canEdit && (
                  <IconButton icon="pencil" label={t("row.edit")} disabled={busy} onClick={() => onEdit(p)} />
                )}
                {onClone && canEdit && (
                  <IconButton icon="copy" label={t("bp.clone")} disabled={busy} onClick={() => onClone(p)} />
                )}
                {onDelete && canDelete && (
                  <IconButton
                    icon="trash"
                    danger
                    label={t("row.delete")}
                    title={open ? t("row.closeFirst") : t("row.delete")}
                    disabled={busy || open}
                    onClick={() => onDelete(p)}
                  />
                )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
