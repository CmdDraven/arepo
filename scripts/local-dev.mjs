#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function hasCommand(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function launchDetached(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function frontendMenuCommand() {
  return `cd ${shellQuote(root)} && npm run frontend:menu; printf '\nPress Enter to close this terminal...'; read _`;
}

function openFrontendTerminal() {
  if (process.env.AREPO_NO_OPEN_TERMINAL === "1") return false;

  if (process.platform === "darwin" && hasCommand("osascript")) {
    const script = `tell application "Terminal" to do script "cd ${root.replaceAll('"', '\\"')} && npm run frontend:menu"`;
    launchDetached("osascript", ["-e", script]);
    return true;
  }

  if (process.platform === "win32") {
    launchDetached("cmd.exe", [
      "/c",
      "start",
      "cmd.exe",
      "/k",
      `cd /d "${root}" && npm run frontend:menu`,
    ]);
    return true;
  }

  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;

  const command = frontendMenuCommand();
  const terminals = [
    ["x-terminal-emulator", ["-e", "bash", "-lc", command]],
    ["gnome-terminal", ["--", "bash", "-lc", command]],
    ["konsole", ["-e", "bash", "-lc", command]],
    ["xterm", ["-e", "bash", "-lc", command]],
  ];

  for (const [terminal, args] of terminals) {
    if (!hasCommand(terminal)) continue;
    launchDetached(terminal, args);
    return true;
  }

  return false;
}

function startBackend() {
  const backend = spawn(npmCommand(), ["run", "backend:dev:server"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  const stop = (signal) => {
    if (!backend.killed) backend.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  backend.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

console.log("AREPO local dev launcher");
console.log("Starting the local backend in this terminal.");
const opened = openFrontendTerminal();
if (opened) {
  console.log("Opened a second terminal with frontend/build targets.");
} else {
  console.log("Could not open a second terminal automatically.");
  console.log("Run this in another terminal: npm run frontend:menu");
}
console.log("");
startBackend();
