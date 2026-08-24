import type { DirectoryBrowserResponse } from "./contracts.js";

export type DirectoryBrowserState = {
  open: boolean;
  loading: boolean;
  listing: DirectoryBrowserResponse | null;
  error: string | null;
};

export const CLOSED_DIRECTORY_BROWSER: DirectoryBrowserState = {
  open: false,
  loading: false,
  listing: null,
  error: null,
};

export function openDirectoryBrowser(): DirectoryBrowserState {
  return { open: true, loading: true, listing: null, error: null };
}

export function beginDirectoryNavigation(state: DirectoryBrowserState): DirectoryBrowserState {
  return { ...state, open: true, loading: true, error: null };
}

export function finishDirectoryNavigation(
  state: DirectoryBrowserState,
  listing: DirectoryBrowserResponse,
): DirectoryBrowserState {
  return { ...state, open: true, loading: false, listing, error: null };
}

export function failDirectoryNavigation(
  state: DirectoryBrowserState,
  error: string,
): DirectoryBrowserState {
  return { ...state, open: true, loading: false, error };
}

export function cancelDirectoryBrowser(): DirectoryBrowserState {
  return CLOSED_DIRECTORY_BROWSER;
}

export function selectCurrentDirectory(state: DirectoryBrowserState): {
  state: DirectoryBrowserState;
  selectedPath: string | null;
} {
  return {
    state: CLOSED_DIRECTORY_BROWSER,
    selectedPath: state.listing?.currentPath ?? null,
  };
}
