<!--
Delete whatever does not apply. A short PR that answers the two questions below
is worth more than a long one that answers neither.
-->

## What this changes

<!-- One or two sentences. What is different afterwards. -->

## How you know it works

<!--
The one question this project actually cares about, because the answer has been
"it doesn't" often enough to be worth asking every time.

  git apply --check   says a patch applies.
  the compiler        says it builds.

Neither says it works, and three times here the difference was the whole story:
a --lang conclusion that was right about the source and wrong about the browser;
a patch that typechecked in every language it was written in and did not
compile; and a geolocation patch that applied, linked, and answered every
request with "Timeout expired" because macOS asks the OS for permission before
it asks any provider for a position.

So: what did you run, and what did it print?
-->

## For a fingerprint patch

- [ ] There is a `core/verify/verify-NNNN.py` beside it, and it passes.
- [ ] It has a **control**: an unconfigured build reports something *different*.
      A check that also passes when nothing is wired up is not a check.
- [ ] It reads the value from more than the main frame — a Worker and an iframe
      at least. A config that reaches the top document and not the one below it
      is exactly the cross-context disagreement a detector looks for.
- [ ] The entry in `core/patches/series` says *why*, not just *what*. The series
      is the design record; a patch whose reasoning is only in the diff is a
      patch nobody can rebase.

## Checklist

- [ ] `cargo test --workspace` passes.
- [ ] `cargo clippy --all-targets` is clean for anything you touched.
- [ ] If you touched anything platform-specific:
      `cargo check -p fury-platform --target x86_64-pc-windows-msvc`.
- [ ] No measurement was quoted that you did not take. If a number is an
      estimate, the text says so — that rule is why the README says "measured
      rather than estimated" in some places and not in others.

## For a contributed persona

<!--
Delete this section unless the PR adds a file under shared/personas/contributed/.
`cargo run -p fury-detect -- personas-check` must pass; CI runs it. Three
questions it cannot answer:
-->

- **What machine is this?** Model, OS version, and whether the display is the
  built-in one or external (a persona captured on an external monitor describes
  a machine that does not exist when the laptop is on its own).
- **Anything that shapes the browser?** Display scaling other than the default,
  accessibility settings, a font manager. Extensions do not matter — the
  capture runs in a throwaway profile.
- **You understand this file is that machine's fingerprint** and you are
  publishing it under the repository's licence.

## For a catalogue extension

<!--
Delete this section unless the PR edits shared/extensions/catalogue.json.
`cargo test -p fury-shared extensions` must pass; CI runs it. Two questions it
cannot answer:
-->

- **Does the id resolve?** `https://chromewebstore.google.com/detail/<id>`
  opens and its title is the `name` in the entry.
- **Why this one?** Something an account operator installs into every profile
  by hand, open-source or from a vendor whose name carries the responsibility.
  Not a wallet, not an anti-captcha — see shared/extensions/README.md.
