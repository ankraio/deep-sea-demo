# Deep Sea Facts

[![CI](https://github.com/ankraio/deep-sea-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/ankraio/deep-sea-demo/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ankraio/deep-sea-demo/actions/workflows/codeql.yml/badge.svg)](https://github.com/ankraio/deep-sea-demo/actions/workflows/codeql.yml)

An animated single page of deep sea facts with **Ask Sonar**, an AI chat that answers from a
open model we run ourselves on Ankra Cloud in Stockholm, instead of a public AI provider. This is the demo repository from the Ankra blog post
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

Configuration comes from three environment variables, set in `.ankra/manifests/deployment.yaml`
(the key from the application's environment secrets) and pointing at Sonar's own model (see below):

| Variable          | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `OPENAI_BASE_URL` | OpenAI-compatible API root, e.g. `https://api.example/v1` |
| `OPENAI_API_KEY`  | The key the model server accepts                          |
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

Ankra builds and ships this repository, and `.ankra/pipeline.yaml` is the pipeline of record. On every
push to `main`, Ankra Pipelines installs and tests the code, builds the image with provenance and an
SBOM, scans it with Semgrep, Checkov and Trivy, gates on the findings, and publishes an immutable
`sha-` tag to the organisation's Ankra registry. Ankra then rolls that tag out to the
`applications-demo` cluster, where the demo runs at
[deepsea.f6x778iwii.7bl6jmr0fb.ankra.cc](https://deepsea.f6x778iwii.7bl6jmr0fb.ankra.cc), with the
DNS record and the TLS certificate handled by the platform.

The GitHub Actions gauntlet above still runs on every push and pull request as an independent second
opinion. Neither path holds a kubeconfig, a cluster-admin credential or a DNS panel, and rolling back is
deploying the previous `sha-` tag.

## Sonar's model

Sonar runs on Qwen3 8B (Apache-2.0, 4-bit GGUF from `Qwen/Qwen3-8B-GGUF` at a pinned revision and
checksum), served by llama.cpp on a 16 vCPU CPU node of the `demo-cloud` cluster on Ankra Cloud. No
question leaves our infrastructure. The stack is in `sonar/`: a namespace, the API key as a
SOPS-sealed Secret, the model volume and the llama.cpp server with thinking mode off. The model has no
public endpoint: demo-cloud is IPv6 only and this page's cluster is IPv4 only, so a chisel client in
the stack dials out over TLS to `sonar-tunnel` (in `.ankra/manifests/`) and opens a reverse tunnel,
which the page calls as `http://sonar-model`. The tunnel user may open only that one port, and only
the page's pods may reach it. Review and deploy the model stack with:

```bash
ankra cluster draft -f sonar/cluster.yaml --cluster demo-cloud --org demo
ankra cluster stacks deploy-draft sonar-model --cluster demo-cloud --org demo
```

## Why this repository exists

The point of the blog post is that agents ship safely when the platform provides typed, budgeted,
audited capabilities instead of raw credentials. This repository is the other half of that
argument: the code an agent ships should enter the world through the same gates a careful team
would demand of any service. One prompt in, but linted, tested, scanned, and inventoried on the
way out.

## License

[MIT](LICENSE)
