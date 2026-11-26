# Run living-brain next to the existing site on the same VM

A second, separate copy of the app on the same Lightsail VM, on its own address (for example `https://brain.54.251.42.51.sslip.io`).
The existing site (`~/pulsarx`, project `bnb-hackathon`) is not touched except for one reviewed Caddy change.

## What is here
| File | Purpose |
|---|---|
| `docker-build-only.workflow.yml` | GitHub Actions workflow that BUILDS and pushes the two images. It has **no deploy step**, unlike `bnb-hackathon`'s, so it can never redeploy the live site. Copy it to `.github/workflows/docker.yml` in the GitHub web UI (an automated token cannot create workflow files). |
| `docker-compose.yml` | The second project, `living-brain`: app + agent-chat (+ the agent loop only with `--profile loop`). Its own volumes and env files, no published ports. |
| `Caddyfile` | Two sites for the one Caddy that owns ports 80/443. |
| `switch-caddy.sh` | Makes the existing Caddy serve both sites through `~/pulsarx/docker-compose.override.yml` (a deployment of the live site only replaces `docker-compose.yml`, so it cannot undo this), validates first, and removes the override again if the live site stops answering. |

## Steps
1. **Images.** (Either build on the VM with `docker build`, as was done for the first deploy, or) in the GitHub web UI add `deploy/second-site/docker-build-only.workflow.yml` as `.github/workflows/docker.yml`
   (repo -> Add file -> Create new file). Copy the repository variables `NEXT_PUBLIC_BSC_RPC_URL`, `NEXT_PUBLIC_ETH_RPC_URL`,
   `NEXT_PUBLIC_ARB_RPC_URL`, `NEXT_PUBLIC_SEPOLIA_RPC_URL` from `bnb-hackathon` (Settings -> Secrets and variables -> Actions -> Variables).
   Run the workflow once (Actions -> docker -> Run workflow). It publishes `ghcr.io/plusarx/living-brain-app` and `living-brain-agent`.
   If the packages are private, make them readable by the VM (`docker login ghcr.io` on the VM with a read-only token) or make them public.
2. **Swap (the VM has 1.9 GB RAM).** `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
   and add `/swapfile none swap sw 0 0` to `/etc/fstab`.
3. **Folder.** `mkdir -p ~/living-brain && cd ~/living-brain`, copy `docker-compose.yml` and `Caddyfile` there, and create `.env` and `agent.env`
   from `.env.example` / `agent/.env.example`. In `agent.env` set `LIVING_BRAIN_API_KEY` (and `CMC_API_KEY` if wanted). Keep `DRY_RUN=true`.
   Use the same `KEYSTORE_SECRET` as the live site only if you copy its database.
4. **Shared network.** `docker network create edge`.
5. **Start.** `docker compose pull && docker compose up -d` (add `--profile loop` only if you want a dry-run agent loop).
6. **Caddy.** `bash switch-caddy.sh` (from `~/living-brain`; it writes `~/pulsarx/docker-compose.override.yml`, it does not edit the deployed compose file).
7. Open the new address and check `/memory`.

## Safety
- The live agent loop in `~/pulsarx` is real-money (`DRY_RUN=false`). This project does not start a loop unless you ask for the `loop` profile, and then keep it dry run:
  two live loops on one wallet could place the same order twice.
- The chat service is always dry run.
- To undo the Caddy change: delete `~/pulsarx/docker-compose.override.yml` and run `docker compose up -d caddy` in `~/pulsarx`.
- Do not edit `~/pulsarx/docker-compose.yml` by hand for this: every deployment of the live site replaces it (that is exactly what undid the first attempt).
