import { createFileRoute } from "@tanstack/react-router";
import {
  Children,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  Trash2,
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
import { type NoteIndex } from "@/lib/vault/indexer";
import {
  DEFAULT_THEME,
  centerViewAfterAssignment,
  centerViewAfterDocumentClose,
  createTreeUiState,
  lastNonDocumentViewForDocumentOpen,
  paneRenderWidth,
  shouldShowPaneContent,
  type CenterWorkspaceView,
  type NonDocumentCenterView,
  type PaneSide,
  type TreePlacement,
  type TreeUiState,
} from "@/lib/workspace/workspaceState";
import {
  useVault,
  type GeneratedDataAction,
  type RemoveVaultResponse,
  type VaultInfo,
  type VaultPermission,
} from "@/lib/vault/store";
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

type WorkspaceTreeUiState = TreeUiState<IndexFilterKind, IndexFilterResponse, IndexSearchResponse>;

type LocalSearchResult = {
  note: NoteIndex;
  inName: boolean;
  inBody: boolean;
  inTags: boolean;
};

const LEFT_PANE_DEFAULT = 260;
const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 520;
const RIGHT_PANE_DEFAULT = 320;
const RIGHT_PANE_MIN = 260;
const RIGHT_PANE_MAX = 560;
const CENTER_PANE_MIN = 0;
const CENTER_PANE_FALLBACK_MIN = 0;
const PANE_TUCK_THRESHOLD = 64;
const TAB_DRAG_CLICK_THRESHOLD = 6;
const SIDE_PANE_CONTENT_MIN = 144;

function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function effectiveCenterMin(
  totalWidth: number,
  leftMinimum = LEFT_PANE_MIN,
  rightMinimum = RIGHT_PANE_MIN,
): number {
  const availableAfterMinimumSidebars = totalWidth - leftMinimum - rightMinimum;
  return Math.min(
    CENTER_PANE_MIN,
    Math.max(CENTER_PANE_FALLBACK_MIN, availableAfterMinimumSidebars),
  );
}

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
    removeVault,
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
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [buffer, setBuffer] = useState<string>("");
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["Notes", "Reference"]));
  const [sidebarTreeState, setSidebarTreeState] = useState<WorkspaceTreeUiState>(() =>
    createTreeUiState<IndexFilterKind, IndexFilterResponse, IndexSearchResponse>(false),
  );
  const [centerTreeState, setCenterTreeState] = useState<WorkspaceTreeUiState>(() =>
    createTreeUiState<IndexFilterKind, IndexFilterResponse, IndexSearchResponse>(true),
  );
  const [inspectData, setInspectData] = useState<VaultInspectResponse | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [centerWorkspaceView, setCenterWorkspaceView] = useState<CenterWorkspaceView>("empty");
  const [lastNonDocumentCenterView, setLastNonDocumentCenterView] =
    useState<NonDocumentCenterView | null>(null);
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
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT);
  const [rightPaneWidth, setRightPaneWidth] = useState(RIGHT_PANE_DEFAULT);
  const [leftPaneTucked, setLeftPaneTucked] = useState(false);
  const [rightPaneTucked, setRightPaneTucked] = useState(false);
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<"light" | "dark">(DEFAULT_THEME);
  const [themeHydrated, setThemeHydrated] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const suppressTuckedTabClickRef = useRef(false);
  const autoOpenedVaultRef = useRef<string | null>(null);
  const selfWriteSuppressionRef = useRef<{ path: string; content: string; until: number } | null>(
    null,
  );

  useEffect(() => {
    const stored = localStorage.getItem("vault:theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
    setThemeHydrated(true);
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("vault:theme", theme);
  }, [theme, themeHydrated]);

  useEffect(() => {
    const clampWidthsForViewport = () => {
      const totalWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const leftMinimum = leftPaneTucked ? 0 : LEFT_PANE_MIN;
      const rightMinimum = rightPaneTucked ? 0 : RIGHT_PANE_MIN;
      const centerMin = effectiveCenterMin(totalWidth, leftMinimum, rightMinimum);
      if (!leftPaneTucked) {
        setLeftPaneWidth((current) =>
          clampPaneWidth(current, LEFT_PANE_MIN, totalWidth - rightMinimum - centerMin),
        );
      }
      if (!rightPaneTucked) {
        setRightPaneWidth((current) =>
          clampPaneWidth(current, RIGHT_PANE_MIN, totalWidth - leftMinimum - centerMin),
        );
      }
    };

    clampWidthsForViewport();
    window.addEventListener("resize", clampWidthsForViewport);
    return () => window.removeEventListener("resize", clampWidthsForViewport);
  }, [leftPaneTucked, rightPaneTucked]);

  const startPaneResize = useCallback(
    (pane: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const totalWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const centerMin = effectiveCenterMin(
        totalWidth,
        pane === "left" ? 0 : leftPaneTucked ? 0 : LEFT_PANE_MIN,
        pane === "right" ? 0 : rightPaneTucked ? 0 : RIGHT_PANE_MIN,
      );
      const startX = event.clientX;
      const startLeft = leftPaneTucked ? 0 : leftPaneWidth;
      const startRight = rightPaneTucked ? 0 : rightPaneWidth;
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onPointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        if (pane === "left") {
          const maxLeft = totalWidth - startRight - centerMin;
          const nextLeft = startLeft + moveEvent.clientX - startX;
          if (nextLeft <= PANE_TUCK_THRESHOLD) {
            setLeftPaneTucked(true);
            return;
          }
          setLeftPaneTucked(false);
          setLeftPaneWidth(clampPaneWidth(nextLeft, LEFT_PANE_MIN, maxLeft));
        } else {
          const maxRight = totalWidth - startLeft - centerMin;
          const nextRight = startRight + startX - moveEvent.clientX;
          if (nextRight <= PANE_TUCK_THRESHOLD) {
            setRightPaneTucked(true);
            return;
          }
          setRightPaneTucked(false);
          setRightPaneWidth(clampPaneWidth(nextRight, RIGHT_PANE_MIN, maxRight));
        }
      };

      const onPointerUp = () => {
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [leftPaneTucked, leftPaneWidth, rightPaneTucked, rightPaneWidth],
  );

  const startTuckedTabResize = useCallback(
    (pane: "left" | "right", event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const totalWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const otherPaneWidth =
        pane === "left"
          ? rightPaneTucked
            ? 0
            : rightPaneWidth
          : leftPaneTucked
            ? 0
            : leftPaneWidth;
      const centerMin = effectiveCenterMin(
        totalWidth,
        pane === "left" ? 0 : leftPaneTucked ? 0 : LEFT_PANE_MIN,
        pane === "right" ? 0 : rightPaneTucked ? 0 : RIGHT_PANE_MIN,
      );
      const startX = event.clientX;
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      let dragged = false;
      let finalWidth = 0;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onPointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const distance = pane === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        if (Math.abs(distance) > TAB_DRAG_CLICK_THRESHOLD) dragged = true;
        const maxWidth = totalWidth - otherPaneWidth - centerMin;
        finalWidth = clampPaneWidth(Math.max(0, distance), 0, maxWidth);

        if (pane === "left") {
          setLeftPaneWidth(finalWidth);
          setLeftPaneTucked(finalWidth === 0);
        } else {
          setRightPaneWidth(finalWidth);
          setRightPaneTucked(finalWidth === 0);
        }
      };

      const onPointerUp = () => {
        suppressTuckedTabClickRef.current = true;
        if (!dragged) {
          if (pane === "left") {
            setLeftPaneWidth(LEFT_PANE_DEFAULT);
            setLeftPaneTucked(false);
          } else {
            setRightPaneWidth(RIGHT_PANE_DEFAULT);
            setRightPaneTucked(false);
          }
        } else if (pane === "left") {
          if (finalWidth <= PANE_TUCK_THRESHOLD) {
            setLeftPaneTucked(true);
          } else {
            setLeftPaneWidth(Math.max(finalWidth, LEFT_PANE_MIN));
            setLeftPaneTucked(false);
          }
        } else if (finalWidth <= PANE_TUCK_THRESHOLD) {
          setRightPaneTucked(true);
        } else {
          setRightPaneWidth(Math.max(finalWidth, RIGHT_PANE_MIN));
          setRightPaneTucked(false);
        }
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [leftPaneTucked, leftPaneWidth, rightPaneTucked, rightPaneWidth],
  );

  // Load buffer when active file changes
  useEffect(() => {
    if (activePath && files[activePath] !== undefined) {
      setBuffer(files[activePath]);
      setSavedSnapshot(files[activePath]);
    } else if (
      activeVault &&
      paths.length &&
      autoOpenedVaultRef.current !== activeVault.id &&
      activePath === null
    ) {
      autoOpenedVaultRef.current = activeVault.id;
      setCenterWorkspaceView("document");
      setActivePath(paths[0]);
    } else {
      setActivePath(null);
      setBuffer("");
      setSavedSnapshot("");
    }
  }, [activePath, activeVault, files, paths]);

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

  const backlinks = metadataPath ? (index.backlinks[metadataPath] ?? []) : [];
  const fileIssues = useMemo(
    () => (metadataPath ? issues.filter((i) => i.path === metadataPath) : []),
    [issues, metadataPath],
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

  const assignCenterView = useCallback(
    (view: NonDocumentCenterView) => {
      setLastNonDocumentCenterView(view);
      setCenterWorkspaceView((current) => centerViewAfterAssignment(activePath, view, current));
    },
    [activePath],
  );

  const openDocumentInCenter = useCallback(
    (path: string) => {
      setLastNonDocumentCenterView((currentLast) =>
        lastNonDocumentViewForDocumentOpen(centerWorkspaceView, currentLast),
      );
      setCenterWorkspaceView("document");
      setActivePath(path);
    },
    [centerWorkspaceView],
  );

  const selectPath = useCallback(
    (path: string) => {
      if (path === activePath) return;
      if (dirty && !window.confirm("Discard unsaved changes and switch files?")) {
        return;
      }
      setSelectedPaths(new Set());
      openDocumentInCenter(path);
    },
    [activePath, dirty, openDocumentInCenter],
  );

  const closeDocument = useCallback(() => {
    if (!activePath) return;
    if (dirty && !window.confirm("Discard unsaved changes and close this document?")) {
      return;
    }
    setActivePath(null);
    setCenterWorkspaceView(centerViewAfterDocumentClose(lastNonDocumentCenterView));
    setSelectedPaths(new Set());
    setBuffer("");
    setSavedSnapshot("");
    setExternalNotice(null);
    setDiffReview(null);
    setDiffError(null);
    setConflictMessage(null);
    setSuppressedConflict(null);
    void refreshVaultStatus(null);
  }, [activePath, dirty, lastNonDocumentCenterView, refreshVaultStatus]);

  const inspectPath = useCallback(
    (path: string, nextMobileTab: "edit" | "preview" | "inspect" = "inspect") => {
      if (!index.notes[path]) return;
      if (
        path !== activePath &&
        dirty &&
        !window.confirm("Discard unsaved changes and switch files?")
      ) {
        return;
      }
      setSelectedPaths(new Set([path]));
      openDocumentInCenter(path);
      if (isMobile) setMobileTab(nextMobileTab);
    },
    [activePath, dirty, index.notes, isMobile, openDocumentInCenter],
  );

  const openAnchor = useCallback(
    (path: string, anchor: string) => {
      if (!index.notes[path]) return;
      if (
        path !== activePath &&
        dirty &&
        !window.confirm("Discard unsaved changes and switch files?")
      ) {
        return;
      }
      setSelectedPaths(new Set([path]));
      openDocumentInCenter(path);
      setCenterTab("preview");
      if (isMobile) setMobileTab("preview");
      window.setTimeout(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    },
    [activePath, dirty, index.notes, isMobile, openDocumentInCenter],
  );

  const handleGraphSelectionChange = useCallback(
    (paths: string[]) => {
      const notePaths = paths.filter((path) => Boolean(index.notes[path]));
      setSelectedPaths(new Set(notePaths));
      if (notePaths.length === 1 && notePaths[0] && notePaths[0] !== activePath && !dirty) {
        openDocumentInCenter(notePaths[0]);
      }
    },
    [activePath, dirty, index.notes, openDocumentInCenter],
  );

  const updateTreeState = useCallback(
    (placement: TreePlacement, updater: (state: WorkspaceTreeUiState) => WorkspaceTreeUiState) => {
      if (placement === "sidebar") setSidebarTreeState(updater);
      else setCenterTreeState(updater);
    },
    [],
  );

  const refreshIndexFilter = useCallback(
    async (placement: TreePlacement, filter: IndexFilterKind) => {
      if (!activeVault) {
        updateTreeState(placement, (state) => ({ ...state, indexFilterResponse: null }));
        return;
      }
      updateTreeState(placement, (state) => ({
        ...state,
        indexFilterLoading: true,
        indexFilterError: null,
      }));
      try {
        const response = await settingsApi<IndexFilterResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/index/filters?filter=${filter}`,
        );
        updateTreeState(placement, (state) => ({ ...state, indexFilterResponse: response }));
      } catch (error) {
        updateTreeState(placement, (state) => ({
          ...state,
          indexFilterResponse: null,
          indexFilterError: errorMessage(error),
        }));
      } finally {
        updateTreeState(placement, (state) => ({ ...state, indexFilterLoading: false }));
      }
    },
    [activeVault, updateTreeState],
  );

  useEffect(() => {
    void refreshIndexFilter("sidebar", sidebarTreeState.indexFilter);
  }, [refreshIndexFilter, sidebarTreeState.indexFilter]);

  useEffect(() => {
    void refreshIndexFilter("center", centerTreeState.indexFilter);
  }, [refreshIndexFilter, centerTreeState.indexFilter]);

  const refreshIndexSearch = useCallback(
    async (placement: TreePlacement, query: string) => {
      const q = query.trim();
      if (!activeVault || !q) {
        updateTreeState(placement, (state) => ({
          ...state,
          indexSearchResponse: null,
          indexSearchError: null,
          indexSearchLoading: false,
        }));
        return;
      }
      updateTreeState(placement, (state) => ({
        ...state,
        indexSearchLoading: true,
        indexSearchError: null,
      }));
      try {
        const response = await settingsApi<IndexSearchResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/index/search?q=${encodeURIComponent(q)}`,
        );
        updateTreeState(placement, (state) => ({ ...state, indexSearchResponse: response }));
      } catch (error) {
        updateTreeState(placement, (state) => ({
          ...state,
          indexSearchResponse: null,
          indexSearchError: errorMessage(error),
        }));
      } finally {
        updateTreeState(placement, (state) => ({ ...state, indexSearchLoading: false }));
      }
    },
    [activeVault, updateTreeState],
  );

  useEffect(() => {
    const id = window.setTimeout(
      () => void refreshIndexSearch("sidebar", sidebarTreeState.indexSearchQuery),
      250,
    );
    return () => window.clearTimeout(id);
  }, [refreshIndexSearch, sidebarTreeState.indexSearchQuery]);

  useEffect(() => {
    const id = window.setTimeout(
      () => void refreshIndexSearch("center", centerTreeState.indexSearchQuery),
      250,
    );
    return () => window.clearTimeout(id);
  }, [refreshIndexSearch, centerTreeState.indexSearchQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!activeVault || !metadataPath || selectedNotePaths.length > 1) {
      setInspectData(null);
      setInspectError(null);
      setInspectLoading(false);
      return;
    }
    setInspectLoading(true);
    setInspectError(null);
    settingsApi<VaultInspectResponse>(
      `/api/vaults/${encodeURIComponent(activeVault.id)}/index/inspect?path=${encodeURIComponent(metadataPath)}`,
    )
      .then((data) => {
        if (!cancelled) setInspectData(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setInspectData(null);
          setInspectError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setInspectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeVault, metadataPath, selectedNotePaths.length]);

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
    openDocumentInCenter(path);
    if (isMobile) setMobileTab("edit");
  };
  const handleNewIndexNote = async () => {
    const ok = await createFile("index.md");
    if (!ok) return;
    openDocumentInCenter("index.md");
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
    if (ok) openDocumentInCenter(next);
  };
  const openSettings = () => setShowSettings(true);
  const handleSaveAsNew = async () => {
    if (!activePath) return;
    const next = window.prompt("Save current buffer as new Markdown file", activePath);
    if (!next || next === activePath) return;
    const ok = await createFileWithContent(next, buffer);
    if (!ok) return;
    openDocumentInCenter(next);
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
    setCenterWorkspaceView(centerViewAfterDocumentClose(lastNonDocumentCenterView));
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

  const buildLocalSearchResults = useCallback(
    (rawQuery: string): LocalSearchResult[] | null => {
      const q = rawQuery.trim().toLowerCase();
      if (!q) return null;
      return Object.values(index.notes).reduce<LocalSearchResult[]>((results, note) => {
        const inName = note.path.toLowerCase().includes(q);
        const inBody = note.body.toLowerCase().includes(q);
        const inTags = note.tags.some((tag) => tag.toLowerCase().includes(q));
        if (inName || inBody || inTags) {
          results.push({ note, inName, inBody, inTags });
        }
        return results;
      }, []);
    },
    [index],
  );

  const sidebarResults = useMemo(
    () => buildLocalSearchResults(sidebarTreeState.query),
    [buildLocalSearchResults, sidebarTreeState.query],
  );
  const centerResults = useMemo(
    () => buildLocalSearchResults(centerTreeState.query),
    [buildLocalSearchResults, centerTreeState.query],
  );

  const totalIssues = issues.length;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  const graphData = useMemo(() => buildGraph(index, issues), [index, issues]);
  const suppressedActiveConflict =
    Boolean(activePath) &&
    Boolean(suppressedConflict) &&
    suppressedConflict?.path === activePath &&
    suppressedConflict.hash === vaultStatus?.file?.hash;
  const showLeftPaneContent = shouldShowPaneContent(
    leftPaneTucked,
    leftPaneWidth,
    SIDE_PANE_CONTENT_MIN,
  );
  const showRightPaneContent = shouldShowPaneContent(
    rightPaneTucked,
    rightPaneWidth,
    SIDE_PANE_CONTENT_MIN,
  );

  const restorePane = useCallback((pane: PaneSide) => {
    if (pane === "left") {
      setLeftPaneWidth(LEFT_PANE_DEFAULT);
      setLeftPaneTucked(false);
    } else {
      setRightPaneWidth(RIGHT_PANE_DEFAULT);
      setRightPaneTucked(false);
    }
  }, []);

  const handleTuckedTabClick = useCallback(
    (pane: PaneSide, event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (suppressTuckedTabClickRef.current) {
        suppressTuckedTabClickRef.current = false;
        return;
      }
      restorePane(pane);
    },
    [restorePane],
  );

  // ----- shared pane content -----
  const renderTreePaneContent = (
    placement: TreePlacement,
    state: WorkspaceTreeUiState,
    results: typeof sidebarResults,
  ) => (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="p-2 border-b space-y-2">
        <div className="relative">
          <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.query}
            onChange={(e) =>
              updateTreeState(placement, (current) => ({ ...current, query: e.target.value }))
            }
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
        <TreeUtilityPanel
          title="Index search"
          description="Non-semantic search over indexed structure."
          badge={state.indexSearchResponse?.total ?? 0}
          collapsed={state.searchCollapsed}
          onToggle={() =>
            updateTreeState(placement, (current) => ({
              ...current,
              searchCollapsed: !current.searchCollapsed,
            }))
          }
        >
          <IndexSearchPanel
            query={state.indexSearchQuery}
            response={state.indexSearchResponse}
            loading={state.indexSearchLoading}
            error={state.indexSearchError}
            hideHeader
            onQueryChange={(query) =>
              updateTreeState(placement, (current) => ({ ...current, indexSearchQuery: query }))
            }
            onRefresh={() => refreshIndexSearch(placement, state.indexSearchQuery)}
            onPick={(path) => {
              inspectPath(path);
            }}
          />
        </TreeUtilityPanel>
        <TreeUtilityPanel
          title="Index filters"
          description={`Read-only structure: ${INDEX_FILTER_OPTIONS.find((option) => option.value === state.indexFilter)?.label ?? state.indexFilter}.`}
          badge={state.indexFilterResponse?.total ?? 0}
          collapsed={state.filtersCollapsed}
          onToggle={() =>
            updateTreeState(placement, (current) => ({
              ...current,
              filtersCollapsed: !current.filtersCollapsed,
            }))
          }
        >
          <IndexFiltersPanel
            filter={state.indexFilter}
            response={state.indexFilterResponse}
            loading={state.indexFilterLoading}
            error={state.indexFilterError}
            hideHeader
            onFilterChange={(filter) =>
              updateTreeState(placement, (current) => ({ ...current, indexFilter: filter }))
            }
            onRefresh={() => refreshIndexFilter(placement, state.indexFilter)}
            onPick={(path) => {
              inspectPath(path);
            }}
          />
        </TreeUtilityPanel>
        {activeVault && !files["index.md"] && (
          <TreeUtilityPanel
            title="Optional homepage note"
            description="index.md is optional and treated as a normal note."
            collapsed={state.homepageCollapsed}
            onToggle={() =>
              updateTreeState(placement, (current) => ({
                ...current,
                homepageCollapsed: !current.homepageCollapsed,
              }))
            }
          >
            <div className="text-muted-foreground">
              AREPO indexes this vault automatically; `index.md` is only a normal note.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleNewIndexNote()}
            >
              Create index.md
            </Button>
          </TreeUtilityPanel>
        )}
      </div>
      <div className="min-w-0 p-2">
        {results ? (
          <SearchResults
            results={results}
            onPick={(p) => {
              selectPath(p);
              updateTreeState(placement, (current) => ({ ...current, query: "" }));
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
    </div>
  );

  const renderGraphPaneContent = (placement: "sidebar" | "center") => (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
      <VaultGraph
        key={placement}
        data={graphData}
        activePath={activePath}
        selectedPaths={selectedPaths}
        onSelectionChange={handleGraphSelectionChange}
        onSelect={(p) => {
          inspectPath(p, "edit");
        }}
        onOpenPreview={(p) => {
          inspectPath(p, "preview");
          if (isMobile) setMobileTab("preview");
          else setCenterTab("preview");
        }}
      />
    </div>
  );

  const vaultPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 overflow-hidden border-b p-2">
        <SegBtn active={vaultMode === "tree"} onClick={() => setVaultMode("tree")}>
          <FolderTree className="size-3.5" /> Tree
        </SegBtn>
        <SegBtn active={vaultMode === "graph"} onClick={() => setVaultMode("graph")}>
          <Network className="size-3.5" /> Graph
        </SegBtn>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto hidden h-7 px-2 text-xs md:inline-flex"
          onClick={() => assignCenterView(vaultMode)}
          title={`Show ${vaultMode} in center workspace`}
        >
          Center
        </Button>
      </div>
      {vaultMode === "tree"
        ? renderTreePaneContent("sidebar", sidebarTreeState, sidebarResults)
        : renderGraphPaneContent("sidebar")}
    </div>
  );

  const fileActionBar = (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-3 text-xs">
      <SegBtn active={centerTab === "edit"} onClick={() => setCenterTab("edit")}>
        <Pencil className="size-3.5" /> Edit
      </SegBtn>
      <SegBtn active={centerTab === "preview"} onClick={() => setCenterTab("preview")}>
        <Eye className="size-3.5" /> Preview
      </SegBtn>
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
        onClick={closeDocument}
        disabled={!activePath}
      >
        Close
      </Button>
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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {fileActionBar}
      <textarea
        ref={editorRef}
        spellCheck={false}
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        className="min-h-0 min-w-0 flex-1 resize-none bg-background p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none"
        placeholder={activePath ? "" : "Select or create a file to start editing."}
      />
    </div>
  );

  const previewPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {fileActionBar}
      <div
        className="prose-vault min-h-0 min-w-0 flex-1 overflow-auto p-4"
        onClick={onPreviewClick}
        dangerouslySetInnerHTML={{ __html: previewBody }}
      />
    </div>
  );

  const emptyDocumentPane = (
    <div className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden p-6 text-center">
      <div className="space-y-1">
        <FileText className="mx-auto size-5 text-muted-foreground" />
        <div className="text-sm font-medium">No document open</div>
        <div className="text-xs text-muted-foreground">
          Select a Markdown file from the tree, graph, search, or index views to open it here.
        </div>
      </div>
    </div>
  );

  const centerModeBar = (
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b px-2">
      <SegBtn active={centerWorkspaceView === "tree"} onClick={() => assignCenterView("tree")}>
        <FolderTree className="size-3.5" /> Tree
      </SegBtn>
      <SegBtn active={centerWorkspaceView === "graph"} onClick={() => assignCenterView("graph")}>
        <Network className="size-3.5" /> Graph
      </SegBtn>
      <span className="ml-auto text-[11px] text-muted-foreground hidden lg:inline">
        Center workspace
      </span>
    </div>
  );

  const centerTreePane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {centerModeBar}
      {renderTreePaneContent("center", centerTreeState, centerResults)}
    </div>
  );

  const centerGraphPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {centerModeBar}
      {renderGraphPaneContent("center")}
    </div>
  );

  const centerPane = activePath
    ? centerTab === "edit"
      ? editorPane
      : previewPane
    : centerWorkspaceView === "tree"
      ? centerTreePane
      : centerWorkspaceView === "graph"
        ? centerGraphPane
        : emptyDocumentPane;

  const inspectorPane = (
    <IndexInspectPanel
      selectedCount={selectedNotePaths.length}
      inspectData={inspectData}
      inspectLoading={inspectLoading}
      inspectError={inspectError}
      backlinks={backlinks}
      noteTitles={index.notes}
      fileIssues={fileIssues}
      combinedMetadata={combinedMetadata}
      metadataNote={metadataNote}
      metadataPath={metadataPath}
      metadataFileMeta={metadataFileMeta}
      onPick={inspectPath}
      onAnchor={openAnchor}
    />
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
            disabled={!themeHydrated}
            title="Toggle theme"
          >
            {!themeHydrated || theme === "dark" ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
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
            onRemoveVault={removeVault}
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
            onRemoveVault={removeVault}
            onReindexVault={reindexVault}
            onRefreshVaults={refreshNode}
            onTestHealth={testHealth}
          />
        </main>
      )}

      {!showSettings && activeVault && (
        <>
          {/* Desktop: 3-pane with center editor/preview tabs */}
          <div
            ref={workspaceRef}
            className="relative flex-1 min-h-0 hidden md:flex overflow-hidden"
          >
            {leftPaneTucked && (
              <TuckedPaneRestoreTab
                side="left"
                onPointerDown={(event) => startTuckedTabResize("left", event)}
                onClick={(event) => handleTuckedTabClick("left", event)}
              />
            )}
            {rightPaneTucked && (
              <TuckedPaneRestoreTab
                side="right"
                onPointerDown={(event) => startTuckedTabResize("right", event)}
                onClick={(event) => handleTuckedTabClick("right", event)}
              />
            )}
            <WorkspaceSidePane
              width={paneRenderWidth(leftPaneTucked, leftPaneWidth)}
              showContent={showLeftPaneContent}
            >
              {vaultPane}
            </WorkspaceSidePane>
            <PaneResizeHandle
              side="left"
              tucked={leftPaneTucked}
              onPointerDown={(event) => startPaneResize("left", event)}
            />
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r">
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{centerPane}</div>
            </section>
            <PaneResizeHandle
              side="right"
              tucked={rightPaneTucked}
              onPointerDown={(event) => startPaneResize("right", event)}
            />
            <WorkspaceSidePane
              width={paneRenderWidth(rightPaneTucked, rightPaneWidth)}
              showContent={showRightPaneContent}
            >
              {inspectorPane}
            </WorkspaceSidePane>
          </div>

          {/* Mobile: single-view tabbed */}
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden md:hidden">
            <div className="h-full min-w-0 overflow-hidden" hidden={mobileTab !== "vault"}>
              {vaultPane}
            </div>
            <div className="h-full min-w-0 overflow-hidden" hidden={mobileTab !== "edit"}>
              {activePath ? editorPane : emptyDocumentPane}
            </div>
            <div className="h-full min-w-0 overflow-hidden" hidden={mobileTab !== "preview"}>
              {activePath ? previewPane : emptyDocumentPane}
            </div>
            <div className="h-full min-w-0 overflow-hidden" hidden={mobileTab !== "inspect"}>
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
  children: ReactNode;
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

function TuckedPaneRestoreTab({
  side,
  onPointerDown,
  onClick,
}: {
  side: PaneSide;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const isLeft = side === "left";
  return (
    <button
      type="button"
      aria-label={isLeft ? "Restore left sidebar" : "Restore right inspector"}
      title={isLeft ? "Restore left sidebar" : "Restore right inspector"}
      className={cn(
        "absolute top-1/2 z-30 flex h-14 w-10 -translate-y-1/2 cursor-col-resize touch-none select-none text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isLeft
          ? "left-0 items-center justify-start rounded-r-sm"
          : "right-0 items-center justify-end rounded-l-sm",
      )}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <span
        className="block h-11 w-8 border border-primary/80 bg-primary/90 shadow-lg shadow-black/25 ring-1 ring-background transition-colors hover:bg-primary dark:border-primary-foreground/70 dark:bg-primary dark:ring-background"
        style={{
          clipPath: isLeft
            ? "polygon(0 0, 100% 22%, 100% 78%, 0 100%)"
            : "polygon(100% 0, 0 22%, 0 78%, 100% 100%)",
        }}
      />
    </button>
  );
}

function WorkspaceSidePane({
  width,
  showContent,
  children,
}: {
  width: number;
  showContent: boolean;
  children: ReactNode;
}) {
  return (
    <aside
      className="relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
      aria-hidden={!showContent}
      style={{ width, flexBasis: width, maxWidth: width }}
    >
      {showContent && <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>}
    </aside>
  );
}

function PaneResizeHandle({
  side,
  tucked,
  onPointerDown,
}: {
  side: PaneSide;
  tucked: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const isLeft = side === "left";
  const columnName = isLeft ? "vault" : "inspect";
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={tucked ? `Show ${columnName} column` : `Resize ${columnName} column`}
      title={
        tucked
          ? `Drag ${isLeft ? "right" : "left"} to show ${columnName} column`
          : `Resize ${columnName} column`
      }
      className={cn(
        "group relative z-10 w-2 shrink-0 cursor-col-resize touch-none select-none border-x bg-border/20 hover:bg-primary/15 focus:outline-none focus-visible:bg-primary/20",
        tucked && "bg-primary/20 hover:bg-primary/25",
      )}
      onPointerDown={onPointerDown}
    >
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border group-hover:bg-primary/50" />
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = useId();
  return (
    <div className="min-w-0 overflow-hidden border-b last:border-b-0">
      <CollapseToggleButton
        contentId={contentId}
        collapsed={collapsed}
        onToggle={onToggle}
        className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
      >
        {icon}
        <span>{title}</span>
        {typeof count === "number" && <span className="font-mono normal-case">({count})</span>}
      </CollapseToggleButton>
      <div id={contentId} hidden={collapsed} className="min-w-0 overflow-hidden px-3 pb-3">
        {children}
      </div>
    </div>
  );
}

function CollapseToggleButton({
  contentId,
  collapsed,
  onToggle,
  className,
  children,
}: {
  contentId: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("flex w-full min-w-0 items-center gap-2 overflow-hidden text-left", className)}
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={contentId}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">{children}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{collapsed ? "+" : "-"}</span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden text-xs italic text-muted-foreground">{children}</div>
  );
}

function StateMessage({
  tone = "empty",
  children,
}: {
  tone?: "empty" | "loading" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded px-2 py-1.5 text-xs",
        tone === "error"
          ? "border border-destructive/30 bg-destructive/10 text-destructive"
          : "text-muted-foreground",
        tone === "loading" && "border border-border bg-muted/20",
      )}
    >
      {children}
    </div>
  );
}

function IndexInspectPanel({
  selectedCount,
  inspectData,
  inspectLoading,
  inspectError,
  backlinks,
  noteTitles,
  fileIssues,
  combinedMetadata,
  metadataNote,
  metadataPath,
  metadataFileMeta,
  onPick,
  onAnchor,
}: IndexInspectPanelProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sectionCollapsed = (key: string) => Boolean(collapsedSections[key]);
  const toggleSection = (key: string) =>
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">
      <Section
        icon={<Info className="size-3.5" />}
        title="Index inspect"
        count={
          inspectData
            ? inspectData.issues.length + inspectData.brokenOutgoingLinks.length
            : undefined
        }
        collapsed={sectionCollapsed("index")}
        onToggle={() => toggleSection("index")}
      >
        {selectedCount > 1 ? (
          <Empty>
            Multiple graph nodes selected. Combined metadata is shown below; select one file for
            file-level index inspection.
          </Empty>
        ) : inspectLoading ? (
          <StateMessage tone="loading">
            Loading file details from the generated machine index...
          </StateMessage>
        ) : inspectError ? (
          <ErrorMessage>Index inspect unavailable: {inspectError}</ErrorMessage>
        ) : inspectData ? (
          <InspectDetails data={inspectData} onPick={onPick} onAnchor={onAnchor} />
        ) : metadataPath ? (
          <Empty>
            No machine-index details are available for this file. Rebuild the index or refresh the
            vault if the file was just added.
          </Empty>
        ) : (
          <Empty>
            Select a file from Tree, Graph, Index search, or Index filters to inspect it.
          </Empty>
        )}
      </Section>

      <Section
        icon={<Link2 className="size-3.5" />}
        title="Backlinks"
        count={backlinks.length}
        collapsed={sectionCollapsed("backlinks")}
        onToggle={() => toggleSection("backlinks")}
      >
        {metadataPath ? (
          <BacklinkList backlinks={backlinks} noteTitles={noteTitles} onPick={onPick} />
        ) : (
          <Empty>No file selected. Backlinks appear after selecting a file.</Empty>
        )}
      </Section>

      <Section
        icon={<AlertTriangle className="size-3.5" />}
        title="Validation (this file)"
        count={fileIssues.length}
        collapsed={sectionCollapsed("validation")}
        onToggle={() => toggleSection("validation")}
      >
        {metadataPath ? (
          <ValidationIssueList issues={fileIssues} />
        ) : (
          <Empty>No file selected. Validation issues appear after selecting a file.</Empty>
        )}
      </Section>

      <Section
        icon={<FileText className="size-3.5" />}
        title={combinedMetadata ? "Combined metadata" : "Metadata"}
        count={combinedMetadata?.fileCount}
        collapsed={sectionCollapsed("metadata")}
        onToggle={() => toggleSection("metadata")}
      >
        {combinedMetadata ? (
          <CombinedMetadataDetails metadata={combinedMetadata} />
        ) : metadataNote ? (
          <SingleMetadataDetails
            note={metadataNote}
            path={metadataPath}
            fileMeta={metadataFileMeta}
          />
        ) : (
          <Empty>Select one file, or shift-select graph nodes to view combined metadata.</Empty>
        )}
      </Section>
    </div>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <StateMessage tone="error">{children}</StateMessage>;
}

function BacklinkList({
  backlinks,
  noteTitles,
  onPick,
}: {
  backlinks: InspectBacklink[];
  noteTitles: Record<string, { title: string }>;
  onPick: (path: string) => void;
}) {
  if (backlinks.length === 0) {
    return <Empty>No backlinks found for this file.</Empty>;
  }
  return (
    <ul className="min-w-0 space-y-1 overflow-hidden">
      {backlinks.map((backlink, index) => {
        const from = noteTitles[backlink.fromPath];
        return (
          <li key={`${backlink.fromPath}-${index}`}>
            <button
              className="text-left text-xs hover:underline w-full truncate"
              onClick={() => onPick(backlink.fromPath)}
            >
              <span className="font-medium">{from?.title ?? backlink.fromPath}</span>
              {backlink.anchor && (
                <span className="text-muted-foreground"> #{backlink.anchor}</span>
              )}
              <span className="text-muted-foreground"> — {backlink.fromPath}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ValidationIssueList({ issues }: { issues: VaultInspectIssue[] }) {
  if (issues.length === 0) return <Empty>No validation issues for this file.</Empty>;
  return (
    <ul className="min-w-0 space-y-1 overflow-hidden">
      {issues.map((issue, index) => (
        <li
          key={`${issue.kind}-${index}`}
          className={cn(
            "text-xs break-words",
            issue.severity === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
          )}
        >
          <span className="font-mono opacity-70">[{issue.kind}]</span> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function CombinedMetadataDetails({ metadata }: { metadata: CombinedInspectMetadata }) {
  return (
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">files</dt>
      <dd>{metadata.fileCount}</dd>
      <dt className="text-muted-foreground">total size</dt>
      <dd>{formatBytes(metadata.totalBytes)}</dd>
      <dt className="text-muted-foreground">tags</dt>
      <dd className="flex flex-wrap gap-1">
        <TagBadges tags={metadata.tags} />
      </dd>
      <dt className="text-muted-foreground">headings</dt>
      <dd>{metadata.headings}</dd>
      <dt className="text-muted-foreground">outgoing</dt>
      <dd>{metadata.outgoing}</dd>
      <dt className="text-muted-foreground">backlinks</dt>
      <dd>{metadata.backlinks}</dd>
      <dt className="text-muted-foreground">issues</dt>
      <dd>{metadata.issueCount}</dd>
      <dt className="text-muted-foreground">paths</dt>
      <dd className="space-y-0.5">
        {metadata.paths.map((path) => (
          <div key={path} className="font-mono truncate" title={path}>
            {path}
          </div>
        ))}
      </dd>
    </dl>
  );
}

function SingleMetadataDetails({
  note,
  path,
  fileMeta,
}: {
  note: MetadataNote;
  path: string | null;
  fileMeta?: { size: number };
}) {
  return (
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">title</dt>
      <dd className="truncate">{note.title}</dd>
      <dt className="text-muted-foreground">path</dt>
      <dd className="font-mono truncate" title={path ?? undefined}>
        {path}
      </dd>
      <dt className="text-muted-foreground">size</dt>
      <dd>{fileMeta ? formatBytes(fileMeta.size) : "checking"}</dd>
      <dt className="text-muted-foreground">id</dt>
      <dd className="font-mono truncate">{(note.frontmatter.id as string) ?? "—"}</dd>
      <dt className="text-muted-foreground">tags</dt>
      <dd className="flex flex-wrap gap-1">
        <TagBadges tags={note.tags} />
      </dd>
      <dt className="text-muted-foreground">headings</dt>
      <dd>{note.headings.length}</dd>
      <dt className="text-muted-foreground">outgoing</dt>
      <dd>{note.wikilinks.length}</dd>
    </dl>
  );
}

function TagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return tags.map((tag) => (
    <Badge key={tag} variant="secondary" className="text-[10px] py-0">
      {tag}
    </Badge>
  ));
}

function InspectDetails({
  data,
  onPick,
  onAnchor,
}: {
  data: VaultInspectResponse;
  onPick: (path: string) => void;
  onAnchor: (path: string, anchor: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-3 overflow-hidden text-xs">
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">source</dt>
        <dd className="font-mono">{data.source}</dd>
        <dt className="text-muted-foreground">title</dt>
        <dd className="truncate">{data.title}</dd>
        <dt className="text-muted-foreground">path</dt>
        <dd className="font-mono truncate" title={data.path}>
          {data.path}
        </dd>
        <dt className="text-muted-foreground">id</dt>
        <dd className="font-mono truncate">{data.frontmatterId ?? "-"}</dd>
        <dt className="text-muted-foreground">orphan</dt>
        <dd>{data.orphan ? "yes" : "no"}</dd>
        <dt className="text-muted-foreground">tags</dt>
        <dd className="flex flex-wrap gap-1">
          {data.tags.length ? (
            data.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] py-0">
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </dd>
      </dl>

      <InspectGroup title="Headings" empty="No headings found in this file.">
        {data.headings.map((heading, index) => (
          <button
            key={`${heading.anchor}-${index}`}
            className="w-full rounded bg-muted/30 px-2 py-1 text-left hover:bg-muted"
            onClick={() => onAnchor(data.path, heading.anchor)}
            title={`Open #${heading.anchor} in preview`}
          >
            <div className="truncate">
              {"#".repeat(heading.level)} {heading.text}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              #{heading.anchor}
              {heading.explicit ? " explicit" : " generated"}
            </div>
          </button>
        ))}
      </InspectGroup>

      <InspectGroup title="Outgoing links" empty="No outgoing links found in this file.">
        {data.outgoingLinks.map((link, index) => (
          <InspectLinkRow key={`${link.raw}-${index}`} link={link} onPick={onPick} />
        ))}
      </InspectGroup>

      <InspectGroup title="Backlinks" empty="No backlinks found for this file.">
        {data.backlinks.map((backlink, index) => (
          <button
            key={`${backlink.fromPath}-${index}`}
            className="w-full min-w-0 rounded px-2 py-1 text-left hover:bg-muted"
            onClick={() => onPick(backlink.fromPath)}
          >
            <div className="truncate font-medium">{backlink.fromTitle}</div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {backlink.fromPath}
              {backlink.anchor ? `#${backlink.anchor}` : ""}
            </div>
          </button>
        ))}
      </InspectGroup>

      <InspectGroup title="Broken outgoing links" empty="No broken outgoing links from this file.">
        {data.brokenOutgoingLinks.map((link, index) => (
          <div
            key={`${link.raw}-${index}`}
            className="rounded border border-destructive/30 px-2 py-1"
          >
            <div className="font-mono text-destructive truncate">{link.raw}</div>
            <div className="text-[10px] text-muted-foreground break-words">
              Missing target: {link.target}
              {link.anchor ? `#${link.anchor}` : ""}
            </div>
            <div className="text-[10px] text-destructive/80">
              No resolved file exists for this link.
            </div>
          </div>
        ))}
      </InspectGroup>

      <InspectGroup
        title="Duplicate frontmatter ID"
        empty="This file does not share its frontmatter ID with another indexed file."
      >
        {data.duplicateId ? (
          <div className="space-y-1">
            <div className="font-mono text-amber-600 dark:text-amber-400">
              {data.duplicateId.id}
            </div>
            {data.duplicateId.paths.map((path) => (
              <button
                key={path}
                className="block w-full min-w-0 truncate rounded px-2 py-1 text-left font-mono text-[10px] hover:bg-muted"
                onClick={() => onPick(path)}
                title={`Inspect ${path}`}
              >
                {path}
              </button>
            ))}
          </div>
        ) : null}
      </InspectGroup>

      <InspectGroup
        title="Duplicate heading anchors"
        empty="No duplicate heading anchors found in this file."
      >
        {data.duplicateAnchors.map((duplicate) => (
          <div key={duplicate.anchor} className="rounded border border-amber-500/30 px-2 py-1">
            <div className="font-mono text-amber-600 dark:text-amber-400">#{duplicate.anchor}</div>
            <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
              {duplicate.headings.map((heading, index) => (
                <li key={`${heading.text}-${index}`}>
                  <button
                    className="w-full truncate rounded px-1 py-0.5 text-left hover:bg-muted"
                    onClick={() => onAnchor(data.path, duplicate.anchor)}
                    title={`Open #${duplicate.anchor} in preview`}
                  >
                    {"#".repeat(heading.level)} {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </InspectGroup>

      <InspectGroup title="Validation issues" empty="No validation issues found for this file.">
        {data.issues.map((issue, index) => (
          <div
            key={`${issue.kind}-${index}`}
            className={cn(
              "rounded px-2 py-1 break-words",
              issue.severity === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            <span className="font-mono">[{issue.kind}]</span> {issue.message}
          </div>
        ))}
      </InspectGroup>
    </div>
  );
}

function InspectGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const contentId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const items = Children.toArray(children).filter(Boolean);
  return (
    <div className="min-w-0 overflow-hidden rounded border bg-muted/10">
      <CollapseToggleButton
        contentId={contentId}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
        className="px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground hover:bg-muted/50"
      >
        <span className="truncate">{title}</span>
      </CollapseToggleButton>
      <div id={contentId} hidden={collapsed} className="min-w-0 px-2 pb-2">
        {items.length ? (
          <div className="min-w-0 space-y-1 overflow-hidden">{items}</div>
        ) : (
          <Empty>{empty}</Empty>
        )}
      </div>
    </div>
  );
}

function InspectLinkRow({
  link,
  onPick,
}: {
  link: VaultInspectLink;
  onPick: (path: string) => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-medium">
          {link.targetTitle ?? link.targetPath ?? link.target}
        </span>
        <Badge variant={link.broken ? "destructive" : "outline"} className="text-[9px] py-0">
          {link.status}
        </Badge>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground truncate">
        {link.targetPath ?? link.target}
        {link.anchor ? `#${link.anchor}` : ""}
      </div>
      {link.alias && (
        <div className="text-[10px] text-muted-foreground truncate">alias: {link.alias}</div>
      )}
    </>
  );
  if (!link.targetPath) {
    return <div className="rounded px-2 py-1 bg-muted/20">{content}</div>;
  }
  return (
    <button
      className="w-full min-w-0 rounded px-2 py-1 text-left hover:bg-muted"
      onClick={() => onPick(link.targetPath!)}
    >
      {content}
    </button>
  );
}

function SearchResults({
  results,
  onPick,
}: {
  results: LocalSearchResult[];
  onPick: (path: string) => void;
}) {
  if (!results.length)
    return <div className="overflow-hidden p-2 text-xs text-muted-foreground">No matches.</div>;
  return (
    <ul className="min-w-0 space-y-1 overflow-hidden">
      {results.map((r) => (
        <li key={r.note.path}>
          <button
            onClick={() => onPick(r.note.path)}
            className="w-full min-w-0 rounded px-2 py-1.5 text-left hover:bg-muted"
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

function TreeUtilityPanel({
  title,
  description,
  badge,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  badge?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <div className="min-w-0 overflow-hidden rounded border bg-muted/20 text-xs">
      <CollapseToggleButton
        contentId={contentId}
        collapsed={collapsed}
        onToggle={onToggle}
        className="px-2 py-2 hover:bg-muted/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block truncate text-muted-foreground">{description}</span>
        </span>
        {badge !== undefined && (
          <Badge variant="outline" className="font-mono">
            {badge}
          </Badge>
        )}
      </CollapseToggleButton>
      <div
        id={contentId}
        hidden={collapsed}
        className="min-w-0 space-y-2 overflow-hidden border-t px-2 py-2"
      >
        {children}
      </div>
    </div>
  );
}

function IndexSearchPanel({
  query,
  response,
  loading,
  error,
  hideHeader = false,
  onQueryChange,
  onRefresh,
  onPick,
}: {
  query: string;
  response: IndexSearchResponse | null;
  loading: boolean;
  error: string | null;
  hideHeader?: boolean;
  onQueryChange: (query: string) => void;
  onRefresh: () => Promise<void>;
  onPick: (path: string) => void;
}) {
  const trimmed = query.trim();
  return (
    <div
      className={cn(
        "min-w-0 space-y-2 overflow-hidden text-xs",
        !hideHeader && "rounded border bg-muted/20 px-2 py-2",
      )}
    >
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Index search</div>
            <div className="text-muted-foreground">Non-semantic search over indexed structure.</div>
          </div>
          <Badge variant="outline" className="font-mono">
            {response?.total ?? 0}
          </Badge>
        </div>
      )}
      <form
        className="flex min-w-0 gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void onRefresh();
        }}
      >
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search paths, headings, tags..."
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading || !trimmed}>
          {loading ? "..." : "Go"}
        </Button>
      </form>
      {error ? (
        <StateMessage tone="error">Index search unavailable: {error}</StateMessage>
      ) : !trimmed ? (
        <StateMessage>
          Enter a path, title, ID, tag, heading, anchor, wikilink target, or backlink source. This
          searches the generated index, not full note text.
        </StateMessage>
      ) : loading && !response ? (
        <StateMessage tone="loading">Searching the generated machine index...</StateMessage>
      ) : response && response.results.length > 0 ? (
        <ul className="min-w-0 space-y-1 pr-1">
          {response.results.map((result) => (
            <li key={result.id}>
              <button
                className="w-full min-w-0 rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => onPick(result.path)}
              >
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-medium">{result.title}</span>
                  <IndexSearchBadge matchType={result.matchType} />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {result.path}
                </div>
                <div className="text-[10px] text-muted-foreground break-words">
                  {result.matchedField}: {result.matchedValue}
                </div>
                {result.headingText && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    Heading: {result.headingText}
                    {result.anchor ? ` #${result.anchor}` : ""}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <StateMessage>
          No indexed paths, titles, IDs, tags, headings, anchors, wikilinks, or backlinks matched
          this search.
        </StateMessage>
      )}
    </div>
  );
}

function IndexSearchBadge({ matchType }: { matchType: IndexSearchMatchType }) {
  const label = matchType.replace(/-/g, " ");
  return (
    <Badge variant="outline" className="text-[9px] py-0 capitalize">
      {label}
    </Badge>
  );
}

function IndexFiltersPanel({
  filter,
  response,
  loading,
  error,
  hideHeader = false,
  onFilterChange,
  onRefresh,
  onPick,
}: {
  filter: IndexFilterKind;
  response: IndexFilterResponse | null;
  loading: boolean;
  error: string | null;
  hideHeader?: boolean;
  onFilterChange: (filter: IndexFilterKind) => void;
  onRefresh: () => Promise<void>;
  onPick: (path: string) => void;
}) {
  const selected = INDEX_FILTER_OPTIONS.find((option) => option.value === filter);
  return (
    <div
      className={cn(
        "min-w-0 space-y-2 overflow-hidden text-xs",
        !hideHeader && "rounded border bg-muted/20 px-2 py-2",
      )}
    >
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Index filters</div>
            <div className="text-muted-foreground">Read-only structure from the machine index.</div>
          </div>
          <Badge variant="outline" className="font-mono">
            {response?.total ?? 0}
          </Badge>
        </div>
      )}
      <div className="flex min-w-0 gap-1">
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as IndexFilterKind)}
          className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
          title="Select structural index filter"
        >
          {INDEX_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          {loading ? "..." : "Refresh"}
        </Button>
      </div>
      {error ? (
        <StateMessage tone="error">Index filter unavailable: {error}</StateMessage>
      ) : loading && !response ? (
        <StateMessage tone="loading">
          Loading read-only filter results from the generated index...
        </StateMessage>
      ) : response && response.results.length > 0 ? (
        <ul className="min-w-0 space-y-1 pr-1">
          {response.results.map((result) => (
            <li key={result.id}>
              <button
                className="w-full min-w-0 rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => onPick(result.path)}
              >
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-medium">{result.title}</span>
                  <IndexFilterBadge result={result} />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {result.path}
                </div>
                <div className="text-[10px] text-muted-foreground break-words">{result.reason}</div>
                {result.headingText && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    Heading: {result.headingText}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <StateMessage>
          {selected?.empty ?? "No results found."} Results are derived from the generated machine
          index and do not modify Markdown files.
        </StateMessage>
      )}
    </div>
  );
}

function IndexFilterBadge({ result }: { result: IndexFilterResult }) {
  const label =
    result.tag ??
    result.folder ??
    result.duplicateKey ??
    result.target ??
    result.anchor ??
    result.filter;
  return (
    <Badge variant="secondary" className="max-w-[110px] truncate font-mono text-[9px] py-0">
      {label}
    </Badge>
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

type LocalNodeRuntimeStatus = {
  ok: true;
  node: {
    nodeId: string;
    displayName: string;
    mode: "local" | "remote";
    apiVersion: 1;
  };
  runtime: {
    host: string;
    port: number;
    localOnlyMode: boolean;
    allowedOrigins: string[];
    startupWarnings: string[];
  };
  auth: {
    mode: "disabled";
    requestedMode: "disabled" | "protected";
    enabled: boolean;
    enforcement: "none";
    protectedModeAvailable: boolean;
    protectedModeRequested: boolean;
    warning: string;
    error?: string;
  };
  requestPolicy: {
    routePolicyInventoryPresent: boolean;
    routePolicyCount: number;
    browserSecurityPolicyPresent: boolean;
    authorizationPlannerPresent: boolean;
    dryRunMiddlewareConfigured: boolean;
    dryRunMiddlewareMounted: boolean;
    dryRunObservationOnly: true;
    dryRunRunCount: number;
    dryRunAuditConfigured: boolean;
    dryRunAuditAttemptedCount: number;
    dryRunAuditAppendCount: number;
    lastDryRunAuditStatus?: {
      mode: "disabled" | "append";
      status: "skipped" | "written" | "failed";
      eventId?: string;
      reasonCode?: string;
      error?: string;
      enforcementActive: false;
      networkExposureSafe: false;
    };
    lastDryRunResult?: {
      timestamp: string;
      method: string;
      path: string;
      routePattern?: string;
      status: "wouldAllow" | "wouldDeny" | "anonymousReduced" | "failed";
      credentialStatus?: string;
      credentialSource?: string;
      reasonCodes: string[];
      plannedResponse?: {
        kind: string;
        httpStatus: number;
        reasonCode: string;
        authRequired: boolean;
        confirmationRequired: boolean;
        enforcementActive: false;
        networkExposureSafe: false;
      };
      enforcementActive: false;
      networkExposureSafe: false;
      error?: string;
    };
    dryRun: {
      configured: boolean;
      mounted: boolean;
      observed: {
        count: number;
        lastStatus?: "wouldAllow" | "wouldDeny" | "anonymousReduced" | "failed";
      };
      planned: {
        computed: boolean;
        lastResponse?: {
          kind: string;
          httpStatus: number;
          reasonCode: string;
          authRequired: boolean;
          confirmationRequired: boolean;
          enforcementActive: false;
          networkExposureSafe: false;
        };
      };
      audited: {
        configured: boolean;
        attemptedCount: number;
        appendedCount: number;
        lastStatus?: "skipped" | "written" | "failed";
        lastReasonCode?: string;
      };
      enforced: false;
      enforcementActive: false;
      protectedModeOperational: false;
      networkExposureSafe: false;
    };
    enforcementActive: false;
    enforced: false;
    credentialVerificationActive: false;
    auditRequestLoggingActive: false;
    revocationChecksActive: false;
    csrfOriginEnforcementActive: false;
    acceptsCredentials: false;
    acceptsSessions: false;
    acceptsBearerTokens: false;
    networkExposureSafe: false;
  };
  protectedModeStartup: {
    requestedAuthMode: "disabled" | "protected";
    operationalAuthMode: "disabled";
    protectedModeAvailable: false;
    protectedModeMayStart: false;
    missingRequiredStores: {
      store: "credentials" | "tokenVerifiers" | "sessions" | "revocations";
      path: string;
      error: string;
      quarantineCandidate?: string;
    }[];
    corruptStores: {
      store: "credentials" | "tokenVerifiers" | "sessions" | "revocations";
      path: string;
      error: string;
      quarantineCandidate?: string;
    }[];
    unsafeStorePaths: string[];
    permissionWarnings: string[];
    nonLocalBindWithDisabledAuth: boolean;
    enforcementActive: false;
    credentialVerificationActive: false;
    auditWiringActive: false;
    revocationChecksActive: false;
    csrfOriginEnforcementActive: false;
    networkExposureSafe: false;
  };
  protectedModeReadiness: {
    readyForEnforcement: false;
    enforcementActive: false;
    protectedModeOperational: false;
    networkExposureSafe: false;
    requestedAuthMode: "disabled" | "protected";
    operationalAuthMode: "disabled";
    protectedModeAvailable: false;
    protectedModeMayStart: false;
    blockerCount: number;
    blockers: string[];
    routePolicy: {
      inventoryPresent: boolean;
      routePolicyCount: number;
      expectedMinimum: number;
      complete: boolean;
    };
    checks: {
      credentialVerificationActive: false;
      credentialAcceptanceActive: false;
      auditEnforcementActive: false;
      revocationChecksActive: false;
      csrfOriginEnforcementActive: false;
      reducedAnonymousStatusEnforced: false;
      strongerConfirmationEnforced: false;
      explicitEnforcementFlagEnabled: false;
      protectedRequestPipelineAvailable: boolean;
      protectedResponsePlannerAvailable: boolean;
      reducedAnonymousStatusPlannerAvailable: boolean;
      strongerConfirmationPlannerAvailable: boolean;
      auditRequirementPlannerAvailable: boolean;
    };
    startup: {
      missingStoreCount: number;
      corruptStoreCount: number;
      unsafeStorePathCount: number;
      permissionWarningCount: number;
    };
    network: {
      localOnlyMode: boolean;
      nonLocalBindWithDisabledAuth: boolean;
    };
  };
  vaultCount: number;
  vaults: {
    vaultId: string;
    displayName: string;
    indexStatus: "fresh" | "stale" | "rebuilding" | "error";
    changedExternally: boolean;
    watcherHealth: "ok" | "stale" | "rebuilding" | "error";
    changedPathCount: number;
    addedPathCount: number;
    deletedPathCount: number;
    lastEventAt?: number;
    lastIndexedAt?: number;
    storageSummaryAvailable: boolean;
    error?: string;
  }[];
  capabilities: {
    storageSummary: true;
    remoteNodes: false;
    authentication: false;
    sync: false;
    ai: false;
    database: false;
    migrationSupport: false;
  };
};

type IndexFilterKind =
  "broken-links" | "orphan-notes" | "tags" | "folders" | "duplicate-ids" | "duplicate-anchors";

type IndexFilterResult = {
  id: string;
  filter: IndexFilterKind;
  path: string;
  title: string;
  reason: string;
  target?: string;
  tag?: string;
  folder?: string;
  duplicateKey?: string;
  headingText?: string;
  anchor?: string;
};

type IndexFilterResponse = {
  filter: IndexFilterKind;
  total: number;
  source: "machine-index";
  results: IndexFilterResult[];
};

type IndexSearchMatchType =
  "file" | "frontmatter-id" | "tag" | "heading" | "anchor" | "link-target" | "backlink";

type IndexSearchResult = {
  id: string;
  matchType: IndexSearchMatchType;
  path: string;
  title: string;
  matchedField: string;
  matchedValue: string;
  headingText?: string;
  anchor?: string;
  tag?: string;
  linkTarget?: string;
  targetPath?: string;
  fromPath?: string;
  fromTitle?: string;
};

type IndexSearchResponse = {
  q: string;
  total: number;
  source: "machine-index";
  results: IndexSearchResult[];
};

type VaultInspectLink = {
  target: string;
  targetPath?: string;
  targetTitle?: string;
  anchor?: string;
  alias?: string;
  raw: string;
  status: string;
  broken: boolean;
  targetPaths?: string[];
};

type VaultInspectBacklink = {
  fromPath: string;
  fromTitle: string;
  anchor?: string;
  alias?: string;
};

type VaultInspectDuplicateAnchor = {
  anchor: string;
  headings: { text: string; level: number; explicit: boolean }[];
};

type VaultInspectIssue = {
  kind: string;
  path: string;
  message: string;
  severity: "warning" | "error";
};

type VaultInspectResponse = {
  source: "machine-index";
  path: string;
  title: string;
  frontmatterId?: string;
  tags: string[];
  headings: { level: number; text: string; anchor: string; explicit: boolean }[];
  anchors: string[];
  outgoingLinks: VaultInspectLink[];
  backlinks: VaultInspectBacklink[];
  brokenOutgoingLinks: VaultInspectLink[];
  duplicateId?: { id: string; paths: string[] };
  duplicateAnchors: VaultInspectDuplicateAnchor[];
  orphan: boolean;
  issues: VaultInspectIssue[];
};

type InspectBacklink = {
  fromPath: string;
  anchor?: string;
  alias?: string;
};

type MetadataNote = {
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  headings: unknown[];
  wikilinks: unknown[];
};

type CombinedInspectMetadata = {
  fileCount: number;
  totalBytes: number;
  headings: number;
  outgoing: number;
  backlinks: number;
  issueCount: number;
  tags: string[];
  paths: string[];
};

type IndexInspectPanelProps = {
  selectedCount: number;
  inspectData: VaultInspectResponse | null;
  inspectLoading: boolean;
  inspectError: string | null;
  backlinks: InspectBacklink[];
  noteTitles: Record<string, { title: string }>;
  fileIssues: VaultInspectIssue[];
  combinedMetadata: CombinedInspectMetadata | null;
  metadataNote: MetadataNote | null;
  metadataPath: string | null;
  metadataFileMeta?: { size: number };
  onPick: (path: string) => void;
  onAnchor: (path: string, anchor: string) => void;
};

const INDEX_FILTER_OPTIONS: { value: IndexFilterKind; label: string; empty: string }[] = [
  { value: "broken-links", label: "Broken links", empty: "No broken links found." },
  { value: "orphan-notes", label: "Orphan notes", empty: "No orphan notes found." },
  { value: "tags", label: "Tags", empty: "No tags found." },
  { value: "folders", label: "Folders", empty: "No folder results found." },
  { value: "duplicate-ids", label: "Duplicate IDs", empty: "No duplicate IDs found." },
  {
    value: "duplicate-anchors",
    label: "Duplicate anchors",
    empty: "No duplicate heading anchors found.",
  },
];

function VaultSettingsPanel({
  vaults,
  activeVaultId,
  health,
  mutationError,
  firstRun,
  onClose,
  onSelectVault,
  onAddVault,
  onRemoveVault,
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
  onRemoveVault: (
    vaultId: string,
    generatedDataAction: GeneratedDataAction,
  ) => Promise<RemoveVaultResponse | null>;
  onReindexVault: (vaultId: string) => Promise<boolean>;
  onRefreshVaults: () => Promise<boolean>;
  onTestHealth: () => Promise<boolean>;
}) {
  const [summaries, setSummaries] = useState<Record<string, VaultSummary>>({});
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [nodeStatus, setNodeStatus] = useState<LocalNodeRuntimeStatus | null>(null);
  const [nodeStatusError, setNodeStatusError] = useState<string | null>(null);
  const [nodeStatusLoading, setNodeStatusLoading] = useState(false);
  const [busyVaultId, setBusyVaultId] = useState<string | null>(null);

  const refreshNodeStatus = useCallback(async () => {
    setNodeStatusLoading(true);
    setNodeStatusError(null);
    try {
      const status = await settingsApi<LocalNodeRuntimeStatus>("/api/node/status");
      setNodeStatus(status);
    } catch (error) {
      setNodeStatus(null);
      setNodeStatusError(errorMessage(error));
    } finally {
      setNodeStatusLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void refreshNodeStatus();
  }, [refreshNodeStatus, vaults]);

  const reindexOne = async (vaultId: string) => {
    setBusyVaultId(vaultId);
    const ok = await onReindexVault(vaultId);
    if (ok) await refreshSummaries();
    setBusyVaultId(null);
  };

  const removeOne = async (vaultId: string, generatedDataAction: GeneratedDataAction) => {
    setBusyVaultId(vaultId);
    const result = await onRemoveVault(vaultId, generatedDataAction);
    if (result) {
      await refreshSummaries();
      await refreshNodeStatus();
    }
    setBusyVaultId(null);
    return result;
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
            <LocalNodeDiagnosticsCard
              status={nodeStatus}
              error={nodeStatusError}
              loading={nodeStatusLoading}
              onRefresh={refreshNodeStatus}
            />
            <ConfiguredVaultsCard
              vaults={vaults}
              summaries={summaries}
              activeVaultId={activeVaultId}
              busyVaultId={busyVaultId}
              onSelectVault={onSelectVault}
              onReindexVault={reindexOne}
              onRemoveVault={removeOne}
              onRefresh={async () => {
                await onRefreshVaults();
                await refreshSummaries();
                await refreshNodeStatus();
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

function LocalNodeDiagnosticsCard({
  status,
  error,
  loading,
  onRefresh,
}: {
  status: LocalNodeRuntimeStatus | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const unsupported: [string, boolean][] = status
    ? [
        ["Authentication", status.capabilities.authentication],
        ["Remote nodes", status.capabilities.remoteNodes],
        ["Sync", status.capabilities.sync],
        ["AI/vector", status.capabilities.ai],
        ["Database", status.capabilities.database],
        ["Migrations", status.capabilities.migrationSupport],
      ]
    : [];
  const statusLabel = status
    ? status.runtime.localOnlyMode
      ? "Local only"
      : "Warning"
    : error
      ? "Unavailable"
      : "Checking";
  const dryRunStatus = status?.requestPolicy.dryRun;
  const lastObserved = status?.requestPolicy.lastDryRunResult;
  const plannedResponse =
    dryRunStatus?.planned.lastResponse ?? status?.requestPolicy.lastDryRunResult?.plannedResponse;

  return (
    <section className="border rounded-md">
      <div className="border-b px-3 py-2 flex items-center gap-2">
        <Info className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Local Node Diagnostics</h2>
        <Badge
          variant={error || (status && !status.runtime.localOnlyMode) ? "destructive" : "outline"}
          className="ml-auto"
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="p-3 text-sm space-y-3">
        <p className="text-xs text-muted-foreground">
          Read-only runtime status for this local AREPO backend. This is not remote node or
          federation setup.
        </p>

        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Backend unavailable. Local diagnostics cannot be refreshed: {error}</span>
          </div>
        )}

        {status?.runtime.startupWarnings.map((warning) => (
          <div
            key={warning}
            className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex gap-2"
          >
            <ShieldAlert className="size-4 shrink-0" />
            <span>{warning}</span>
          </div>
        ))}

        {status ? (
          <>
            <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Node</span>
              <span>
                {status.node.displayName} <span className="font-mono">({status.node.nodeId})</span>
              </span>
              <span className="text-muted-foreground">Mode</span>
              <span>{status.node.mode}</span>
              <span className="text-muted-foreground">Backend</span>
              <span className="font-mono">
                {status.runtime.host}:{status.runtime.port}
              </span>
              <span className="text-muted-foreground">Vaults</span>
              <span>{status.vaultCount}</span>
              <span className="text-muted-foreground">Storage status</span>
              <span>{status.capabilities.storageSummary ? "available" : "unavailable"}</span>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Authentication posture</div>
              <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Mode</span>
                <span>{status.auth.mode}</span>
                <span className="text-muted-foreground">Requested mode</span>
                <span>{status.auth.requestedMode}</span>
                <span className="text-muted-foreground">Enabled</span>
                <span>{status.auth.enabled ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Enforcement</span>
                <span>{status.auth.enforcement}</span>
                <span className="text-muted-foreground">Protected mode</span>
                <span>{status.auth.protectedModeAvailable ? "available" : "unavailable"}</span>
              </div>
              <p className="text-xs text-muted-foreground">{status.auth.warning}</p>
              {status.auth.error && <p className="text-xs text-destructive">{status.auth.error}</p>}
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Protected-mode startup gate</div>
              <div className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Requested auth</span>
                <span>{status.protectedModeStartup.requestedAuthMode}</span>
                <span className="text-muted-foreground">Operational auth</span>
                <span>{status.protectedModeStartup.operationalAuthMode}</span>
                <span className="text-muted-foreground">May start</span>
                <span>{status.protectedModeStartup.protectedModeMayStart ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Missing stores</span>
                <span>{status.protectedModeStartup.missingRequiredStores.length}</span>
                <span className="text-muted-foreground">Corrupt stores</span>
                <span>{status.protectedModeStartup.corruptStores.length}</span>
                <span className="text-muted-foreground">Unsafe paths</span>
                <span>{status.protectedModeStartup.unsafeStorePaths.length}</span>
                <span className="text-muted-foreground">Network safe</span>
                <span>{status.protectedModeStartup.networkExposureSafe ? "yes" : "no"}</span>
              </div>
              {status.protectedModeStartup.missingRequiredStores.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Missing auth stores:{" "}
                  {status.protectedModeStartup.missingRequiredStores
                    .map((store) => store.store)
                    .join(", ")}
                </p>
              )}
              {status.protectedModeStartup.corruptStores.length > 0 && (
                <p className="text-xs text-destructive">
                  Corrupt auth stores:{" "}
                  {status.protectedModeStartup.corruptStores.map((store) => store.store).join(", ")}
                </p>
              )}
              {status.protectedModeStartup.unsafeStorePaths.length > 0 && (
                <p className="text-xs text-destructive">
                  {status.protectedModeStartup.unsafeStorePaths.join(" ")}
                </p>
              )}
              {status.protectedModeStartup.permissionWarnings.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {status.protectedModeStartup.permissionWarnings.join(" ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Startup gating is diagnostic only. It does not verify credentials or enforce auth.
              </p>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Protected-mode readiness</div>
              <div className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Ready to enforce</span>
                <span>{status.protectedModeReadiness.readyForEnforcement ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Operational</span>
                <span>{status.protectedModeReadiness.protectedModeOperational ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Enforcement active</span>
                <span>{status.protectedModeReadiness.enforcementActive ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Network safe</span>
                <span>{status.protectedModeReadiness.networkExposureSafe ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Blockers</span>
                <span>{status.protectedModeReadiness.blockerCount}</span>
                <span className="text-muted-foreground">Route policy</span>
                <span>
                  {status.protectedModeReadiness.routePolicy.routePolicyCount}/
                  {status.protectedModeReadiness.routePolicy.expectedMinimum} planned
                </span>
                <span className="text-muted-foreground">Pipeline</span>
                <span>
                  {status.protectedModeReadiness.checks.protectedRequestPipelineAvailable
                    ? "planning-only"
                    : "absent"}
                </span>
                <span className="text-muted-foreground">Response planner</span>
                <span>
                  {status.protectedModeReadiness.checks.protectedResponsePlannerAvailable
                    ? "planning-only"
                    : "absent"}
                </span>
                <span className="text-muted-foreground">Reduced status</span>
                <span>
                  {status.protectedModeReadiness.checks.reducedAnonymousStatusPlannerAvailable
                    ? "planning-only"
                    : "absent"}
                </span>
                <span className="text-muted-foreground">Confirmation planner</span>
                <span>
                  {status.protectedModeReadiness.checks.strongerConfirmationPlannerAvailable
                    ? "planning-only"
                    : "absent"}
                </span>
                <span className="text-muted-foreground">Audit planner</span>
                <span>
                  {status.protectedModeReadiness.checks.auditRequirementPlannerAvailable
                    ? "planning-only"
                    : "absent"}
                </span>
              </div>
              {status.protectedModeReadiness.blockers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {status.protectedModeReadiness.blockers.slice(0, 8).map((blocker) => (
                    <Badge key={blocker} variant="secondary" className="font-mono">
                      {blocker}
                    </Badge>
                  ))}
                  {status.protectedModeReadiness.blockers.length > 8 && (
                    <Badge variant="secondary">
                      +{status.protectedModeReadiness.blockers.length - 8}
                    </Badge>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Readiness is diagnostic only. It explains why protected mode cannot enforce yet and
                does not make non-local exposure safe.
              </p>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Protected-mode policy plumbing</div>
              <div className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Route policies</span>
                <span>
                  {status.requestPolicy.routePolicyInventoryPresent
                    ? `${status.requestPolicy.routePolicyCount} present`
                    : "absent"}
                </span>
                <span className="text-muted-foreground">Browser policy</span>
                <span>
                  {status.requestPolicy.browserSecurityPolicyPresent ? "present" : "absent"}
                </span>
                <span className="text-muted-foreground">Auth planner</span>
                <span>
                  {status.requestPolicy.authorizationPlannerPresent ? "present" : "absent"}
                </span>
                <span className="text-muted-foreground">Observer configured</span>
                <span>{dryRunStatus?.configured ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Observer mounted</span>
                <span>{dryRunStatus?.mounted ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Observed requests</span>
                <span>{dryRunStatus?.observed.count ?? status.requestPolicy.dryRunRunCount}</span>
                <span className="text-muted-foreground">Audit configured</span>
                <span>{dryRunStatus?.audited.configured ? "append" : "disabled"}</span>
                <span className="text-muted-foreground">Audit attempted</span>
                <span>
                  {dryRunStatus?.audited.attemptedCount ??
                    status.requestPolicy.dryRunAuditAttemptedCount}
                </span>
                <span className="text-muted-foreground">Audit appended</span>
                <span>
                  {dryRunStatus?.audited.appendedCount ??
                    status.requestPolicy.dryRunAuditAppendCount}
                </span>
                {(dryRunStatus?.audited.lastStatus ||
                  status.requestPolicy.lastDryRunAuditStatus) && (
                  <>
                    <span className="text-muted-foreground">Last audit</span>
                    <span>
                      {dryRunStatus?.audited.lastStatus ??
                        status.requestPolicy.lastDryRunAuditStatus?.status}
                    </span>
                  </>
                )}
                {lastObserved && (
                  <>
                    <span className="text-muted-foreground">Last observed</span>
                    <span>
                      {lastObserved.method} {lastObserved.routePattern ?? lastObserved.path} (
                      {dryRunStatus?.observed.lastStatus ?? lastObserved.status})
                    </span>
                    {plannedResponse && (
                      <>
                        <span className="text-muted-foreground">Planned response</span>
                        <span>
                          {plannedResponse.kind} ({plannedResponse.httpStatus},{" "}
                          {plannedResponse.reasonCode})
                        </span>
                      </>
                    )}
                  </>
                )}
                <span className="text-muted-foreground">Enforced</span>
                <span>{dryRunStatus?.enforced ? "yes" : "no"}</span>
                <span className="text-muted-foreground">Enforcement active</span>
                <span>
                  {status.requestPolicy.enforcementActive || dryRunStatus?.enforcementActive
                    ? "active"
                    : "inactive"}
                </span>
                <span className="text-muted-foreground">Credential checks</span>
                <span>
                  {status.requestPolicy.credentialVerificationActive ? "active" : "inactive"}
                </span>
                <span className="text-muted-foreground">CSRF/origin checks</span>
                <span>
                  {status.requestPolicy.csrfOriginEnforcementActive ? "active" : "inactive"}
                </span>
                <span className="text-muted-foreground">Network safe</span>
                <span>{status.requestPolicy.networkExposureSafe ? "yes" : "no"}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Policy plumbing is observation-only. Mounted dry-run may observe requests, plan
                future responses, and attempt sanitized audit writes, but it never sends planned
                responses, rejects requests, or protects non-local exposure.
              </p>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Allowed browser origins</div>
              <div className="flex flex-wrap gap-1">
                {status.runtime.allowedOrigins.length > 0 ? (
                  status.runtime.allowedOrigins.map((origin) => (
                    <Badge key={origin} variant="secondary" className="font-mono">
                      {origin}
                    </Badge>
                  ))
                ) : (
                  <Empty>No browser origins are currently allowed.</Empty>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Vault runtime health</div>
              {status.vaults.length === 0 ? (
                <Empty>
                  No configured vaults. Add a local Markdown folder before checking watcher or index
                  health.
                </Empty>
              ) : (
                <div className="space-y-2">
                  {status.vaults.map((vault) => (
                    <div key={vault.vaultId} className="rounded border bg-muted/20 px-2 py-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium truncate">{vault.displayName}</span>
                        <Badge
                          variant={vault.watcherHealth === "error" ? "destructive" : "outline"}
                          className="ml-auto"
                        >
                          {vault.watcherHealth}
                        </Badge>
                      </div>
                      <div className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2 text-xs text-muted-foreground">
                        <span>Index: {vault.indexStatus}</span>
                        <span>
                          Storage summary:{" "}
                          {vault.storageSummaryAvailable ? "available" : "unavailable"}
                        </span>
                        <span>Changed paths: {vault.changedPathCount}</span>
                        <span>
                          Added/deleted: {vault.addedPathCount}/{vault.deletedPathCount}
                        </span>
                        {vault.lastIndexedAt && (
                          <span>Indexed: {formatTime(vault.lastIndexedAt)}</span>
                        )}
                        {vault.lastEventAt && (
                          <span>Last event: {formatTime(vault.lastEventAt)}</span>
                        )}
                      </div>
                      {vault.error && (
                        <div className="mt-1 text-xs text-destructive">{vault.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold">Disabled V1 capabilities</div>
              <div className="flex flex-wrap gap-1">
                {unsupported.map(([label, enabled]) => (
                  <Badge key={label} variant={enabled ? "outline" : "secondary"}>
                    {label}: {enabled ? "enabled" : "disabled"}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        ) : (
          !error && (
            <StateMessage tone="loading">Checking local node runtime status...</StateMessage>
          )
        )}

        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh diagnostics"}
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
  onRemoveVault,
  onRefresh,
}: {
  vaults: VaultInfo[];
  summaries: Record<string, VaultSummary>;
  activeVaultId: string | null;
  busyVaultId: string | null;
  onSelectVault: (vaultId: string) => void;
  onReindexVault: (vaultId: string) => Promise<void>;
  onRemoveVault: (
    vaultId: string,
    generatedDataAction: GeneratedDataAction,
  ) => Promise<RemoveVaultResponse | null>;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [removeVaultId, setRemoveVaultId] = useState<string | null>(null);
  const [generatedDataAction, setGeneratedDataAction] = useState<GeneratedDataAction>("keep");
  const [removeResult, setRemoveResult] = useState<RemoveVaultResponse | null>(null);
  const generatedDataChoiceName = useId();
  const refresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };
  const confirmRemove = async (vaultId: string) => {
    const result = await onRemoveVault(vaultId, generatedDataAction);
    if (result) {
      setRemoveResult(result);
      setRemoveVaultId(null);
      setGeneratedDataAction("keep");
    }
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
        {removeResult && (
          <div className="p-3 text-xs space-y-2 border-b bg-muted/20">
            <div className="font-medium">Removed {removeResult.vault.displayName} from AREPO.</div>
            <div className="text-muted-foreground">
              Your vault folder and source files were not deleted.
            </div>
            {removeResult.generatedData.action === "discard" ? (
              removeResult.generatedData.deletedPaths.length > 0 ? (
                <div>
                  Discarded {removeResult.generatedData.deletedPaths.length} AREPO-generated
                  index/cache file
                  {removeResult.generatedData.deletedPaths.length === 1 ? "" : "s"}.
                </div>
              ) : (
                <div>No verified AREPO-generated index/cache files were deleted.</div>
              )
            ) : (
              <div>AREPO-generated index/cache data was kept.</div>
            )}
            {removeResult.generatedData.diagnostics.length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-100">
                {removeResult.generatedData.diagnostics.join(" ")}
              </div>
            )}
          </div>
        )}
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
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 basis-48">
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs border-destructive/40 text-destructive hover:text-destructive"
                    onClick={() => {
                      setRemoveResult(null);
                      setGeneratedDataAction("keep");
                      setRemoveVaultId(vault.id);
                    }}
                    disabled={busyVaultId === vault.id}
                  >
                    <Trash2 className="size-3.5" />
                    Forget vault
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
                {removeVaultId === vault.id && (
                  <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-xs space-y-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">Remove vault from AREPO?</div>
                      <p className="text-muted-foreground">
                        This will remove this vault from AREPO&apos;s registered vault list. Your
                        vault folder and source files will not be deleted.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="font-medium">Generated data</div>
                      {summary?.storage && (
                        <div className="text-muted-foreground">
                          Current AREPO map/index cache:{" "}
                          {formatBytes(summary.storage.appDataCache.bytes)}
                        </div>
                      )}
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={generatedDataChoiceName}
                          value="keep"
                          checked={generatedDataAction === "keep"}
                          onChange={() => setGeneratedDataAction("keep")}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">Keep AREPO-generated index/cache data</span>
                          <span className="block text-muted-foreground">
                            Re-adding this vault may reuse or rebuild generated data according to
                            existing behavior.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={generatedDataChoiceName}
                          value="discard"
                          checked={generatedDataAction === "discard"}
                          onChange={() => setGeneratedDataAction("discard")}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">
                            Discard AREPO-generated index/cache data
                          </span>
                          <span className="block text-muted-foreground">
                            Only verified AREPO-owned generated data for this vault will be removed.
                            Source files and user-authored Markdown are left untouched.
                          </span>
                        </span>
                      </label>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setRemoveVaultId(null)}
                        disabled={busyVaultId === vault.id}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void confirmRemove(vault.id)}
                        disabled={busyVaultId === vault.id}
                      >
                        {busyVaultId === vault.id ? "Removing..." : "Remove from AREPO"}
                      </Button>
                    </div>
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
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
