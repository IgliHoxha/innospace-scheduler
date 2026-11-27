import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "scheduler-ci-"));
const bin = path.join(root, "bin");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const UNKNOWN = "f".repeat(40);
let dir = root;
let made = 0;

// One record a call, its arguments kept apart, so a test reads exactly what a tool was handed.
const RECORD = `rec=$(printf '%s\\037' "$(basename "$0")" "$@"); printf '%s\\036' "$rec" >> "$STUB_LOG"`;
const COUNT = `n=$(cat "$STUB_DIR/$1.count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_DIR/$1.count"`;

/** Each stands in for a tool a script calls, so no test reaches Fly, GitHub, Cloudflare or couch-gag. */
const STUBS: Record<string, string> = {
  curl: `for arg; do
  case "$arg" in
    */purge_cache) exit "\${STUB_PURGE:-0}" ;;
    */v1/releases) [ -n "$STUB_REPLY" ] || exit 22; printf '%s' "$STUB_REPLY"; exit 0 ;;
  esac
done`,
  gh: `case "$1 $2" in
  "release view") [ -n "$STUB_EXISTS" ]; exit ;;
  "release create") exit 0 ;;
esac
case "$2" in
  */actions/workflows/*) [ -z "$STUB_GH_DOWN" ] || exit 1; echo "$STUB_GREEN" ;;
  */releases/latest) [ -n "$STUB_PREVIOUS" ] || exit 1; echo "$STUB_PREVIOUS" ;;
  */compare/* | */commits\\?*) printf '%s\\n' "$STUB_CHANGES" ;;
esac`,
  flyctl: `case "$1" in
  image) [ -z "$STUB_FLY_DOWN" ] || exit 1; printf '[{"Tag":"%s"}]' "$STUB_TAG" ;;
  deploy)
    ${COUNT}
    [ "$n" -gt "\${STUB_BUILD_FAILS:-0}" ] && exit 0
    echo "\${STUB_BUILD_ERROR:-rpc error: code = Unavailable desc = closing}"
    exit 1 ;;
esac`,
  npm: `[ "$1" = run ] || exit 0
echo "words of $2"
if [ -n "$STUB_SLOW" ] && [ "$2" != test ]; then
  mkdir "$STUB_DIR/one-at-a-time" 2>/dev/null || touch "$STUB_DIR/overlapped"
  /bin/sleep 0.05
  rmdir "$STUB_DIR/one-at-a-time" 2>/dev/null
fi
case " $STUB_NPM_FAILS " in *" $2 "*) exit 1 ;; esac`,
  copilot: `{ pwd; ls -A; } > "$STUB_DIR/copilot.cwd"
env | cut -d= -f1 | sort > "$STUB_DIR/copilot.env"
printf '%s' "$STUB_DRAFT"`,
  sleep: "exit 0",
  // Stands in for root: runs what it is asked as this user, the stand-ins' own settings let through "env -i".
  sudo: `case "$1" in
  -u)
    shift 2
    if [ "$1" = env ] && [ "$2" = -i ]; then
      shift 2
      exec env -i "STUB_LOG=$STUB_LOG" "STUB_DIR=$STUB_DIR" "STUB_DRAFT=$STUB_DRAFT" "$@"
    fi
    exec "$@" ;;
  pkill | useradd) exit 0 ;;
  install) for last; do :; done; cat > "$last" ;;
  *) exec "$@" ;;
esac`,
  chown: "exit 0",
};

interface Run {
  status: number | null;
  out: string;
  stdout: string;
  calls: string[][];
  outputs: Record<string, string>;
  summary: string;
  /** Where the stand-ins of this run kept their notes. */
  io: string;
}

type Env = Record<string, string>;

const text = (file: string): string =>
  existsSync(file) ? readFileSync(file, "utf8") : "";

const callsIn = (io: string): string[][] =>
  text(path.join(io, "calls"))
    .split("\x1e")
    .filter(Boolean)
    .map((record) => record.split("\x1f").slice(0, -1));

interface Extra {
  args?: string[];
  input?: string;
}

/** Runs one script as a step would, in `cwd`, with nothing of this process's own env but PATH. */
function run(
  name: string,
  env: Env = {},
  cwd: string = dir,
  { args = [], input }: Extra = {},
): Run {
  const io = path.join(root, `io-${++made}`);
  mkdirSync(io);
  const done = spawnSync(
    "bash",
    [path.resolve(`.github/scripts/${name}.sh`), ...args],
    {
      cwd,
      input,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HOME: dir,
        TMPDIR: dir,
        RUNNER_TEMP: dir,
        GITHUB_ACTIONS: "true",
        GITHUB_WORKSPACE: path.join(dir, "workspace"),
        SANDBOX_ROOT: path.join(dir, "sandbox"),
        GITHUB_OUTPUT: path.join(io, "output"),
        GITHUB_STEP_SUMMARY: path.join(io, "summary"),
        GITHUB_REPOSITORY: "owner/scheduler",
        GITHUB_REF_NAME: "main",
        GITHUB_SHA: SHA,
        STUB_LOG: path.join(io, "calls"),
        STUB_DIR: io,
        ...env,
      },
    },
  );
  return {
    status: done.status,
    out: done.stdout + done.stderr,
    stdout: done.stdout,
    calls: callsIn(io),
    outputs: Object.fromEntries(
      text(path.join(io, "output"))
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    ),
    summary: text(path.join(io, "summary")),
    io,
  };
}

const called = (done: Run, tool: string): string[][] =>
  done.calls.filter(([name]) => name === tool).map((call) => call.slice(1));

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function commit(repo: string, files: Record<string, string>): string {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", "change");
  return git(repo, "rev-parse", "HEAD");
}

/** A repository whose first commit is the one measured from, with one commit per change after it. */
function repoWith(...changes: Record<string, string>[]): {
  repo: string;
  base: string;
} {
  const repo = path.join(root, `repo-${++made}`);
  mkdirSync(repo);
  git(repo, "init", "-q");
  const base = commit(repo, {
    "src/app/page.tsx": "page",
    "src/lib/db.ts": "db",
    "public/logo-mark.svg": "logo",
    "tests/unit/guest.test.ts": "test",
    "vitest.config.mts": "vitest",
    ".github/workflows/fly-deploy.yml": "workflow",
    "docs/img/login.png": "picture",
    "README.md": "notes",
    "package.json": "{}",
    "eslint.config.mjs": "lint",
    Dockerfile: "FROM scratch",
    "docker-entrypoint.sh": "boot",
    "fly.toml.example": "app",
    Makefile: "check:",
    ".env.example": "TZ=",
    "knip.json": "{}",
  });
  for (const change of changes) commit(repo, change);
  return { repo, base };
}

beforeAll(() => {
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${RECORD}\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
});

beforeEach(() => {
  dir = path.join(root, `run-${++made}`);
  mkdirSync(dir);
  // The checkout a step would run in: the sandbox copies it and runs its scripts from the copy.
  cpSync(".github/scripts", path.join(dir, "workspace/.github/scripts"), {
    recursive: true,
  });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the checks a change needs", () => {
  const ALL = { any: "true", code: "true", app: "true" };
  const since = (repo: string, base: string, env: Env = {}) =>
    run(
      "changed-since-green",
      { GITHUB_EVENT_NAME: "pull_request", BASE: base, ...env },
      repo,
    );

  it("are none for notes and the pictures in the docs", () => {
    const { repo, base } = repoWith({
      "README.md": "other notes",
      "CLAUDE.md": "more notes",
      "docs/img/login.png": "another picture",
    });
    expect(since(repo, base).outputs).toEqual({
      any: "false",
      code: "false",
      app: "false",
    });
  });

  it("are the formatter, knip and the tests for a workflow or one of its scripts", () => {
    const { repo, base } = repoWith({
      ".github/workflows/fly-deploy.yml": "another workflow",
      ".github/scripts/new.sh": "a script",
    });
    expect(since(repo, base).outputs).toEqual({
      any: "true",
      code: "false",
      app: "false",
    });
  });

  it("leave out the app's typecheck alone for a test or the tests' config", () => {
    for (const file of ["tests/unit/guest.test.ts", "vitest.config.mts"]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      expect(since(repo, base).outputs, file).toEqual({
        any: "true",
        code: "true",
        app: "false",
      });
    }
  });

  it("are all of them for the app, a dependency, a config or a kind of file nobody listed", () => {
    for (const file of [
      "src/app/page.tsx",
      "package.json",
      "eslint.config.mjs",
      "Makefile",
      "notes.mdx",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      expect(since(repo, base).outputs, file).toEqual(ALL);
    }
  });

  it("measure a pull request from its base, asking GitHub nothing", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, base);
    expect(done.status).toBe(0);
    expect(done.out).toContain(`Measured from ${base}.`);
    expect(called(done, "gh")).toEqual([]);
  });

  it("measure main from the head of this workflow's last green push run", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, "", {
      GITHUB_EVENT_NAME: "push",
      GH_TOKEN: "token",
      STUB_GREEN: base,
    });
    expect(done.outputs.any).toBe("false");
    expect(called(done, "gh")).toEqual([
      [
        "api",
        "repos/owner/scheduler/actions/workflows/fly-deploy.yml/runs?branch=main&event=push&status=success&per_page=1",
        "--jq",
        ".workflow_runs[0].head_sha // empty",
      ],
    ]);
  });

  // The push before may have failed: its change stays inside the diff until a run passes.
  it("still count a change from a push before this one that never went green", () => {
    const { repo, base } = repoWith(
      { "src/app/page.tsx": "broken" },
      { "README.md": "notes on top" },
    );
    const push = { GITHUB_EVENT_NAME: "push", GH_TOKEN: "token" };
    expect(since(repo, "", { ...push, STUB_GREEN: base }).outputs).toEqual(ALL);
  });

  it("are all of them when GitHub cannot be asked or knows no green run", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    const push = { GITHUB_EVENT_NAME: "push", GH_TOKEN: "token" };
    const silent: Env[] = [{ STUB_GH_DOWN: "1" }, { STUB_GREEN: "" }];
    for (const env of silent) {
      const done = since(repo, "", { ...push, ...env });
      expect(done.status, JSON.stringify(env)).toBe(0);
      expect(done.outputs).toEqual(ALL);
      expect(done.out).toContain("Measured from nothing, so every check runs.");
    }
  });

  it("are all of them on a manual run, and from a base git does not hold", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    const manual = since(repo, "", { GITHUB_EVENT_NAME: "workflow_dispatch" });
    expect(manual.outputs).toEqual(ALL);
    expect(called(manual, "gh")).toEqual([]);
    const lost = since(repo, UNKNOWN);
    expect(lost.status).toBe(0);
    expect(lost.outputs).toEqual(ALL);
  });
});

describe("what a push changes of the live release", () => {
  const NOTHING = { release: "false", backup: "false" };
  const EVERYTHING = { release: "true", backup: "true" };
  /** `tag` is what Fly names as live, or null when Fly cannot be asked. */
  const since = (repo: string, tag: string | null, event = "push") =>
    run(
      "changed-since-live",
      {
        FLY_API_TOKEN: "token",
        GITHUB_EVENT_NAME: event,
        STUB_TAG: tag ?? "",
        STUB_FLY_DOWN: tag === null ? "1" : "",
      },
      repo,
    );

  it("is nothing for tests, docs, workflows, notes and the tools' configs", () => {
    const { repo, base } = repoWith({
      "tests/unit/guest.test.ts": "another test",
      "docs/img/login.png": "another picture",
      ".github/workflows/fly-deploy.yml": "another workflow",
      ".github/scripts/new.sh": "a script",
      "README.md": "other notes",
      "vitest.config.mts": "changed",
      Makefile: "changed",
      ".env.example": "changed",
      "knip.json": "changed",
    });
    const done = since(repo, `sha-${base}`);
    expect(done.status).toBe(0);
    expect(done.outputs).toEqual(NOTHING);
    expect(done.out).toContain(
      `::notice::Nothing in the image changed since ${base}, so there is nothing to release.`,
    );
  });

  it("asks Fly for the image that is live, by the committed config", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    expect(called(since(repo, `sha-${base}`), "flyctl")).toEqual([
      ["image", "show", "--config", "fly.toml.example", "--json"],
    ]);
  });

  it("is a release without a backup for a page, a picture, a dependency or the linter's config", () => {
    for (const file of [
      "src/app/page.tsx",
      "public/logo-mark.svg",
      "package.json",
      "eslint.config.mjs",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      const done = since(repo, `sha-${base}`);
      expect(done.outputs, file).toEqual({ release: "true", backup: "false" });
      expect(done.out).not.toContain("::notice::");
    }
  });

  it("is a release behind a backup for the database module, the image's recipe, its boot or the mount", () => {
    for (const file of [
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      expect(since(repo, `sha-${base}`).outputs, file).toEqual(EVERYTHING);
    }
  });

  // A failed or superseded run released nothing, so its change is still owed.
  it("is measured from what is live, so an unreleased commit before this one still counts", () => {
    const { repo, base } = repoWith(
      { "src/lib/db.ts": "changed" },
      { "README.md": "notes on top" },
    );
    expect(since(repo, `sha-${base}`).outputs).toEqual(EVERYTHING);
  });

  it("is everything on a manual run, whatever the commit holds", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, `sha-${base}`, "workflow_dispatch");
    expect(done.outputs).toEqual(EVERYTHING);
  });

  it("is everything when Fly cannot be asked, names no commit, or names one git lacks", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    for (const tag of [null, "", "deployment-01ABC", `sha-${UNKNOWN}`]) {
      const done = since(repo, tag);
      expect(done.status, String(tag)).toBe(0);
      expect(done.outputs, String(tag)).toEqual(EVERYTHING);
    }
  });

  it("does not run without Fly's token, so a missing secret is not read as a release", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    const done = run(
      "changed-since-live",
      { FLY_API_TOKEN: "", GITHUB_EVENT_NAME: "push" },
      repo,
    );
    expect(done.status).not.toBe(0);
    expect(done.outputs).toEqual({});
    expect(called(done, "flyctl")).toEqual([]);
  });
});

describe("the checks of a change", () => {
  const ALWAYS = ["format:check", "knip", "test"];
  const ALL = [...ALWAYS, "lint", "typecheck", "typecheck:tests"].sort();
  const ran = (done: Run) =>
    called(done, "npm")
      .map(([verb, name]) => (verb === "run" ? name : verb))
      .sort();

  it("are all six unless an answer says plainly that one is not needed", () => {
    const answers: Env[] = [{}, { CODE: "true", APP: "true" }, { CODE: "" }];
    for (const env of answers) {
      const done = run("checks", env);
      expect(done.status, JSON.stringify(env)).toBe(0);
      expect(ran(done)).toEqual(ALL);
    }
  });

  // All at once they took the cores from the suite's slowest file on GitHub and the step got no shorter.
  it("run the static ones in turn beside the suite, which leaves them a core", () => {
    const done = run("checks", { STUB_SLOW: "1" });
    expect(done.status).toBe(0);
    const calls = called(done, "npm");
    expect(
      calls.map(([, name]) => name).filter((name) => name !== "test"),
    ).toEqual(["format:check", "knip", "lint", "typecheck:tests", "typecheck"]);
    expect(existsSync(path.join(done.io, "overlapped"))).toBe(false);
    expect(calls.find(([, name]) => name === "test")).toEqual([
      "run",
      "test",
      "--",
      expect.stringMatching(/^--maxWorkers=[1-9]\d*$/),
    ]);
  });

  it("leave out the linter and both typechecks for a change that holds no code", () => {
    const done = run("checks", { CODE: "false", APP: "false" });
    expect(done.status).toBe(0);
    expect(ran(done)).toEqual(ALWAYS);
  });

  it("leave out the app's typecheck alone for a change to the tests", () => {
    const done = run("checks", { CODE: "true", APP: "false" });
    expect(done.status).toBe(0);
    expect(ran(done)).toEqual(ALL.filter((name) => name !== "typecheck"));
  });

  it("show the suite as it runs and each other check whole, in a group of its own", () => {
    const done = run("checks");
    expect(done.out).toContain("words of test\n");
    for (const name of ALL.filter((check) => check !== "test"))
      expect(done.out, name).toContain(
        `::group::npm run ${name}: passed\nwords of ${name}\n::endgroup::\n`,
      );
    expect(done.out).not.toContain("::error::");
  });

  it("fail when any one of them does, the others still run and shown", () => {
    for (const name of ALL) {
      const done = run("checks", { STUB_NPM_FAILS: name });
      expect(done.status, name).toBe(1);
      expect(ran(done)).toEqual(ALL);
      expect(done.out.match(/::group::npm run [\w:]+: passed/g)).toHaveLength(
        name === "test" ? 5 : 4,
      );
      if (name === "test") continue;
      expect(done.out).toContain(`::group::npm run ${name}: failed\n`);
      expect(done.out).toContain(`::error::npm run ${name} failed.\n`);
    }
  });

  it("name every check that failed, not the first alone", () => {
    const done = run("checks", { STUB_NPM_FAILS: "knip typecheck" });
    expect(done.status).toBe(1);
    expect(done.out.match(/::error::npm run [\w:]+ failed\./g)).toEqual([
      "::error::npm run knip failed.",
      "::error::npm run typecheck failed.",
    ]);
  });
});

describe("the sandbox", () => {
  const script = (name: string, body: string) =>
    writeFileSync(
      path.join(dir, "workspace/.github/scripts", `${name}.sh`),
      body,
    );
  const PROBE = `env | cut -d= -f1 | grep -v ^STUB_ | sort | tr '\\n' ' '
echo
pwd
printf 'given<%s>\\n' "$GIVEN"
cat
exit "\${CODE:-0}"`;

  it("runs the script in a copy of the checkout, from an empty environment plus what was named", () => {
    script("probe", PROBE);
    const done = run(
      "sandbox",
      { SANDBOX_ENV: "GIVEN", GIVEN: "kept", WITHHELD: "left" },
      dir,
      {
        args: ["probe.sh"],
      },
    );
    expect(done.status).toBe(0);
    const [names, cwd] = done.stdout.split("\n");
    expect(names.trim().split(" ")).toEqual(
      expect.arrayContaining([
        "CI",
        "GITHUB_ACTIONS",
        "GITHUB_WORKSPACE",
        "GIVEN",
        "HOME",
        "PATH",
        "RUNNER_TEMP",
        "TMPDIR",
      ]),
    );
    for (const name of [
      "WITHHELD",
      "GITHUB_OUTPUT",
      "GITHUB_SHA",
      "SANDBOX_ENV",
    ])
      expect(names.trim().split(" ")).not.toContain(name);
    expect(realpathSync(cwd)).toBe(
      realpathSync(path.join(dir, "sandbox/work")),
    );
  });

  it("hands a value over whole, in a file and on no command line", () => {
    script("probe", PROBE);
    const GIVEN = `it's "quoted" $HOME \`tick\` and\na second line`;
    const done = run("sandbox", { SANDBOX_ENV: "GIVEN", GIVEN }, dir, {
      args: ["probe.sh"],
    });
    expect(done.stdout).toContain(`given<${GIVEN}>\n`);
    expect(done.calls.flat().join(" ")).not.toContain("quoted");
    expect(called(done, "sudo")).toContainEqual([
      "install",
      "-m",
      "600",
      "-o",
      "sandbox",
      "-g",
      "sandbox",
      "/dev/stdin",
      path.join(dir, "sandbox/home/.env"),
    ]);
    expect(existsSync(path.join(dir, "sandbox/home/.env"))).toBe(false);
  });

  it("passes the script's input, output and exit code through, adding no word of its own", () => {
    script("probe", PROBE);
    const done = run("sandbox", { SANDBOX_ENV: "CODE", CODE: "7" }, dir, {
      args: ["probe.sh"],
      input: "what came in\n",
    });
    expect(done.status).toBe(7);
    expect(done.stdout.split("\n").slice(2).join("\n")).toBe(
      "given<>\nwhat came in\n",
    );
  });

  it("keeps what the script writes out of the checkout, and the tools' caches out of the copy", () => {
    script("scribble", "touch added && ls -A node_modules");
    for (const made of [
      "node_modules/.vite/results.json",
      "node_modules/.bin/tool",
      "node_modules/pkg/index.js",
    ]) {
      mkdirSync(path.dirname(path.join(dir, "workspace", made)), {
        recursive: true,
      });
      writeFileSync(path.join(dir, "workspace", made), "x");
    }
    const done = run("sandbox", {}, dir, { args: ["scribble.sh"] });
    expect(done.status).toBe(0);
    expect(done.stdout.trim().split("\n").sort()).toEqual([".bin", "pkg"]);
    expect(existsSync(path.join(dir, "sandbox/work/added"))).toBe(true);
    expect(existsSync(path.join(dir, "workspace/added"))).toBe(false);
    expect(existsSync(path.join(dir, "workspace/node_modules/.vite"))).toBe(
      true,
    );
  });

  it("ends whatever the user left running, before and after", () => {
    script("probe", PROBE);
    const sudo = called(
      run("sandbox", {}, dir, { args: ["probe.sh"] }),
      "sudo",
    );
    const kill = ["pkill", "-KILL", "-u", "sandbox"];
    expect(sudo[0]).toEqual(kill);
    expect(sudo.at(-1)).toEqual(kill);
    expect(sudo.at(-2)?.slice(0, 4)).toEqual(["-u", "sandbox", "env", "-i"]);
  });

  it("takes the name of a script here, names of variables, and a runner, or does nothing", () => {
    script("probe", PROBE);
    const refused: [string[], Env][] = [
      [[], {}],
      [["../probe.sh"], {}],
      [["probe"], {}],
      [["probe.sh"], { SANDBOX_ENV: "GIVEN; rm -rf /" }],
      [["probe.sh"], { GITHUB_ACTIONS: "" }],
    ];
    for (const [args, env] of refused) {
      const done = run("sandbox", env, dir, { args });
      expect(done.status, JSON.stringify([args, env])).not.toBe(0);
      expect(called(done, "sudo")).toEqual([]);
    }
  });
});

describe("the image behind the checks", () => {
  const env = { FLY_API_TOKEN: "token", IMAGE_LABEL: `sha-${SHA}` };
  const behind = (extra: Env = {}) => {
    const start = run("image-in-background", { ...env, ...extra }, dir, {
      args: ["start"],
    });
    expect(start.status).toBe(0);
    const wait = run("image-in-background", {}, dir, { args: ["wait"] });
    return {
      wait,
      built: callsIn(start.io).filter(([tool]) => tool === "flyctl"),
    };
  };

  it("is built while the job goes on, and the wait ends on its success with its log", () => {
    const { wait, built } = behind();
    expect(wait.status).toBe(0);
    expect(built.map(([, verb]) => verb)).toEqual(["deploy"]);
  });

  it("returns at once from the start, saying where the result will be read", () => {
    const start = run("image-in-background", env, dir, { args: ["start"] });
    expect(start.status).toBe(0);
    expect(start.out).toContain("building behind the checks");
    expect(run("image-in-background", {}, dir, { args: ["wait"] }).status).toBe(
      0,
    );
  });

  it("fails the wait, with the builder's words, when the build failed", () => {
    const { wait, built } = behind({
      STUB_BUILD_FAILS: "1",
      STUB_BUILD_ERROR: "Type error: Property 'x' does not exist",
    });
    expect(wait.status).toBe(1);
    expect(wait.out).toContain("Type error: Property 'x' does not exist");
    expect(built).toHaveLength(1);
  });

  it("fails the wait when the build is gone and left no result", () => {
    writeFileSync(path.join(dir, "image.pid"), "99999999");
    writeFileSync(path.join(dir, "image.log"), "the builder's last line\n");
    const done = run("image-in-background", {}, dir, { args: ["wait"] });
    expect(done.status).toBe(1);
    expect(done.out).toContain("the builder's last line");
    expect(done.out).toContain("::error::The image build stopped");
  });

  it("does not start without the token or the label, and takes start or wait alone", () => {
    for (const missing of ["FLY_API_TOKEN", "IMAGE_LABEL"]) {
      const done = run("image-in-background", { ...env, [missing]: "" }, dir, {
        args: ["start"],
      });
      expect(done.status, missing).not.toBe(0);
    }
    expect(run("image-in-background", env).status).toBe(2);
    expect(
      run("image-in-background", env, dir, { args: ["stop"] }).status,
    ).toBe(2);
  });
});

describe("the image build", () => {
  const env = { FLY_API_TOKEN: "token", IMAGE_LABEL: `sha-${SHA}` };
  const dropped = (done: Run) =>
    done.out.match(/::warning::The builder dropped the connection[^\n]+/g);

  it("builds and pushes the image under this commit's label", () => {
    const done = run("build-image", env);
    expect(done.status).toBe(0);
    expect(called(done, "flyctl")).toEqual([
      [
        "deploy",
        "--build-only",
        "--push",
        "--remote-only",
        "--image-label",
        `sha-${SHA}`,
        "--config",
        "fly.toml.example",
      ],
    ]);
    expect(called(done, "sleep")).toEqual([]);
  });

  it("tries again when the builder drops the connection, with a warning each time", () => {
    for (const STUB_BUILD_ERROR of [
      "rpc error: code = Unavailable desc = closing",
      "error reading from server: EOF",
    ]) {
      const done = run("build-image", {
        ...env,
        STUB_BUILD_FAILS: "2",
        STUB_BUILD_ERROR,
      });
      expect(done.status, STUB_BUILD_ERROR).toBe(0);
      expect(called(done, "flyctl")).toHaveLength(3);
      expect(dropped(done)).toEqual([
        "::warning::The builder dropped the connection (attempt 1 of 3), retrying.",
        "::warning::The builder dropped the connection (attempt 2 of 3), retrying.",
      ]);
      expect(called(done, "sleep")).toEqual([["20"], ["20"]]);
    }
  });

  it("fails at once on a real build error, showing it", () => {
    const done = run("build-image", {
      ...env,
      STUB_BUILD_FAILS: "1",
      STUB_BUILD_ERROR: "Type error: Property 'x' does not exist",
    });
    expect(done.status).toBe(1);
    expect(done.out).toContain("Type error: Property 'x' does not exist");
    expect(called(done, "flyctl")).toHaveLength(1);
    expect(called(done, "sleep")).toEqual([]);
  });

  it("fails once the connection has dropped three times", () => {
    const done = run("build-image", { ...env, STUB_BUILD_FAILS: "3" });
    expect(done.status).toBe(1);
    expect(called(done, "flyctl")).toHaveLength(3);
    expect(dropped(done)).toHaveLength(3);
  });

  it("does not run without the token or the label", () => {
    for (const missing of ["FLY_API_TOKEN", "IMAGE_LABEL"]) {
      const done = run("build-image", { ...env, [missing]: "" });
      expect(done.status, missing).not.toBe(0);
      expect(called(done, "flyctl")).toEqual([]);
    }
  });
});

describe("the purge of the edge", () => {
  const env = { CF_ZONE_ID: "zone", CF_API_TOKEN: "token" };

  it("asks Cloudflare to drop the booking page alone, as a bearer of the token", () => {
    const done = run("purge-cache", env);
    expect(done.status).toBe(0);
    expect(called(done, "curl")).toEqual([
      [
        "--fail-with-body",
        "-sS",
        "-X",
        "POST",
        "https://api.cloudflare.com/client/v4/zones/zone/purge_cache",
        "-H",
        "Authorization: Bearer token",
        "-H",
        "Content-Type: application/json",
        "--data",
        '{"files":["https://scheduler.innospacetirana.com/"]}',
      ],
    ]);
  });

  it("passes, asking nothing, until the zone and the token are both set", () => {
    for (const missing of ["CF_ZONE_ID", "CF_API_TOKEN"]) {
      const done = run("purge-cache", { ...env, [missing]: "" });
      expect(done.status, missing).toBe(0);
      expect(done.out).toContain("not set, skipping purge.");
      expect(called(done, "curl")).toEqual([]);
    }
  });

  it("fails when Cloudflare refuses", () => {
    expect(run("purge-cache", { ...env, STUB_PURGE: "22" }).status).toBe(22);
  });
});

describe("the release's name", () => {
  const env = { COUCH_GAG_URL: "https://gag.example", COUCH_GAG_KEY: "key" };
  const reply = (slug: string) =>
    JSON.stringify({ sequence: 17, slug, name: "Bart the Genius" });

  it("is the episode couch-gag gives this repository's commit", () => {
    const done = run("release-name", {
      ...env,
      STUB_REPLY: reply("bart-the-genius"),
    });
    expect(done.status).toBe(0);
    expect(done.outputs).toEqual({
      tag: "r17-bart-the-genius",
      title: "Bart the Genius",
    });
    const [args] = called(done, "curl");
    expect(args).toContain("Authorization: Bearer key");
    expect(args.at(-1)).toBe("https://gag.example/v1/releases");
    expect(JSON.parse(args[args.indexOf("-d") + 1])).toEqual({
      repo: "owner/scheduler",
      ref: SHA,
    });
  });

  it("fails, asking nothing, while the address or the key is not set", () => {
    for (const missing of ["COUCH_GAG_URL", "COUCH_GAG_KEY"]) {
      const done = run("release-name", { ...env, [missing]: "" });
      expect(done.status, missing).not.toBe(0);
      expect(done.outputs).toEqual({});
      expect(called(done, "curl")).toEqual([]);
    }
  });

  it("is never made of an answer that is not a release, or of none", () => {
    for (const STUB_REPLY of [
      reply("Bart; rm -rf"),
      '{"error":"forbidden"}',
      "",
    ]) {
      const done = run("release-name", { ...env, STUB_REPLY });
      expect(done.status, STUB_REPLY).not.toBe(0);
      expect(done.outputs).toEqual({});
    }
  });
});

describe("the release's description", () => {
  const env = {
    GH_TOKEN: "token",
    TAG: "r17-bart-the-genius",
    RULES: "Write the description.",
    COPILOT_CLI: "1.0.114",
    STUB_PREVIOUS: "r16-homers-odyssey",
    STUB_CHANGES:
      "Commits:\n- feat: a new screen\n\nFiles changed:\nadded a.ts (+1 -0)",
    STUB_DRAFT: "It adds a screen.\n\n### Changes\n- A new screen",
  };
  const notes = () => path.join(dir, "notes.md");

  // Its package is fetched fresh on each release, into a job that holds the keys to the machine.
  it("is asked of Copilot as the sandbox's user, handed the token and the rules and none of the job's keys", () => {
    const done = run("release-notes", {
      ...env,
      GH_TOKEN: "gh-secret-value",
      FLY_API_TOKEN: "fly-secret-value",
      R2_SECRET_ACCESS_KEY: "r2-secret-value",
    });
    expect(done.status).toBe(0);
    const names = text(path.join(done.io, "copilot.env")).split("\n");
    expect(names).toEqual(
      expect.arrayContaining(["GH_TOKEN", "RULES", "COPILOT_CLI", "HOME"]),
    );
    for (const name of ["FLY_API_TOKEN", "R2_SECRET_ACCESS_KEY", "TAG"])
      expect(names).not.toContain(name);
    expect(called(done, "sudo").map(([verb]) => verb)).toContain("-u");
    // Every user can list a command line, so the token is on none.
    expect(done.calls.flat().join(" ")).not.toContain("gh-secret-value");
  });

  it("is Copilot's wording of the commits since the last release, kept for the release and the summary", () => {
    const done = run("release-notes", env);
    expect(done.status).toBe(0);
    expect(readFileSync(notes(), "utf8")).toBe(env.STUB_DRAFT);
    expect(done.summary).toBe(env.STUB_DRAFT);
    expect(called(done, "gh").map((args) => args[1])).toEqual([
      "view",
      "repos/owner/scheduler/releases/latest",
      `repos/owner/scheduler/compare/r16-homers-odyssey...${SHA}`,
    ]);
    expect(called(done, "npm")).toEqual([
      [
        "install",
        "--global",
        "--silent",
        "--no-audit",
        "--no-fund",
        "@github/copilot@1.0.114",
      ],
    ]);
  });

  it("hands Copilot the rules and the changes, no tools and an empty folder", () => {
    const done = run("release-notes", env);
    expect(called(done, "copilot")).toEqual([
      ["-p", `${env.RULES}\n\n${env.STUB_CHANGES}`, "-s", "--available-tools="],
    ]);
    const [cwd, ...files] = text(path.join(done.io, "copilot.cwd"))
      .split("\n")
      .filter(Boolean);
    expect(files).toEqual([]);
    expect(cwd).toContain(path.join("sandbox", "tmp"));
  });

  it("is worded from the last commits when no release came before", () => {
    const done = run("release-notes", { ...env, STUB_PREVIOUS: "" });
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)?.[1]).toBe(
      `repos/owner/scheduler/commits?sha=${SHA}&per_page=20`,
    );
    expect(existsSync(notes())).toBe(true);
  });

  it("is not asked for without a tag, for a release that exists, or for no new commit", () => {
    const quiet: Env[] = [
      { TAG: "" },
      { STUB_EXISTS: "1" },
      { STUB_CHANGES: "Commits:\n" },
    ];
    for (const change of quiet) {
      const done = run("release-notes", { ...env, ...change });
      expect(done.status, JSON.stringify(change)).toBe(0);
      expect(called(done, "copilot")).toEqual([]);
      expect(called(done, "npm")).toEqual([]);
      expect(existsSync(notes())).toBe(false);
    }
  });

  it("fails, leaving no notes, when Copilot writes nothing", () => {
    const done = run("release-notes", { ...env, STUB_DRAFT: "" });
    expect(done.status).toBe(1);
    expect(done.out).toContain("::warning::Copilot wrote nothing");
    expect(existsSync(notes())).toBe(false);
    expect(done.summary).toBe("");
  });
});

describe("the tag and the GitHub release", () => {
  const env = {
    GH_TOKEN: "token",
    TAG: "r17-bart-the-genius",
    TITLE: "Bart the Genius",
  };
  const create = [
    "release",
    "create",
    "r17-bart-the-genius",
    "--repo",
    "owner/scheduler",
    "--target",
    SHA,
    "--title",
    "Bart the Genius",
    "--generate-notes",
  ];

  it("are made with GitHub's own list when Copilot left no words", () => {
    const done = run("release-create", env);
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual(create);
  });

  it("carry Copilot's words above that list when it wrote some", () => {
    const words = "It adds a screen.\n\n### Changes\n- A new screen";
    writeFileSync(path.join(dir, "notes.md"), words);
    const done = run("release-create", env);
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual([...create, "--notes", words]);
  });

  it("are not made twice", () => {
    const done = run("release-create", { ...env, STUB_EXISTS: "1" });
    expect(done.status).toBe(0);
    expect(done.out).toContain("already exists");
    expect(called(done, "gh")).toHaveLength(1);
  });

  // The Copilot step may fail and the job goes on, so the release is made from the name alone.
  it("follow a description that failed: the three scripts in a row still end in a release", () => {
    const name = run("release-name", {
      COUCH_GAG_URL: "https://gag.example",
      COUCH_GAG_KEY: "key",
      STUB_REPLY: JSON.stringify({
        sequence: 17,
        slug: "bart-the-genius",
        name: "Bart the Genius",
      }),
    });
    const described = run("release-notes", {
      GH_TOKEN: "token",
      TAG: name.outputs.tag,
      RULES: "Write the description.",
      COPILOT_CLI: "1.0.114",
      STUB_CHANGES: "Commits:\n- feat: a new screen",
      STUB_DRAFT: "",
    });
    expect(described.status).toBe(1);
    const done = run("release-create", {
      GH_TOKEN: "token",
      TAG: name.outputs.tag,
      TITLE: name.outputs.title,
    });
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual(create);
  });
});
