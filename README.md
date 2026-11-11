# Cosmos Space

A living 3D view of the Cosmos ecosystem. Every chain is a planet: pick one, fly inside and watch it work in real time.

Included chains: **Juno** (`juno-1`), **Cosmos Hub** (`cosmoshub-4`), **Osmosis** (`osmosis-1`), **Neutron** (`neutron-1`), **Akash** (`akashnet-2`) and **Noble** (`noble-1`).

## What you see

**Home (in space)**

- The six planets, with the Cosmos Hub at the centre and faint IBC lanes between them.
- IBC transfers on Cosmos Hub and Osmosis are watched live and fly as ships between the planets (when the lanes are quiet, recent real transfers are replayed and labelled as such). No other chain data is loaded here.
- Click a planet (or its button in the dock, or keys `1`–`6`) to fly inside.

**Inside a planet** (the same districts on every chain, themed in the chain's colour)

| District | What it shows |
| --- | --- |
| Consensus Core | The CometBFT round for each block: propose → prevote → precommit → commit. The core fires when a block is finalised. |
| Validator Ring | One tower per bonded validator, height = voting power. A golden beam marks the block proposer; sparks are commit signatures; a red tower missed the last commit. |
| Block Helix | Each committed block joins a rising spiral. Bigger, brighter cubes carry more transactions. |
| Mempool | Coloured sparks (send, staking, rewards, contract, swap, vote, IBC) stream into the core to be packed into the block. |
| Governance Hall | The latest on-chain proposals as holograms with their tally; pulsing frames are open for voting. |
| IBC Spaceport | Outbound transfers launch through the gate rings and leave the planet; inbound packets land on the pad. |

Hover or click anything (towers, blocks, proposals, the core, the port) for details. Use the dock, keys `1`–`6`, or **Guided tour** to move between districts. `Esc` leaves the planet. The stats panel and live feed are shown only while inside a planet.

## Data

Everything is read live from public LCD endpoints (publicnode, Polkachu, cosmos.directory, …) with automatic failover — no API key or backend. A chain's feed starts when you enter its planet and stops when you leave.

- Blocks, decoded transactions, proposer and commit signatures: `/cosmos/tx/v1beta1/txs/block/{height}`
- Validators: `/cosmos/staking/v1beta1/validators`
- Proposals and tallies: `/cosmos/gov/v1/proposals`
- IBC destination chains are resolved from each channel's client state.

Notes on accuracy:

- A block is only known once it is committed, so the consensus round is **replayed** as each block arrives. Proposer and signatures are real; the signatures shown are the block's `last_commit` (the votes that finalised the previous height).
- IBC transfers can be minutes or hours apart on quieter chains. When the port is quiet, real recent transfers are replayed and labelled `replay`.
- Chains that inject non-transaction data into blocks (Neutron's oracle vote extensions) have those entries skipped, so "Txs in block" counts real transactions only.
- Noble is a proof-of-authority chain with no staking token or governance module: its 7 validators have equal power, "Bonded" shows `PoA`, "Open votes" shows `n/a` and the Governance Hall is empty.
- If no endpoint is reachable the app switches to a clearly badged **SIMULATED** chain. Force it with `?sim`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (relative paths, host anywhere)
```

### Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds the site and publishes `dist/` to GitHub Pages on every push to `master` (or manually from the Actions tab). One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at https://giansalex.github.io/appchain-3d/.

URL flags: `?sim` (simulated chains), `?enter=<chain>` (skip the intro and fly straight into `juno`, `cosmoshub`, `osmosis`, `neutron`, `akash` or `noble`).

## Stack

Vite + Three.js + TypeScript (strict; custom GLSL for the planet and shell, bloom post-processing). No framework.
`npm run typecheck` checks types; `npm run build` type-checks before bundling.

```
src/chains.ts    the included chains (ids, endpoints, colours) — add a chain here
src/types.ts     shared data shapes (chain config, validators, blocks, feed events…)
src/lcd.ts       REST client with endpoint failover, one per chain
src/data.ts      per-chain live feed + simulation fallback
src/space.ts     home scene with all planets
src/interior.ts  inside-the-planet scene
src/main.ts      camera, HUD, picking, wiring
src/util.ts      labels, tweens, particle pool, ships
```
