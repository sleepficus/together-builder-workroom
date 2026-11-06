# Together — Agent-Native Workroom

This branch extends Together with a focused workroom for people and agents. The browser and MCP client call the same validated actions against the same project records.

**Build status:** installed locally, builder-tested and independently exercised by Main Chad on October 28, 2026. A fresh Codex participant used actual HTTP MCP actions; the browser shows its code and real check result. See [BUILDER-VERIFICATION.md](BUILDER-VERIFICATION.md) for the measured scope and limits.

## What this entry adds

- A new `/builder` workroom for the request, conversation and result.
- Real `@agent-native/core@0.221.0` action definitions shared by an authenticated browser bridge and the framework's official MCP transport.
- Task-revision checks before an agent writes or verifies a change, so revised requirements require a fresh read.
- A separate local startup/state directory for this entry.

This is a bounded local coding demonstration, using the existing check-summary helper exercise. It does not provide arbitrary host shell access or a general multi-provider coding service. A task claim records ownership; it does not establish active model inference. The external agent supplies its own model/harness.

## Install and open

Use Node.js **22.22 or newer** and Git. From this source folder:

```sh
npm run install:builder
npm run start:builder
```

Keep the terminal open and open the printed **local-login** URL. The launcher chooses free loopback ports, signs the browser into this installation, and opens the Workroom. Private records and credentials live in `../private/builder-state`, outside the source folder. No model starts and no provider key is needed for installation.

Enter a request such as:

> Implement summarizeChecks(records) in summary.mjs using the workspace brief and frozen tests. Preserve unknown checks as not-checked, do not mutate the input, and report the real check result.

Click **Share the request**. This saves the task for a connected agent; it does not launch one. Leave the visible acceptance defaults or edit them for this exercise.

## Connect an existing agent

In another terminal, from the same source folder:

```sh
npm run builder:agent:setup -- --name "My agent" --host codex \
  --state-dir ../private/builder-state
```

Use `claude` or `other` for the corresponding host. Setup returns a private `.http-mcp.json` path without printing the bearer token. It grants one project, eight scopes, and 30 days; it does not register global tools, start a model, or grant owner/admin/integration access. Keep that config and its credential file private. Use the emitted HTTP-config path in place of `CONFIG`:

```sh
npm run --silent builder:agent -- CONFIG list
npm run --silent builder:agent -- --pretty CONFIG read_context '{}'
```

The CLI uses the official MCP SDK against the real framework HTTP transport. It performs one deliberate invocation, with no automatic retry after an uncertain outcome. A native MCP host may connect to the same endpoint with the scoped credential using its supported private configuration; this package does not silently modify host settings.

Give the connected agent the saved task ID and ask it to discover the tool schemas, read and claim the task, then reread context after claiming. It can read `README.md`, `summary.test.mjs` and `summary.mjs`, edit only `summary.mjs`, and request the fixed check. It must use the current task revision, assignment ID and epoch returned by the server; use fresh operation IDs for new effects and preserve an ID when deliberately retrying that same operation.

Use **Add to the conversation** for discussion and **Change the brief** for a requirement change. A stale write is refused before touching the file. The agent must reread the updated task and reconsider its change. **Result** shows the exact candidate diff and actual check output. A passing check does not merge anything or count as independent review.

## Return, reconnect and recover

Ctrl-C stops this installation; starting it again preserves the project and checks. Rerun setup with the same name, host and state directory if free ports changed: it refreshes the address while retaining identity, credential and original expiry. Expired or revoked access remains refused. Setup does not silently extend a grant. Task claims have a separate shorter lease, reported by `read_context`; an expired claim must be resolved before writing.

For fixed ports or a separate private workspace:

```sh
npm run start:builder -- --port 54414 --api-port 54417 --state-dir /absolute/private/path
```

Use that same state path for setup. Independent Builder installations have separate browser cookies even on the same hostname. Their saved task records and tokens are not shared. A new task does not reset the existing code workspace; use a new private state directory for a fresh exercise.

If a check is interrupted, read its result and preserved records before retrying. An uncertain operation is not a no-effect receipt. This first Workroom lists the latest ten tasks and five verification summaries; it is intended for the bounded demonstration, not a large-project archive browser. Before an agent posts a message, its claim may display a shortened identity ID rather than its name.

Run `npm run test:builder`, `npm run typecheck` and `npm run build` for focused checks. `npm test` includes the broader inherited local suite. The optional Linux Docker test and two optional hosted-OAuth test files are not part of the local first-use proof. The optional OpenTelemetry warning means framework tracing is disabled; the shared actions still run. The existing SQLite experimental and Vite large-chunk warnings are retained.

## Existing work disclosure

Baseline: Together `0.1.0-rc.3`, commit `b85564d8032822f385c7b0b41bc36e97ed75740e`. The collaboration engine, tasks/claims, conversation, Git proposal/candidate machinery, check collector, previous UI, local installation and frozen helper exercise existed before this entry. Their source lineage and contributor attribution remain in [PROVENANCE.md](PROVENANCE.md).

The Workroom, Agent-Native integration and revision-aware action path are new development begun October 27, 2026. A diff from the baseline and the final verification record identify the actual implemented changes. No old recording or synthetic sample is presented as a new real-agent run.

## Framework scope

Core is pinned in `agent-native/package.json` and its separate lockfile; Node >=22.22 is required for this entry. The frontend uses an app-owned authenticated HTTP bridge to the same action objects exported by the official MCP transport. This does not claim automatic mounting of the full framework app, native framework chat, A2A, SQL persistence or frontend hooks. Together retains its own existing durable local store and authorization.

## Entry status

The local build was verified October 28. A public [Clips demonstration](https://clips.agent-native.com/share/rbFiE3ltmy7v) is available, with the matching [YouTube video](https://youtu.be/kMf21rI274U). This repository provides the source; it is not a hosted application. Competition submission is a separate step and is not established by publishing this repository.
