> Historical/general Together local route. For this public Builder edition, start with [README.md](README.md) and [BUILDER-ENTRY.md](BUILDER-ENTRY.md). References to a private source candidate below describe its earlier preparation.

# Together

Together keeps a project’s conversation, tasks, code changes, checks and reviews in one place. Agents use MCP. The person working alongside them uses the browser. Both see the same records.

**Builder Agent-Native entry:** start with [BUILDER-ENTRY.md](BUILDER-ENTRY.md) for the new shared-action workroom, its separate installation steps and the measured proof. The instructions below describe the preserved Together RC3 route.

This is a private source release candidate. Use Node.js 22.13+ and Git; development uses Node 22.23.1. No Cloudflare account or model-provider key is needed for the first-use steps below.

## Install and open

Clone the private repository or unpack the source ZIP, then enter its folder:

```sh
npm ci
npm start
```

Keep that terminal open. Open the **local-login URL printed by the launcher**. Together chooses free loopback ports and sets a private browser cookie. There is no token to paste. Installation builds the MCP adapter automatically.

Starting without `.env` is supported for this key-free walkthrough. A message that `.env` was not found, or Node’s SQLite `ExperimentalWarning`, does not by itself mean startup failed; use the printed URL and any actual error to judge the result. An npm dependency deprecation warning is also different from a failed installation.

## Connect your agent

In a second terminal, in the same Together folder:

```sh
npm run --silent agent:setup -- --name "My agent" --host claude
```

Use `--host codex` for Codex, or `--host other` for another MCP client. Setup creates a project-scoped private connection valid for 30 days and prints its `configPath` and native MCP configuration. It does not change global host settings or start a model.

The registration contains absolute paths to this checkout, its generated adapter and the Node executable currently running setup. Node may resolve a toolchain symlink to its real installation path. Keep those paths stable during the trial: moving the checkout or replacing the toolchain can break a native registration, and setup does not migrate private file paths or edit host registration for you. For a still-valid saved connection, rerunning setup with the same name, host and profile prints the current registration; update the native host deliberately if its paths changed. The CLI examples below use the current Node installation.

Use the printed path in place of `CONFIG`:

```sh
npm run --silent agent -- CONFIG list
npm run --silent agent -- CONFIG together_project '{}'
npm run --silent agent -- CONFIG together_post_message '{"channel":"team","body":"I have connected through MCP.","clientRequestId":"first-hello-1"}'
```

Open **Talk to the crew → Team**. That message should appear under your agent’s name: an actual MCP call and the same saved message in the browser. The CLI uses the MCP SDK and Together’s existing stdio adapter. It works in a session that cannot reload its tool list. Native host registration is optional and deliberate; use the printed configuration when you want it.

## Give it work

Follow [USAGE.md](USAGE.md) to create and claim the first task, edit the small generated Git workspace, submit an exact candidate, and run its fixed check in the browser. The default `work` profile can report progress, submit changes, record findings and review exact candidates. It cannot administer identities, integrate code, start models or execute arbitrary host commands. Use `--profile chat` for conversation-only access. External agents keep their own harness and model access; an MCP connection does not verify their provider.

The optional **NVIDIA Nemotron** panel is separate. It needs a private Nebius key configuration and explicit actions. Its demo permits one small coding attempt, one fixed Node check and inspection of the actual diff/output. A failed result stays visible and unmerged. It is not a general code sandbox. See [USAGE.md](USAGE.md) before enabling it; installation and the steps above make no Nebius calls.

## Come back later

`.runtime/local/` holds this installation’s saved project and credentials and stays out of Git. Ctrl-C stops its servers. Starting again reopens the same project. Run `agent:setup` again with the same name, host and profile if free ports changed; it refreshes the address and reuses the same identity, session and credential. Expired or revoked access remains denied, rather than silently being replaced.

Refreshing the address does **not** restart the credential’s 30-day clock. Reused setup reports the original cached enrollment expiry if available. An older config reports `expiresAt: "unknown"`; this means the date is unreported, not that access never expires. Retain the original setup expiry. Task claims have their own shorter leases, explained in [USAGE.md](USAGE.md#claim-duration-and-progress).

Chat reads also resume their saved acknowledged position. An older message missing from the next page does not mean it was deleted. Use `together_read_messages` with `{"channel":"team","after":0,"limit":2}` to reread the history your identity is authorized to see, then pass each returned `nextCursor` as `after`; see [USAGE.md](USAGE.md#read-the-shared-context).

If the initial connection check fails, restore the server connection and retry the same setup command. If setup reports an interrupted operation after identity creation may have begun, retain its private `.pending` record and inspect the existing identity/enrollment before continuing; automatic recovery is not implemented. Do not delete the record or change names merely to bypass an unknown outcome.

Fixed ports and another saved workspace are optional:

```sh
npm start -- --port 19130 --api-port 19139 --state-dir /absolute/owned/workspace
# In the second terminal, use the same state directory:
npm run --silent agent:setup -- --name "My agent" --host claude --state-dir /absolute/owned/workspace
```

Run `npm run typecheck`, `npm run build` and `npm test` to check the source. [VERIFICATION.md](VERIFICATION.md) explains offline fixtures and explicit optional-test requirements.

MIT licensed. Keep [LICENSE](LICENSE), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), dependency notices and artwork provenance. [PROVENANCE.md](PROVENANCE.md) records the source lineage. `private:true` prevents accidental npm publication; GitHub visibility is managed separately.
