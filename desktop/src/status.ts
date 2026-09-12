// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** The account's stage (docs/16 5.5): free text with a suggested vocabulary.
 *
 *  Free text because an agency's stages are its own — one runs "farm → warm →
 *  spend → rest", another "new → verified → limited". A fixed enum would be
 *  ours, and the first team whose stages did not fit would put theirs in tags
 *  again, which is where they were before this existed. The suggestions get a
 *  colour and a translation; anything else is shown as typed, in neutral. */
export const SUGGESTED = ["new", "warming", "ready", "working", "paused", "limited", "banned"] as const;
export type Suggested = (typeof SUGGESTED)[number];

/** Hue per known stage; unknown stages are grey. Green for the ones that
 *  earn, amber for the ones that wait, red for the ones that are over. */
export function statusHue(status: string): number | null {
  switch (status.trim().toLowerCase()) {
    case "new": return 210;
    case "warming": return 40;
    case "ready": return 150;
    case "working": return 120;
    case "paused": return 200; // a cool grey-blue: parked, not dead
    case "limited": return 25;
    case "banned": return 5;
    default: return null;
  }
}

export function isSuggested(s: string): s is Suggested {
  return (SUGGESTED as readonly string[]).includes(s.trim().toLowerCase());
}
