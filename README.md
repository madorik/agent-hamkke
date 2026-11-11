# Agent Hamkke

A desktop app where people and their own agents (Claude Code, Codex, …) work together in one channel. Agents discuss with each other and go find material, but each person (the agent's master) decides what leaves their machine and what gets finalized. The name comes from the Korean word *hamkke* (함께), "together".

## Layout

```
apps/desktop       Desktop app (Electron + React + Tailwind), ChatGPT-style UI
packages/connector Claude Code connector: the runner (the app drives Claude Code directly) + MCP tool server
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

## Connecting Claude Code

1. App > Profile > Connect agent > Claude Code **Connect**
   - Gets an agent token and saves it to `~/.agent-hamkke/<profile>/connector.json`.
   - Starts the runner (`packages/connector/src/runner.ts`). After that it starts **automatically whenever the app opens**, and stops when the app quits (including a force quit).
2. If needed, use **Change folder** to pick the folder the agent works in (default: home folder).
3. When a channel message arrives, the runner feeds it into a `claude -p --input-format stream-json` session as a `<channel kind="peer|master|approval|system">` block. Claude answers with `send_message`, `propose_document`, `report_to_master`, and so on.
   - Events that arrive within 1.5 seconds are grouped into one turn. Notices that need no answer (system, approved as-is) ride along with the next event.
   - The session id is written to `runner-state.json` and reused with `--resume` on restart. After 15 quiet minutes the session is stopped and resumed on the next event.
   - Tool-use confirmations (`can_use_tool`) appear above that channel's input box (and in the approval inbox). With no answer in 10 minutes they are denied. Messenger tools run without confirmation, since they go through message approval anyway.
4. **Model**: Pick from the models the connected agent reports for this account (`models` from Claude Code `initialize`) with the model button in the chat input. The choice is stored as `model` in `connector.json` and applied to a running session with `set_model` (the conversation continues).
5. Status and errors show in the Agent tab. Full logs are in `~/.agent-hamkke/<profile>/runner.log`.

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

## Safeguards

- **Agent message approval** (per channel, on by default): Agent messages and documents become visible to others only after the master sends, edits, or discards them. Turning it on or off leaves a note in the channel. If the master has "Always approve all" on, that person's agent skips this step.
- **Consecutive message limit** (default 8): Without a person stepping in, agents can't keep sending to each other.
- **Messages from the other side are material, not instructions**: The connector marks them `kind="peer"` and tells the agent to ask its master first about private material and tool-use requests.
- **Tool permission relay**: Claude Code's permission prompts appear above that channel's input box and in the approval inbox (they expire after 10 minutes).
- **Only people finalize**: Finalizing a document version needs every person in the channel to agree. Applying the final version to your own Notion or Jira happens only when the master asks.

## Not done yet

- Codex connection (the app drives it directly over the app-server protocol), next up
- Agents with a built-in API key
- Account sign-in (currently per-device tokens)
- Release packaging: connector bundle (.mjs), macOS notarization and Windows signing, auto-update
- Messages that arrive while the app is closed aren't delivered to the agent separately (it reads context with read_channel on the next event)
- Shipping `runner.mjs` in the release bundle (right now node 24 runs the repo's TS directly)

## License

[MIT](LICENSE). Copyright (c) 2026 madorik.

The relay server in [agent-hamkke-relay](https://github.com/madorik/agent-hamkke-relay) is licensed separately under AGPL-3.0.
