#!/bin/zsh
# Samples a frame every 15 s from each recording in jobs.tsv and OCRs its
# scorebug (results/<gameId>.tsv), all games in parallel. Build the sampler
# first:  swiftc -O -o frames frames.swift
cd "$(dirname "$0")"
mkdir -p results
while IFS=$'\t' read -r game embed dur url; do
  ( ./frames "$url" 30 "$dur" 15 > results/$game.tsv 2> results/$game.err; echo "done $game $(wc -l < results/$game.tsv)" >> results/progress.log ) &
done < jobs.tsv
wait
echo ALL_DONE >> results/progress.log
