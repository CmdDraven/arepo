import test from "node:test";
import assert from "node:assert/strict";
import {
  beginDirectoryNavigation,
  cancelDirectoryBrowser,
  failDirectoryNavigation,
  finishDirectoryNavigation,
  openDirectoryBrowser,
  selectCurrentDirectory,
} from "./directoryBrowser.ts";

const listing = {
  currentPath: "/srv/notes",
  parentPath: "/srv",
  directories: [{ name: "Research", path: "/srv/notes/Research" }],
};

test("directory browser opens and navigation replaces the current listing", () => {
  const opened = openDirectoryBrowser();
  assert.equal(opened.open, true);
  assert.equal(opened.loading, true);

  const loaded = finishDirectoryNavigation(opened, listing);
  const navigating = beginDirectoryNavigation(loaded);
  const child = finishDirectoryNavigation(navigating, {
    currentPath: "/srv/notes/Research",
    parentPath: "/srv/notes",
    directories: [],
  });
  assert.equal(child.listing?.currentPath, "/srv/notes/Research");
  assert.equal(child.loading, false);
});

test("selecting only returns the current path and closes without submitting anything", () => {
  const loaded = finishDirectoryNavigation(openDirectoryBrowser(), listing);
  const selected = selectCurrentDirectory(loaded);
  assert.equal(selected.selectedPath, "/srv/notes");
  assert.deepEqual(selected.state, cancelDirectoryBrowser());
  assert.equal("submit" in selected, false);
});

test("browsing failure stays bounded and does not own or replace manual form input", () => {
  const manualRootPath = "/manually/typed/vault";
  const failed = failDirectoryNavigation(openDirectoryBrowser(), "Directory could not be loaded.");
  assert.equal(failed.open, true);
  assert.equal(failed.error, "Directory could not be loaded.");
  assert.equal(manualRootPath, "/manually/typed/vault");
});
