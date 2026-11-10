# Planet Juno

A living 3D view of the [Juno](https://junonetwork.io) blockchain (`juno-1`, Cosmos ecosystem).
Juno is a planet. Orbit it, then fly inside to watch the chain work in real time.

## What you see

**In orbit**

- Juno pulses with every new block; its satellites are the bonded validators.
- Neighbouring IBC chains (Osmosis, Cosmos Hub, Stargaze, …) float nearby. IBC transfers leave the planet as ships heading to the destination chain.

**Inside the planet**

| District | What it shows |
| --- | --- |
| Consensus Core | The CometBFT round for each block: propose → prevote → precommit → commit. The core fires when a block is finalised. |
| Validator Ring | One tower per bonded validator, height = voting power. A golden beam marks the block proposer; sparks are commit signatures; a red tower missed the last commit. |
| Block Helix | Each committed block joins a rising spiral. Bigger, brighter cubes carry more transactions. |
| Mempool | Coloured sparks (send, staking, rewards, contract, vote, IBC) stream into the core to be packed into the block. |
| Governance Hall | The latest on-chain proposals as holograms with their tally; pulsing frames are open for voting. |
| IBC Spaceport | Outbound transfers launch through the gate rings and leave the planet; inbound packets land on the pad. |

Hover or click anything (towers, blocks, proposals, the core, the port) for details. Use the dock, keys `1`–`6`, or **Guided tour** to move between districts. `E` enters the planet, `Esc` leaves.

## Data

Everything is read live from public Juno LCD endpoints (publicnode, cosmos.directory, Polkachu) with automatic failover — no API key or backend.

- Blocks, decoded transactions, proposer and commit signatures: `/cosmos/tx/v1beta1/txs/block/{height}`
- Validators: `/cosmos/staking/v1beta1/validators`
- Proposals and tallies: `/cosmos/gov/v1/proposals`
- IBC destination chains are resolved from each channel's client state.

Notes on accuracy:

- A block is only known once it is committed, so the consensus round is **replayed** as each block arrives. Proposer and signatures are real; the signatures shown are the block's `last_commit` (the votes that finalised the previous height).
- IBC transfers on Juno can be minutes or hours apart. When the port is quiet, real recent transfers are replayed and labelled `replay`.
- If no endpoint is reachable the app switches to a clearly badged **SIMULATED** chain. Force it with `?sim`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (relative paths, host anywhere)
```

### Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds the site and publishes `dist/` to GitHub Pages on every push to `master` (or manually from the Actions tab). One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at https://giansalex.github.io/appchain-3d/.

URL flags: `?sim` (simulated chain), `?enter` (skip the intro and fly straight in).

## Stack

Vite + Three.js (custom GLSL for the planet and shell, bloom post-processing). No framework.

```
src/data.js      live feed + simulation fallback
src/space.js     orbit scene
src/interior.js  inside-the-planet scene
src/main.js      camera, HUD, picking, wiring
src/util.js      labels, tweens, particle pool, ships
```
