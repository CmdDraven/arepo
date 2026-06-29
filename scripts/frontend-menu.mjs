#!/usr/bin/env node
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpm(args) {
  return new Promise((resolve) => {
    const child = spawn(npmCommand(), args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

async function chooseTarget() {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      console.log("\nAREPO frontend/build targets");
      console.log("1. dev         Vite dev UI on http://localhost:8733");
      console.log("2. dev:port    Vite dev UI on a custom port");
      console.log("3. build       Production frontend build");
      console.log("4. build:dev   Development-mode frontend build");
      console.log("5. preview     Preview the production build");
      console.log("6. exit");
      const choice = (await rl.question("Select a target [1]: ")).trim() || "1";

      if (choice === "1" || choice.toLowerCase() === "dev") {
        return ["run", "dev"];
      }
      if (choice === "2" || choice.toLowerCase() === "dev:port") {
        const port = (await rl.question("Frontend port: ")).trim();
        if (!validPort(port)) {
          console.log("Port must be an integer from 1 to 65535.");
          continue;
        }
        return ["run", "dev", "--", "--port", port];
      }
      if (choice === "3" || choice.toLowerCase() === "build") {
        return ["run", "build"];
      }
      if (choice === "4" || choice.toLowerCase() === "build:dev") {
        return ["run", "build:dev"];
      }
      if (choice === "5" || choice.toLowerCase() === "preview") {
        return ["run", "preview"];
      }
      if (choice === "6" || choice.toLowerCase() === "exit") {
        return null;
      }
      console.log("Choose 1, 2, 3, 4, 5, or 6.");
    }
  } finally {
    rl.close();
  }
}

const target = await chooseTarget();
if (!target) {
  console.log("No frontend target started.");
  process.exit(0);
}
const code = await runNpm(target);
process.exit(code);
