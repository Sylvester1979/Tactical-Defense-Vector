#!/usr/bin/env bash
# Downloads the CC0 source recordings the game's sound effects are built from.
#   tools/audio/fetch_sources.sh <dir>
# Then: python3 tools/audio/build_sfx.py <dir> public/audio
set -euo pipefail
DIR="${1:?usage: fetch_sources.sh <dir>}"
mkdir -p "$DIR"
cd "$DIR"

# Kenney (kenney.nl) — Creative Commons CC0
for url in \
  https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip \
  https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip \
  https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip; do
  zip="$(basename "$url")"
  [ -f "$zip" ] || curl -fsSL -o "$zip" "$url"
  unzip -q -o "$zip" -d "${zip%.zip}"
done

# "Gunshots" from OpenGameArt (opengameart.org/content/gunshots) — CC0
mkdir -p oga-gunshots
for name in "22 Magnum" "22 Pistol" "Black Powder" "Unkown"; do
  [ -f "oga-gunshots/$name.wav" ] || curl -fsSL -o "oga-gunshots/$name.wav" "https://opengameart.org/sites/default/files/${name// /%20}.wav"
done
echo "sources in $DIR"
