# Together — Agent-Native Workroom

What happens when you change your mind while an AI agent is working?

This workroom keeps the request, conversation, code change and check result together. When someone changes the brief, a write based on the old version is refused. The agent reads the updated request before trying again.

Built by Stephen Luc and the Misfit Circuit crew for the **Builder Agent-Native Hackathon, October–November 2026**.

**Watch the demo:** [Public Clips recording](https://clips.agent-native.com/share/rbFiE3ltmy7v) · [YouTube, 2:18](https://youtu.be/kMf21rI274U)

## Which Together is this?

Together is our existing collaboration project. This repository contains its **Builder Agent-Native Workroom edition**. Other Together entries share an earlier foundation; this entry adds the Workroom, shared Agent-Native actions and checks against outdated task versions. Those additions began October 27, 2026. The earlier collaboration engine and coding exercise are pre-existing work.

The demo follows one small coding task. It shows an outdated write being refused, the agent reading the revised request, and the resulting code with **10 passing checks**. The recording shows a saved October 28 run reopened October 29; it is not a new live run each time someone plays it.

## Try it locally

Use **Node.js 22.22 or newer** and Git:

```sh
git clone https://github.com/sleepficus/together-builder-workroom.git
cd together-builder-workroom
npm run install:builder
npm run start:builder
```

Open the local-login URL printed in the terminal. No provider key or model call is needed to open the app. Connecting an agent uses your existing MCP client and model access; sharing a request does not launch an agent automatically.

[Installation and agent setup](BUILDER-ENTRY.md) · [Measured verification](BUILDER-VERIFICATION.md) · [Source history and attribution](PROVENANCE.md)

## How it works

The browser and the agent’s MCP tools use the same validated actions through `@agent-native/core@0.221.0`. Together retains its existing local storage and authorization. Writes check the task version and assignment before changing the file. The result keeps the candidate diff and real check output together.

This demonstration has three readable workspace files, one editable file and a fixed Node check. It does not offer arbitrary shell access, automatically merge changes or provide a general code sandbox. A passing check is evidence about that check, not an independent approval.

## Check the source

```sh
npm run test:builder
npm run typecheck
npm run build
```

[Verification details and limits](BUILDER-VERIFICATION.md) record the original builder tests and independent review. The broader inherited Together route is documented in [TOGETHER-LOCAL.md](TOGETHER-LOCAL.md).

Private state and credentials stay outside this source folder in `../private/builder-state` by default. Do not commit that folder or private MCP connection files.

## License

[MIT](LICENSE): free to use, modify and distribute, including commercially, with the required notices. Dependency licenses and artwork provenance are retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
