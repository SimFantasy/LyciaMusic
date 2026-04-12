import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT =
  process.env.LYCIA_PROJECT_ROOT || "C:/Users/lover/Desktop/LyciaMusic";

function clip(text, max = 12000) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n...[truncated]...`;
}

function existsRelative(relPath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relPath));
}

function readJsonRelative(relPath) {
  return JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf8")
  );
}

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runCommand(command, args, cwd = PROJECT_ROOT) {
  const result = await execFileAsync(command, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function safeGitStatus() {
  return runCommand("git", ["status", "--short", "--branch"]).then(
    (r) => r.stdout.trim(),
    () => "git status unavailable"
  );
}

function listScripts() {
  if (!existsRelative("package.json")) return [];
  try {
    const pkg = readJsonRelative("package.json");
    return Object.keys(pkg.scripts ?? {});
  } catch {
    return [];
  }
}

function findInterestingPaths() {
  const hits = new Set();

  const roots = [
    PROJECT_ROOT,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  const nameMatchers = [
    /library\.db$/i,
    /^covers?$/i,
    /lycia/i,
    /lyciamusic/i,
  ];

  function shouldDescend(name, depth, isTopLevel) {
    if (depth <= 0) return false;
    if (isTopLevel) return true;
    return /lycia|music|tauri|cover|cache|app/i.test(name);
  }

  function walk(dir, depth, isTopLevel = false) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (nameMatchers.some((re) => re.test(entry.name))) {
        hits.add(fullPath);
      }

      if (entry.isDirectory() && shouldDescend(entry.name, depth, isTopLevel)) {
        walk(fullPath, depth - 1, false);
      }
    }
  }

  for (const root of roots) {
    walk(root, root === PROJECT_ROOT ? 3 : 2, true);
  }

  return Array.from(hits).slice(0, 60);
}

const server = new McpServer({
  name: "lycia-mcp",
  version: "0.1.0",
});

server.registerTool(
  "lycia_project_status",
  {
    title: "Lycia project status",
    description:
      "Inspect the Lycia music player project and report key files, scripts, and git status.",
    inputSchema: z.object({}),
  },
  async () => {
    const keyFiles = {
      "package.json": existsRelative("package.json"),
      "src-tauri/Cargo.toml": existsRelative("src-tauri/Cargo.toml"),
      "src-tauri/tauri.conf.json": existsRelative("src-tauri/tauri.conf.json"),
      "src-tauri/src": existsRelative("src-tauri/src"),
      "src": existsRelative("src"),
      ".git": existsRelative(".git"),
    };

    const scripts = listScripts();
    const gitStatus = await safeGitStatus();

    let packageName = null;
    let packageManager = "unknown";

    if (existsRelative("package.json")) {
      try {
        const pkg = readJsonRelative("package.json");
        packageName = pkg.name ?? null;

        if (existsRelative("pnpm-lock.yaml")) packageManager = "pnpm";
        else if (existsRelative("package-lock.json")) packageManager = "npm";
        else if (existsRelative("yarn.lock")) packageManager = "yarn";
      } catch {
        // ignore
      }
    }

    const result = {
      projectRoot: PROJECT_ROOT,
      packageName,
      packageManager,
      keyFiles,
      scripts,
      gitStatus,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "lycia_run_check",
  {
    title: "Run Lycia project checks",
    description:
      "Run curated checks for the Lycia music player project.",
    inputSchema: z.object({
      check: z.enum([
        "cargo_check",
        "npm_build",
        "npm_lint",
        "npm_typecheck",
      ]),
    }),
  },
  async ({ check }) => {
    const scripts = listScripts();

    const checks = {
      cargo_check: {
        command: "cargo",
        args: ["check", "--manifest-path", "src-tauri/Cargo.toml"],
        requiresScript: null,
      },
      npm_build: {
        command: npmBin(),
        args: ["run", "build"],
        requiresScript: "build",
      },
      npm_lint: {
        command: npmBin(),
        args: ["run", "lint"],
        requiresScript: "lint",
      },
      npm_typecheck: {
        command: npmBin(),
        args: ["run", "typecheck"],
        requiresScript: "typecheck",
      },
    };

    const selected = checks[check];

    if (selected.requiresScript && !scripts.includes(selected.requiresScript)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                projectRoot: PROJECT_ROOT,
                check,
                ok: false,
                reason: `package.json does not contain script "${selected.requiresScript}"`,
                availableScripts: scripts,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const { stdout, stderr } = await runCommand(
        selected.command,
        selected.args
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                projectRoot: PROJECT_ROOT,
                check,
                ok: true,
                stdout: clip(stdout),
                stderr: clip(stderr),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                projectRoot: PROJECT_ROOT,
                check,
                ok: false,
                error: String(error),
                stdout: clip(error?.stdout ?? ""),
                stderr: clip(error?.stderr ?? ""),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "lycia_find_runtime_files",
  {
    title: "Find Lycia runtime files",
    description:
      "Look for likely Lycia runtime files such as library.db and cover cache folders under the project and common Windows app data locations.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = {
      projectRoot: PROJECT_ROOT,
      appdata: process.env.APPDATA ?? null,
      localappdata: process.env.LOCALAPPDATA ?? null,
      hits: findInterestingPaths(),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`lycia-mcp running for ${PROJECT_ROOT}`);
}

main().catch((error) => {
  console.error("Fatal error in lycia-mcp:", error);
  process.exit(1);
});