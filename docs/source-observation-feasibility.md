# Exact source-observation feasibility

Status: design and evidence only. No production cache-validity or watcher behavior is changed by
this investigation.

## Decision summary

AREPO cannot safely infer that a source still has hash `H` from the current Node `fs.watch`
stream or from a metadata tuple. Portable zero-read validation is therefore a **NO-GO**.

The decisive Linux counterexamples are legal unprivileged writes: inotify and fanotify explicitly
do not report modifications caused by `mmap(2)`, `msync(2)`, or `munmap(2)`. A directory watch also
does not see a write made through a hard link outside the watched tree. The local probe reproduced
both: SHA-256 changed while AREPO's directory-style watcher received no event. Node also omits the
raw observer state needed to detect queue overflow or establish a durable or request-time cursor.

Windows USN is the most promising durable primitive, but remains **CONDITIONAL**. It has a volume
journal identity, replay cursor, detectable truncation, file identities, and content/security/
rename reason flags. It requires administrative change-journal access, native code, a maintained
file-ID-to-vault-membership ledger, and proof of mapped-write and checkpoint semantics before it
could be authoritative. macOS FSEvents is useful as a conservative persistent invalidator, but its
documented coalescing/drop behavior and lack of a reliable exact query barrier prevent classifying
it as per-access content proof.

A future capability contract with unconditional canonical fallback is sound, but a production
native observer is not justified now. The next indexing work should remain portable: coalesce
concurrent canonical verification and profile secure path work. This avoids duplicated work without
changing the proof boundary.

## 1. Proof obligation and present consistency boundary

At baseline observation `O0`, AREPO securely resolves an in-scope Markdown path `P`, reads it, and
computes `SHA-256(bytes) = H`. At access `O1`, reusing `H` without reading is safe only when AREPO can
prove all of the following over the interval from `O0` to a request-time checkpoint `C1`:

1. The bytes of every known source did not change by overwrite, truncate, extend, an already-open
   descriptor, mapped write, or an alias such as a hard link.
2. No source was added, deleted, replaced, renamed, moved into or out of scope, or changed between a
   regular file and another type.
3. The root, mounts, parent-directory identities, symlink/reparse topology, readability, permissions,
   and relevant ACL/security state did not change.
4. Observer initialization covered the baseline race; every relevant record through `C1` was
   consumed; and overflow, journal loss, reset, unmount, restart, or unsupported filesystem behavior
   is either absent or detectably forces fallback.

These are three different proofs: **content**, **source inventory**, and **path/security topology**.
A content observer does not by itself authorize skipping discovery or containment checks.

The current implementation is conservative but is not a transactional vault snapshot. Discovery
runs first; sources are then resolved/read concurrently (bounded at 32); each read hashes the bytes
returned by that particular `readFile`. Files can change between discovery, path checks, open, read,
and other files' reads. An atomic replacement after one file is opened may leave that read on the old
inode while another file is observed later. A writer modifying a file during `readFile` can also race
the read. Thus the meaningful contract is:

> no weaker than securely resolving, opening, reading, and hashing each source during this index
> operation—not a globally linearizable snapshot of the vault.

A zero-read provider must at least ensure that every relevant operation completed before the
request/checkpoint is reflected before reuse. Operations concurrent with the checkpoint may fall on
either side, just as they may race today's per-file reads. Filesystem snapshots could strengthen the
contract, but are not required to preserve it.

## 2. Evidence categories

- **AUTHORITATIVE**: proves unchanged state under verified preconditions.
- **CONSERVATIVE INVALIDATOR**: can over-report but does not miss a covered class while healthy.
- **GAP-DETECTABLE**: reports loss/reset; a gap forces canonical fallback.
- **SESSION-ONLY**: trust cannot bridge observer/process restart.
- **PERSISTENT-REPLAY**: a durable cursor can bridge restart while its journal interval remains valid.
- **HEURISTIC**: useful for prioritization only; never sufficient to skip hashing.
- **UNSUITABLE**: cannot satisfy the proof.

Only an AUTHORITATIVE result may return `proven-unchanged`. A provider can combine categories—for
example, PERSISTENT-REPLAY + GAP-DETECTABLE + CONSERVATIVE INVALIDATOR—and become authoritative only
when startup, membership, hard-link, mapped-write, topology, and request-time checkpoint obligations
are all closed.

## 3. Current AREPO and Node behavior

AREPO currently:

- performs recursive real-directory discovery, excluding symlinks and `.git`/`.arepo`;
- installs one non-recursive `fs.watch` per discovered directory;
- ignores event identity/type details and debounces a full hash reconciliation by 200 ms;
- stores path-to-SHA snapshots and size/mtime maintenance metadata;
- serializes reconciliation and uses source generations plus a newest-generation rebuild queue;
- discovers topology every 30 seconds and performs authoritative full hashing at most every five
  minutes; and
- performs a full hash rescan when runtime status is requested.

Initial watcher setup hashes before installing directory watches. That is a classic scan-then-watch
gap. A new empty directory can also receive a nested creation before its watch is installed.
Maintenance/status hashing repairs such gaps eventually, but the event stream itself cannot prove
absence of a change.

The actual runtime is Node `v26.2.0`. Current Node documentation says `fs.watch` uses inotify on
Linux, FSEvents for macOS directories/kqueue for files, and `ReadDirectoryChangesW` on Windows. It
supports recursive Linux directory watching in contemporary Node, but AREPO deliberately maintains
its own topology. Node documents platform inconsistency, unreliable or impossible operation on NFS,
SMB, and virtualized host filesystems, nullable filenames, inode-following behavior on Linux/macOS,
and special Windows rename/deletion behavior.

The JavaScript callback exposes only `rename` or `change` and an optional filename. It does **not**
expose raw inotify overflow/unmount masks and watch descriptors, FSEvents event IDs/drop flags,
Windows zero-byte overflow, USN journal identity/cursor, stable file IDs, mount identity, or a
drain/checkpoint primitive. Therefore:

- current `fs.watch` cannot prove exact unchanged content;
- a pure-JavaScript rearrangement cannot recover state that Node does not expose; and
- current watcher health/generation state is an optimization and responsiveness aid only. Canonical
  fallback must remain authoritative.

## 4. Metadata-only proof

`dev + inode/file ID + size + mtimeNs + ctimeNs` is a strong local heuristic, not a formal content
identity. Size misses same-size writes. Owners can restore mtime. Timestamps have finite granularity
and filesystem-specific update/writeback behavior. Inodes/file IDs can be reused after deletion;
network clients can cache or synthesize attributes; atomic replacement changes identity but a reused
identity can eventually collide; and a metadata sample can itself race mutation. Linux mapped writes
do update timestamps under documented rules, but notification timing and finite values are not an
unforgeable monotonic change identity. Privileged actors can manipulate more state, although AREPO
does not claim protection against a hostile kernel/admin.

The current Linux UAPI `statx` exposes inode, size, timestamps, mount ID, and related attributes, but
the documented structure has no portable inode content-version/change-cookie field. Kernel
`i_version` is an internal, filesystem-dependent change attribute, and no Node or generic documented
`statx` field makes it an AREPO proof. `FS_IOC_GETVERSION`/inode generation must not be confused with
a cryptographic digest or universally incrementing content counter.

Verdict: **HEURISTIC / NO-GO**. Metadata may decide what to verify first; it may not skip SHA-256.

## 5. Platform evidence

### Linux inotify

Raw inotify is SESSION-ONLY, CONSERVATIVE for its documented event classes while healthy, and
GAP-DETECTABLE because `IN_Q_OVERFLOW`, `IN_UNMOUNT`, and `IN_IGNORED` are explicit. Its queue is
ordered, although identical unread events may coalesce. It detects ordinary writes, directory-entry
renames, deletion, and replacement when the right directory/inode is watched.

It is not recursive. Adding a watch after a subdirectory is created or moved in has a documented
race. Watching a mount point does not report objects below a subsequently mounted filesystem.
Directory events are path-parent scoped, so a write through an external hard-link name is absent
from AREPO's watched parent; a direct inode watch does see the local ordinary write, but follows the
old inode across path replacement. Most decisively, inotify explicitly does not report mmap/msync/
munmap modifications. It has no durable replay cursor. A Linux cookie-file barrier can order normal
inotify events before a request, as Watchman demonstrates, but it cannot make absent mmap events
appear.

Verdict: **UNSUITABLE for exact proof**. Raw inotify would improve gap detection over Node, but not
close the content proof.

### Linux fanotify

Fanotify exposes `FAN_Q_OVERFLOW`. Filesystem or mount marks avoid the new-subdirectory race; a
filesystem mark can observe activity through all mounts and could associate file handles with known
source inodes. Mount/filesystem marks require `CAP_SYS_ADMIN`; mount marks also omit several
directory-entry events available to filesystem marks. Directory marks remain non-recursive and
racy. Remote changes on network filesystems are not reported.

Fanotify explicitly does not report mmap/msync/munmap modifications. Consequently neither
unprivileged per-file marks nor privileged filesystem marks meet AREPO's ordinary-process threat
model. A filesystem-wide mark could close the external-hard-link gap for ordinary filesystem-API
writes, but not mapped writes, and adds capability, unrelated-volume-event filtering, native code,
file-handle, mount, and packaging burdens.

Verdict: **UNSUITABLE for exact proof; NO-GO for production session proof**.

### Linux filesystem counters

No generic, documented userspace counter available through Node or current `statx` proves every
content mutation across ext4, btrfs, XFS, tmpfs, and remote/virtual implementations. Internal
`i_version`, inode generation, filesystem transaction IDs, and btrfs generations differ in meaning,
availability, scope, and persistence. None is a portable cryptographic content identity. A future
filesystem-specific provider would need primary documentation and adversarial validation for its
exact mount options and UAPI; no such provider is established here.

Verdict: **FILESYSTEM-SPECIFIC research only; no proven implementation**.

### macOS FSEvents and kqueue

FSEvents supplies persistent per-volume event IDs and replay across reboot. It reports
`MustScanSubDirs`, `KernelDropped`, `UserDropped`, `EventIdsWrapped`, and `RootChanged`; every such
condition requires an affected-subtree or full canonical scan. Directory events can coalesce;
file-event mode adds item-level flags but does not turn the stream into a content journal. Volume
UUID/event-ID regression or purging also invalidates a saved cursor.

FSEventStream flush APIs request delivery, but they do not establish the exact-on-access ordering
AREPO needs. Watchman's documented production experience says cookie + `FSEventStreamFlushSync` can
return before earlier high-load changes and that Apple provides no supported synchronization
guarantee. Primary Apple documentation found here also does not establish external-hard-link or mmap
coverage sufficient for a content proof. A vault-root path stream could miss a modification made
through an alias outside that path.

FSEvents is therefore a useful **PERSISTENT-REPLAY, GAP-DETECTABLE, CONSERVATIVE subtree
invalidator**, not an AUTHORITATIVE per-access content proof. kqueue inode watches are session-only
and have replacement/topology scaling problems; Node uses them only for macOS file watches.

Verdict: **CONDITIONAL for acceleration with fallback; NO-GO as exact FSEvents proof**. Endpoint
Security was suggested to Watchman by Apple for stronger ordering, but its coverage, entitlements,
mapped-write behavior, and product suitability remain RESEARCH BLOCKED here.

### Windows ReadDirectoryChangesW

`ReadDirectoryChangesW` supports subtree watching and content/name/security filters. Its handle
buffer accumulates changes between calls. Overflow is detectable to native callers: a successful
zero-byte result or `ERROR_NOTIFY_ENUM_DIR` requires full enumeration. It has no durable cursor and
cannot bridge handle/process restart. Node hides its overflow-specific result and exposes only the
normalized `fs.watch` event.

The API is SESSION-ONLY and useful as a conservative invalidator, but it does not document a durable
request checkpoint, external-hard-link identity tracking, or mapped-write proof. It also has
network-buffer constraints and Node documents Windows root move/delete caveats.

Verdict: **UNSUITABLE alone for exact zero-read proof**.

### Windows USN Change Journal

USN is the strongest candidate investigated. NTFS records volume-wide changes with a monotonically
positioned USN, file reference number, parent file reference, and flags for data overwrite/extend/
truncate, create/delete, old/new rename names, hard-link changes, security/basic-info changes,
reparse points, and streams. `FSCTL_QUERY_USN_JOURNAL` gives journal identity, `FirstUsn`, `NextUsn`,
and `LowestValidUsn`. A changed journal ID or a cursor below retained history is a detectable gap.
Querying a head USN and reading through that head offers a plausible request-time checkpoint.

A persisted `{volume identity, journal ID, safe USN}` can bridge process restart/reboot while the
same journal retains the interval. Atomic replacement appears as old/new identities and create/
delete/rename reasons. Because data reasons attach to file identity in a volume-wide journal, a
write through an outside hard link can conservatively dirty every tracked vault path for that file
ID. Exact subtree membership requires maintaining parent/file-ID relationships and processing both
sides of renames; pathname filtering after the fact is insufficient.

Important blockers remain:

- Microsoft states change-journal operations require administrator privileges.
- A native Windows helper/addon and volume handles are required; Node has no USN API.
- Microsoft documentation reviewed here establishes data-write reasons but does not explicitly prove
  the mapped-write case or the exact visibility point for dirty mapped pages. That must be proven
  with primary evidence and a Windows native torture test.
- Open handles whose reasons accumulate until close require careful checkpoint tests even though the
  documentation shows a record on the initial write.
- Journal creation/presence is not guaranteed; deletion, restamping, wrap, or retention loss forces a
  full baseline.
- ReFS uses 128-bit IDs in USN v3-era structures, but equivalence of all needed semantics and normal
  desktop availability is **UNKNOWN / REQUIRES PROOF**.

Verdict: **CONDITIONAL**, not yet AUTHORITATIVE. It is the only credible Level 3 candidate found.

## 6. Cross-cutting mutation findings

### Hard links

Linux local evidence: modifying an outside alias changed the vault file's SHA-256 and ctime, produced
events on a direct inode watch, and produced **zero** events on the vault directory watch. Therefore
current AREPO topology cannot trust `nlink > 1`. A future path-scoped observer should mark such a
source observation-untrusted and canonically read it. A volume-wide identity journal may instead map
the file identity to every known vault path. FSEvents and `ReadDirectoryChangesW` have no documented
proof for an alias outside the watched root. USN is promising because it is volume/file-ID based.

No production hard-link policy is introduced by this investigation.

### Memory-mapped writes

The local Python `mmap` write changed content, ctime, and mtime but generated **zero** Node events on
both directory and direct file watches. This matches the explicit inotify and fanotify limitations.
It is a complete falsification of Linux event-only proof under AREPO's normal uncooperative-process
threat model. FSEvents, ReadDirectoryChangesW, and USN remain unproven for mapped writes unless their
primary platform contracts explicitly cover them.

### Atomic replacement and identity

Temp-file plus rename changed `(dev, ino)` and generated directory rename/change events. A direct
file watch remained associated with the old inode, as Node documents. Exact handling therefore
requires directory inventory events plus identity replacement, not a file watch alone. Delete/
recreate is the same class. Rename away/back may preserve identity and content but still changes path
topology and must invalidate topology trust until reconciled.

### Permission and ACL changes

Readability/security is part of source state: an old derivative must not imply that a currently
unreadable source was just verified. Linux chmod generated an event locally, and Windows USN has
security/basic-info reasons, but provider-specific ACL semantics still need proof. Security events
may conservatively dirty a source even when bytes are unchanged.

## 7. Startup, request synchronization, gaps, and restart

A viable observer baseline protocol is:

1. Validate provider, filesystem/volume identity, journal identity, vault root identity, and support.
2. Start the observer or capture durable cursor `C0` **before** canonical discovery/hash.
3. Perform canonical secure discovery and hashing.
4. Capture/checkpoint head `C1`; drain/replay every relevant record in `(C0, C1]`.
5. Reconcile affected content, inventory, and topology; repeat until a provider checkpoint can be
   consumed without an uncovered interval.
6. Atomically persist the resulting manifest/hash/trust state and safe cursor; only then declare the
   epoch trusted.

For ordered raw inotify, a watched cookie can form a normal-event barrier, but mmap absence still
fails. FSEvents flush is not a proven barrier. USN's queryable `NextUsn`/read cursor is the strongest
checkpoint model, subject to mapped-write/open-handle proof.

Provider state must be one of `healthy`, `dirty`, `uncertain`, or `unavailable`. Overflow, drop flag,
journal wrap/deletion/reset, cursor too old, observer error, coverage gap, root/mount/volume identity
change, unknown event/record version, unsupported filesystem, or failed checkpoint moves the affected
scope to `uncertain`. `uncertain` always means canonical fallback—never last-hash reuse.

Raw inotify, fanotify, FSEvents, `ReadDirectoryChangesW`, and USN can expose different gap signals;
Node `fs.watch` suppresses the critical platform-specific ones. Session mechanisms cannot cross
observer stop, process restart, machine restart, or reboot. The local stop/change/restart probe had a
changed SHA-256 and no indication in the newly started watcher. FSEvents and USN can replay across
restart only while volume/journal identity and retained cursor range validate.

## 8. Crash-consistent persistent ledger

If a persistent provider is ever proven, its ledger is disposable generated data, not canonical
source. One atomic snapshot should contain:

- schema/provider kind and version;
- filesystem/volume and journal identities;
- vault/root identity and safely processed cursor;
- relative path, file/parent identity where meaningful, last authoritative SHA-256, associated
  metadata, and content/inventory/topology trust states; and
- dirty/uncertain scopes caused by all records through that cursor.

Safe ordering is: read records, update identity/membership/dirty/hash state, serialize the complete
ledger with its processed cursor to a temporary file, fsync it, atomically rename it, then fsync the
parent directory where supported. Never persist an advanced cursor before its corresponding state.
A crash that leaves an older atomic ledger causes duplicate replay, which is conservative. A current
cursor paired with older state is unsafe and must be impossible; malformed or mismatched ledgers
fall back to a canonical baseline.

## 9. Source inventory and path/security proof

Level 2/3 optimization needs a provider to prove no supported source was created, deleted, renamed,
moved across scope depth, or changed type. Inotify per-directory topology has a new-directory race;
fanotify filesystem marks avoid it but require privilege and still fail mmap content proof. FSEvents
can conservatively dirty subtrees and replay, but gaps and barriers force discovery. USN can model
membership using file and parent IDs, but must replay every rename/create/delete/reparse/security
record and handle hard-link multiplicity.

Even a content proof cannot silently bypass AREPO's containment boundary. The baseline must bind each
path component/root/mount to identities and invalidate on symlink/reparse creation, directory
replacement, root move, mount attach/detach, file-type change, or security change. Providers without
proven topology coverage retain current `lstat`/`realpath` checks. Successful administrator-authorized
directory browsing is unrelated; index cache reuse never gains permission to follow a new link.

## 10. Filesystem/provider support matrix

`Y` means documented support for the column, `N` means absent, `?` means UNKNOWN / REQUIRES PROOF,
and `F` means any uncertainty falls back to canonical discovery/read/hash. “Native” means a helper or
addon outside Node's standard API.

| Filesystem   | Candidate             | Node-native           | Native/helper     | Privilege                   | Recursive/tree   | Restart replay    | Gap/cursor                        | Content writes                   | mmap | external hard link   | Inventory             | request checkpoint        | Classification / fallback                       |
| ------------ | --------------------- | --------------------- | ----------------- | --------------------------- | ---------------- | ----------------- | --------------------------------- | -------------------------------- | ---- | -------------------- | --------------------- | ------------------------- | ----------------------------------------------- |
| Linux ext4   | inotify               | wrapped, insufficient | raw API           | normal                      | per-dir; race    | N                 | overflow Y; cursor N              | ordinary Y                       | N    | dir N / inode Y      | incomplete            | cookie for covered events | SESSION, GAP-DETECTABLE, UNSUITABLE / F         |
| Linux ext4   | fanotify filesystem   | N                     | Y                 | `CAP_SYS_ADMIN`             | filesystem Y     | N                 | overflow Y; cursor N              | API writes Y                     | N    | likely Y by identity | Y with FID events     | no durable head           | GAP-DETECTABLE, UNSUITABLE / F                  |
| Linux btrfs  | inotify/fanotify      | same as Linux         | Y for raw         | same; subvolume FID caveats | same             | N                 | same                              | same                             | N    | same                 | same                  | same                      | UNSUITABLE; filesystem counter proof absent / F |
| Linux XFS    | inotify/fanotify      | same as Linux         | Y for raw         | same                        | same             | N                 | same                              | same                             | N    | same                 | same                  | same                      | UNSUITABLE; filesystem counter proof absent / F |
| Linux tmpfs  | inotify/fanotify      | same as Linux         | Y for raw         | same                        | same             | N                 | overflow only                     | ordinary Y                       | N    | same                 | same                  | same                      | SESSION only / F after restart                  |
| macOS APFS   | FSEvents              | wrapped, insufficient | Y for IDs/flags   | normal for normal streams   | subtree Y        | Y                 | IDs/drop flags Y                  | conservative ?                   | ?    | path-scoped ?        | conservative Y        | no proven exact barrier   | PERSISTENT invalidator, CONDITIONAL / F         |
| Windows NTFS | ReadDirectoryChangesW | wrapped, insufficient | raw API           | normal directory access     | subtree Y        | N                 | overflow Y; cursor N              | ordinary Y                       | ?    | subtree ?            | Y while healthy       | no durable head           | SESSION invalidator / F                         |
| Windows NTFS | USN                   | N                     | Y                 | administrator               | volume Y         | Y                 | journal ID/USN Y                  | documented reasons Y             | ?    | promising file-ID Y  | Y with identity graph | plausible `NextUsn` head  | CONDITIONAL PERSISTENT-REPLAY / F               |
| Windows ReFS | USN v3                | N                     | Y                 | administrator               | volume Y         | likely Y          | structures support 128-bit IDs    | ?                                | ?    | ?                    | ?                     | ?                         | REQUIRES PROOF / F                              |
| NFS          | platform watcher/stat | unreliable            | provider-specific | varies                      | ?                | protocol-specific | ?                                 | server-side events may be missed | ?    | ?                    | ?                     | ?                         | UNSUITABLE by default / F                       |
| SMB/CIFS     | platform watcher      | Node warns unreliable | provider-specific | varies                      | backend-specific | N for Node        | RDCW network overflow constraints | ?                                | ?    | ?                    | ?                     | ?                         | UNSUITABLE by default / F                       |

APFS snapshots, btrfs/ZFS snapshots, and VSS are intentionally not listed as observers: they can
stabilize a read view but do not prove that an old hash still matches without a trustworthy change
lineage. Filesystem support must be capability-detected; names alone are insufficient for network,
FUSE, containers, bind mounts, subvolumes, and virtualized host shares.

## 11. Third-party libraries and daemons

- **Watchman** exposes clocks, `is_fresh_instance`, recrawl warnings, overflow recovery, and query
  cookies. On Linux its cookie synchronization gives the same pre-query ordering shape as current
  canonical traversal, but Linux still misses mmap and a root-scoped watcher still has hard-link
  concerns. Watchman itself documents that FSEvents flush/cookies are not a guaranteed macOS query
  barrier. It is valuable as a gap-aware invalidator, not as AREPO content proof.
- **@parcel/watcher** is a native C++ recursive wrapper with FSEvents, inotify, Windows, Watchman, and
  snapshot/query APIs. Its public contract coalesces events and does not establish mmap, external
  hard-link, cursor identity, or exact request-barrier guarantees. Historical snapshots can use
  backend crawling. It does not upgrade the weakest primitive into proof.
- **chokidar** normalizes `fs.watch`/polling, atomic saves, and write-finish behavior. Its polling is
  metadata-based and its debounce/coalescing features target usability, not proof. It is unsuitable.

No dependency is added.

## 12. Snapshots and content-integrity facilities

Filesystem snapshots can give a stable read interval, but AREPO still has to discover and hash the
snapshot unless a separately proven change lineage relates it to `H`. btrfs/ZFS require vaults on
managed subvolumes/datasets and platform-specific lifecycle/permissions; APFS snapshot APIs and
unprivileged desktop suitability require further proof; VSS is a Windows COM/volume subsystem with
administrative and packaging cost. None is a portable primary architecture.

Linux fs-verity does expose a constant-time Merkle-tree-based file digest on ext4, f2fs, and btrfs,
but enabling it makes file contents read-only. It is designed for immutable managed files, not normal
editable Markdown. Filesystem block checksums (including btrfs/ReFS integrity) protect storage blocks
and generally do not expose the same portable file-content SHA-256 identity. A change counter is not
a cryptographic digest; it is useful only if its no-missed-change semantics and identity are proven.

## 13. Local Linux torture probe

Run with:

```bash
node scripts/probe-source-observation.mjs
```

The probe is self-cleaning and reports Node directory-watch events, direct-file-watch events,
`dev/ino/nlink/mode/size/mtimeNs/ctimeNs`, and SHA-256 before/after. It is falsification evidence on
one host, not proof of portable semantics. On Node `v26.2.0`, Linux `7.0.11`, local ext-family storage:

| Operation                                                       | Vault directory event     | Direct inode event       | hash / identity result                             |
| --------------------------------------------------------------- | ------------------------- | ------------------------ | -------------------------------------------------- |
| overwrite, same-size + restored mtime, truncate/rewrite, append | Y                         | Y                        | hash changed; identity stable                      |
| atomic replace; delete/recreate                                 | Y                         | Y on old inode lifecycle | hash and identity changed                          |
| rename away/back                                                | Y                         | Y                        | hash stable; topology metadata changed             |
| chmod unreadable                                                | Y                         | Y                        | read failed until mode restored                    |
| write via hard link outside root                                | **N**                     | Y                        | hash changed; identity stable; nlink/ctime changed |
| Python mmap write + flush                                       | **N**                     | **N**                    | hash changed; identity stable; timestamps changed  |
| 200 rapid writes                                                | Y (coalescing is allowed) | Y                        | final hash changed                                 |
| nested directory create/delete                                  | root topology Y           | source N                 | inventory changed transiently                      |
| observer stop, change, restart                                  | **N; no gap indication**  | N                        | hash changed                                       |
| root rename                                                     | rename event locally      | source N                 | root path changed                                  |

The setup/start mutation race is established structurally rather than treated as a timing lottery:
`fs.watch` has no start cursor, so a mutation before successful watcher establishment has no replay or
gap signal. The stop/restart case deterministically demonstrates the same missing history.

## 14. Narrow future contract and capability tiers

Do not build a general filesystem-provider framework. If a platform primitive is later proven, the
only necessary conceptual boundary is:

```ts
type SourceObservationProof =
  | {
      state: "proven-unchanged";
      contentHash: string;
      observationEpoch: string;
      fileIdentity?: string;
    }
  | { state: "dirty"; path?: string }
  | { state: "uncertain"; reason: string }
  | { state: "unavailable"; reason: string };
```

Only `proven-unchanged` skips canonical hashing. The provider must also declare separate content,
inventory, topology, restart-replay, gap-detection, and request-checkpoint capabilities. Unsupported,
cold start, dirty, uncertain, gap, overflow, identity mismatch, provider failure, or unknown
filesystem always uses the portable path.

Useful tiers are:

1. **PORTABLE** — current canonical secure discovery/read/SHA-256; always available.
2. **SESSION OBSERVATION** — canonical baseline, then zero-read only while a proven gap-free native
   chain and request barrier remains alive; no Linux candidate currently passes mmap.
3. **PERSISTENT JOURNAL** — durable replay from an atomic ledger/cursor; journal reset/gap falls back.
   Windows USN is the only credible candidate, still conditional.

## 15. Performance upper bounds

The benchmark's `--observation-only` mode runs only cold and warm v5 access and then mirrors current
per-source symlink-segment `lstat`, leaf `lstat`, and `realpath` validation without reading bodies.
Results below are one OS-cache-warm iteration on this host, so they are evidence rather than a service
level. `capture` includes secure per-path validation, body read, and hash; `hash` is its measured SHA
subset. Level 2/3 floors exclude unknown provider replay/checkpoint cost.

| Profile                     | Current warm |  discovery | capture (hash subset) | cache read + materialize | Level 1: discovery + path validation |      Level 1 saved | Level 2: floor + inventory proof | Level 3: floor + epoch proof |
| --------------------------- | -----------: | ---------: | --------------------: | -----------------------: | -----------------------------------: | -----------------: | -------------------------------: | ---------------------------: |
| medium, 5k / 58.9 MiB       |     746.7 ms |   216.9 ms |       404.1 ms (40.8) |                 105.3 ms |                             516.9 ms |   229.9 ms / 30.8% |                       >=125.7 ms |                   >=125.7 ms |
| file-heavy, 20k / 21.6 MiB  |   2,278.4 ms |   659.8 ms |     1,335.4 ms (49.2) |                 255.5 ms |                           1,580.2 ms |   698.2 ms / 30.6% |                       >=283.2 ms |                   >=283.2 ms |
| datacentre, 50k / 393.9 MiB |   6,097.8 ms | 1,378.0 ms |    3,476.6 ms (277.1) |               1,165.5 ms |                           4,166.9 ms | 1,931.0 ms / 31.7% |                     >=1,243.3 ms |                 >=1,243.3 ms |

Level 1 preserves full recursive discovery and current secure path validation, so file-count syscall
cost remains. Level 2 avoids most per-source checks only if inventory and topology are independently
proven; its provider replay cost is unknown. Level 3 adds durable epoch proof and could approach cache
read/materialization plus checkpoint overhead. The ideal Level 2/3 savings are 79.6–87.6%, but no
cross-platform provider demonstrated those semantics. SHA itself is only 49–277 ms here and is not
the main target.

## 16. Engineering economics and explicit decisions

| Decision                           | Verdict                                  | Reason                                                                                          |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pure Node/current `fs.watch`       | **NO-GO**                                | hides gap/cursor/barrier state; Linux mmap and hard-link misses                                 |
| Metadata tuple                     | **NO-GO**                                | heuristic, not an unforgeable/content-monotonic identity                                        |
| Linux session-native observer      | **NO-GO**                                | both inotify and fanotify explicitly miss mmap; fanotify tree coverage is privileged            |
| Linux persistent replay            | **FILESYSTEM-SPECIFIC**                  | no generic local journal/UAPI proven; canonical fallback remains                                |
| macOS                              | **CONDITIONAL invalidator; NO-GO exact** | persistent/gap flags exist; exact query barrier, mmap, alias proof absent                       |
| Windows                            | **CONDITIONAL**                          | USN has the right durable shape; privilege, native mapping, mmap/checkpoint proof remain        |
| Cross-platform capability contract | **GO as a design boundary**              | safe only because every unsupported/uncertain case canonically falls back                       |
| Production implementation priority | **LOW / not justified now**              | one conditional privileged platform; no exact Linux/macOS path despite large theoretical upside |

Cost for a real implementation is at least a Windows native Node-API/Rust/C++ component or helper,
administrator-aware installation, volume/journal/file-ID graph logic, atomic ledger migrations,
Windows CI torture tests, native packaging/signing for supported architectures, and a security review.
A broader cross-platform product means separate macOS and Linux research/implementations plus a large
fallback matrix. Watchman adds a daemon/install/operational dependency without closing mmap proof.

The recommended next tranche is portable coalescing of concurrent canonical source verification,
with deterministic concurrency tests, followed by profiling/reducing repeated secure per-path work
without changing containment checks. Only if Windows protected/native deployment becomes a product
priority should a throwaway USN spike precede production design; that spike must prove admin
availability, NTFS/ReFS support, mmap, hard links, open descriptors, checkpoint ordering, journal
wrap/reset, volume replacement, membership mapping, and crash recovery.

## 17. Threat boundary

The required adversary is a normal editor or uncooperative unprivileged local process using legal
writes, atomic rename, chmod/ACL operations, hard links, existing descriptors, or mmap. Those actions
must not silently preserve stale structural data. AREPO does not promise correctness against an
administrator controlling mounts/journals/system time or an attacker controlling the kernel; any
detected privileged change still forces fallback. Generated observer state is disposable and never
authoritative over source files.

## Primary references

- Node.js, [`fs.watch` current documentation and caveats](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)
- Linux man-pages, [`inotify(7)`](https://man7.org/linux/man-pages/man7/inotify.7.html)
- Linux man-pages, [`fanotify(7)`](https://man7.org/linux/man-pages/man7/fanotify.7.html)
- Linux man-pages, [`fanotify_mark(2)`](https://man7.org/linux/man-pages/man2/fanotify_mark.2.html)
- Linux man-pages, [`statx(2)`](https://man7.org/linux/man-pages/man2/statx.2.html)
- Linux kernel, [`fs-verity`](https://docs.kernel.org/filesystems/fsverity.html)
- Apple, [Using the File System Events API](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html)
- Apple, [FSEvents technology overview](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/TechnologyOverview/TechnologyOverview.html)
- Microsoft, [`ReadDirectoryChangesW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
- Microsoft, [Change Journal Records](https://learn.microsoft.com/en-us/windows/win32/fileio/change-journal-records)
- Microsoft, [`READ_USN_JOURNAL_DATA_V1`](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ns-winioctl-read_usn_journal_data_v1)
- Microsoft, [`USN_RECORD_V3`](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ns-winioctl-usn_record_v3)
- Microsoft, [Using the Change Journal Identifier](https://learn.microsoft.com/en-us/windows/win32/fileio/using-the-change-journal-identifier)
- Microsoft, [Hard links and junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)
- Watchman, [query synchronization and FSEvents limitation](https://facebook.github.io/watchman/docs/cookies)
- Watchman, [recrawl/overflow behavior](https://facebook.github.io/watchman/docs/troubleshooting)
- Parcel, [`@parcel/watcher`](https://github.com/parcel-bundler/watcher)
- Chokidar, [watcher options and semantics](https://github.com/paulmillr/chokidar/blob/main/README.md)
- Btrfs, [`btrfs-subvolume(8)`](https://btrfs.readthedocs.io/en/latest/btrfs-subvolume.html)
- Microsoft, [Volume Shadow Copy Service](https://learn.microsoft.com/en-us/windows/win32/vss/volume-shadow-copy-service-portal)
