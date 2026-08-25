# Deep Sea Facts

[![CI](https://github.com/ankraio/deep-sea-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/ankraio/deep-sea-demo/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ankraio/deep-sea-demo/actions/workflows/codeql.yml/badge.svg)](https://github.com/ankraio/deep-sea-demo/actions/workflows/codeql.yml)

An animated single page of deep sea facts with **Ask Sonar**, an AI chat that answers from a
private GPU instead of a public AI provider. This is the demo repository from the Ankra blog post
[One Prompt to a Live URL](https://ankra.ai/blog/one-prompt-to-a-live-url): the whole app was
built and shipped by an AI agent from a single paragraph, riding the rails of the
[Ankra](https://ankra.ai) platform.

It is also a working example of what we consider a golden-standard CI baseline for a service that
an agent (or a human) ships to production: every push is linted, tested, and scanned from source
code to running container before anything deploys.

## How it runs

- `server.js` is a zero-runtime-dependency Node server: it serves the static page and proxies
  `POST /api/chat` to an OpenAI-compatible endpoint, injecting the API key server-side so the
  key never reaches the browser. Strict security headers, request size caps, a per-address rate
  limit, and graceful degradation when no inference endpoint is configured.
- `public/` is the page: a canvas of drifting bioluminescent particles, a fact carousel, and the
  Sonar chat.
- The container image is built by Ankra's application lane and pushed to the Harbor registry the
  platform provides for the organisation; the deployment engine rolls it out and the DNS and TLS
  lane exposes it.

Configuration comes from three environment variables, typically wired by the deployment from a
key minted by the LiteLLM token broker of the
[gpu-chat stack](https://ankra.ai/blog/managed-private-ai-stack-for-developers):

| Variable          | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `OPENAI_BASE_URL` | OpenAI-compatible API root, e.g. `https://api.example/v1` |
| `OPENAI_API_KEY`  | A scoped, budgeted key from the token broker              |
| `MODEL_NAME`      | Served model name (default `qwen3-8b`)                    |

Run it locally:

```bash
npm ci
npm start            # http://localhost:8080 (chat degrades gracefully without a key)
npm test             # unit tests via node --test
npm run lint         # eslint
npm run format:check # prettier
```

Or as the container CI ships:

```bash
docker build -t deep-sea-demo .
docker run -p 8080:8080 -e OPENAI_BASE_URL=... -e OPENAI_API_KEY=... deep-sea-demo
```

## The CI gauntlet

Every push and pull request runs the full pipeline in `.github/workflows/`:

| Stage           | Tool                                     | What it catches                                       |
| --------------- | ---------------------------------------- | ----------------------------------------------------- |
| Code lint       | ESLint, Prettier                         | Bugs, dead code, drift from the formatting contract   |
| Config lint     | yamllint, actionlint, hadolint           | Broken workflows, Dockerfile antipatterns             |
| Unit tests      | `node --test`                            | Server behaviour, headers, input limits, degradation  |
| Secret scan     | gitleaks                                 | Credentials committed anywhere in history             |
| SAST            | Semgrep (`p/owasp-top-ten`, `p/secrets`) | OWASP Top Ten code patterns before they ship          |
| Dependency scan | Trivy (filesystem)                       | Vulnerable lockfile entries, IaC misconfig, secrets   |
| Image scan      | Trivy + Grype                            | CVEs in the built container, two independent opinions |
| SBOM            | Syft                                     | SPDX inventory of the image, attached to every run    |
| Code analysis   | CodeQL (security-extended)               | Taint-flow and injection classes, continuously        |
| DAST            | OWASP ZAP baseline                       | The running container probed like an attacker would   |
| Updates         | Dependabot                               | npm, Docker base image, and Actions kept current      |

The scans gate on HIGH and CRITICAL findings: a red run blocks the deploy lane. The app keeps the
attack surface small to begin with: zero runtime npm dependencies, a read-only static directory,
one POST endpoint with strict input validation, and a non-root container with a healthcheck.

## Continuous deployment

When every gate above is green on `main`, the `deploy` job ships the build to an Ankra playground
cluster at [sea.7bl6jmr0fb.ankra.cc](https://sea.7bl6jmr0fb.ankra.cc):

1. The image is pushed to GHCR tagged with the immutable commit SHA (never `latest`).
2. The commit SHA is substituted into `deploy/manifests/deployment.yaml`.
3. `ankra cluster apply -f deploy/cluster.yaml` hands the stack to Ankra's deployment engine,
   which rolls it out in dependency order (namespace, then deployment, service, ingress) and
   publishes the hostname the ingress claims.

CI holds two credentials only: the repo-scoped `GITHUB_TOKEN` for the registry push, and a
least-privilege Ankra API token for the apply. No kubeconfig, no cluster admin, no DNS panel.
Rolling back is applying the previous commit. The hardened manifests in `deploy/manifests/` go
through the same Trivy misconfiguration scan as everything else in the repo.

## Why this repository exists

The point of the blog post is that agents ship safely when the platform provides typed, budgeted,
audited capabilities instead of raw credentials. This repository is the other half of that
argument: the code an agent ships should enter the world through the same gates a careful team
would demand of any service. One prompt in, but linted, tested, scanned, and inventoried on the
way out.

## License

[MIT](LICENSE)
