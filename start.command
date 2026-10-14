#!/bin/zsh
cd "$(dirname "$0")" || exit 1

export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 24 >/dev/null
fi

(sleep 3; open "http://localhost:4173") &
npm run dev -- --port 4173 --strictPort
