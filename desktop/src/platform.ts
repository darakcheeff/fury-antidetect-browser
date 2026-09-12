// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** Which platform a profile is for, read from where it opens.
 *
 *  AdsPower shows a platform icon beside every profile and the list reads
 *  faster for it: an operator with forty accounts scans for "the TikTok ones",
 *  not for names. Theirs comes from a domain list the team edits in settings
 *  and from favicons fetched over the network.
 *
 *  Ours is derived from the profile's start URLs and never fetched. A favicon
 *  request from the desktop shell would leave this machine over its own
 *  connection, not the profile's proxy, and would tell the platform which
 *  operator machine is interested in it — the exact link a profile exists to
 *  break. So: a short table of names and colours, and the bare domain for
 *  anything not in it. Offline, deterministic, and honest about what it knows. */

export interface Platform {
  /** Short display name. */
  name: string;
  /** Two letters for the badge. */
  mark: string;
  /** A stable hue per platform so the column scans by colour. */
  hue: number;
}

const KNOWN: [RegExp, Platform][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)meta\.com$/, { name: "Facebook", mark: "Fb", hue: 220 }],
  [/(^|\.)instagram\.com$/, { name: "Instagram", mark: "Ig", hue: 330 }],
  [/(^|\.)tiktok\.com$/, { name: "TikTok", mark: "Tt", hue: 0 }],
  [/(^|\.)ads\.google\.com$|(^|\.)adwords\.google\.com$/, { name: "Google Ads", mark: "GA", hue: 45 }],
  [/(^|\.)google\.com$|(^|\.)gmail\.com$|(^|\.)youtube\.com$/, { name: "Google", mark: "G", hue: 210 }],
  [/(^|\.)amazon\.[a-z.]+$/, { name: "Amazon", mark: "Am", hue: 35 }],
  [/(^|\.)ebay\.[a-z.]+$/, { name: "eBay", mark: "eB", hue: 120 }],
  [/(^|\.)etsy\.com$/, { name: "Etsy", mark: "Et", hue: 25 }],
  [/(^|\.)shopify\.com$|(^|\.)myshopify\.com$/, { name: "Shopify", mark: "Sh", hue: 100 }],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, { name: "X", mark: "X", hue: 0 }],
  [/(^|\.)linkedin\.com$/, { name: "LinkedIn", mark: "Li", hue: 200 }],
  [/(^|\.)reddit\.com$/, { name: "Reddit", mark: "Rd", hue: 15 }],
  [/(^|\.)pinterest\.[a-z.]+$/, { name: "Pinterest", mark: "Pi", hue: 355 }],
  [/(^|\.)telegram\.org$|(^|\.)t\.me$|(^|\.)web\.telegram\.org$/, { name: "Telegram", mark: "Tg", hue: 195 }],
  [/(^|\.)discord\.com$/, { name: "Discord", mark: "Dc", hue: 235 }],
  [/(^|\.)paypal\.com$/, { name: "PayPal", mark: "PP", hue: 215 }],
  [/(^|\.)stripe\.com$/, { name: "Stripe", mark: "St", hue: 250 }],
  [/(^|\.)binance\.com$/, { name: "Binance", mark: "Bn", hue: 45 }],
  [/(^|\.)coinbase\.com$/, { name: "Coinbase", mark: "Cb", hue: 220 }],
  [/(^|\.)avito\.ru$/, { name: "Avito", mark: "Av", hue: 150 }],
  [/(^|\.)ozon\.ru$/, { name: "Ozon", mark: "Oz", hue: 230 }],
  [/(^|\.)wildberries\.ru$/, { name: "Wildberries", mark: "Wb", hue: 300 }],
  [/(^|\.)vk\.com$/, { name: "VK", mark: "VK", hue: 210 }],
  [/(^|\.)yandex\.[a-z.]+$/, { name: "Yandex", mark: "Ya", hue: 50 }],
  [/(^|\.)openai\.com$|(^|\.)chatgpt\.com$/, { name: "OpenAI", mark: "Oa", hue: 160 }],
];

/** The platform of the FIRST start URL, or null when there is none or it does
 *  not parse. The first because it is what the operator sees when the profile
 *  opens; a second URL is a tool beside the platform, not the platform. */
export function platformOf(startUrls: string[] | undefined): Platform | null {
  const first = startUrls?.find((u) => u.trim() !== "");
  if (!first) return null;
  let host: string;
  try {
    host = new URL(first.includes("://") ? first : `https://${first}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  for (const [re, p] of KNOWN) {
    if (re.test(host)) return p;
  }
  // Unknown: the registrable-ish domain, coloured by its own hash so two
  // profiles on the same unknown site still match each other.
  const parts = host.split(".");
  const label = parts.length > 2 ? parts.slice(-2).join(".") : host;
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return { name: label, mark: label.slice(0, 2), hue: h % 360 };
}
