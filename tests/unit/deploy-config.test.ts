import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

// No test can run a deploy, so the lines a safe release rests on are pinned as text.
const read = (...path: string[]) =>
  readFileSync(join(process.cwd(), ...path), "utf8");

const workflow = read(".github", "workflows", "fly-deploy.yml");
const dockerfile = read("Dockerfile");
const ignored = read(".dockerignore").split("\n");

describe("deciding whether a push needs a release", () => {
  const skipped = [...workflow.matchAll(/':!([^']+)'/g)].map((m) => m[1]);

  it("leaves tests, docs and the workflow itself out of the comparison", () => {
    expect(skipped).toEqual([
      "tests",
      "docs",
      ".github",
      "*.md",
      "vitest.config.ts",
    ]);
  });

  // A path skipped here but copied into the image would change production without a release.
  it("skips only paths the image build never sees", () => {
    for (const path of skipped) expect(ignored).toContain(path);
  });

  it("compares with the commit that is live, read from the image tag", () => {
    expect(workflow).toContain("IMAGE_LABEL: sha-${{ github.sha }}");
    expect(workflow).toMatch(/flyctl image show [^\n]*\.\[0\]\.Tag/);
    expect(workflow).toContain('git diff --quiet "$live" HEAD');
  });
});

describe("the release job", () => {
  it("waits for the checks and the image", () => {
    expect(workflow).toMatch(
      /deploy:\s+name: Release\s+needs: \[check, build\]/,
    );
  });

  it("deploys the image that was built for this commit", () => {
    expect(workflow).toContain(
      'flyctl deploy --image "registry.fly.io/innospace-scheduler:$IMAGE_LABEL"',
    );
  });

  it("asks the origin for the booking page before purging the edge", () => {
    const smoke = workflow.indexOf("https://innospace-scheduler.fly.dev/");
    expect(smoke).toBeGreaterThan(-1);
    expect(smoke).toBeLessThan(workflow.indexOf("purge_cache"));
  });
});

describe("what goes into the image", () => {
  it("keeps every .env file out of the build context", () => {
    expect(ignored).toContain(".env*");
  });

  // Dropping sharp is only safe while nothing can ask the optimizer to use it.
  it("leaves the image optimizer out, and turns it off", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.outputFileTracingExcludes?.["*"]).toEqual([
      "node_modules/@img/**",
      "node_modules/sharp/**",
    ]);
  });

  it("fails the build when the sqlite driver does not load", () => {
    expect(dockerfile).toContain(
      `RUN node -e "new (require('better-sqlite3'))(':memory:').close()"`,
    );
  });

  it("commits no runtime config with the Fly template", () => {
    expect(read("fly.toml.example")).not.toMatch(/^\s*\[env\]/m);
  });
});
