#!/bin/zsh
# Pull 12-20 s of the take back to night and ease into dawn over 20-26 s.
#   tools/grade.sh IN.mp4 OUT.mp4
set -e
ffmpeg -y -i "$1" -/filter_complex "${0:A:h}/night-grade.txt" -map "[v]" -map 0:a -c:v libx264 -crf 17 -c:a copy "$2"
