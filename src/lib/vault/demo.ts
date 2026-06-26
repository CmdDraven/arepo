export type DemoFile = { path: string; content: string };

export const DEMO_FILES: DemoFile[] = [
  {
    path: "index.md",
    content: `---
id: index
title: Vault Index
tags: [index, meta]
---

# Vault Index

Welcome to your local Markdown knowledge base. The notes below are plain
\`.md\` files on disk — this app only indexes them.

## Areas

- [[probe-tiers|DCIPHERED Probe Tiers]]
- [[safety-model]]
- [[model-provenance-tracker]]
- [[autonomy-governor]]

## Broken link demo

This link points nowhere on purpose: [[nonexistent-note]].

And this anchor is missing: [[safety-model#does-not-exist]].
`,
  },
  {
    path: "DCIPHERED/probe-tiers.md",
    content: `---
id: dciphered-probe-tiers
title: DCIPHERED Probe Tiers
tags: [dciphered, diagnostics, safety]
---

# DCIPHERED Probe Tiers

Tiered probes for diagnosing model behaviour. See also [[safety-model]].

## Tier 1: Safe OS APIs {#tier-1-safe-os-apis}

Read-only probes that only touch sandboxed OS APIs.

- File metadata
- Process listing
- Network counters

## Tier 2: Instrumented Calls {#tier-2-instrumented-calls}

Wrapped calls with full audit logging. See [[safety-model#audit-logging]].

## Tier 3: Live Intervention {#tier-3-live-intervention}

Requires explicit operator approval per [[autonomy-governor#approval-gates]].
`,
  },
  {
    path: "DCIPHERED/safety-model.md",
    content: `---
id: dciphered-safety-model
title: DCIPHERED Safety Model
tags: [dciphered, safety]
---

# Safety Model

The safety model is layered. Each layer is independently auditable.

## Threat Classes {#threat-classes}

1. Data exfiltration
2. Privilege escalation
3. Silent drift

## Audit Logging {#audit-logging}

All Tier 2+ probes (see [[probe-tiers#tier-2-instrumented-calls]]) emit
structured audit events.

## Provenance {#provenance}

Cross-reference with [[model-provenance-tracker]].
`,
  },
  {
    path: "SEco/model-provenance-tracker.md",
    content: `---
id: seco-model-provenance-tracker
title: Model Provenance Tracker
tags: [seco, provenance]
---

# Model Provenance Tracker

Tracks where every deployed model came from.

## Fields {#fields}

| Field | Notes |
| --- | --- |
| source | upstream repo |
| hash | sha256 of weights |
| signer | release key id |

## Integration {#integration}

Feeds into [[autonomy-governor]] decisions and links back to
[[safety-model#provenance]].
`,
  },
  {
    path: "SEco/autonomy-governor.md",
    content: `---
id: seco-autonomy-governor
title: Autonomy Governor
tags: [seco, governance]
---

# Autonomy Governor

Decides when an agent is allowed to act without an operator.

## Approval Gates {#approval-gates}

- Tier 3 probes from [[probe-tiers#tier-3-live-intervention]]
- Any write to production

## Inputs {#inputs}

- Provenance score from [[model-provenance-tracker#fields]]
- Current threat class (see [[safety-model#threat-classes]])
`,
  },
];
