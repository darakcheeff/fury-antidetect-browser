// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! The domain-list matcher, which lives in shared-rs since 12.09.2026 so the
//! server can read the organisation's lists with the same code. Everything
//! about what it matches and why it sits in the relay rather than in DNS is in
//! `fury_shared::domains`.

pub use fury_shared::domains::Blocklist;
