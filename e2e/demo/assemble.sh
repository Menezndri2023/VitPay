#!/usr/bin/env bash
# Assemble chaque vidéo de démonstration : vidéo Playwright + clips de voix off placés à leur
# instant exact (cues.json), puis une vidéo complète enchaînant les parcours.
# Usage : demo/assemble.sh <DEMO_OUT> <dossier-de-sortie>
set -euo pipefail
OUT="${1:?usage: assemble.sh <DEMO_OUT> <sortie>}"; DEST="${2:?usage: assemble.sh <DEMO_OUT> <sortie>}"
mkdir -p "$DEST"
list="$DEST/.concat.txt"; : > "$list"
for cues in "$OUT"/*/cues.json; do
  dir="$(dirname "$cues")"; name="$(basename "$dir")"
  video="$(node -e 'console.log(require(process.argv[1]).video)' "$cues")"
  args=(-y -loglevel error -i "$video"); filter=""; labels=""; i=1
  while IFS=$'\t' read -r t file; do
    args+=(-i "$file")
    ms=$(node -e 'console.log(Math.round(process.argv[1]*1000))' "$t")
    filter+="[$i:a]aresample=48000,adelay=${ms}|${ms}[a$i];"; labels+="[a$i]"; i=$((i+1))
  done < <(node -e 'for (const c of require(process.argv[1]).cues) console.log(c.t + "\t" + c.file)' "$cues")
  filter+="${labels}amix=inputs=$((i-1)):normalize=0:dropout_transition=0,aformat=channel_layouts=stereo[aout]"
  ffmpeg "${args[@]}" -filter_complex "$filter" -map 0:v -map "[aout]" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -movflags +faststart "$DEST/$name.mp4"
  echo "✓ $DEST/$name.mp4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DEST/$name.mp4" | cut -d. -f1) s)"
  echo "file '$DEST/$name.mp4'" >> "$list"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy -movflags +faststart "$DEST/VITPAY-demo-complete.mp4"
rm -f "$list"
echo "✓ $DEST/VITPAY-demo-complete.mp4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DEST/VITPAY-demo-complete.mp4" | cut -d. -f1) s)"
