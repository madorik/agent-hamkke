# Agent Hamkke

A desktop app where people and their own agents (Claude Code, Codex, …) work together in one channel. Agents discuss with each other and go find material, but each person (the agent's master) decides what leaves their machine and what gets finalized. The name comes from the Korean word *hamkke* (함께), "together".

![Agent Hamkke demo: open a channel, an agent's draft waits for approval, compare document versions, finalize](docs/demo.gif)

<sub>Higher quality: [docs/demo.mp4](docs/demo.mp4). In the demo, Jamie's side and both agents' messages are sent through the relay API so the run is repeatable (`apps/desktop/e2e/demo.mjs`).</sub>

## Download

| Platform | File |
| --- | --- |
| macOS, Apple silicon | [Agent-Hamkke-mac-arm64.dmg](https://github.com/madorik/agent-hamkke/releases/latest/download/Agent-Hamkke-mac-arm64.dmg) |
| macOS, Intel | [Agent-Hamkke-mac-x64.dmg](https://github.com/madorik/agent-hamkke/releases/latest/download/Agent-Hamkke-mac-x64.dmg) |
| Windows (x64) | [Agent-Hamkke-win-x64.exe](https://github.com/madorik/agent-hamkke/releases/latest/download/Agent-Hamkke-win-x64.exe) |

All versions are on the [Releases](https://github.com/madorik/agent-hamkke/releases) page.

- **macOS**: Open the `.dmg` and drag Agent Hamkke to Applications. The app is signed and notarized by Apple.
- **Windows**: The installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**.

To connect an agent, you need [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex) installed and signed in on the same computer. Codex works with a ChatGPT account. You don't need Node.js: the app runs its connector itself.

## Usage

### 1. Get started

Open the app and enter your name. That's your account on this computer. A release build connects to the shared relay at `https://hamkke.watalabs.com`. Run from source, it uses `http://localhost:8787` unless you set `AH_RELAY_URL`. To pick another relay, choose **Change server address** on this screen.

### 2. Open a channel and invite people

On the home screen, describe the work ("Q3 partnership proposal with Jamie's team") and press Enter. A channel opens with that title.

Click **Invite** at the top right to get a 6-character code. The other person chooses **Join with invite code** on their home screen and enters it.

<img src="docs/images/home.png" width="49%" alt="Home: describe the work to open a channel"> <img src="docs/images/invite.png" width="49%" alt="Invite code dialog">

### 3. Connect your agent

Click your name at the bottom left, then **Connect agent**. Next to **Claude Code** or **Codex**, click **Connect**. From then on the app starts that agent for you whenever it's open. You don't need a terminal. You can connect one agent at a time; connecting the other one switches to it.

- **Change folder** sets the folder your agent works in (default: your home folder).
- Pick the model with the model button in the message box.
- Status and errors show here. **View log** opens the full log.

<img src="docs/images/connect-agent.png" width="70%" alt="Settings > Agents: connect an agent">

### 4. Talk in the channel

- Write in the message box to talk to everyone in the channel.
- Type `@` to mention someone. Their agent treats it as a request and looks for the answer with that person's tools (Notion, Jira, files, …), then drafts a reply.
- Turn on **To my agent** to give your agent instructions that no one else sees. While your agent works on your instruction (or on an `@` request to you), a **Working** line shows what it's doing, and its reply appears word by word as it writes. Your agent reacting to ordinary channel chat doesn't show this line.
- Hover over a reply your agent sent only to you and click **Share to channel** to show it to everyone. Hover over a message your agent posted to the channel and click **Unshare** to take it back; it disappears for everyone else and stays visible to you.
- To share a file, use **+ > Upload a file from this computer**, drag it into the channel, or paste an image. Files can be up to 25 MB.

### 5. Approve what your agent sends

Your agent can't post to the channel on its own. Its messages, documents, and files wait above your message box until you decide.

- **Send** posts it as is. **Edit** lets you change it first. **Discard** drops it. With two or more, **Approve all** sends them all.
- When your agent wants to run a tool or command that needs permission (for example, writing to Notion or reaching the network), choose **Allow** or **Deny**. Unanswered requests are denied after 10 minutes.
- **Approvals** in the sidebar shows everything waiting across all channels.
- If you trust your agent, turn on **Always approve all**. While it's on, an **Auto-approve** badge shows in the message box. Click the badge to turn it off.

<img src="docs/images/approve-drafts.png" width="80%" alt="A draft from your agent waiting above the message box">

### 6. Work on documents together

Agents and people post documents as Markdown. Click a document card to open it next to the chat.

- Switch versions at the top (`v1`, `v2`, …). **Compare with previous version** highlights what changed.
- **Edit as a new version** posts your own revision.
- **Finalize this version** records your sign-off. A version is final only when every person in the channel signs off.
- After it's final, **Ask my agent to apply it** has your agent copy it into your Notion or Jira.

<img src="docs/images/document-compare.png" width="80%" alt="Comparing two versions of a document">

### 7. Decisions while you're away

Work shouldn't stop because you stepped out, and your agent shouldn't guess on things only you can decide.

- **Away**: you're marked away after 10 minutes without input or when you lock your screen, and back when you're active again. To set it yourself with a note (In a meeting, Lunch, …), click your name at the bottom left, then **Set yourself as away**. Others see it in the member list and in `@` suggestions.
- **Decisions**: when something needs your judgment (schedule, price, contract, budget, priorities), your agent records it in **Decisions** instead of guessing. Each one has the question, the facts it needs, choices, and who is waiting, and your agent tells that person it's waiting on you. If someone `@`mentions you while your agent is off, the relay records the request there too.
- **Decide in one click**: in **Decisions** in the sidebar, or above the message box of that channel, pick a choice or write your answer. **Tell the channel** (on by default) posts your decision and `@`mentions the person waiting. Your agent receives it and carries on.
- **Back**: when you return, a line shows how long you were away and what's waiting. **Catch me up on this channel** asks your agent for a summary of what you missed, which appears as it's written.

### 8. Meetings

Click the microphone at the top of a channel.

- **Record meeting**: the recording stays on your computer. On a Mac, speech is transcribed live on the device (macOS Dictation must be on; the app shows how to turn it on if it's off). Add notes while you talk.
- **End meeting**: the transcript and your notes are posted to the channel as a document, and your agent writes the minutes (summary, decisions, to-dos with owners, next topics). To-dos for others go out as `@` requests, and anything left for you goes to **Decisions**. Tick **Also post the recording to the channel** to share the audio (up to 25 MB, compressed to m4a on a Mac).
- **Minutes from a transcript**: paste or choose a transcript from Zoom, Teams, Clova Note, etc. (txt, vtt, srt, md) to get minutes the same way.

### 9. Channel settings

Click the stage next to the channel title (**Request**, **Draft**, **Review**, **Final**) to open the channel menu.

- **Stage**: where the work is. Everyone sees the change.
- **Approve agent messages**: on by default. When it's off, agents' messages and documents in this channel go out without waiting for approval. Files an agent posts to the channel still wait for approval.
- **Agent turn limit**: how many messages agents may send in a row before a person has to speak (default 8).
- **My agent takes part**: take your agent out of this channel, or bring it back.
- **Rename**: change the channel title.

<img src="docs/images/channel-settings.png" width="80%" alt="Channel menu with stage and agent settings">

### Settings

Click your name at the bottom left, then **Settings**.

- **General**: theme (System, Light, Dark) and language (한국어, English). Your agent reports to you in the language you pick.
- **Agents**: connect Claude Code or Codex, and turn **Always approve all** on or off.
- **Account**: your name and the server address.

## Layout

```
apps/desktop       Desktop app (Electron + React + Tailwind), ChatGPT-style UI
packages/connector Agent connector: the runner (the app drives Claude Code or Codex directly) + MCP tool server
packages/protocol  Shared types (mirrors src/protocol.ts in the relay repo)
```

The relay server lives in its own repo: [madorik/agent-hamkke-relay](https://github.com/madorik/agent-hamkke-relay). It passes messages, the approval queue, document versions, sign-offs, and permission requests. Production runs at `https://hamkke.watalabs.com` (Vercel + Neon Postgres + Vercel Blob).

Agents run on each person's own computer, and only messages go through the relay. The relay never holds Notion or Jira tokens. Agents use the MCP servers they already have.

## Run

Start the relay from the relay repo:

```bash
cd ../agent-hamkke-relay
npm install
npm run db     # local Postgres (docker compose)
npm run dev    # relay on :8787
```

Then the app:

```bash
pnpm install
pnpm dev       # desktop app, connects to http://localhost:8787
```

The relay URL is `AH_RELAY_URL`. When it is unset, a packaged app uses `https://hamkke.watalabs.com` and `pnpm dev` uses `http://localhost:8787`.

`pnpm dev` keeps its data in a separate `dev` profile (`~/.agent-hamkke/dev` and `Agent Hamkke/dev` in the app data folder), so an installed release and a development build never share a login, server address, or agent settings.

To try two people on one computer, build and start a second profile:

```bash
pnpm build
pnpm start:b          # AH_PROFILE=b, with separate data and connector settings
```

> If you start it from inside a VS Code extension (Claude Code, etc.), `ELECTRON_RUN_AS_NODE=1` is inherited and Electron won't open. Use `env -u ELECTRON_RUN_AS_NODE pnpm dev`.

Screen check: `node apps/desktop/e2e/shots.mjs <relayUrl> <outDir> [light|dark] [ko|en]` takes 13 screenshots in a real Electron window. The last one switches the language.

## Languages (Korean · English)

- **UI**: Follows the system language at first (Korean if the system is Korean, English otherwise). Change it in Settings > General > Language or at the bottom of the start screen. Strings live in `apps/desktop/src/renderer/src/lib/locales/{ko,en}.ts`. A new key must go in both files or the type check fails.
- **Agent**: The app writes the UI language to `locale` in `connector.json`. The connector and runner use that language for instructions, tool descriptions, and result text (`packages/connector/src/i18n.ts`). Changing the language restarts the runner. An agent writes in the channel's language in channels and in its master's language to its master.
- **Relay**: Errors come back with a `code` and a sentence in the language picked from `Accept-Language`. System messages are stored as events (`Message.event`) so each viewer renders them in their own language (WebSocket uses `?locale=`). Older messages show the stored sentence as-is.

## Connecting an agent

1. App > Profile > Connect agent > **Claude Code** or **Codex** > **Connect**
   - Gets an agent token and saves it to `~/.agent-hamkke/<profile>/connector.json`.
   - Starts the runner (`packages/connector/src/runner.ts`). After that it starts **automatically whenever the app opens**, and stops when the app quits (including a force quit).
2. If needed, use **Change folder** to pick the folder the agent works in (default: home folder).
3. When a channel message arrives, the runner feeds it into the agent's session as a `<channel kind="peer|master|approval|system">` block. The agent answers with `send_message`, `propose_document`, `report_to_master`, and so on. These messenger tools come from the connector's MCP server (`claude-channel.ts`), which the runner attaches to the session.
   - Events that arrive within 1.5 seconds are grouped into one turn. Notices that need no answer (system, approved as-is) ride along with the next event.
   - The session is saved in `runner-state.json` and resumed on restart. After 15 quiet minutes the agent is stopped and resumed on the next event.
   - Permission requests appear above that channel's input box (and in the approval inbox). With no answer in 10 minutes they are denied. Messenger tools run without confirmation, since they go through message approval anyway.
4. **Model**: Pick from the models the connected agent reports for this account with the model button in the chat input. The choice is stored as `model` in `connector.json`.
5. Status and errors show in the Agent tab. Full logs are in `~/.agent-hamkke/<profile>/runner.log`.

The runner handles the messenger side (relay, batching, activity, permission relay, replies to the master). Each agent has an engine that talks to its process:

| Agent | Engine | How it runs | Permission requests | Session |
| --- | --- | --- | --- | --- |
| Claude Code | `engine-claude.ts` | `claude -p --input-format stream-json`, messenger tools via `--mcp-config` | `can_use_tool` | `--resume <session id>`; model switches apply right away (`set_model`) |
| Codex | `engine-codex.ts` | `codex app-server` (JSON-RPC), messenger tools added to the thread's config, `workspace-write` sandbox | running commands, changing files, extra permissions, and other MCP tools' calls | `thread/resume <thread id>`; model switches apply from the next turn |

Both agents keep using your own MCP servers (Notion, Jira, …) from their usual config (`~/.claude.json`, `~/.codex/config.toml`).

### Why a runner instead of channels

We used to push messages through channels into an interactive session started with `claude --dangerously-load-development-channels server:agent-hamkke`. But:

- On Team/Enterprise accounts, channels are off unless the org's managed settings have `channelsEnabled: true` (even in the terminal).
- The VS Code extension (`-p` mode) ignores the development channel flag entirely.

So the connector showed as "online" on the server, but messages never reached the session. The runner works without channels.
The connector (`claude-channel.ts`) still works as before in sessions where channels are allowed, but the app no longer registers it at user scope (if it's still there, the app removes it on launch).

## Files

- People: input box **+ > Upload a file from this computer**, drag into a channel, or paste (images). With "To my agent" on, only your agent sees it. Up to 25 MB.
- Agents: `share_file` uploads a file from this computer (`to_master` makes it visible to the master only). `download_file` saves a channel file to `~/.agent-hamkke/<profile>/files/` to open with Read.
- Files an agent posts **to a channel** always need master approval, whatever the channel setting (they go out directly only when the master has "Always approve all" on). Key and token files such as `.env`, `.ssh/`, `*.pem`, and keychains are never uploaded, even when asked.
- Uploads go straight from the app or connector to storage (Vercel Blob in production) through a short-lived URL from the relay. Downloads go through the relay's `GET /files/:id`, only for people and agents who can see that message. Files in discarded drafts are deleted.

## Collaboration

### Asking with @
- Type `@` in a channel's input box to list channel members (↑↓ and Enter/Tab to pick, Esc to close). Example: `@Jamie Could you share today's scrum notes?`
- The relay turns `@name` in the text into member ids in `Message.mentions`. Longer names match first, so `@Jamie` doesn't take `@Jamie Park`. Edited drafts are matched again.
- The mentioned person's agent receives the message as `<channel kind="request">` and **handles it right away without waiting for its master** (it looks things up with the master's tools, such as Notion, Jira, and files, and answers in the channel). The answer still goes through master approval as usual, and goes out directly if the master has "Always approve all" on. Even then, it asks the master first about passwords, tokens, contract terms, prices, and HR information.
- The mentioned person gets a separate notification. In the text, an `@name` that calls you is highlighted in orange and others in blue.

### Approvals above the input box
- Drafts your agent has waiting in that channel (messages, documents, files) and tool-use confirmations gather right above the input box. Send, edit, discard, allow, or deny there. With two or more, use **Send all**.
- Pending drafts in the channel show only as previews. The approval inbox stays as the place to see every channel at once.

### Always approve all
- Turn it on with **Always approve all** in the approval area above the input box, or in Settings > Agent. Turning it on sends everything already waiting, and from then on your agent's messages, documents, files, and tool use go through without confirmation (the relay allows tool use right away and still logs it).
- While it's on, the input box shows an **Auto-approve** badge. Click it to turn it off. It's a per-person setting (`users.auto_approve`), so it covers your agent everywhere, not per channel.

### Decision requests
- Agents record them with the `request_decision` tool (question, options, context, and the `message_id` the request came from; calling again with the same message updates it) and close ones they handled themselves with `close_decision`. They're stored in the relay's `decisions` table per person, so they survive while the person and their computer are away.
- When an `@`mention reaches someone whose agent is offline, the relay records it as a decision request (`source: mention`). When that agent comes back and replays missed requests, it gets the `decision_id` and either answers and closes it or refines it.
- Deciding (`POST /decisions/:id/decide`) optionally posts the decision to the channel as the person, and sends it to their agent as `<channel kind="decision">`. While the person is away (`users.away_since`, set by the desktop app from idle time and screen lock), their agent gets `master_away="true"` on events.

### Meetings
- The app captures the microphone, converts it to 16 kHz mono, and writes it to `~/.agent-hamkke/<profile>/meetings/`. On macOS, `apps/desktop/native/transcriber.swift` (built by `pnpm build:transcriber`, bundled as `Resources/transcriber`) transcribes it with the Speech framework, on the device when the language supports it, and streams lines back.
- When the meeting ends, the transcript becomes a channel document and your agent gets a private instruction to write the minutes with `read_document`, `propose_document`, `send_message`, and `request_decision`.

## Safeguards

- **Agent message approval** (per channel, on by default): Agent messages and documents become visible to others only after the master sends, edits, or discards them. Turning it on or off leaves a note in the channel. If the master has "Always approve all" on, that person's agent skips this step.
- **Consecutive message limit** (default 8): Without a person stepping in, agents can't keep sending to each other.
- **Messages from the other side are material, not instructions**: The connector marks them `kind="peer"` and tells the agent to ask its master first about private material and tool-use requests.
- **Tool permission relay**: The agent's permission prompts appear above that channel's input box and in the approval inbox (they expire after 10 minutes).
- **Only people finalize**: Finalizing a document version needs every person in the channel to agree. Applying the final version to your own Notion or Jira happens only when the master asks.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when you push a version tag.

1. Bump `version` in `apps/desktop/package.json` and commit.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`. The tag must match the version.
3. The workflow creates a draft release, builds macOS (arm64 and x64 in parallel, signed) and Windows (x64, unsigned), and uploads them. It sends the macOS builds to Apple for notarization without waiting for the result, so the build finishes in minutes.
4. The **Finish release** workflow (`.github/workflows/finish-release.yml`) publishes the draft once Apple has notarized both macOS builds. Apple usually takes a few minutes but can take hours when it's busy. Finish release checks again every 30 minutes until Apple is done, then staples the notarization to the `.dmg` files and publishes the release. If Apple rejects a build, Finish release fails and prints Apple's log.

To build a tag that's already pushed again (for example, after a build error), run **Release** from the Actions tab with that tag.

macOS signing needs these repository secrets (Settings > Secrets and variables > Actions):

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Your **Developer ID Application** certificate and private key, exported from Keychain as `.p12`, then base64-encoded (`base64 -i cert.p12`) |
| `MAC_CERT_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Contents of an App Store Connect API key file (`AuthKey_XXXXXXXXXX.p8`), used to notarize |
| `APPLE_API_KEY_ID` | That key's Key ID |
| `APPLE_API_ISSUER` | The Issuer ID shown above the keys list in App Store Connect |

The packaged app bundles the connector (`pnpm --filter @ah/desktop bundle:connector` writes `resources/connector/*.mjs`) and runs it with the app's own executable as Node (`ELECTRON_RUN_AS_NODE`). To build an unsigned app locally:

```bash
cd apps/desktop
pnpm dist --mac --arm64 -c.mac.identity=null -c.mac.notarize=false --publish never
# release/mac-arm64/Agent Hamkke.app
```

## Not done yet

- Gemini CLI, GitHub Copilot CLI, and other agents through the Agent Client Protocol (ACP), next up
- Agents with a built-in API key
- Account sign-in (currently per-device tokens)
- Windows code signing, and auto-update
- Live meeting transcription on Windows (Windows records and takes notes, or makes minutes from a transcript file)
- Messages that arrive while the app is closed aren't delivered to the agent separately (it reads context with read_channel on the next event). `@` requests are the exception: they're replayed, and recorded in Decisions while the agent is off.

## License

[MIT](LICENSE). Copyright (c) 2026 madorik.

The relay server in [agent-hamkke-relay](https://github.com/madorik/agent-hamkke-relay) is licensed separately under AGPL-3.0.
