#!/usr/bin/env bash
# Deploy the committed HEAD to the Hugging Face Space (Docker SDK).
#   SPACE=volage05/junction-lab deploy/deploy-hf.sh
# Needs a logged-in hf CLI (`hf auth login` with a write token).
set -euo pipefail
SPACE="${SPACE:-volage05/junction-lab}"
HF="${HF:-$(command -v hf || echo "$HOME/.local/bin/hf")}"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Only what the Docker build needs, from the committed tree (no local edits, no node_modules).
git -C "$ROOT" archive HEAD Dockerfile .dockerignore package.json package-lock.json tsconfig.base.json networks engine server web | tar -x -C "$STAGE"
cp "$ROOT/deploy/hf/README.md" "$STAGE/README.md"

"$HF" repos create "$SPACE" --repo-type space --space-sdk docker --public --exist-ok >/dev/null
"$HF" upload "$SPACE" "$STAGE" . --repo-type space --delete "*" --commit-message "Deploy $(git -C "$ROOT" rev-parse --short HEAD)"
echo "Deployed. App: https://${SPACE/\//-}.hf.space  Space: https://huggingface.co/spaces/$SPACE"
