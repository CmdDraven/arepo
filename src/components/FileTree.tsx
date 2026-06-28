import { useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
};

function buildTree(paths: string[], folders: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };
  const ensureFolder = (segments: string[]): TreeNode => {
    let cur = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = cur.children!.find((c) => c.kind === "folder" && c.name === seg);
      if (!next) {
        next = { name: seg, path: acc, kind: "folder", children: [] };
        cur.children!.push(next);
      }
      cur = next;
    }
    return cur;
  };
  for (const f of folders) ensureFolder(f.split("/").filter(Boolean));
  for (const p of paths) {
    const segs = p.split("/");
    const file = segs.pop()!;
    const parent = ensureFolder(segs);
    parent.children!.push({ name: file, path: p, kind: "file" });
  }
  const sort = (n: TreeNode) => {
    if (!n.children) return;
    n.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export type FileTreeProps = {
  paths: string[];
  folders: string[];
  activePath: string | null;
  dirtyPaths: Set<string>;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (path: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
};

export function FileTree(props: FileTreeProps) {
  const tree = useMemo(() => buildTree(props.paths, props.folders), [props.paths, props.folders]);
  return (
    <div className="text-sm">
      <Node node={tree} depth={-1} {...props} />
    </div>
  );
}

function Node({
  node,
  depth,
  activePath,
  dirtyPaths,
  expanded,
  onToggleFolder,
  onSelect,
  onNewFile,
  onNewFolder,
}: { node: TreeNode; depth: number } & Omit<FileTreeProps, "paths" | "folders">) {
  if (node.kind === "folder") {
    const isRoot = depth === -1;
    const open = isRoot || expanded.has(node.path);
    return (
      <div>
        {!isRoot && (
          <div
            className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted cursor-pointer select-none"
            style={{ paddingLeft: depth * 12 + 6 }}
            onClick={() => onToggleFolder(node.path)}
          >
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {open ? (
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate flex-1">{node.name}</span>
            <button
              className="opacity-0 group-hover:opacity-100 hover:text-foreground text-muted-foreground"
              title="New file here"
              onClick={(e) => {
                e.stopPropagation();
                onNewFile(node.path);
              }}
            >
              <Plus className="size-3.5" />
            </button>
            <button
              className="opacity-0 group-hover:opacity-100 hover:text-foreground text-muted-foreground"
              title="New folder here"
              onClick={(e) => {
                e.stopPropagation();
                onNewFolder(node.path);
              }}
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>
        )}
        {open &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              expanded={expanded}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
            />
          ))}
      </div>
    );
  }
  const isActive = activePath === node.path;
  const isDirty = dirtyPaths.has(node.path);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer select-none",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
      )}
      style={{ paddingLeft: depth * 12 + 22 }}
      onClick={() => onSelect(node.path)}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate flex-1">{node.name}</span>
      {isDirty && <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
    </div>
  );
}
