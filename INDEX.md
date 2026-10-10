# ICOS INDEX

```shell
icos/   # Root of project.
├── .reference/             # Reference files - plans, legacy code, etc.
│     ├── notes/            # Subsystem planning notes.
│     ├── plans/            # Implementation plans.
│     │     ├── closed/     # Plan files that have been completed.
│     │     └── evidence/   # Evidence files captured after each milestone.
│     │
│     └── status.md         # Live project status tracking.
│
├── bin/            # Launch script helper files.
│     ├── dmr       # Compose override shorthand for the DMR variant.
│     └── verifier  # Starts the local Jev-style claims verifier (macOS/MLX).
│
├── core/                   # Core subsystem.
│     ├── ...               # Other miscellaneous project files.
│     ├── src/              # Project files.
│     ├── test/             # Project test files.
│     ├── Dockerfile        # Server image for compose.
│     ├── .dmr.env.sample   # Runtime configuration template for using Docker Model Runner.
│     └── .env.sample       # Authoritative runtime configuration template.
│
├── docs/                       # User-facing documents.
│     ├── usage.md              # Setup, configuration, and operation.
│     ├── releases.md           # Release history and milestone changelog.
│     ├── model-lineups.md      # Which models to run, and the memory budget.
│     ├── security.md           # Exposure, TLS, auth, and secrets.
│     ├── skill-blueprint.md    # Template for new skill creation.
│     └── tool-blueprint.md     # Template for new tool creation.
│
├── web-client/         # Web-based frontend client.
│     ├── ...           # Other miscellaneous project files.
│     ├── public/       # Public asset files (images, etc.).
│     ├── src/          # Project files.
│     └── Dockerfile    # Web client image for compose.
│
├── .gitignore              # Files to avoid committing to Git.
├── AGENTS.md               # Project-level Agent rules.
├── ARCHITECTURE.md         # Plain-English architecture and feature guide.
├── COMMERCIAL-LICENSE.md   # Commercial use license.
├── docker-compose-dmr.yml  # Compose configuration for adding DMR.
├── docker-compose.yml      # Core Compose configuration.
├── INDEX.md                # Project index.
├── LICENSE.md              # Non-commercial use license.
└── README.md               # Project-level README document.
```
