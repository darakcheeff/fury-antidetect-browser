// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! The extension catalogue: `shared/extensions/catalogue.json`, baked in.
//!
//! A short list of Web Store ids with a sentence each, offered in the
//! Extensions section for one-click install. The package is fetched by the
//! agent through the profile's own proxy and its key checked against the id
//! (`agent/src/ext.rs`); this module only knows what to offer. See the README
//! beside the file for what belongs in it and how to add an entry.

use serde::{Deserialize, Serialize};

const RAW: &str = include_str!("../../shared/extensions/catalogue.json");

/// One offered extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    /// The Chrome Web Store id: 32 letters `a`–`p`.
    pub id: String,
    pub name: String,
    /// Why it is here, in the two languages the desktop speaks.
    pub summary: Summary,
    pub category: String,
    pub homepage: String,
    pub licence: String,
    pub added_by: String,
    pub added_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Summary {
    pub en: String,
    pub ru: String,
}

pub const CATEGORIES: &[&str] = &["blocking", "cookies", "auth", "appearance", "tools"];

/// The catalogue as shipped. Parsed on each call; it is a few kilobytes.
pub fn all() -> Vec<Entry> {
    serde_json::from_str(RAW).expect("shared/extensions/catalogue.json parses — the test below checks it")
}

/// Is this a Web Store id: 32 characters, each `a`–`p`.
pub fn is_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|c| (b'a'..=b'p').contains(&c))
}

/// Everything wrong with the catalogue, for CI and the README's step 3.
pub fn problems() -> Vec<String> {
    let entries: Vec<Entry> = match serde_json::from_str(RAW) {
        Ok(e) => e,
        Err(e) => return vec![format!("catalogue.json does not parse: {e}")],
    };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for e in &entries {
        let who = format!("{} ({})", e.name, e.id);
        if !is_id(&e.id) {
            out.push(format!("{who}: id is not 32 letters a-p"));
        }
        if !seen.insert(e.id.clone()) {
            out.push(format!("{who}: id listed twice"));
        }
        if e.summary.en.trim().is_empty() || e.summary.ru.trim().is_empty() {
            out.push(format!("{who}: both summaries are required"));
        }
        if !CATEGORIES.contains(&e.category.as_str()) {
            out.push(format!("{who}: category {:?} is not one of {CATEGORIES:?}", e.category));
        }
        if !e.homepage.starts_with("https://") {
            out.push(format!("{who}: homepage must be https"));
        }
        if e.added_by.trim().is_empty() || e.added_on.len() != 10 {
            out.push(format!("{who}: added_by and added_on (YYYY-MM-DD) are required"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_catalogue_is_well_formed() {
        let p = problems();
        assert!(p.is_empty(), "{}", p.join("\n"));
        assert!(!all().is_empty());
    }

    #[test]
    fn ids_are_32_letters_a_to_p() {
        assert!(is_id("ddkjiahejlhfcafbddmgiahcphecmpfh"));
        assert!(!is_id("ddkjiahejlhfcafbddmgiahcphecmpf"));
        assert!(!is_id("ddkjiahejlhfcafbddmgiahcphecmpfz"));
        assert!(!is_id("DDKJIAHEJLHFCAFBDDMGIAHCPHECMPFH"));
    }
}
