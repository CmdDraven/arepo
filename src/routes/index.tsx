import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Database,
  FileText,
  Link2,
  FolderTree,
  Pencil,
  Eye,
  Info,
  Moon,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  Network,
} from "lucide-react";
import { FileTree } from "@/components/FileTree";
import { VaultGraph } from "@/components/VaultGraph";
import {
  buildContextLineDiff,
  buildLineDiff,
  numberLineDiffRows,
  type ContextLineDiffRow,
} from "@/lib/vault/diff";
import { buildGraph } from "@/lib/vault/graph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useVault, type VaultInfo, type VaultPermission } from "@/lib/vault/store";
import { renderMarkdown } from "@/lib/vault/render";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AREPO — Local Knowledge Mapping" },
      {
        name: "description",
        content:
          "Local-first Markdown editor, indexer, and viewer. Your notes stay as plain .md files.",
      },
    ],
  }),
  component: VaultApp,
});

function VaultApp() {
  const vault = useVault();
  const {
    files,
    fileMeta,
    index,
    issues,
    write,
    overwriteFile,
    createFile,
    createFileWithContent,
    createFolder,
    rename,
    reindex,
    addVault,
    refreshNode,
    testHealth,
    reindexVault,
    hasExternalChange,
    readFileFromDisk,
    activeVault,
    health,
    vaultStatus,
    reloadFile,
    refreshActiveVault,
    refreshVaultStatus,
    loading,
    error,
    mutationError,
  } = vault;

  const paths = useMemo(() => Object.keys(files), [files]);
  const [activePath, setActivePath] = useState<string | null>(() => paths[0] ?? null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [buffer, setBuffer] = useState<string>("");
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["Notes", "Reference"]));
  const [query, setQuery] = useState("");
  const [centerTab, setCenterTab] = useState<"edit" | "preview">("edit");
  const [mobileTab, setMobileTab] = useState<"vault" | "edit" | "preview" | "inspect">("vault");
  const [vaultMode, setVaultMode] = useState<"tree" | "graph">("tree");
  const [showSettings, setShowSettings] = useState(false);
  const [externalNotice, setExternalNotice] = useState<{
    kind: "conflict" | "deleted";
    path: string;
  } | null>(null);
  const [diffReview, setDiffReview] = useState<{
    path: string;
    diskContent: string;
  } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [suppressedConflict, setSuppressedConflict] = useState<{
    path: string;
    hash: string;
  } | null>(null);
  const [handledVaultChangeAt, setHandledVaultChangeAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("vault:theme") as "light" | "dark") || "light";
  });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const selfWriteSuppressionRef = useRef<{ path: string; content: string; until: number } | null>(
    null,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("vault:theme", theme);
  }, [theme]);

  // Load buffer when active file changes
  useEffect(() => {
    if (activePath && files[activePath] !== undefined) {
      setBuffer(files[activePath]);
      setSavedSnapshot(files[activePath]);
    } else if (paths.length) {
      setActivePath(paths[0]);
    } else {
      setActivePath(null);
      setBuffer("");
      setSavedSnapshot("");
    }
  }, [activePath, files, paths]);

  const dirty = buffer !== savedSnapshot;
  const dirtyPaths = useMemo(
    () => new Set(dirty && activePath ? [activePath] : []),
    [dirty, activePath],
  );

  useEffect(() => {
    if (!activeVault) return;
    void refreshVaultStatus(activePath);
    const id = window.setInterval(() => void refreshVaultStatus(activePath), 2500);
    return () => window.clearInterval(id);
  }, [activeVault, activePath, refreshVaultStatus]);

  useEffect(() => {
    setExternalNotice(null);
    setDiffReview(null);
    setDiffError(null);
    setConflictMessage(null);
    setSuppressedConflict(null);
  }, [activePath]);

  useEffect(() => {
    const file = vaultStatus?.file;
    if (!activePath || !file || file.path !== activePath) return;
    if (!file.exists) {
      setExternalNotice({ kind: "deleted", path: activePath });
      return;
    }
    const meta = fileMeta[activePath];
    if (!file.hash || !meta || file.hash === meta.hash) return;
    if (dirty) {
      const selfWrite = selfWriteSuppressionRef.current;
      if (
        selfWrite?.path === activePath &&
        selfWrite.content === buffer &&
        Date.now() < selfWrite.until
      ) {
        return;
      }
      if (suppressedConflict?.path === activePath && suppressedConflict.hash === file.hash) return;
      setExternalNotice({ kind: "conflict", path: activePath });
      return;
    }
    if (selfWriteSuppressionRef.current?.path === activePath) {
      selfWriteSuppressionRef.current = null;
    }
    void reloadFile(activePath);
  }, [activePath, buffer, dirty, fileMeta, reloadFile, suppressedConflict, vaultStatus]);

  useEffect(() => {
    if (!vaultStatus?.changedExternally || !vaultStatus.lastEventAt || dirty) return;
    if (vaultStatus.file?.deletedExternally) return;
    if (handledVaultChangeAt === vaultStatus.lastEventAt) return;
    setHandledVaultChangeAt(vaultStatus.lastEventAt);
    void refreshActiveVault();
  }, [dirty, handledVaultChangeAt, refreshActiveVault, vaultStatus]);

  const selectedNotePaths = useMemo(
    () => Array.from(selectedPaths).filter((path) => Boolean(index.notes[path])),
    [index.notes, selectedPaths],
  );
  const metadataPath = selectedNotePaths.length === 1 ? selectedNotePaths[0] : activePath;
  const metadataNote = metadataPath ? index.notes[metadataPath] : null;
  const metadataFileMeta = metadataPath ? fileMeta[metadataPath] : undefined;
  const combinedMetadata = useMemo(() => {
    if (selectedNotePaths.length <= 1) return null;
    const uniqueTags = new Set<string>();
    let totalBytes = 0;
    let headings = 0;
    let outgoing = 0;
    let backlinks = 0;
    let issueCount = 0;
    for (const path of selectedNotePaths) {
      const selectedNote = index.notes[path];
      if (!selectedNote) continue;
      for (const tag of selectedNote.tags) uniqueTags.add(tag);
      totalBytes += fileMeta[path]?.size ?? 0;
      headings += selectedNote.headings.length;
      outgoing += selectedNote.wikilinks.length;
      backlinks += index.backlinks[path]?.length ?? 0;
      issueCount += issues.filter((issue) => issue.path === path).length;
    }
    return {
      fileCount: selectedNotePaths.length,
      totalBytes,
      headings,
      outgoing,
      backlinks,
      issueCount,
      tags: Array.from(uniqueTags).sort((a, b) => a.localeCompare(b)),
      paths: selectedNotePaths,
    };
  }, [fileMeta, index.backlinks, index.notes, issues, selectedNotePaths]);
  const previewBody = useMemo(() => {
    // Re-parse the live buffer so preview matches what's in the editor
    if (!activePath) return "";
    const stripped = buffer.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return renderMarkdown(stripped, index);
  }, [buffer, index, activePath]);

  const backlinks = activePath ? (index.backlinks[activePath] ?? []) : [];
  const fileIssues = useMemo(
    () => (activePath ? issues.filter((i) => i.path === activePath) : []),
    [issues, activePath],
  );

  const save = useCallback(async () => {
    if (!activePath || saving) return false;
    setSaving(true);
    const changedOnDisk = await hasExternalChange(activePath);
    if (changedOnDisk) {
      setConflictMessage("Disk changed externally. Review changes or overwrite to continue.");
      setSuppressedConflict(null);
      setExternalNotice({ kind: "conflict", path: activePath });
      setSaving(false);
      return false;
    }
    const ok = await write(activePath, buffer);
    if (ok) {
      selfWriteSuppressionRef.current = {
        path: activePath,
        content: buffer,
        until: Date.now() + 5000,
      };
      setSavedSnapshot(buffer);
      setExternalNotice(null);
      setDiffReview(null);
      setDiffError(null);
      setConflictMessage(null);
      setSuppressedConflict(null);
      void refreshVaultStatus(activePath);
    }
    setSaving(false);
    return ok;
  }, [activePath, buffer, hasExternalChange, refreshVaultStatus, saving, write]);

  // Ctrl/Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const selectPath = useCallback(
    (path: string) => {
      if (path === activePath) return;
      if (dirty && !window.confirm("Discard unsaved changes and switch files?")) {
        return;
      }
      setSelectedPaths(new Set());
      setActivePath(path);
    },
    [activePath, dirty],
  );

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a.wikilink") as HTMLAnchorElement | null;
    if (!link) return;
    e.preventDefault();
    const path = link.dataset.path;
    const anchor = link.dataset.anchor;
    if (!path) return;
    selectPath(path);
    if (isMobile) setMobileTab("preview");
    if (anchor) {
      requestAnimationFrame(() => {
        const el = document.getElementById(anchor);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const toggleFolder = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const handleNewFile = async (parent: string) => {
    const name = window.prompt("New file name (without .md)", "new-note");
    if (!name) return;
    const safe = name.trim().replace(/\.md$/i, "");
    const path = parent ? `${parent}/${safe}.md` : `${safe}.md`;
    const ok = await createFile(path);
    if (!ok) return;
    setActivePath(path);
    if (isMobile) setMobileTab("edit");
  };
  const handleNewIndexNote = async () => {
    const ok = await createFile("index.md");
    if (!ok) return;
    setActivePath("index.md");
    if (isMobile) setMobileTab("edit");
  };
  const handleNewFolder = async (parent: string) => {
    const name = window.prompt("New folder name", "folder");
    if (!name) return;
    const path = parent ? `${parent}/${name.trim()}` : name.trim();
    const ok = await createFolder(path);
    if (!ok) return;
    setExpanded((prev) => new Set(prev).add(path));
  };
  const handleRename = async () => {
    if (!activePath) return;
    if (dirty) {
      const shouldSave = window.confirm("Save current edits before renaming?");
      if (!shouldSave) return;
      const saved = await save();
      if (!saved) return;
    }
    const next = window.prompt("Rename to (full path)", activePath);
    if (!next || next === activePath) return;
    const ok = await rename(activePath, next);
    if (ok) setActivePath(next);
  };
  const openSettings = () => setShowSettings(true);
  const handleSaveAsNew = async () => {
    if (!activePath) return;
    const next = window.prompt("Save current buffer as new Markdown file", activePath);
    if (!next || next === activePath) return;
    const ok = await createFileWithContent(next, buffer);
    if (!ok) return;
    setActivePath(next);
    setSavedSnapshot(buffer);
    setExternalNotice(null);
    setDiffReview(null);
    setConflictMessage(null);
    setSuppressedConflict(null);
  };
  const handleReloadDiskVersion = async () => {
    if (!activePath) return;
    const file = vaultStatus?.file;
    if (file?.exists === false) {
      await refreshActiveVault();
      setExternalNotice(null);
      setDiffReview(null);
      setConflictMessage(null);
      setSuppressedConflict(null);
      return;
    }
    const ok = await reloadFile(activePath);
    if (ok) {
      setExternalNotice(null);
      setDiffReview(null);
      setConflictMessage(null);
      setSuppressedConflict(null);
    }
  };
  const handleCloseDeletedBuffer = async () => {
    await refreshActiveVault();
    setActivePath(null);
    setExternalNotice(null);
    setDiffReview(null);
    setConflictMessage(null);
    setSuppressedConflict(null);
  };
  const handleReviewChanges = async () => {
    if (!activePath) return;
    setDiffError(null);
    const disk = await readFileFromDisk(activePath);
    if (!disk) {
      setDiffError("Could not load the current disk version.");
      return;
    }
    setDiffReview({ path: activePath, diskContent: disk.content });
  };
  const handleKeepEditing = () => {
    const hash = vaultStatus?.file?.hash;
    if (externalNotice?.kind === "conflict" && hash) {
      setSuppressedConflict({ path: externalNotice.path, hash });
    }
    setExternalNotice(null);
    setDiffReview(null);
    setConflictMessage(null);
  };
  const handleOverwriteDisk = async () => {
    if (!activePath) return;
    const okToOverwrite = window.confirm(
      "Overwrite the current disk version with your AREPO editor buffer? The external disk changes for this file will be replaced.",
    );
    if (!okToOverwrite) return;
    const ok = await overwriteFile(activePath, buffer);
    if (!ok) {
      setConflictMessage("Overwrite failed. Review the latest disk version before trying again.");
      setExternalNotice({ kind: "conflict", path: activePath });
      return;
    }
    setSavedSnapshot(buffer);
    setExternalNotice(null);
    setDiffReview(null);
    setDiffError(null);
    setConflictMessage(null);
    setSuppressedConflict(null);
    await refreshVaultStatus(activePath);
  };

  // Search results
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return Object.values(index.notes)
      .map((n) => {
        const inName = n.path.toLowerCase().includes(q);
        const inBody = n.body.toLowerCase().includes(q);
        const inTags = n.tags.some((t) => t.toLowerCase().includes(q));
        if (!inName && !inBody && !inTags) return null;
        return { note: n, inName, inBody, inTags };
      })
      .filter(Boolean) as {
      note: (typeof index.notes)[string];
      inName: boolean;
      inBody: boolean;
      inTags: boolean;
    }[];
  }, [query, index]);

  const totalIssues = issues.length;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  const graphData = useMemo(
    () => (vaultMode === "graph" ? buildGraph(index, issues) : null),
    [vaultMode, index, issues],
  );
  const suppressedActiveConflict =
    Boolean(activePath) &&
    Boolean(suppressedConflict) &&
    suppressedConflict?.path === activePath &&
    suppressedConflict.hash === vaultStatus?.file?.hash;

  // ----- shared pane content -----
  const vaultPane = (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-2 border-b shrink-0 flex gap-1">
        <SegBtn active={vaultMode === "tree"} onClick={() => setVaultMode("tree")}>
          <FolderTree className="size-3.5" /> Tree
        </SegBtn>
        <SegBtn active={vaultMode === "graph"} onClick={() => setVaultMode("graph")}>
          <Network className="size-3.5" /> Graph
        </SegBtn>
      </div>
      {vaultMode === "tree" ? (
        <>
          <div className="p-2 border-b space-y-2 shrink-0">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files, text, tags…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={() => void handleNewFile("")}
              >
                New file
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={() => void handleNewFolder("")}
              >
                New folder
              </Button>
            </div>
            {activeVault && !files["index.md"] && (
              <div className="rounded border bg-muted/30 px-2 py-2 text-xs space-y-2">
                <div>
                  <div className="font-medium">Optional homepage note</div>
                  <div className="text-muted-foreground">
                    AREPO indexes this vault automatically; `index.md` is only a normal note.
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleNewIndexNote()}
                >
                  Create index.md
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2">
            {results ? (
              <SearchResults
                results={results}
                onPick={(p) => {
                  selectPath(p);
                  setQuery("");
                  if (isMobile) setMobileTab("edit");
                }}
              />
            ) : (
              <FileTree
                paths={paths}
                folders={vault.folders}
                activePath={activePath}
                dirtyPaths={dirtyPaths}
                expanded={expanded}
                onToggleFolder={toggleFolder}
                onSelect={(p) => {
                  selectPath(p);
                  if (isMobile) setMobileTab("edit");
                }}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0">
          {graphData && (
            <VaultGraph
              data={graphData}
              activePath={activePath}
              selectedPaths={selectedPaths}
              onSelectionChange={(paths) => setSelectedPaths(new Set(paths))}
              onSelect={(p) => {
                selectPath(p);
                if (isMobile) setMobileTab("edit");
              }}
              onOpenPreview={(p) => {
                selectPath(p);
                if (isMobile) setMobileTab("preview");
                else setCenterTab("preview");
              }}
            />
          )}
        </div>
      )}
    </div>
  );

  const fileActionBar = (
    <div className="h-10 shrink-0 border-b flex items-center gap-2 px-3 text-xs">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono truncate min-w-0 flex-1">{activePath ?? "—"}</span>
      {dirty && <span className="text-amber-500 font-medium shrink-0">●</span>}
      {suppressedActiveConflict && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs shrink-0 text-amber-600 dark:text-amber-300"
          onClick={() => {
            if (activePath) {
              setSuppressedConflict(null);
              setExternalNotice({ kind: "conflict", path: activePath });
            }
          }}
        >
          External conflict
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs shrink-0"
        onClick={() => void handleRename()}
        disabled={!activePath}
      >
        Rename
      </Button>
      <Button
        variant="default"
        size="sm"
        className="h-7 gap-1.5 text-xs shrink-0"
        onClick={() => void save()}
        disabled={!dirty || saving}
      >
        <Save className="size-3.5" />
        Save
        <kbd className="ml-1 hidden md:inline-block font-mono text-[10px] opacity-70">⌘S</kbd>
      </Button>
    </div>
  );

  const editorPane = (
    <div className="flex flex-col min-h-0 h-full">
      {fileActionBar}
      <textarea
        ref={editorRef}
        spellCheck={false}
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        className="flex-1 min-h-0 resize-none w-full p-4 bg-background text-foreground font-mono text-[13px] leading-relaxed outline-none"
        placeholder={activePath ? "" : "Select or create a file to start editing."}
      />
    </div>
  );

  const previewPane = (
    <div className="flex flex-col min-h-0 h-full">
      {fileActionBar}
      <div
        className="flex-1 min-h-0 overflow-auto p-4 prose-vault"
        onClick={onPreviewClick}
        dangerouslySetInnerHTML={{ __html: previewBody }}
      />
    </div>
  );

  const inspectorPane = (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      <Section icon={<Link2 className="size-3.5" />} title="Backlinks" count={backlinks.length}>
        {backlinks.length === 0 ? (
          <Empty>No notes link here.</Empty>
        ) : (
          <ul className="space-y-1">
            {backlinks.map((bl, i) => {
              const from = index.notes[bl.fromPath];
              return (
                <li key={i}>
                  <button
                    className="text-left text-xs hover:underline w-full truncate"
                    onClick={() => {
                      selectPath(bl.fromPath);
                      if (isMobile) setMobileTab("edit");
                    }}
                  >
                    <span className="font-medium">{from?.title ?? bl.fromPath}</span>
                    {bl.anchor && <span className="text-muted-foreground"> #{bl.anchor}</span>}
                    <span className="text-muted-foreground"> — {bl.fromPath}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section
        icon={<AlertTriangle className="size-3.5" />}
        title="Validation (this file)"
        count={fileIssues.length}
      >
        {fileIssues.length === 0 ? (
          <Empty>No issues.</Empty>
        ) : (
          <ul className="space-y-1">
            {fileIssues.map((iss, i) => (
              <li
                key={i}
                className={cn(
                  "text-xs break-words",
                  iss.severity === "error"
                    ? "text-destructive"
                    : "text-amber-600 dark:text-amber-400",
                )}
              >
                <span className="font-mono opacity-70">[{iss.kind}]</span> {iss.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        icon={<FileText className="size-3.5" />}
        title={combinedMetadata ? "Combined metadata" : "Metadata"}
        count={combinedMetadata?.fileCount}
      >
        {combinedMetadata ? (
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">files</dt>
            <dd>{combinedMetadata.fileCount}</dd>
            <dt className="text-muted-foreground">total size</dt>
            <dd>{formatBytes(combinedMetadata.totalBytes)}</dd>
            <dt className="text-muted-foreground">tags</dt>
            <dd className="flex flex-wrap gap-1">
              {combinedMetadata.tags.length ? (
                combinedMetadata.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] py-0">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
            <dt className="text-muted-foreground">headings</dt>
            <dd>{combinedMetadata.headings}</dd>
            <dt className="text-muted-foreground">outgoing</dt>
            <dd>{combinedMetadata.outgoing}</dd>
            <dt className="text-muted-foreground">backlinks</dt>
            <dd>{combinedMetadata.backlinks}</dd>
            <dt className="text-muted-foreground">issues</dt>
            <dd>{combinedMetadata.issueCount}</dd>
            <dt className="text-muted-foreground">paths</dt>
            <dd className="space-y-0.5">
              {combinedMetadata.paths.map((path) => (
                <div key={path} className="font-mono truncate" title={path}>
                  {path}
                </div>
              ))}
            </dd>
          </dl>
        ) : metadataNote ? (
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">title</dt>
            <dd className="truncate">{metadataNote.title}</dd>
            <dt className="text-muted-foreground">path</dt>
            <dd className="font-mono truncate" title={metadataPath ?? undefined}>
              {metadataPath}
            </dd>
            <dt className="text-muted-foreground">size</dt>
            <dd>{metadataFileMeta ? formatBytes(metadataFileMeta.size) : "checking"}</dd>
            <dt className="text-muted-foreground">id</dt>
            <dd className="font-mono truncate">{(metadataNote.frontmatter.id as string) ?? "—"}</dd>
            <dt className="text-muted-foreground">tags</dt>
            <dd className="flex flex-wrap gap-1">
              {metadataNote.tags.length ? (
                metadataNote.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] py-0">
                    {t}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
            <dt className="text-muted-foreground">headings</dt>
            <dd>{metadataNote.headings.length}</dd>
            <dt className="text-muted-foreground">outgoing</dt>
            <dd>{metadataNote.wikilinks.length}</dd>
          </dl>
        ) : (
          <Empty>No file selected.</Empty>
        )}
      </Section>
    </div>
  );

  return (
    <div
      className="h-[100dvh] w-full flex flex-col bg-background text-foreground overflow-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Top bar */}
      <header className="h-10 shrink-0 border-b flex items-center gap-2 px-3 text-xs">
        <Database className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium tracking-tight shrink-0">Vault</span>
        <Badge variant="outline" className="font-mono shrink-0 hidden sm:inline-flex">
          {Object.keys(index.notes).length} notes
        </Badge>
        <Badge variant={errorCount > 0 ? "destructive" : "outline"} className="font-mono shrink-0">
          {errorCount}e · {totalIssues - errorCount}w
        </Badge>
        {vaultStatus && vaultStatus.indexStatus !== "fresh" && (
          <Badge
            variant={vaultStatus.indexStatus === "error" ? "destructive" : "outline"}
            className="font-mono shrink-0"
            title={vaultStatus.error ?? "Vault changed on disk"}
          >
            index {vaultStatus.indexStatus}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {vault.vaults.length > 0 && (
            <select
              value={activeVault?.id ?? ""}
              onChange={(e) => vault.selectVault(e.target.value)}
              className="h-7 max-w-[180px] rounded border bg-background px-2 text-xs"
              title="Select vault"
            >
              {vault.vaults.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 hidden sm:inline-flex"
            onClick={openSettings}
            title="Open vault settings"
          >
            <Settings className="size-3.5" />
            Vaults
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 sm:hidden"
            onClick={openSettings}
            title="Vault settings"
          >
            <Settings className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 hidden sm:inline-flex"
            onClick={() => void reindex()}
            disabled={!activeVault}
            title="Rebuild machine index from Markdown files"
          >
            <RefreshCw className="size-3.5" />
            Rebuild index
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 sm:hidden"
            onClick={() => void reindex()}
            disabled={!activeVault}
            title="Rebuild machine index"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </div>
      </header>

      {(error || mutationError) && (
        <div className="shrink-0 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {mutationError ?? error}
        </div>
      )}

      {externalNotice && (
        <div className="shrink-0 border-b bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="font-medium">
            {externalNotice.kind === "deleted"
              ? "This file was deleted on disk."
              : "This file changed on disk while you have unsaved edits."}
          </span>
          <span className="font-mono truncate max-w-[260px]">{externalNotice.path}</span>
          {conflictMessage && <span className="text-destructive">{conflictMessage}</span>}
          {diffError && <span className="text-destructive">{diffError}</span>}
          <div className="ml-auto flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleKeepEditing}>
              Keep editing
            </Button>
            {externalNotice.kind === "conflict" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleReviewChanges()}
                >
                  Review changes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-destructive/40 text-destructive"
                  onClick={() => void handleOverwriteDisk()}
                >
                  Overwrite disk with my edits
                </Button>
              </>
            )}
            {externalNotice.kind === "deleted" ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void handleCloseDeletedBuffer()}
              >
                Close buffer
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void handleReloadDiskVersion()}
              >
                Reload disk version
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleSaveAsNew()}
            >
              Save as new file
            </Button>
          </div>
        </div>
      )}

      {diffReview && (
        <DiffReviewPanel
          path={diffReview.path}
          yourText={buffer}
          diskText={diffReview.diskContent}
          onClose={() => setDiffReview(null)}
          onKeep={handleKeepEditing}
          onReload={() => void handleReloadDiskVersion()}
          onSaveAsNew={() => void handleSaveAsNew()}
          onOverwrite={() => void handleOverwriteDisk()}
        />
      )}

      {showSettings && (
        <main className="flex-1 min-h-0 overflow-auto">
          <VaultSettingsPanel
            vaults={vault.vaults}
            activeVaultId={activeVault?.id ?? null}
            health={health}
            mutationError={mutationError}
            onClose={() => setShowSettings(false)}
            onSelectVault={vault.selectVault}
            onAddVault={addVault}
            onReindexVault={reindexVault}
            onRefreshVaults={refreshNode}
            onTestHealth={testHealth}
          />
        </main>
      )}

      {!showSettings && loading && !activeVault && (
        <main className="flex-1 min-h-0 flex items-center justify-center p-6 text-sm text-muted-foreground">
          Connecting to local backend...
        </main>
      )}

      {!showSettings && !loading && !activeVault && (
        <main className="flex-1 min-h-0 overflow-auto">
          <VaultSettingsPanel
            vaults={vault.vaults}
            activeVaultId={null}
            health={health}
            mutationError={mutationError}
            firstRun
            onClose={() => setShowSettings(false)}
            onSelectVault={vault.selectVault}
            onAddVault={addVault}
            onReindexVault={reindexVault}
            onRefreshVaults={refreshNode}
            onTestHealth={testHealth}
          />
        </main>
      )}

      {!showSettings && activeVault && (
        <>
          {/* Desktop: 3-pane with center editor/preview tabs */}
          <div className="flex-1 min-h-0 hidden md:grid md:grid-cols-[260px_minmax(0,1fr)_320px]">
            <aside className="border-r min-h-0">{vaultPane}</aside>
            <section className="flex flex-col min-h-0 border-r">
              <div className="h-9 shrink-0 border-b flex items-center gap-1 px-2">
                <SegBtn active={centerTab === "edit"} onClick={() => setCenterTab("edit")}>
                  <Pencil className="size-3.5" /> Edit
                </SegBtn>
                <SegBtn active={centerTab === "preview"} onClick={() => setCenterTab("preview")}>
                  <Eye className="size-3.5" /> Preview
                </SegBtn>
              </div>
              <div className="flex-1 min-h-0">
                {centerTab === "edit" ? editorPane : previewPane}
              </div>
            </section>
            <aside className="min-h-0">{inspectorPane}</aside>
          </div>

          {/* Mobile: single-view tabbed */}
          <main className="flex-1 min-h-0 md:hidden">
            <div className="h-full" hidden={mobileTab !== "vault"}>
              {vaultPane}
            </div>
            <div className="h-full" hidden={mobileTab !== "edit"}>
              {editorPane}
            </div>
            <div className="h-full" hidden={mobileTab !== "preview"}>
              {previewPane}
            </div>
            <div className="h-full" hidden={mobileTab !== "inspect"}>
              {inspectorPane}
            </div>
          </main>
          <nav className="md:hidden shrink-0 border-t grid grid-cols-4 bg-background">
            <TabBtn
              active={mobileTab === "vault"}
              onClick={() => setMobileTab("vault")}
              icon={<FolderTree className="size-4" />}
              label="Vault"
            />
            <TabBtn
              active={mobileTab === "edit"}
              onClick={() => setMobileTab("edit")}
              icon={<Pencil className="size-4" />}
              label="Edit"
              dot={dirty}
            />
            <TabBtn
              active={mobileTab === "preview"}
              onClick={() => setMobileTab("preview")}
              icon={<Eye className="size-4" />}
              label="Preview"
            />
            <TabBtn
              active={mobileTab === "inspect"}
              onClick={() => setMobileTab("inspect")}
              icon={<Info className="size-4" />}
              label="Inspect"
              badge={errorCount > 0 ? errorCount : undefined}
            />
          </nav>
        </>
      )}
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-2.5 rounded text-xs font-medium inline-flex items-center gap-1.5",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  dot,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  dot?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="relative">
        {icon}
        {dot && <span className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-amber-500" />}
        {typeof badge === "number" && (
          <span className="absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] leading-[14px] text-center">
            {badge}
          </span>
        )}
      </span>
      {label}
      {active && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-foreground rounded-full" />
      )}
    </button>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b last:border-b-0">
      <div className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        {title}
        {typeof count === "number" && <span className="font-mono normal-case">({count})</span>}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-muted-foreground italic">{children}</div>;
}

function SearchResults({
  results,
  onPick,
}: {
  results: {
    note: { path: string; title: string; tags: string[] };
    inName: boolean;
    inBody: boolean;
    inTags: boolean;
  }[];
  onPick: (path: string) => void;
}) {
  if (!results.length) return <div className="text-xs text-muted-foreground p-2">No matches.</div>;
  return (
    <ul className="space-y-1">
      {results.map((r) => (
        <li key={r.note.path}>
          <button
            onClick={() => onPick(r.note.path)}
            className="w-full text-left rounded px-2 py-1.5 hover:bg-muted"
          >
            <div className="text-xs font-medium truncate">{r.note.title}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {r.note.path}
            </div>
            <div className="flex gap-1 mt-0.5">
              {r.inName && (
                <Badge variant="outline" className="text-[9px] py-0">
                  name
                </Badge>
              )}
              {r.inBody && (
                <Badge variant="outline" className="text-[9px] py-0">
                  text
                </Badge>
              )}
              {r.inTags && (
                <Badge variant="outline" className="text-[9px] py-0">
                  tag
                </Badge>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DiffReviewPanel({
  path,
  yourText,
  diskText,
  onClose,
  onKeep,
  onReload,
  onSaveAsNew,
  onOverwrite,
}: {
  path: string;
  yourText: string;
  diskText: string;
  onClose: () => void;
  onKeep: () => void;
  onReload: () => void;
  onSaveAsNew: () => void;
  onOverwrite: () => void;
}) {
  const [viewMode, setViewMode] = useState<"diff" | "full">("diff");
  const rows = useMemo(
    () => numberLineDiffRows(buildLineDiff(yourText, diskText)),
    [yourText, diskText],
  );
  const contextRows = useMemo(() => buildContextLineDiff(rows, 2), [rows]);
  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm p-3 md:p-6">
      <div className="h-full max-w-7xl mx-auto border rounded-md bg-background shadow-lg flex flex-col min-h-0">
        <div className="shrink-0 border-b px-3 py-2 flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Review external changes</h2>
            <div className="text-xs text-muted-foreground font-mono truncate">{path}</div>
          </div>
          <div className="flex rounded-md border p-0.5">
            <Button
              variant={viewMode === "diff" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewMode("diff")}
            >
              Diff
            </Button>
            <Button
              variant={viewMode === "full" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewMode("full")}
            >
              Full files
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onKeep}>
              Keep editing
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onReload}>
              Reload disk version
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSaveAsNew}>
              Save as new file
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-destructive/40 text-destructive"
              onClick={onOverwrite}
            >
              Overwrite disk with my edits
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <div className="grid gap-3 md:grid-cols-2 md:h-full md:min-h-0">
            {viewMode === "diff" ? (
              <>
                <DiffPane title="Your edits" side="left" rows={contextRows} />
                <DiffPane title="Disk version" side="right" rows={contextRows} />
              </>
            ) : (
              <>
                <DiffPane title="Your edits" side="left" rows={rows} />
                <DiffPane title="Disk version" side="right" rows={rows} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffPane({
  title,
  side,
  rows,
}: {
  title: string;
  side: "left" | "right";
  rows: ContextLineDiffRow[];
}) {
  return (
    <section className="border rounded-md min-h-[260px] md:min-h-0 flex flex-col">
      <div className="shrink-0 border-b px-3 py-2 text-xs font-semibold">{title}</div>
      <div className="flex-1 min-h-0 overflow-auto bg-muted/20">
        <pre className="m-0 p-0 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words">
          {rows.map((row, index) =>
            row.kind === "gap" ? (
              <DiffGap key={index} />
            ) : (
              <DiffLine key={index} row={row} side={side} />
            ),
          )}
        </pre>
      </div>
    </section>
  );
}

function DiffLine({
  row,
  side,
}: {
  row: Exclude<ContextLineDiffRow, { kind: "gap" }>;
  side: "left" | "right";
}) {
  const text = side === "left" ? row.left : row.right;
  const lineNumber = side === "left" ? row.leftLine : row.rightLine;
  const highlighted =
    (side === "left" && (row.kind === "removed" || row.kind === "changed")) ||
    (side === "right" && (row.kind === "added" || row.kind === "changed"));
  const backgroundColor = highlighted ? (side === "left" ? "#a51b0b" : "#34219C") : undefined;
  return (
    <span
      className="block min-h-[1.5em] px-2 py-0.5"
      style={{
        backgroundColor,
        color: highlighted ? "white" : undefined,
      }}
    >
      <span className="inline-block w-10 pr-3 select-none text-right opacity-50">{lineNumber}</span>
      <span>{text ?? ""}</span>
    </span>
  );
}

function FullFilePane({ title, text }: { title: string; text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  return (
    <section className="border rounded-md min-h-[260px] md:min-h-0 flex flex-col">
      <div className="shrink-0 border-b px-3 py-2 text-xs font-semibold">{title}</div>
      <div className="flex-1 min-h-0 overflow-auto bg-muted/20">
        <pre className="m-0 p-0 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words">
          {lines.map((line, index) => (
            <span key={index} className="block min-h-[1.5em] px-2 py-0.5">
              <span className="inline-block w-10 pr-3 select-none text-right opacity-50">
                {index + 1}
              </span>
              <span>{line}</span>
            </span>
          ))}
        </pre>
      </div>
    </section>
  );
}

type StorageBucket = {
  fileCount: number;
  bytes: number;
};

type VaultStorageSummary = {
  total: StorageBucket;
  markdownText: StorageBucket;
  attachments: StorageBucket;
  appDataCache: StorageBucket & { machineIndexBytes: number };
};

type VaultSummary = {
  fileCount: number;
  indexedNoteCount: number;
  issueCount: number;
  storage: VaultStorageSummary | null;
  status: "ready" | "error";
  error?: string;
};

function VaultSettingsPanel({
  vaults,
  activeVaultId,
  health,
  mutationError,
  firstRun,
  onClose,
  onSelectVault,
  onAddVault,
  onReindexVault,
  onRefreshVaults,
  onTestHealth,
}: {
  vaults: VaultInfo[];
  activeVaultId: string | null;
  health: { ok: boolean; node: { displayName: string; nodeId: string; mode: string } } | null;
  mutationError: string | null;
  firstRun?: boolean;
  onClose: () => void;
  onSelectVault: (vaultId: string) => void;
  onAddVault: (
    rootPath: string,
    displayName?: string,
    permissions?: Partial<VaultPermission>,
  ) => Promise<boolean>;
  onReindexVault: (vaultId: string) => Promise<boolean>;
  onRefreshVaults: () => Promise<boolean>;
  onTestHealth: () => Promise<boolean>;
}) {
  const [summaries, setSummaries] = useState<Record<string, VaultSummary>>({});
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [busyVaultId, setBusyVaultId] = useState<string | null>(null);

  const refreshSummaries = useCallback(async () => {
    setSummaryError(null);
    const entries = await Promise.all(
      vaults.map(async (vault) => {
        try {
          const [files, indexResponse, storage] = await Promise.all([
            settingsApi<{ files: { path: string }[] }>(
              `/api/vaults/${encodeURIComponent(vault.id)}/files`,
            ),
            settingsApi<{ index: { notes: Record<string, unknown> }; issues: unknown[] }>(
              `/api/vaults/${encodeURIComponent(vault.id)}/index`,
            ),
            settingsApi<VaultStorageSummary>(`/api/vaults/${encodeURIComponent(vault.id)}/storage`),
          ]);
          return [
            vault.id,
            {
              fileCount: files.files.length,
              indexedNoteCount: Object.keys(indexResponse.index.notes).length,
              issueCount: indexResponse.issues.length,
              storage,
              status: "ready" as const,
            },
          ] as const;
        } catch (error) {
          return [
            vault.id,
            {
              fileCount: 0,
              indexedNoteCount: 0,
              issueCount: 0,
              storage: null,
              status: "error" as const,
              error: errorMessage(error),
            },
          ] as const;
        }
      }),
    );
    setSummaries(Object.fromEntries(entries));
  }, [vaults]);

  useEffect(() => {
    void refreshSummaries().catch((error) => setSummaryError(errorMessage(error)));
  }, [refreshSummaries]);

  const reindexOne = async (vaultId: string) => {
    setBusyVaultId(vaultId);
    const ok = await onReindexVault(vaultId);
    if (ok) await refreshSummaries();
    setBusyVaultId(null);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Vault Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure local Markdown folders that this AREPO backend may read and write.
            </p>
          </div>
          {!firstRun && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>

        {firstRun && (
          <div className="border rounded-md p-4 bg-muted/30 space-y-2">
            <h2 className="text-sm font-semibold">No local vault configured</h2>
            <p className="text-sm text-muted-foreground">
              AREPO needs an existing local folder of Markdown files before the editor can open.
              Start with a test or disposable vault until you are comfortable with the write flow.
            </p>
          </div>
        )}

        {(mutationError || summaryError) && (
          <div className="border border-destructive/30 bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {mutationError ?? summaryError}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <NodeHealthCard health={health} onTestHealth={onTestHealth} />
            <ConfiguredVaultsCard
              vaults={vaults}
              summaries={summaries}
              activeVaultId={activeVaultId}
              busyVaultId={busyVaultId}
              onSelectVault={onSelectVault}
              onReindexVault={reindexOne}
              onRefresh={async () => {
                await onRefreshVaults();
                await refreshSummaries();
              }}
            />
          </div>
          <div className="space-y-4">
            <AddVaultCard
              onAddVault={onAddVault}
              onAdded={async () => {
                await onRefreshVaults();
                await refreshSummaries();
              }}
            />
            <SecurityModelCard />
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeHealthCard({
  health,
  onTestHealth,
}: {
  health: { ok: boolean; node: { displayName: string; nodeId: string; mode: string } } | null;
  onTestHealth: () => Promise<boolean>;
}) {
  const [checking, setChecking] = useState(false);
  const test = async () => {
    setChecking(true);
    await onTestHealth();
    setChecking(false);
  };
  return (
    <section className="border rounded-md">
      <div className="border-b px-3 py-2 flex items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Local Node</h2>
        <Badge variant={health?.ok ? "outline" : "destructive"} className="ml-auto">
          {health?.ok ? "Healthy" : "Unknown"}
        </Badge>
      </div>
      <div className="p-3 text-sm space-y-2">
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Name</span>
          <span>{health?.node.displayName ?? "Local Node"}</span>
          <span className="text-muted-foreground">Node ID</span>
          <span className="font-mono">{health?.node.nodeId ?? "local"}</span>
          <span className="text-muted-foreground">Mode</span>
          <span>{health?.node.mode ?? "local"}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void test()} disabled={checking}>
          {checking ? "Checking..." : "Test connection"}
        </Button>
      </div>
    </section>
  );
}

function ConfiguredVaultsCard({
  vaults,
  summaries,
  activeVaultId,
  busyVaultId,
  onSelectVault,
  onReindexVault,
  onRefresh,
}: {
  vaults: VaultInfo[];
  summaries: Record<string, VaultSummary>;
  activeVaultId: string | null;
  busyVaultId: string | null;
  onSelectVault: (vaultId: string) => void;
  onReindexVault: (vaultId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };
  return (
    <section className="border rounded-md">
      <div className="border-b px-3 py-2 flex items-center gap-2">
        <FolderTree className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Configured Vaults</h2>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          Refresh
        </Button>
      </div>
      <div className="divide-y">
        {vaults.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No vaults are configured. Add a local Markdown folder to begin.
          </div>
        ) : (
          vaults.map((vault) => {
            const summary = summaries[vault.id];
            const selected = vault.id === activeVaultId;
            return (
              <div key={vault.id} className="p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold truncate">{vault.displayName}</h3>
                      {selected && <Badge variant="secondary">Selected</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {vault.id}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onSelectVault(vault.id)}
                    disabled={selected}
                  >
                    Select
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void onReindexVault(vault.id)}
                    disabled={busyVaultId === vault.id}
                  >
                    {busyVaultId === vault.id ? "Indexing..." : "Rebuild index"}
                  </Button>
                </div>
                <div className="text-xs font-mono break-all bg-muted/40 rounded px-2 py-1">
                  {vault.rootPath}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <PermissionList permissions={vault.permissions} />
                  <div className="text-xs space-y-1">
                    <StorageSummaryList summary={summary} />
                  </div>
                </div>
                {vault.permissions.deleteFiles && (
                  <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex gap-2">
                    <ShieldAlert className="size-4 shrink-0" />
                    Delete permission is enabled for this vault.
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function StorageSummaryList({ summary }: { summary: VaultSummary | undefined }) {
  if (!summary) {
    return <div className="text-muted-foreground">Storage: checking</div>;
  }
  if (summary.status === "error") {
    return <div className="text-destructive">{summary.error}</div>;
  }
  const storage = summary.storage;
  return (
    <>
      <div>
        <span className="text-muted-foreground">Files:</span> {summary.fileCount}
      </div>
      <div>
        <span className="text-muted-foreground">Indexed notes:</span> {summary.indexedNoteCount}
      </div>
      <div>
        <span className="text-muted-foreground">Index issues:</span> {summary.issueCount}
      </div>
      <div>
        <span className="text-muted-foreground">Vault content:</span>{" "}
        {storage ? formatBytes(storage.total.bytes) : "checking"}
        {storage && ` (${storage.total.fileCount} files)`}
      </div>
      <div>
        <span className="text-muted-foreground">Markdown/text:</span>{" "}
        {storage ? formatBytes(storage.markdownText.bytes) : "checking"}
        {storage && ` (${storage.markdownText.fileCount} files)`}
      </div>
      <div>
        <span className="text-muted-foreground">Attachments/other:</span>{" "}
        {storage ? formatBytes(storage.attachments.bytes) : "checking"}
        {storage && ` (${storage.attachments.fileCount} files)`}
      </div>
      <div>
        <span className="text-muted-foreground">AREPO map/index cache:</span>{" "}
        {storage ? formatBytes(storage.appDataCache.bytes) : "checking"}
        {storage && ` (${storage.appDataCache.fileCount} files)`}
      </div>
      <div>
        <span className="text-muted-foreground">Status:</span> {summary.status}
      </div>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function PermissionList({ permissions }: { permissions: VaultPermission }) {
  const items: [keyof VaultPermission, string][] = [
    ["readIndex", "Read index"],
    ["readContent", "Read content"],
    ["writeContent", "Write content"],
    ["deleteFiles", "Delete files"],
  ];
  return (
    <div className="text-xs space-y-1">
      {items.map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              permissions[key] ? "bg-emerald-500" : "bg-muted-foreground/35",
            )}
          />
          <span className={permissions[key] ? "" : "text-muted-foreground"}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function AddVaultCard({
  onAddVault,
  onAdded,
}: {
  onAddVault: (
    rootPath: string,
    displayName?: string,
    permissions?: Partial<VaultPermission>,
  ) => Promise<boolean>;
  onAdded: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [permissions, setPermissions] = useState<VaultPermission>({
    readIndex: true,
    readContent: true,
    writeContent: true,
    deleteFiles: false,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setPermission = (key: keyof VaultPermission, value: boolean) => {
    if (
      key === "deleteFiles" &&
      value &&
      !window.confirm(
        "Enable delete permission for this vault? Files can be permanently removed through the local backend.",
      )
    ) {
      return;
    }
    setPermissions((prev) => {
      const next = { ...prev, [key]: value };
      if (!next.readContent) {
        next.writeContent = false;
        next.deleteFiles = false;
      }
      if (!next.writeContent) next.deleteFiles = false;
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    const path = rootPath.trim();
    const pathError = validateVaultRootPath(path);
    const permissionError = validateVaultPermissions(permissions);
    if (!name) {
      setLocalError("Name is required.");
      return;
    }
    if (pathError) {
      setLocalError(pathError);
      return;
    }
    if (permissionError) {
      setLocalError(permissionError);
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    const ok = await onAddVault(path, name, permissions);
    if (ok) {
      setDisplayName("");
      setRootPath("");
      setPermissions({
        readIndex: true,
        readContent: true,
        writeContent: true,
        deleteFiles: false,
      });
      await onAdded();
    }
    setSubmitting(false);
  };

  return (
    <section className="border rounded-md">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Add Vault</h2>
      </div>
      <form className="p-3 space-y-3" onSubmit={(e) => void submit(e)}>
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="vault-name">
            Name
          </label>
          <Input
            id="vault-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Research notes"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="vault-root">
            Root path
          </label>
          <Input
            id="vault-root"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="/home/me/notes"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="rounded bg-muted/40 px-2 py-2 text-xs text-muted-foreground">
          The backend can only access folders configured here. It does not scan your filesystem.
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium">Permissions</div>
          <div className="text-xs text-muted-foreground">
            Delete permission is off by default. Read access is required for this UI to open and
            index Markdown files.
          </div>
          <PermissionCheckbox
            label="Read index"
            checked={permissions.readIndex}
            onChange={(checked) => setPermission("readIndex", checked)}
          />
          <PermissionCheckbox
            label="Read content"
            checked={permissions.readContent}
            onChange={(checked) => setPermission("readContent", checked)}
          />
          <PermissionCheckbox
            label="Write content"
            checked={permissions.writeContent}
            disabled={!permissions.readContent}
            onChange={(checked) => setPermission("writeContent", checked)}
          />
          <PermissionCheckbox
            label="Delete files"
            checked={permissions.deleteFiles}
            disabled={!permissions.writeContent}
            onChange={(checked) => setPermission("deleteFiles", checked)}
          />
        </div>
        {permissions.deleteFiles && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive flex gap-2">
            <ShieldAlert className="size-4 shrink-0" />
            Delete permission allows permanent file deletion through the backend. Leave it off
            unless you have tested backups.
          </div>
        )}
        {localError && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive">
            {localError}
          </div>
        )}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Adding..." : "Add vault"}
        </Button>
      </form>
    </section>
  );
}

function PermissionCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-xs", disabled && "opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function SecurityModelCard() {
  return (
    <section className="border rounded-md">
      <div className="border-b px-3 py-2 flex items-center gap-2">
        <ShieldAlert className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Security Model</h2>
      </div>
      <div className="p-3 text-xs text-muted-foreground space-y-2">
        <p>The backend is local-only by default and has no authentication yet.</p>
        <p>Do not expose it to a LAN or the internet.</p>
        <p>Only configured vault roots are accessible.</p>
        <p>Syncthing, Git, and Borg/Restic/Kopia remain external responsibilities.</p>
      </div>
    </section>
  );
}

function validateVaultRootPath(path: string): string | null {
  if (!path) return "Root path is required.";
  if (path.includes("\0")) return "Root path cannot contain null characters.";
  if (/\s/.test(path[0] ?? "")) return "Root path cannot start with whitespace.";
  if (/[\r\n]/.test(path)) return "Root path must be a single local path.";
  if (!isLikelyAbsolutePath(path)) {
    return "Use an absolute local root path, for example /home/me/notes.";
  }
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.some((part) => part === "..")) {
    return "Root path cannot contain .. segments. Use the resolved absolute folder path.";
  }
  if (path.replace(/^[a-zA-Z]:/, "").includes("//")) {
    return "Root path cannot contain duplicate slashes.";
  }
  return null;
}

function validateVaultPermissions(permissions: VaultPermission): string | null {
  if (!permissions.readIndex) return "Read index must stay enabled for AREPO indexing.";
  if (!permissions.readContent) return "Read content must stay enabled for AREPO editing.";
  if (permissions.writeContent && !permissions.readContent) {
    return "Write content requires read content.";
  }
  if (permissions.deleteFiles && !permissions.writeContent) {
    return "Delete files requires write content.";
  }
  return null;
}

function isLikelyAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

async function settingsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Request failed with ${response.status}`,
    );
  }
  return data as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
