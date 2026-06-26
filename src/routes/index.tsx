import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Database,
  FileText,
  Link2,
  Moon,
  RefreshCw,
  Save,
  Search,
  Sun,
} from "lucide-react";
import { FileTree } from "@/components/FileTree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useVault } from "@/lib/vault/store";
import { renderMarkdown } from "@/lib/vault/render";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vault — Local Markdown Knowledge Base" },
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
  const { files, index, issues, write, createFile, createFolder, rename, resetToDemo } =
    vault;

  const paths = useMemo(() => Object.keys(files), [files]);
  const [activePath, setActivePath] = useState<string | null>(() => paths[0] ?? null);
  const [buffer, setBuffer] = useState<string>("");
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["DCIPHERED", "SEco"]),
  );
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("vault:theme") as "light" | "dark") || "light";
  });
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("vault:theme", theme);
  }, [theme]);

  // Load buffer when active file changes
  useEffect(() => {
    if (activePath && files[activePath] !== undefined) {
      setBuffer(files[activePath]);
      setSavedSnapshot(files[activePath]);
    } else if (!activePath && paths.length) {
      setActivePath(paths[0]);
    }
  }, [activePath, files, paths]);

  const dirty = buffer !== savedSnapshot;
  const dirtyPaths = useMemo(
    () => new Set(dirty && activePath ? [activePath] : []),
    [dirty, activePath],
  );

  const note = activePath ? index.notes[activePath] : null;
  const previewBody = useMemo(() => {
    // Re-parse the live buffer so preview matches what's in the editor
    if (!activePath) return "";
    const stripped = buffer.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return renderMarkdown(stripped, index);
  }, [buffer, index, activePath]);

  const backlinks = activePath ? index.backlinks[activePath] ?? [] : [];
  const fileIssues = useMemo(
    () => (activePath ? issues.filter((i) => i.path === activePath) : []),
    [issues, activePath],
  );

  const save = () => {
    if (!activePath) return;
    write(activePath, buffer);
    setSavedSnapshot(buffer);
  };

  // Ctrl/Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a.wikilink") as HTMLAnchorElement | null;
    if (!link) return;
    e.preventDefault();
    const path = link.dataset.path;
    const anchor = link.dataset.anchor;
    if (!path) return;
    setActivePath(path);
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
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });

  const handleNewFile = (parent: string) => {
    const name = window.prompt("New file name (without .md)", "new-note");
    if (!name) return;
    const safe = name.trim().replace(/\.md$/i, "");
    const path = parent ? `${parent}/${safe}.md` : `${safe}.md`;
    createFile(path);
    setActivePath(path);
  };
  const handleNewFolder = (parent: string) => {
    const name = window.prompt("New folder name", "folder");
    if (!name) return;
    const path = parent ? `${parent}/${name.trim()}` : name.trim();
    createFolder(path);
    setExpanded((prev) => new Set(prev).add(path));
  };
  const handleRename = () => {
    if (!activePath) return;
    const next = window.prompt("Rename to (full path)", activePath);
    if (!next || next === activePath) return;
    rename(activePath, next);
    setActivePath(next);
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
      .filter(Boolean) as { note: (typeof index.notes)[string]; inName: boolean; inBody: boolean; inTags: boolean }[];
  }, [query, index]);

  const totalIssues = issues.length;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="h-10 shrink-0 border-b flex items-center gap-2 px-3 text-xs">
        <Database className="size-3.5 text-muted-foreground" />
        <span className="font-medium tracking-tight">Vault</span>
        <Badge variant="outline" className="font-mono">
          {Object.keys(index.notes).length} notes
        </Badge>
        <Badge
          variant={errorCount > 0 ? "destructive" : "outline"}
          className="font-mono"
        >
          {errorCount} errors · {totalIssues - errorCount} warnings
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={resetToDemo}
            title="Reset workspace to bundled demo files"
          >
            <RefreshCw className="size-3.5" />
            Reset demo
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

      {/* Main 3-pane */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Left: tree + search */}
        <aside className="border-r flex flex-col min-h-0">
          <div className="p-2 border-b space-y-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files, text, tags…"
                className="h-7 pl-7 text-xs"
              />
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => handleNewFile("")}
              >
                New file
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => handleNewFolder("")}
              >
                New folder
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2">
            {results ? (
              <SearchResults
                results={results}
                onPick={(p) => {
                  setActivePath(p);
                  setQuery("");
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
                onSelect={setActivePath}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
              />
            )}
          </div>
        </aside>

        {/* Centre: editor */}
        <section className="flex flex-col min-h-0 border-r">
          <div className="h-9 shrink-0 border-b flex items-center gap-2 px-3 text-xs">
            <FileText className="size-3.5 text-muted-foreground" />
            <span className="font-mono truncate">{activePath ?? "—"}</span>
            {dirty && (
              <span className="text-amber-500 font-medium">● unsaved</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={handleRename}
                disabled={!activePath}
              >
                Rename
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={save}
                disabled={!dirty}
              >
                <Save className="size-3.5" />
                Save
                <kbd className="ml-1 hidden md:inline-block font-mono text-[10px] opacity-70">
                  ⌘S
                </kbd>
              </Button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            spellCheck={false}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            className="flex-1 min-h-0 resize-none w-full p-4 bg-background text-foreground font-mono text-[13px] leading-relaxed outline-none"
            placeholder={activePath ? "" : "Select or create a file to start editing."}
          />
        </section>

        {/* Right: preview + meta */}
        <aside className="flex flex-col min-h-0">
          <div
            className="flex-1 min-h-0 overflow-auto p-4 prose-vault"
            onClick={onPreviewClick}
            dangerouslySetInnerHTML={{ __html: previewBody }}
          />
          <div className="shrink-0 border-t max-h-[45%] overflow-auto">
            <Section
              icon={<Link2 className="size-3.5" />}
              title="Backlinks"
              count={backlinks.length}
            >
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
                          onClick={() => setActivePath(bl.fromPath)}
                        >
                          <span className="font-medium">{from?.title ?? bl.fromPath}</span>
                          {bl.anchor && (
                            <span className="text-muted-foreground"> #{bl.anchor}</span>
                          )}
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
                        "text-xs",
                        iss.severity === "error"
                          ? "text-destructive"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      <span className="font-mono opacity-70">[{iss.kind}]</span>{" "}
                      {iss.message}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section
              icon={<FileText className="size-3.5" />}
              title="Metadata"
            >
              {note ? (
                <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">title</dt>
                  <dd className="truncate">{note.title}</dd>
                  <dt className="text-muted-foreground">id</dt>
                  <dd className="font-mono truncate">
                    {(note.frontmatter.id as string) ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {note.tags.length ? (
                      note.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px] py-0">
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">headings</dt>
                  <dd>{note.headings.length}</dd>
                  <dt className="text-muted-foreground">outgoing</dt>
                  <dd>{note.wikilinks.length}</dd>
                </dl>
              ) : (
                <Empty>No file selected.</Empty>
              )}
            </Section>
          </div>
        </aside>
      </div>
    </div>
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
        {typeof count === "number" && (
          <span className="font-mono normal-case">({count})</span>
        )}
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
  results: { note: { path: string; title: string; tags: string[] }; inName: boolean; inBody: boolean; inTags: boolean }[];
  onPick: (path: string) => void;
}) {
  if (!results.length)
    return <div className="text-xs text-muted-foreground p-2">No matches.</div>;
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
              {r.inName && <Badge variant="outline" className="text-[9px] py-0">name</Badge>}
              {r.inBody && <Badge variant="outline" className="text-[9px] py-0">text</Badge>}
              {r.inTags && <Badge variant="outline" className="text-[9px] py-0">tag</Badge>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
