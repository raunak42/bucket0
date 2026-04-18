import { access, cp } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = join(projectRoot, ".next", "standalone");

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryIfPresent(source, destination) {
  if (!(await exists(source))) {
    return;
  }

  await cp(source, destination, {
    recursive: true,
    force: true,
  });

  console.log(`Copied ${source} -> ${destination}`);
}

if (!(await exists(standaloneRoot))) {
  throw new Error(
    "Missing .next/standalone. Run this script after a standalone Next.js build.",
  );
}

await copyDirectoryIfPresent(
  join(projectRoot, "public"),
  join(standaloneRoot, "public"),
);

await copyDirectoryIfPresent(
  join(projectRoot, ".next", "static"),
  join(standaloneRoot, ".next", "static"),
);
