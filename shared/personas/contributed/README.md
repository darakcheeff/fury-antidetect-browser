# Contributed personas

One real machine per file, captured with **Settings → Add this machine to the
catalogue** in the Fury desktop (or `tools/detect-suite/capture-chrome.sh` +
`fury-detect persona`). The file name is the persona's id.

Before opening a pull request, run what CI runs:

```bash
cargo run -p fury-detect -- personas-check
```

It refuses a file that does not parse, fails `validate()`, reuses an id, claims
`source: "measured"` (reserved for the two machines the maintainers dumped and
checked by hand — a contribution says `"capture"`), sits below the rarity floor,
or carries anything network-shaped.

**A persona is a machine's fingerprint.** Publishing one publishes how that
computer looks to every website. Capture from a machine that does not run live
accounts.

Weights are not "how many people sent this": contributors are not a sample of
the population, and a catalogue weighted by them would seat accounts on
enthusiasts' hardware more often than the world does. The converter writes
0.01; a maintainer adjusts it from public distributions (Steam Hardware Survey
for GPUs, StatCounter for screens) when merging.
