# Contributed personas

One real machine per file. The file name is the persona's id.

The short way in needs no install: open
**https://furyteamtop.github.io/fury-antidetect-browser/** in ordinary Chrome,
press «Снять отпечаток» → «Скачать JSON», drop the file into
[the issue form](https://github.com/furyteamtop/fury-antidetect-browser/issues/new?template=persona.yml).
A workflow converts it, checks it and opens the pull request under your handle
(`contributed_by`), with what you said the machine was (`machine`). The other
ways — **Settings → Add this machine to the catalogue** in the desktop, or
`tools/detect-suite/capture-chrome.sh` + `fury-detect persona` — end in the same
form or in a pull request of your own.

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
