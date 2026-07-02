import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_THEME,
  centerViewAfterAssignment,
  centerViewAfterDocumentClose,
  createTreeUiState,
  lastNonDocumentViewForDocumentOpen,
  paneRenderWidth,
  shouldShowPaneContent,
} from "./workspaceState.ts";

test("tree UI state instances do not share local search or filter state", () => {
  const sidebar = createTreeUiState(false);
  const center = createTreeUiState(true);

  sidebar.query = "sidebar-only";
  sidebar.indexSearchQuery = "path query";
  sidebar.indexFilter = "tags";

  assert.equal(center.query, "");
  assert.equal(center.indexSearchQuery, "");
  assert.equal(center.indexFilter, "broken-links");
  assert.equal(sidebar.searchCollapsed, false);
  assert.equal(center.searchCollapsed, true);
});

test("center workspace assignment does not replace an open document", () => {
  assert.equal(centerViewAfterAssignment(null, "tree", "empty"), "tree");
  assert.equal(centerViewAfterAssignment("Notes/note.md", "graph", "document"), "document");
});

test("opening and closing documents preserves cached Tree or Graph center views", () => {
  assert.equal(lastNonDocumentViewForDocumentOpen("tree", null), "tree");
  assert.equal(lastNonDocumentViewForDocumentOpen("graph", "tree"), "graph");
  assert.equal(lastNonDocumentViewForDocumentOpen("document", "tree"), "tree");
  assert.equal(centerViewAfterDocumentClose("graph"), "graph");
  assert.equal(centerViewAfterDocumentClose(null), "empty");
});

test("tucked or unreadably narrow panes hide content while preserving render width", () => {
  assert.equal(shouldShowPaneContent(false, 180, 144), true);
  assert.equal(shouldShowPaneContent(false, 80, 144), false);
  assert.equal(shouldShowPaneContent(true, 260, 144), false);
  assert.equal(paneRenderWidth(false, 260), 260);
  assert.equal(paneRenderWidth(true, 260), 0);
});

test("default theme is dark without consulting browser-only storage", () => {
  assert.equal(DEFAULT_THEME, "dark");
});
