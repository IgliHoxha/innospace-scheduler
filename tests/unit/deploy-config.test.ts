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
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(posix.join(dir, entry.name))
      : [posix.join(dir, entry.name)],
  );
const excluded = (text: string) =>
  [...text.matchAll(/':!([^']+)'/g)].map((m) => m[1]);

describe("deciding which checks a change needs", () => {
  const job = workflow.slice(
    workflow.indexOf("  check:\n"),
    workflow.indexOf("  build:\n"),
  );
  const decide = job.slice(
    job.indexOf("- name: Which checks does this change need?"),
    job.indexOf("- uses: actions/setup-node"),
  );
  const skips = (answer: string) =>
    excluded(
      decide.split("\n").find((l) => l.includes(`echo "${answer}=`)) ?? "",
    );
  const gate = (script: string) =>
    new RegExp(`- run: ${script}\\n\\s+if: ([^\\n]+)`).exec(job)?.[1];

  // The push before may have failed, so only a run that passed proves the files it held.
  it("measures main from this workflow's last green run", () => {
    expect(decide).toContain(
      "actions/workflows/fly-deploy.yml/runs?branch=$GITHUB_REF_NAME&event=push&status=success&per_page=1",
    );
    expect(job).toContain("actions: read");
    expect(job).toContain("fetch-depth: 0");
  });

  it("measures a pull request from its base", () => {
    expect(decide).toContain("BASE: ${{ github.event.pull_request.base.sha }}");
    expect(decide).toContain('if [ "$GITHUB_EVENT_NAME" = push ]; then');
  });

  it("runs every check when the base is unknown or the answer is missing", () => {
    expect(decide).toContain("|| BASE=");
    expect(decide).toContain(
      'if [ -n "$BASE" ] && git diff --quiet "$BASE" HEAD -- . "$@"; then echo false; else echo true; fi',
    );
    expect(job).not.toContain("== 'true'");
  });

  it("skips every check only for files none of them reads", () => {
    expect(skips("any")).toEqual(["*.md", "docs"]);
    expect(read(".prettierignore").split("\n")).toContain("*.md");
    for (const file of sources("docs")) expect(file).toMatch(/\.png$/);
  });

  it("skips ESLint and the tests' typecheck for a folder that holds no code", () => {
    expect(skips("code")).toEqual([...skips("any"), ".github"]);
    for (const file of sources(".github"))
      expect(file).not.toMatch(/\.(ts|tsx|mts|js|mjs|cjs)$/);
  });

  it("skips the app's typecheck for what its tsconfig leaves out", () => {
    const left = ["tests", "vitest.config.mts"];
    expect(skips("app")).toEqual([...skips("code"), ...left]);
    expect(JSON.parse(read("tsconfig.json")).exclude).toEqual(
      expect.arrayContaining(left),
    );
  });

  it("runs each check on the answer for the files it reads", () => {
    const on = (answer: string) => `steps.changed.outputs.${answer} != 'false'`;
    expect(gate("npm run format:check")).toBe(on("any"));
    expect(gate("npm run lint")).toBe(on("code"));
    expect(gate("npm run typecheck")).toBe(on("app"));
    expect(gate("npm run typecheck:tests")).toBe(on("code"));
    expect(gate("npm run knip")).toBe(on("any"));
    expect(gate("npm run test")).toBe(on("any"));
  });

  // A manifest that drifted from its lockfile has to reach npm ci, which refuses it.
  it("installs only when the manifest, the lockfile or Node changed", () => {
    expect(job).toContain("path: node_modules");
    expect(job).toContain(
      "${{ steps.node.outputs.node-version }}-${{ hashFiles('package.json', 'package-lock.json') }}",
    );
    expect(gate("npm ci")).toBe(
      "steps.changed.outputs.any != 'false' && steps.modules.outputs.cache-hit != 'true'",
    );
  });
});

describe("deciding whether a push needs a release", () => {
  const skipped = excluded(
    workflow.slice(
      workflow.indexOf("- name: Has anything that ships changed?"),
      workflow.indexOf("- name: Build and push"),
    ),
  );

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
    workflow.indexOf("- name: Back up the database"),
    workflow.indexOf("- run: flyctl deploy --image"),
  );
  const touches = /TOUCHES: (.+)\n/.exec(decide)?.[1].split(" ") ?? [];

  it("is taken only when what changed since the live commit can touch the volume", () => {
    expect(touches).toEqual([
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]);
    expect(decide).toContain('git diff --quiet "$live" HEAD -- $TOUCHES; then');
    expect(workflow).toContain("backup: ${{ steps.live.outputs.backup }}");
    expect(step).toContain("NEEDED: ${{ needs.build.outputs.backup }}");
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
    expect(decide).toMatch(/else\n\s+echo "backup=true" >> "\$GITHUB_OUTPUT"/);
    expect(step).toContain('if [ "$NEEDED" = false ]; then');
  });

  it("comes before the release, and says so when none was needed", () => {
    expect(workflow.indexOf("- name: Back up the database")).toBeGreaterThan(
      workflow.indexOf("deploy:\n"),
    );
    expect(step).toContain("No restore point for this release");
    expect(step.indexOf("No restore point")).toBeLessThan(
      step.indexOf("backup-db.sh"),
    );
  });

  it("is the nightly backup's own script, named after the commit", () => {
    expect(step).toContain(
      'bash .github/scripts/backup-db.sh "pre-release-${GITHUB_SHA::7}"',
    );
    for (const name of [
      "FLY_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ])
      expect(step).toContain(`${name}: \${{ secrets.${name} }}`);
  });

  it("stops the release when the backup fails, inside the job's time limit", () => {
    expect(step).toContain("set -euo pipefail");
    expect(read(".github", "scripts", "backup-db.sh")).toMatch(
      /^set -euo pipefail$/m,
    );
    expect(workflow).toMatch(
      /deploy:\s+name: Release[\s\S]*?timeout-minutes: 15/,
    );
  });

  // Fly's whole-disk snapshots were replaced by the gzip in R2, so nothing here may ask for one.
  it("takes no Fly snapshot", () => {
    expect(workflow).not.toContain("volumes snapshots");
  });
});

describe("the database backup", () => {
  const script = read(".github", "scripts", "backup-db.sh");
  const nightly = read(".github", "workflows", "backup.yml");

  it("copies the file the app writes, on the volume the app mounts", () => {
    expect(script).toContain("/app/data/scheduler.db");
    expect(read("fly.toml.example")).toContain("destination = '/app/data'");
  });

  it("takes one consistent copy while the app serves, never opening the file to write", () => {
    expect(script).toContain("VACUUM INTO ?");
    expect(script).toContain("readonly:true,fileMustExist:true");
  });

  // ssh does not wake a suspended machine, and this one sleeps most of the day.
  it("starts the machine before reaching into it", () => {
    expect(script.indexOf("flyctl machine start")).toBeGreaterThan(-1);
    expect(script.indexOf("flyctl machine start")).toBeLessThan(
      script.indexOf("flyctl ssh console"),
    );
  });

  it("keeps a copy only once it opens and holds the reservations", () => {
    const upload = script.indexOf("--aws-sigv4");
    expect(script).toContain('[ "$check" = ok ] ||');
    expect(script.indexOf("PRAGMA integrity_check")).toBeLessThan(upload);
    expect(script.indexOf("SELECT count(*) FROM reservations")).toBeLessThan(
      upload,
    );
  });

  it("stores it gzipped in the bucket, and fails when the upload is refused", () => {
    expect(script).toContain("gzip -9 /tmp/scheduler-backup.db");
    expect(script).toContain(
      "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/$BUCKET/$key",
    );
    expect(script).toContain("curl --fail-with-body");
    expect(script).toContain(
      'key="scheduler-$(date -u +%Y-%m-%dT%H%MZ)-$LABEL.db.gz"',
    );
  });

  // An argument is visible to every process on the runner; a file in the job's own folder is not.
  it("hands curl the bucket's keys in a file, never as an argument", () => {
    expect(script).toContain('-K "$work/r2.curl"');
    expect(script).toMatch(/umask 077 && printf [^\n]*> "\$work\/r2\.curl"/);
    expect(script).not.toMatch(/--user|-u "/);
  });

  it("leaves no copy behind in the machine", () => {
    expect(
      script.indexOf('-C "rm -f /tmp/scheduler-backup.db.gz"'),
    ).toBeGreaterThan(script.indexOf("flyctl ssh sftp get"));
  });

  // The repository is public and the file holds bookers' names and emails.
  it("shows nothing of the file but a count, and uploads it nowhere on GitHub", () => {
    const queries = [...script.matchAll(/sqlite3 "[^"]+" "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(queries).toEqual([
      "PRAGMA integrity_check",
      "SELECT count(*) FROM reservations",
    ]);
    expect(nightly + workflow).not.toContain("upload-artifact");
  });

  it("runs every night and on demand, one run at a time", () => {
    expect(nightly).toMatch(/schedule:\n\s+- cron: "17 2 \* \* \*"/);
    expect(nightly).toContain("workflow_dispatch:");
    expect(nightly).toContain("concurrency: backup");
    expect(nightly).toContain("bash .github/scripts/backup-db.sh nightly");
    expect(nightly).toContain("timeout-minutes: 10");
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

describe("the release's description", () => {
  const job = workflow.slice(workflow.indexOf("  release:\n"));
  const step = job.slice(
    job.indexOf("- name: Ask Copilot for the description"),
    job.indexOf("- name: Create the tag and the GitHub release"),
  );

  it("is worded by Copilot, which only the release job may ask", () => {
    expect(job).toContain("copilot-requests: write");
    expect(workflow.match(/copilot-requests: write/g)).toHaveLength(1);
    expect(step).toContain("GH_TOKEN: ${{ github.token }}");
    expect(step).toMatch(/COPILOT_CLI: "\d+\.\d+\.\d+"/);
    expect(step).toContain('"@github/copilot@$COPILOT_CLI"');
  });

  // The words must come from what was released, not from what the model can go and find.
  it("hands Copilot the commits since the last release and no tools", () => {
    expect(step).toContain('"repos/$GITHUB_REPOSITORY/releases/latest"');
    expect(step).toContain(
      '"repos/$GITHUB_REPOSITORY/compare/$previous...$GITHUB_SHA"',
    );
    expect(step).toContain("--available-tools=");
    expect(step).toContain("never invent a change");
  });

  it("describes nothing for a release that exists or a commit with nothing new", () => {
    expect(step).toContain('[ -n "$TAG" ] || exit 0');
    expect(step).toMatch(/gh release view "\$TAG"[^\n]+then exit 0; fi/);
    expect(step).toContain(
      `grep -q '^- ' "$RUNNER_TEMP/changes.txt" || exit 0`,
    );
  });

  // The release matters more than its wording, so a Copilot outage must not cost the tag.
  it("never stops the release: a failure leaves GitHub's own notes", () => {
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("timeout-minutes: 3");
    expect(step).toContain(
      'mv "$RUNNER_TEMP/draft.md" "$RUNNER_TEMP/notes.md"',
    );
    expect(job).toContain('if [ -s "$RUNNER_TEMP/notes.md" ]; then notes=(');
    expect(job).toContain('--generate-notes "${notes[@]}"');
  });
});
