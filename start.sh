#!/bin/zsh
# FADI LAB live-preview server (venv python has numpy/PIL)
cd "$(dirname "$0")"
exec "/Users/adamghaleb/Documents/windsurf projects/clipsync/.venv/bin/python" server.py "$@"
