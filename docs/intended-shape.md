# AREPO

**Archive Relationship and Enrichment Provenance Orchestrator**

Local-first knowledge mapping for user-owned documents.

AREPO maps ordinary documents, tracks relationships and provenance, and enables optional enrichment without taking ownership of the source files.

## AREPO Intended Shape

AREPO is a local-first document mapping system for turning ordinary files into a navigable, inspectable knowledge map, with a long-term path toward optional semantic enrichment and user-controlled document intelligence.

Its first-class format is Markdown. Plain `.md` files remain the source of truth. User files should stay readable, portable, editable outside AREPO, and safe to back up, sync, or version using normal tools. AREPO does not replace storage, sync, backup, Git, or the user’s preferred editor.

AREPO reads and writes ordinary documents, then builds rebuildable structure around them.

The core purpose of AREPO is to help users understand what their documents contain, how those documents connect, what is missing, what has changed, what generated data exists, and what can be safely enriched.

This document describes both the implemented V1 shape and the intended long-term architecture. V1 implements the local-first Markdown vault, filesystem backend, rebuildable machine index, validation, graph derivation, conflict handling, storage reporting, and test vault fixture. Enrichment, non-Markdown import pipelines, provenance, and multi-node federation are future architecture.

## Core Identity

AREPO is not just a Markdown editor.

It is a local document atlas: a tool for mapping a user-controlled vault of notes, references, logs, project files, imported material, and eventually broader document types.

It shows the terrain of a knowledge base without requiring the user to surrender their files to a cloud platform, proprietary database, hosted account, or locked-in format.

In its mature form, AREPO should support Markdown-first knowledge work, imported chat logs, plain text archives, generated summaries, project documentation, research notes, local AI-assisted linking, and eventually federated document nodes across a user-owned stack.

The app should remain useful with no AI enabled.

Future AI features should enhance the map, not own the map.

## Design Principles

* Markdown files are canonical.
* Generated indexes, graph layouts, caches, embeddings, summaries, and enrichment metadata should be clearly marked as generated data.
* Where possible, generated data should be rebuildable or disposable.
* User approvals, manual edits, and provenance records should be preserved as deliberate user-controlled state.
* The user’s vault remains valid outside AREPO.
* The app is local-first by default.
* No cloud account, hosted database, analytics, or telemetry is required for local use.
* Sync, version history, and backups remain external responsibilities handled by tools such as Syncthing, Git, Borg, Restic, and Kopia.
* Generated data is clearly separated from user-authored data.
* Heavy enrichment is opt-in.
* Transparent, reversible changes are preferred over magical automation.

Consent should be specific. Basic mapping can be default because it is core function. Heavy enrichment should be opt-in because it interprets user material, consumes resources, and creates derived data.

## Current V1 Shape

V1 is a local web UI backed by a local Node backend.

The frontend runs in the browser. The backend runs locally, binds to `127.0.0.1` by default, and reads/writes only configured vault folders. Vault configuration is stored locally in `.arepo/config.json`.

When a vault is added or reindexed, AREPO automatically builds a machine index from Markdown files. A user-authored `index.md` file is optional. If present, it is treated as a normal Markdown note, not as the machine index.

The generated machine index includes structural data needed to derive the map and inspection views:

* file paths
* titles
* frontmatter IDs
* tags
* headings
* heading anchors
* wikilinks
* outgoing links
* backlinks
* broken links
* orphan notes
* duplicate IDs
* duplicate anchors

Graph data and layout are currently derived from that rebuildable index rather than stored as canonical state.

V1 currently provides:

* vault registration by absolute path
* Tree view
* Markdown editor
* sanitized preview
* wikilink rendering
* folder-qualified wikilink resolution
* anchor resolution
* backlinks
* broken-link detection
* graph view
* graph multi-selection metadata
* local file watching
* external edit detection
* conflict review
* safe save, reload, save-as-new-file, and overwrite flows
* atomic writes
* storage reporting for vault content and generated machine index/cache data

The repository includes `test-vault/` as a committed example and manual-test fixture. It demonstrates folder-qualified links, anchors, backlinks, graph rendering, intentional broken links, and ignored fake links inside code blocks.

## What AREPO Should Become

AREPO should grow into a document control plane for user-owned knowledge.

At maturity, it should help a user answer questions such as:

What documents mention this project?

What did I decide previously?

Which notes link to this idea?

Which concepts are duplicated under different names?

Which links are broken?

Which files are isolated?

Which documents are large because of source content, and which are large because of generated enrichment?

Which summaries, embeddings, or generated links can be deleted and rebuilt?

Which notes are eligible for enrichment?

Which imported chats became project decisions, TODOs, or reference material?

This should work across ordinary Markdown notes first, then expand to imported text, chat exports, logs, transcripts, and other document formats where safe.

The long-term goal is not merely note-taking.

The goal is user-owned knowledge infrastructure.

## Security Model

The backend binds to localhost by default.

It should not be exposed to a LAN or the internet until authentication and permission controls are deliberately designed.

Only configured vault roots are accessible. Path traversal, symlink escapes, unsafe writes, and accidental overwrites are rejected. Deletes are disabled by default. Writes are atomic where practical. External edits are detected. The UI does not report a save as successful until the backend confirms it.

The user should be able to understand:

* what AREPO can read
* what AREPO can write
* where generated data is stored
* what is source content versus generated cache
* which future enrichment policies apply

## Storage Reporting

AREPO should make storage visible.

Current V1 reports:

* total vault content size
* Markdown/text size
* attachment/non-Markdown size
* generated AREPO machine index/cache size

Future storage reporting should also distinguish:

* generated notes size
* summary cache size
* embedding/vector data size
* enrichment metadata size
* imported-source derivatives
* other optional generated layers

Generated machine indexes are disposable. They can be deleted and rebuilt from Markdown files.

Storage reporting should show which generated data exists because of the basic map and which exists because the user opted into enrichment.

This matters because future features have different costs. A basic map is cheap. Full-text search is moderate. Embeddings, per-section summaries, imported chat conversion, and local model enrichment can become large.

The user should have a clear loop:

I opted into this.

It generated this much data.

It suggested or changed these things.

I can clear, rebuild, approve, reject, or disable it.

Storage reporting is not just housekeeping. It is part of user sovereignty.

## Basic Mapping Versus Enrichment

Basic mapping is core function. It is lightweight, local, rebuildable, and enabled by default.

Basic mapping includes file discovery, Markdown parsing, headings, anchors, wikilinks, backlinks, broken links, orphan notes, duplicate IDs, duplicate anchors, and structural graph data.

Heavy enrichment is different. It may consume more storage, processing time, energy, and attention. It may also create derived interpretations of the user’s documents. For that reason, heavier enrichment should require explicit consent.

Heavy enrichment may include:

* embeddings
* local model summaries
* entity extraction
* generated tags
* generated aliases
* generated wikilinks
* decision extraction
* TODO extraction
* timeline reconstruction
* duplicate concept detection
* imported chat conversion beyond basic parsing

Users should be able to use AREPO as a useful document map without enabling heavy enrichment.

## Enrichment Consent Model

Future enrichment should be opt-in, not default-on.

Possible policy levels:

* system default
* vault default
* folder or group policy
* document or node override
* temporary user action

Possible default policies:

* no heavy enrichment
* ask before enriching each document or group
* enrich only selected folders, groups, or nodes
* enrich all new documents from this point forward
* enrich all existing and future documents

When an enrichment setting changes, AREPO should ask whether the change applies only to newly onboarded documents or whether it should be applied retroactively to existing documents.

Retroactive enrichment should be explicit because it may generate large amounts of derived data and reinterpret documents the user did not intend to process.

Every document, folder, group, or node should be able to override the default policy. A user should be able to opt a specific node into enrichment, opt it out, or let it inherit the current vault default.

The effective policy for a document should be visible. The user should not have to guess why a file was enriched, why it was skipped, or why generated metadata exists.

More specific choices should override broader defaults.

This model frames enrichment around permission, not cleanup. The user should not be forced to disable enrichment after the fact. The user should decide where enrichment is allowed to operate before expensive or interpretive work happens.

## Enrichment Provenance

Future enrichment data should record:

* what generated it
* when it was generated
* which model or rule was used
* which source document or section it came from
* whether it was user-approved, automatically accepted, rejected, or stale
* whether it can be deleted and rebuilt

Deleting enrichment data must not damage source documents.

Generated changes should be inspectable and reversible. High-confidence links may be applied automatically only under user-controlled rules.

The system should avoid linking every repeated word, because that produces noise instead of knowledge.

A good enrichment system should understand context. It should avoid code blocks, inline code, frontmatter, generic terms, and noisy repeated phrases. It should prefer meaningful links between specific concepts, projects, documents, decisions, and sections.

AI may help rank and explain candidate links. Deterministic rules should perform the final write operations where possible.

## Future File Format Strategy

Markdown remains the editable native format.

Plain text can be indexed and converted into Markdown where useful.

Rich documents such as DOCX, ODT, RTF, PDF, transcripts, exports, and logs may later be imported, extracted, indexed, or converted.

AREPO should not silently corrupt or rewrite complex formats.

For non-Markdown sources, the safer model is:

* raw source retained unchanged
* extracted text stored separately
* generated Markdown created as a readable derivative
* metadata and enrichment stored in AREPO app data or sidecar files

Users should always be able to distinguish original documents from generated documents.

## Node And Federation Direction

V1 is local-node only.

Future versions may support multiple user-controlled AREPO nodes, such as:

* local editor node
* read-only archive node
* server index node
* AI enrichment node
* backup-aware node
* mobile browse node

Federation should not imply cloud dependency. It should mean user-controlled nodes with explicit trust, permissions, auditability, and revocation.

No node should be trusted merely because it exists on the network.

Remote access requires authentication, permission boundaries, auditability, and revocation before it is enabled.

## Non-Goals

AREPO is not:

* a hosted notes service
* a Git replacement
* a Syncthing replacement
* a Borg, Restic, or Kopia replacement
* an Obsidian clone
* an AI chatbot with a notes sidebar
* a proprietary vault format
* a reason to abandon existing editors

AREPO should not silently rewrite a user’s knowledge base in the name of being smart.

AREPO should not treat consent as a default-on toggle hidden behind advanced settings.

## Product Positioning

AREPO maps your Markdown vault, shows how your notes connect, detects what is broken, and keeps the source files yours.

More broadly:

AREPO is a local-first document atlas for user-owned knowledge. It reads ordinary files, builds a rebuildable map of links and metadata, helps identify relationships and gaps, and prepares the ground for optional local enrichment without locking the user into a cloud platform or proprietary format.

## Success Criteria

AREPO succeeds if a user can point it at a folder of documents and quickly understand:

what is there

what links to what

what is broken

what is isolated

what changed externally

what generated data exists

what can be safely rebuilt

what enrichment is enabled

what enrichment data exists

what can be approved, rejected, cleared, or regenerated

It succeeds further if a large messy archive, such as exported AI chats, project notes, logs, and reference material, can be converted into a coherent, navigable knowledge base without destroying the original source material.

The long-term goal is  user-owned knowledge infrastructure.
