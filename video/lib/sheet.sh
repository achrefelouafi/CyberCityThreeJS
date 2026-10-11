#!/bin/sh
# contact sheet of a clip's stills: sh lib/sheet.sh <clip>  -> out/<clip>_sheet.jpg (4 per row)
d=out/$1_stills; files=$(ls $d/*.jpg); n=$(echo "$files" | wc -l)
args=""; for f in $files; do args="$args -i $f"; done
rows=$(( (n + 3) / 4 )); fc=""; i=0; r=0
while [ $r -lt $rows ]; do
  row=""; c=0
  while [ $c -lt 4 ]; do if [ $i -lt $n ]; then row="$row[$i]"; else row="$row[0]"; fi; i=$((i+1)); c=$((c+1)); done
  fc="$fc${row}hstack=4[r$r];"; r=$((r+1))
done
all=""; r=0; while [ $r -lt $rows ]; do all="$all[r$r]"; r=$((r+1)); done
if [ $rows -gt 1 ]; then fc="${fc}${all}vstack=$rows,scale=1920:-1"; else fc="${fc}[r0]scale=1920:-1"; fi
ffmpeg -loglevel error -y $args -filter_complex "$fc" out/$1_sheet.jpg
