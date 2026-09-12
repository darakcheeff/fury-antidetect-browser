# The extension catalogue

`catalogue.json` is what the Extensions section of the desktop offers to
install by one click. Each entry is a Chrome Web Store id and a few words on
why it is here. The `.crx` itself is never in this repository: it is fetched
from Google's update endpoint **through the proxy of the profile it is
installed into** (docs/12, decision B of 12.09.2026), and the agent checks
that the key inside the package derives the id that was asked for
(`agent/src/ext.rs`). There is no hash of the CRX here on purpose — the Web
Store ships a new version whenever the developer does, and a pinned hash
would break the catalogue weekly while proving nothing the key check does not.

## What belongs here

Things an account operator installs into every profile by hand, that are
open-source or from a vendor whose name carries the responsibility: a content
blocker, a cookie editor, an authenticator, a password manager. Popular and
harmless is a virtue — a profile whose extensions look like a real person's
is the point.

What does **not** belong: wallets and anti-captcha services. Those are
installed from the developer's own link, and a catalogue that "recommends"
one is taking responsibility for somebody else's service.

## Adding one

1. Check the id resolves on `https://chromewebstore.google.com/detail/<id>`
   and the title matches `name`.
2. Add an entry: `id` (32 letters a–p), `name`, `summary.en` and
   `summary.ru`, `category` (`blocking` · `cookies` · `auth` · `appearance` ·
   `tools`), `homepage`, `licence`, `added_by` (your GitHub handle),
   `added_on`.
3. `cargo test -p fury-shared extensions` — the catalogue is parsed and checked
   in CI: ids well-formed and unique, both summaries present, category known.
4. Open a pull request. The PR template has a section for it.
