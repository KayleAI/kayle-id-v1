import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageScriptPath = fileURLToPath(
  new URL("./package-worker-deploy-artifact.mjs", import.meta.url)
);

const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
};

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const createTempRepo = async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "package-worker-deploy-artifact-")
  );

  return {
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true });
    },
    directory,
  };
};

const runPackageScript = async ({ artifactDir, projectDir, repoDir }) => {
  await execFileAsync(
    process.execPath,
    [
      packageScriptPath,
      "--project-dir",
      projectDir,
      "--artifact-dir",
      artifactDir,
    ],
    {
      cwd: repoDir,
    }
  );
};

test("creates a minimal deploy config when no generated wrangler config exists", async () => {
  const { cleanup, directory } = await createTempRepo();

  try {
    const projectDir = "apps/demo";
    const artifactDir = path.join(directory, "artifact");

    await writeJson(path.join(directory, projectDir, "wrangler.jsonc"), {
      compatibility_date: "2026-03-20",
      name: "demo",
      routes: [{ pattern: "demo.example.com", zone_name: "example.com" }],
    });
    await writeText(
      path.join(directory, projectDir, ".wrangler-out", "index.js"),
      "export default {}\n"
    );

    await runPackageScript({ artifactDir, projectDir, repoDir: directory });

    const deployConfig = JSON.parse(
      await readFile(
        path.join(
          artifactDir,
          "workspace",
          projectDir,
          "wrangler.deploy.jsonc"
        ),
        "utf8"
      )
    );

    assert.equal(deployConfig.main, "./.wrangler-out/index.js");
    assert.equal(deployConfig.find_additional_modules, undefined);
    assert.equal(deployConfig.assets, undefined);
    assert.equal(deployConfig.no_bundle, undefined);
    assert.deepEqual(deployConfig.routes, [
      { pattern: "demo.example.com", zone_name: "example.com" },
    ]);
  } finally {
    await cleanup();
  }
});

test("preserves Vite worker metadata needed for no-bundle deploy artifacts", async () => {
  const { cleanup, directory } = await createTempRepo();

  try {
    const projectDir = "apps/demo";
    const artifactDir = path.join(directory, "artifact");

    await writeJson(path.join(directory, projectDir, "wrangler.jsonc"), {
      compatibility_date: "2026-03-20",
      name: "demo",
      services: [{ binding: "API", service: "demo-api" }],
    });
    await writeJson(
      path.join(directory, projectDir, "dist", "server", "wrangler.json"),
      {
        assets: { directory: "../client" },
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
      }
    );
    await writeText(
      path.join(directory, projectDir, ".wrangler-out", "index.js"),
      'import "./assets/worker-entry.js";\n'
    );

    await runPackageScript({ artifactDir, projectDir, repoDir: directory });

    const deployConfig = JSON.parse(
      await readFile(
        path.join(
          artifactDir,
          "workspace",
          projectDir,
          "wrangler.deploy.jsonc"
        ),
        "utf8"
      )
    );

    assert.equal(deployConfig.main, "./.wrangler-out/index.js");
    assert.equal(deployConfig.find_additional_modules, true);
    assert.equal(deployConfig.no_bundle, true);
    assert.deepEqual(deployConfig.rules, [
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
    ]);
    assert.deepEqual(deployConfig.assets, {
      directory: "./dist/client",
    });
    assert.deepEqual(deployConfig.services, [
      { binding: "API", service: "demo-api" },
    ]);
  } finally {
    await cleanup();
  }
});

test("excludes local-only and secret material from deploy artifacts", async () => {
  const { cleanup, directory } = await createTempRepo();

  try {
    const projectDir = "apps/demo";
    const artifactDir = path.join(directory, "artifact");

    await writeJson(path.join(directory, projectDir, "wrangler.jsonc"), {
      compatibility_date: "2026-03-20",
      name: "demo",
    });
    await writeText(
      path.join(directory, projectDir, ".wrangler-out", "index.js"),
      "export default {}\n"
    );
    await writeText(path.join(directory, projectDir, ".env.production"), "");
    await writeText(path.join(directory, projectDir, "local.env"), "");
    await writeText(path.join(directory, projectDir, ".dev.vars"), "");
    await writeText(
      path.join(directory, projectDir, "dist", "server", ".dev.vars"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, "certificates", "dev.pem"),
      ""
    );
    await writeText(path.join(directory, projectDir, "private", "auth.p8"), "");
    await writeText(
      path.join(directory, projectDir, ".tanstack", "tmp", "cache"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, ".venv", "pyvenv.cfg"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, "src", "__pycache__", "service.pyc"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, "src", "worker.test.ts"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, "src", "service_test.py"),
      ""
    );
    await writeText(
      path.join(directory, projectDir, "tests", "fixtures", "key.pem"),
      ""
    );
    await writeText(path.join(directory, projectDir, "src", "worker.ts"), "");
    await symlink(
      path.join(directory, projectDir, "src", "worker.ts"),
      path.join(directory, projectDir, "src", "worker-link.ts")
    );

    await runPackageScript({ artifactDir, projectDir, repoDir: directory });

    const workspaceProjectDir = path.join(artifactDir, "workspace", projectDir);

    assert.equal(
      await fileExists(path.join(workspaceProjectDir, ".env.production")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "local.env")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, ".dev.vars")),
      false
    );
    assert.equal(
      await fileExists(
        path.join(workspaceProjectDir, "dist", "server", ".dev.vars")
      ),
      false
    );
    assert.equal(
      await fileExists(
        path.join(workspaceProjectDir, "certificates", "dev.pem")
      ),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "private", "auth.p8")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, ".tanstack")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, ".venv")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "src", "__pycache__")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "src", "worker.test.ts")),
      false
    );
    assert.equal(
      await fileExists(
        path.join(workspaceProjectDir, "src", "service_test.py")
      ),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "tests")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "src", "worker-link.ts")),
      false
    );
    assert.equal(
      await fileExists(path.join(workspaceProjectDir, "src", "worker.ts")),
      true
    );
  } finally {
    await cleanup();
  }
});
