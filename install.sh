#!/usr/bin/env bash
set -euo pipefail

# Solana Observability Skill Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/SBALAVIGNESH123/solana-observability-skill/main/install.sh | bash

REPO="https://github.com/SBALAVIGNESH123/solana-observability-skill.git"
SKILL_DIR="${SOLANA_AI_KIT_DIR:-$HOME/.solana-ai-kit}/skills/solana-observability-skill"
AUTO_CONFIRM="${1:-}"

echo "+============================================+"
echo "|  Solana Observability Skill Installer      |"
echo "+============================================+"
echo ""

# Check for git
if ! command -v git &>/dev/null; then
  echo "❌ git is required but not installed."
  echo "   Install: https://git-scm.com/downloads"
  exit 1
fi

# Confirm installation
if [[ "$AUTO_CONFIRM" != "-y" ]]; then
  echo "This will install the Solana Observability Skill to:"
  echo "  $SKILL_DIR"
  echo ""
  read -rp "Continue? [Y/n] " answer
  if [[ "$answer" =~ ^[Nn] ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Install
echo "📦 Cloning skill repository..."
if [[ -d "$SKILL_DIR" ]]; then
  echo "   Updating existing installation..."
  cd "$SKILL_DIR"
  git pull --ff-only origin main
else
  mkdir -p "$(dirname "$SKILL_DIR")"
  git clone --depth 1 "$REPO" "$SKILL_DIR"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📍 Installed to: $SKILL_DIR"
echo ""
echo "🚀 Next steps:"
echo "   1. The skill is now available in your Solana AI Kit"
echo "   2. Ask your AI agent about Solana observability"
echo "   3. Try: 'Set up RPC health monitoring for my Solana program'"
echo ""
echo "📚 Documentation: https://github.com/SBALAVIGNESH123/solana-observability-skill"
