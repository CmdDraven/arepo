export type CenterWorkspaceView = "empty" | "document" | "tree" | "graph";
export type NonDocumentCenterView = Extract<CenterWorkspaceView, "tree" | "graph">;
export type TreePlacement = "sidebar" | "center";
export type PaneSide = "left" | "right";
export type ThemeMode = "light" | "dark";

export type TreeUiState<
  TFilter extends string = string,
  TFilterResponse = unknown,
  TSearchResponse = unknown,
> = {
  query: string;
  indexFilter: TFilter;
  indexFilterResponse: TFilterResponse | null;
  indexFilterLoading: boolean;
  indexFilterError: string | null;
  indexSearchQuery: string;
  indexSearchResponse: TSearchResponse | null;
  indexSearchLoading: boolean;
  indexSearchError: string | null;
  searchCollapsed: boolean;
  filtersCollapsed: boolean;
  homepageCollapsed: boolean;
};

export const DEFAULT_THEME: ThemeMode = "dark";
export const DEFAULT_INDEX_FILTER = "broken-links";

export function createTreeUiState<
  TFilter extends string = typeof DEFAULT_INDEX_FILTER,
  TFilterResponse = unknown,
  TSearchResponse = unknown,
>(
  collapsed = false,
  defaultIndexFilter = DEFAULT_INDEX_FILTER as TFilter,
): TreeUiState<TFilter, TFilterResponse, TSearchResponse> {
  return {
    query: "",
    indexFilter: defaultIndexFilter,
    indexFilterResponse: null,
    indexFilterLoading: false,
    indexFilterError: null,
    indexSearchQuery: "",
    indexSearchResponse: null,
    indexSearchLoading: false,
    indexSearchError: null,
    searchCollapsed: collapsed,
    filtersCollapsed: collapsed,
    homepageCollapsed: collapsed,
  };
}

export function centerViewAfterAssignment(
  activePath: string | null,
  requestedView: NonDocumentCenterView,
  currentView: CenterWorkspaceView,
): CenterWorkspaceView {
  return activePath ? currentView : requestedView;
}

export function lastNonDocumentViewForDocumentOpen(
  currentView: CenterWorkspaceView,
  currentLastView: NonDocumentCenterView | null,
): NonDocumentCenterView | null {
  return currentView === "tree" || currentView === "graph" ? currentView : currentLastView;
}

export function centerViewAfterDocumentClose(
  lastNonDocumentView: NonDocumentCenterView | null,
): CenterWorkspaceView {
  return lastNonDocumentView ?? "empty";
}

export function shouldShowPaneContent(
  tucked: boolean,
  width: number,
  readableWidth: number,
): boolean {
  return !tucked && width >= readableWidth;
}

export function paneRenderWidth(tucked: boolean, width: number): number {
  return tucked ? 0 : width;
}
