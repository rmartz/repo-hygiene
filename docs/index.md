---
okf_version: 0.2
---

# Documentation

Documentation for `@rmartz/repo-hygiene`, written in
[Open Knowledge Format](okf-format.md).

- [Setting up repo-hygiene in a consuming repo](consuming.md) — install the
  reusable workflow, choose and configure checks, and verify the setup.
- [Running repo-hygiene](overview.md) — the file-set modes, the CLI, and per-repo
  configuration.
- [Checks](checks/index.md) — one page per check: what each flags, its config, and
  whether it is default-on.
- [The distribution contract](distribution-contract.md) — why a check must be safe
  with no config, and the `defaultOn` flag.
- [How a check reaches consumers](consumer-path.md) — release → Dependabot →
  pick-up.
- [Authoring a check](authoring-a-check.md) — the `Check` contract, in five steps,
  with a worked example.
- [The OKF documentation format](okf-format.md) — how these pages are structured
  and how the format is validated in this repo.
