import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

// No test can run a deploy, so the lines a safe release rests on are pinned as text.
const read = (...path: string[]) =>
  readFileSync(join(process.cwd(), ...path), "utf8");

const workflow = read(".github", "workflows", "fly-deploy.yml");
const script = (name: string) => read(".github", "scripts", `${name}.sh`);
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
  const decide = script("changed-since-green");
  const skips = (answer: string) =>
    excluded(
      decide.split("\n").find((l) => l.includes(`echo "${answer}=`)) ?? "",
    );
  const gate = (command: string) =>
    new RegExp(`- run: ${command}\\n\\s+if: ([^\\n]+)`).exec(job)?.[1];

  // The push before may have failed, so only a run that passed proves the files it held.
  it("measures main from this workflow's last green run", () => {
    expect(decide).toContain(
      "actions/workflows/fly-deploy.yml/runs?branch=$GITHUB_REF_NAME&event=push&status=success&per_page=1",
    );
    expect(job).toContain("actions: read");
    expect(job).toContain("fetch-depth: 0");
  });

  it("measures a pull request from its base", () => {
    expect(job).toContain("BASE: ${{ github.event.pull_request.base.sha }}");
    expect(job).toContain("run: bash .github/scripts/changed-since-green.sh");
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
    const checks = script("checks");
    expect(job).toMatch(
      /if: steps\.changed\.outputs\.any != 'false'\n\s+env:\n\s+CODE: \$\{\{ steps\.changed\.outputs\.code \}\}\n\s+APP: \$\{\{ steps\.changed\.outputs\.app \}\}\n\s+run: bash \.github\/scripts\/checks\.sh\n/,
    );
    expect(checks).toMatch(/^start format:check\nstart knip$/m);
    expect(checks).toContain(
      'if needed "${CODE:-}"; then start lint; start typecheck:tests; fi',
    );
    expect(checks).toContain('if needed "${APP:-}"; then start typecheck; fi');
    expect(checks).toMatch(/^npm run test \|\| failed=1$/m);
    // Only a plain "false" skips one, so an answer that went missing still runs it.
    expect(checks).toContain('needed() { [ "${1:-}" != false ]; }');
  });

  // Its dependencies are hundreds of packages nobody here wrote, and Fly's token reaches the database.
  it("is handed no secret, and so builds no image", () => {
    expect(job).not.toContain("secrets.");
    expect(job).not.toContain("flyctl");
    expect(job).toMatch(/permissions:\n\s+contents: read\n\s+actions: read/);
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
  const decide = script("changed-since-live");
  const skipped = excluded(decide);

  it("leaves out every file the image never carries: tests, docs, the workflow and tool configs", () => {
    expect(skipped).toEqual([
      "tests",
      "docs",
      ".github",
      "*.md",
      "vitest.config.mts",
      "Makefile",
      "docker-compose.yml",
      ".env*",
      ".gitignore",
      ".prettierrc.json",
      ".prettierignore",
      "knip.json",
      ".gitguardian.yaml",
      "LICENSE",
      "NOTICE",
    ]);
  });

  // next build runs ESLint, so its config can fail the image: a change to it must release.
  it("still releases on a change to anything the build reads", () => {
    for (const path of [
      "eslint.config.mjs",
      "tsconfig.json",
      "next.config.mjs",
      "package.json",
      "package-lock.json",
      "Dockerfile",
      ".dockerignore",
      "fly.toml.example",
    ]) {
      expect(skipped).not.toContain(path);
      expect(
        ignored.includes(path) &&
          path !== "Dockerfile" &&
          path !== ".dockerignore",
      ).toBe(false);
    }
  });

  // A path skipped here but copied into the image would change production without a release.
  it("skips only paths the image build never sees", () => {
    for (const path of skipped) expect(ignored).toContain(path);
  });

  it("compares with the commit that is live, read from the image tag", () => {
    expect(workflow).toContain("IMAGE_LABEL: sha-${{ github.sha }}");
    expect(decide).toMatch(/flyctl image show [^\n]*\.\[0\]\.Tag/);
    expect(decide).toContain('git diff --quiet "$live" HEAD');
    expect(workflow).toMatch(
      /id: live\n\s+run: bash \.github\/scripts\/changed-since-live\.sh/,
    );
  });
});

describe("building the image", () => {
  const step = script("build-image");

  it("is built only for a push that releases, by the script", () => {
    expect(workflow).toMatch(
      /- name: Build and push\n\s+if: steps\.live\.outputs\.release == 'true'\n\s+run: bash \.github\/scripts\/build-image\.sh\n/,
    );
  });

  // Without pipefail, tee's success would hide a failed build.
  it("reads flyctl's own exit status through the log it tees", () => {
    expect(step).toMatch(/^set -euo pipefail$/m);
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
  const decide = script("changed-since-live");
  const step = workflow.slice(
    workflow.indexOf("- name: Back up the database"),
    workflow.indexOf("- run: flyctl deploy --image"),
  );
  const touches = /^TOUCHES="(.+)"$/m.exec(decide)?.[1].split(" ") ?? [];

  it("is taken only when what changed since the live commit can touch the volume", () => {
    expect(touches).toEqual([
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]);
    expect(decide).toContain('git diff --quiet "$live" HEAD -- $TOUCHES; then');
    expect(workflow).toContain("backup: ${{ steps.live.outputs.backup }}");
    // A step-level skip, so a release that cannot touch the volume never loads the backup secrets.
    expect(step).toContain("if: needs.build.outputs.backup != 'false'");
    expect(step).not.toContain("NEEDED:");
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
    // Only a plain "false" skips it, so an empty or missing answer still takes the backup.
    expect(step).toContain("if: needs.build.outputs.backup != 'false'");
  });

  it("comes before the release, and shows as skipped when none was needed", () => {
    expect(workflow.indexOf("- name: Back up the database")).toBeGreaterThan(
      workflow.indexOf("deploy:\n"),
    );
    expect(workflow.indexOf("- name: Back up the database")).toBeLessThan(
      workflow.indexOf("- run: flyctl deploy --image"),
    );
    expect(step.indexOf("if: needs.build.outputs.backup")).toBeLessThan(
      step.indexOf("backup-db.sh"),
    );
  });

  it("is the nightly backup's own script, named after the commit", () => {
    expect(step).toContain(
      'run: bash .github/scripts/backup-db.sh "pre-release-${GITHUB_SHA::7}"',
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
    expect(step).toMatch(/\n\s+run: bash \.github\/scripts\/backup-db\.sh /);
    expect(script("backup-db")).toMatch(/^set -euo pipefail$/m);
    expect(workflow).toMatch(
      /deploy:\s+name: Release and name it[\s\S]*?timeout-minutes: 15/,
    );
  });

  // Fly's whole-disk snapshots were replaced by the gzip in R2, so nothing here may ask for one.
  it("takes no Fly snapshot", () => {
    expect(workflow).not.toContain("volumes snapshots");
  });
});

describe("the database backup", () => {
  const backup = script("backup-db");
  const nightly = read(".github", "workflows", "backup.yml");

  it("copies the file the app writes, on the volume the app mounts", () => {
    expect(backup).toContain("/app/data/scheduler.db");
    expect(read("fly.toml.example")).toContain("destination = '/app/data'");
  });

  it("takes one consistent copy while the app serves, never opening the file to write", () => {
    expect(backup).toContain("VACUUM INTO ?");
    expect(backup).toContain("readonly:true,fileMustExist:true");
  });

  // ssh does not wake a suspended machine, and this one sleeps most of the day.
  it("starts the machine before reaching into it", () => {
    expect(backup.indexOf("flyctl machine start")).toBeGreaterThan(-1);
    expect(backup.indexOf("flyctl machine start")).toBeLessThan(
      backup.indexOf("flyctl ssh console"),
    );
  });

  it("keeps a copy only once it opens and holds the reservations", () => {
    const upload = backup.indexOf("--aws-sigv4");
    expect(backup).toContain('[ "$check" = ok ] ||');
    expect(backup.indexOf("PRAGMA integrity_check")).toBeLessThan(upload);
    expect(backup.indexOf("SELECT count(*) FROM reservations")).toBeLessThan(
      upload,
    );
  });

  it("stores it gzipped in the bucket, and fails when the upload is refused", () => {
    expect(backup).toContain("gzip -9 /tmp/scheduler-backup.db");
    expect(backup).toContain(
      "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/$BUCKET/$key",
    );
    expect(backup).toContain("curl --fail-with-body");
    expect(backup).toContain(
      'key="scheduler-$(date -u +%Y-%m-%dT%H%MZ)-$LABEL.db.gz"',
    );
  });

  // An argument is visible to every process on the runner; a file in the job's own folder is not.
  it("hands curl the bucket's keys in a file, never as an argument", () => {
    expect(backup).toContain('-K "$work/r2.curl"');
    expect(backup).toMatch(/umask 077 && printf [^\n]*> "\$work\/r2\.curl"/);
    expect(backup).not.toMatch(/--user|-u "/);
  });

  it("leaves no copy behind in the machine", () => {
    expect(
      backup.indexOf('-C "rm -f /tmp/scheduler-backup.db.gz"'),
    ).toBeGreaterThan(backup.indexOf("flyctl ssh sftp get"));
  });

  // The repository is public and the file holds bookers' names and emails.
  it("shows nothing of the file but a count, and uploads it nowhere on GitHub", () => {
    const queries = [...backup.matchAll(/sqlite3 "[^"]+" "([^"]+)"/g)].map(
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

  // Neither skip list reads them, so a push of notes alone has no job to start.
  it("starts nothing for a push of notes or the docs' pictures alone", () => {
    const ignored =
      /\n {4}paths-ignore:\n {6}- "\*\*\.md"\n {6}- "docs\/\*\*"\n/g;
    expect(workflow.match(ignored)).toHaveLength(2);
    expect(workflow).toMatch(/\n {6}- main\n {4}#[^\n]*\n {4}paths-ignore:/);
    expect(workflow).toMatch(/\n {2}pull_request:\n {4}paths-ignore:/);
    expect(workflow).not.toMatch(/\n {4}paths:/);
    for (const list of ["changed-since-green", "changed-since-live"])
      expect(excluded(script(list))).toEqual(
        expect.arrayContaining(["*.md", "docs"]),
      );
  });

  it("waits for the checks and the image", () => {
    expect(workflow).toMatch(
      /deploy:\s+name: Release and name it\s+needs: \[check, build\]\s+if: needs\.build\.outputs\.release == 'true'/,
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
    expect(smoke).toBeLessThan(workflow.indexOf("purge-cache.sh"));
  });

  // The zone is shared with the marketing site, so only the booking page is purged.
  it("purges the booking page alone, and passes when Cloudflare's keys are not set", () => {
    const purge = script("purge-cache");
    expect(workflow).toContain("CF_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}");
    expect(workflow).toContain(
      "CF_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(purge).toContain(
      `--data '{"files":["https://scheduler.innospacetirana.com/"]}'`,
    );
    expect(purge).not.toContain("purge_everything");
    expect(purge).toMatch(/skipping purge\."\n\s+exit 0/);
  });
});

describe("naming the release", () => {
  const job = workflow.slice(workflow.indexOf("  deploy:\n"));
  const name = script("release-name");
  const create = script("release-create");

  // A tag has to mark a build visitors received, so a failed or skipped release gets none.
  it("is the end of the release job, after the smoke test and the purge", () => {
    const at = (line: string) => job.indexOf(line);
    expect(workflow).not.toMatch(/\n {2}release:\n/);
    expect(at("- name: Purge Cloudflare cache")).toBeGreaterThan(
      at("- name: Smoke test the new release"),
    );
    expect(at("- name: Ask couch-gag")).toBeGreaterThan(
      at("- name: Purge Cloudflare cache"),
    );
    expect(at("- name: Create the tag")).toBeGreaterThan(
      at("- name: Ask Copilot"),
    );
    // No step of the job runs when one before it failed, so a failed release is never named.
    expect(job).not.toMatch(/if: [^\n]*(always|failure|cancelled)\(\)/);
  });

  // This job's token can write, so none is left in the folder Copilot is run beside.
  it("leaves no token in the folder it checks out", () => {
    expect(job).toMatch(
      /- uses: actions\/checkout@v\d+\n\s+with:\n\s+persist-credentials: false\n/,
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
    expect(job).toContain("run: bash .github/scripts/release-name.sh");
    expect(name).toContain(
      '--arg repo "$GITHUB_REPOSITORY" --arg ref "$GITHUB_SHA"',
    );
    expect(name).toContain('"$COUCH_GAG_URL/v1/releases"');
  });

  // The same shape as the website's tags: r16-treehouse-of-horror.
  it("builds the tag from the sequence and the slug, and refuses anything else", () => {
    expect(name).toContain(String.raw`'"r\(.sequence)-\(.slug)"'`);
    expect(name).toContain("^r[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$");
    expect(name).toContain("is not a release");
  });

  it("titles the GitHub release with the episode, on the released commit", () => {
    expect(name).toContain('echo "title=$(jq -r \'.name\' <<<"$release")"');
    expect(job).toContain("TITLE: ${{ steps.episode.outputs.title }}");
    expect(job).toContain("run: bash .github/scripts/release-create.sh");
    expect(create).toContain('gh release create "$TAG"');
    expect(create).toContain('--target "$GITHUB_SHA"');
    expect(create).toContain('--title "$TITLE" --generate-notes');
  });

  // A re-run claims the same episode, so the release it finds must not fail the job.
  it("leaves an existing release alone", () => {
    expect(create).toContain('gh release view "$TAG"');
    expect(create).toContain("already exists");
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
  const job = workflow.slice(workflow.indexOf("  deploy:\n"));
  const step = job.slice(
    job.indexOf("- name: Ask Copilot for the description"),
    job.indexOf("- name: Create the tag and the GitHub release"),
  );
  const notes = script("release-notes");

  it("is worded by Copilot, which only the release job may ask", () => {
    expect(job).toContain("copilot-requests: write");
    expect(workflow.match(/copilot-requests: write/g)).toHaveLength(1);
    expect(step).toContain("GH_TOKEN: ${{ github.token }}");
    expect(step).toMatch(/COPILOT_CLI: "\d+\.\d+\.\d+"/);
    expect(step).toContain("run: bash .github/scripts/release-notes.sh");
    expect(notes).toContain('"@github/copilot@$COPILOT_CLI"');
  });

  // The words must come from what was released, not from what the model can go and find.
  it("hands Copilot the commits since the last release and no tools", () => {
    expect(notes).toContain('"repos/$GITHUB_REPOSITORY/releases/latest"');
    expect(notes).toContain(
      '"repos/$GITHUB_REPOSITORY/compare/$previous...$GITHUB_SHA"',
    );
    expect(notes).toContain("--available-tools=");
    // The checkout put the scripts in the workspace, so Copilot is run from an empty folder.
    expect(notes.indexOf('cd "$(mktemp -d)"')).toBeGreaterThan(-1);
    expect(notes.indexOf('cd "$(mktemp -d)"')).toBeLessThan(
      notes.indexOf("copilot -p"),
    );
    expect(step).toContain("never invent a change");
  });

  it("describes nothing for a release that exists or a commit with nothing new", () => {
    expect(notes).toContain('[ -n "${TAG:-}" ] || exit 0');
    expect(notes).toMatch(/gh release view "\$TAG"[^\n]+then exit 0; fi/);
    expect(notes).toContain(
      `grep -q '^- ' "$RUNNER_TEMP/changes.txt" || exit 0`,
    );
  });

  // The release matters more than its wording, so a Copilot outage must not cost the tag.
  it("never stops the release: a failure leaves GitHub's own notes", () => {
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("timeout-minutes: 3");
    expect(notes).toContain(
      'mv "$RUNNER_TEMP/draft.md" "$RUNNER_TEMP/notes.md"',
    );
    const create = script("release-create");
    expect(create).toContain('if [ -s "$RUNNER_TEMP/notes.md" ]; then notes=(');
    expect(create).toContain('--generate-notes ${notes[@]+"${notes[@]}"}');
  });
});

describe("the scripts the workflows run", () => {
  const workflows = sources(".github/workflows").map((file) => ({
    file,
    text: readFileSync(file, "utf8"),
  }));
  const scripts = sources(".github/scripts");
  const ran = (text: string) =>
    [...text.matchAll(/run: bash (\.github\/scripts\/[\w-]+\.sh)/g)].map(
      (m) => m[1],
    );

  // A typed block runs nowhere but on GitHub; a file runs here, under a test.
  it("are files: no workflow types a block of shell of its own", () => {
    for (const { file, text } of workflows)
      expect(text, file).not.toMatch(/run: [|>]/);
  });

  it("all exist, and none is left unrun", () => {
    const named = workflows.flatMap(({ text }) => ran(text));
    expect([...new Set(named)].sort()).toEqual([...scripts].sort());
  });

  // bash <file> gets none of the -e the runner's shell gave a typed block.
  it("each stop at the first failure, unset variable or broken pipe", () => {
    for (const file of scripts)
      expect(readFileSync(file, "utf8"), file).toMatch(/^set -euo pipefail$/m);
  });

  it("are checked out before the first of them runs, in every job", () => {
    for (const { file, text } of workflows) {
      const jobs = text
        .slice(text.indexOf("\njobs:\n"))
        .split(/\n(?= {2}[\w-]+:\n)/)
        .filter((job) => ran(job).length > 0);
      expect(jobs.length, file).toBeGreaterThan(0);
      for (const job of jobs) {
        const checkout = job.indexOf("- uses: actions/checkout@");
        expect(checkout, file).toBeGreaterThan(-1);
        expect(checkout, file).toBeLessThan(job.indexOf("run: bash .github/"));
      }
    }
  });
});
