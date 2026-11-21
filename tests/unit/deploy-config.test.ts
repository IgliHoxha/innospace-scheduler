import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
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
      "vitest.config.mts",
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

describe("building the image", () => {
  const step = workflow.slice(
    workflow.indexOf("- name: Build and push"),
    workflow.indexOf("deploy:\n"),
  );

  // Without pipefail, tee's success would hide a failed build.
  it("reads flyctl's own exit status through the log it tees", () => {
    expect(step).toContain("set -o pipefail");
    expect(step).toMatch(/flyctl deploy --build-only [^\n]*\| tee build\.log/);
  });

  it("retries only a dropped builder connection, at most three times", () => {
    expect(step).toContain("for attempt in 1 2 3; do");
    expect(step).toContain(
      "grep -qE 'rpc error: code = Unavailable|error reading from server: EOF' build.log || exit 1",
    );
  });
});

describe("the restore point before a release", () => {
  const decide = workflow.slice(
    workflow.indexOf("- name: Has anything that ships changed?"),
    workflow.indexOf("- name: Build and push"),
  );
  const step = workflow.slice(
    workflow.indexOf("- name: Snapshot the data volume"),
    workflow.indexOf("- run: flyctl deploy --image"),
  );
  const touches = /TOUCHES: (.+)\n/.exec(decide)?.[1].split(" ") ?? [];
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(posix.join(dir, entry.name))
        : [posix.join(dir, entry.name)],
    );

  it("is taken only when what changed since the live commit can touch the volume", () => {
    expect(touches).toEqual([
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]);
    expect(decide).toContain('git diff --quiet "$live" HEAD -- $TOUCHES; then');
    expect(workflow).toContain("snapshot: ${{ steps.live.outputs.snapshot }}");
    expect(step).toContain("NEEDED: ${{ needs.build.outputs.snapshot }}");
  });

  // A second module opening the database would migrate unseen unless it joins the list.
  it("covers every module that opens the database", () => {
    const opens = sources("src").filter(
      (file) =>
        /\.(ts|tsx|mjs)$/.test(file) &&
        /from "better-sqlite3"/.test(readFileSync(file, "utf8")),
    );
    expect(opens).toEqual(["src/lib/db.ts"]);
    for (const file of opens) expect(touches).toContain(file);
  });

  it("is taken anyway on a manual run, an image no commit names or a missing answer", () => {
    expect(decide).toContain(
      'if [ "$GITHUB_EVENT_NAME" = push ] && [ -n "$live" ] && git diff --quiet "$live" HEAD -- $TOUCHES',
    );
    expect(decide).toMatch(
      /else\n\s+echo "snapshot=true" >> "\$GITHUB_OUTPUT"/,
    );
    expect(step).toContain('if [ "$NEEDED" = false ]; then');
  });

  it("comes before the release, and says so when none was needed", () => {
    expect(
      workflow.indexOf("- name: Snapshot the data volume"),
    ).toBeGreaterThan(workflow.indexOf("deploy:\n"));
    expect(step).toContain("No restore point for this release");
    expect(step).toContain("Restore point for this release: snapshot");
    expect(step.indexOf("No restore point")).toBeLessThan(
      step.indexOf("flyctl volumes snapshots create"),
    );
  });

  it("finds the volume by its name and waits until the snapshot can be restored from", () => {
    expect(step).toContain('select(.name == "scheduler_data")');
    expect(read("fly.toml.example")).toContain("source = 'scheduler_data'");
    expect(step).toMatch(/case "\$STATUS" in\n\s+created\)/);
  });

  // Fly refuses a second snapshot while the daily one runs, and that one is as good.
  it("takes the one already on its way, and fails on any other refusal", () => {
    expect(step).toContain(
      'if ! OUT=$(flyctl volumes snapshots create "$VOLUME" -a "$APP" 2>&1); then',
    );
    expect(step).toContain('grep -q "already scheduled" <<<"$OUT" || exit 1');
    expect(step).toContain("FLOOR=$(( $(date +%s) - 120 ))");
  });

  it("stops the release when no snapshot is ready, inside the job's time limit", () => {
    expect(step).toMatch(/not releasing without it\." >&2\n\s+exit 1/);
    expect(step).toContain("for _ in $(seq 60); do");
    expect(workflow).toMatch(
      /deploy:\s+name: Release[\s\S]*?timeout-minutes: 15/,
    );
  });
});

describe("the release job", () => {
  // A push to an unlisted branch runs nothing, so a rename must reach this line.
  it("is triggered by a push to main, the default branch", () => {
    expect(workflow).toMatch(/\n {2}push:\n {4}branches:\n {6}- main\n/);
    expect(workflow).not.toMatch(/- master\b/);
  });

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

describe("naming the release", () => {
  const job = workflow.slice(workflow.indexOf("  release:\n"));

  // A tag has to mark a build visitors received, so a failed or skipped release gets none.
  it("runs only after the release job", () => {
    expect(workflow).toMatch(
      /release:\s+name: Name the release\s+needs: deploy\s/,
    );
  });

  it("may write to the repository, which no other job can", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(job).toContain("contents: write");
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
  });

  it("asks couch-gag for this repo and commit, with the key from the secret", () => {
    expect(job).toContain("COUCH_GAG_URL: ${{ vars.COUCH_GAG_URL }}");
    expect(job).toContain("COUCH_GAG_KEY: ${{ secrets.COUCH_GAG_KEY }}");
    expect(job).toContain(
      '--arg repo "$GITHUB_REPOSITORY" --arg ref "$GITHUB_SHA"',
    );
    expect(job).toContain('"$COUCH_GAG_URL/v1/releases"');
  });

  // The same shape as the website's tags: r16-treehouse-of-horror.
  it("builds the tag from the sequence and the slug, and refuses anything else", () => {
    expect(job).toContain(String.raw`'"r\(.sequence)-\(.slug)"'`);
    expect(job).toContain("^r[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$");
    expect(job).toContain("is not a release");
  });

  it("titles the GitHub release with the episode, on the released commit", () => {
    expect(job).toContain('echo "title=$(jq -r \'.name\' <<<"$release")"');
    expect(job).toContain('gh release create "$TAG"');
    expect(job).toContain('--target "$GITHUB_SHA"');
    expect(job).toContain('--title "$TITLE" --generate-notes');
  });

  // A re-run claims the same episode, so the release it finds must not fail the job.
  it("leaves an existing release alone", () => {
    expect(job).toContain('gh release view "$TAG"');
    expect(job).toContain("already exists");
  });
});

describe("what goes into the image", () => {
  it("keeps every .env file out of the build context", () => {
    expect(ignored).toContain(".env*");
  });

  // Dropping sharp is only safe while nothing can ask the optimizer to use it.
  it("leaves the image optimizer out, and turns it off", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.outputFileTracingExcludes?.["*"]).toEqual(
      expect.arrayContaining(["node_modules/@img/**", "node_modules/sharp/**"]),
    );
  });

  // Alpine loads the musl binary, so excluding it would ship a driver that cannot start.
  it("drops the sqlite binaries for other platforms, never the musl ones", () => {
    const excluded = nextConfig.outputFileTracingExcludes?.["*"] ?? [];
    const prebuilds = "node_modules/better-sqlite3/prebuilds/";
    expect(excluded.filter((p) => p.startsWith(prebuilds))).toEqual([
      prebuilds + "darwin-*",
      prebuilds + "win32-*",
      prebuilds + "linux-*",
    ]);
  });

  // With scripts on, npm 10 compiles the prebuilt driver, which this image cannot do.
  it("installs without scripts and without a compiler", () => {
    expect(dockerfile).toContain("npm ci --ignore-scripts");
    expect(dockerfile).not.toMatch(/apk add[^\n]*(python3|make|g\+\+)/);
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
