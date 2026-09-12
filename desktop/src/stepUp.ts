// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { api } from "./api";

/** The shape of `ask` from useAsk — a prompt when `placeholder` is present. */
type Ask = (req: { title: string; detail?: string; placeholder?: string; confirmLabel: string; danger?: boolean }) => Promise<string | null>;

/** Run an action the organisation may guard with a second factor (docs/16
 *  5.32). The server refuses with `step_up_required` when this session has
 *  not shown a code in the last ten minutes; the person is asked for one,
 *  the session is marked, and the action runs again. Anything else — a wrong
 *  code, a person with nothing enrolled, an ordinary failure — is rethrown
 *  for the caller's usual `say(e)`.
 *
 *  Prompting only on refusal, rather than up front, means the dialog never
 *  appears for organisations that have not turned the guard on, and appears
 *  once per ten minutes rather than once per action for those that have. */
export async function withStepUp<T>(
  ask: Ask,
  t: (key: "sec.stepUpTitle" | "sec.stepUpDetail" | "auth.code" | "ui.continue") => string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== "err.stepUpRequired") throw e;
  }
  const code = await ask({
    title: t("sec.stepUpTitle"),
    detail: t("sec.stepUpDetail"),
    placeholder: t("auth.code"),
    confirmLabel: t("ui.continue"),
  });
  if (code === null) return null;
  await api.totpVerify(code.replace(/\D/g, ""));
  return await fn();
}
