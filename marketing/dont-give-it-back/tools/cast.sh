#!/bin/zsh
# Character sheets for Wren and the Mother. Run: tools/cast.sh wren|mother front|threequarter|profile|waist
# Needs GEMINI_API_KEY. Make "front" first; the other views use it as the reference.
set -e
HERE=${0:A:h}
cd "$HERE/../cast"
export ASPECT=3:4
G="$HERE/../../generated/pass-4-seven-segments/tools/gen.py"
WREN="Wren: a poor Dutch young woman of about 18, c. 1636, like a Vermeer portrait: a delicate, freckled face, hazel-green eyes; slim and restless; bare head, long glossy dark auburn hair in one loose braid over her left shoulder with a few soft strands framing her face; a faint stubborn half-smile; unbleached cream linen smock with sleeves rolled to the elbow, a faded rust-ochre wool bodice laced at the front, a small off-white linen apron. Light, warm colours, thin linen."
MOTHER="Mother: a sturdy, broad-shouldered Dutch working woman of about 48, c. 1636, weathered face with fine lines, calm watchful grey eyes, tired but kind; hair completely hidden under a close-fitting white linen coif; a charcoal-black thick wool jacket, a faded indigo-blue work apron, sleeves pushed up, raw red work-worn hands with a brass thimble, a brown wool shawl over her shoulders. Dark, cool colours, heavy wool. Not glamorous, no make-up."
TAIL="Natural skin texture, film grain, 35mm look, Dutch Golden Age period film still. One person only. No text, no logo, no watermark."
case $2 in
  front) VIEW="front view, looking straight into the camera, head and shoulders";;
  threequarter) VIEW="three-quarter view, head turned 45 degrees to the right, head and shoulders";;
  profile) VIEW="profile view, facing right, head and shoulders";;
  waist) VIEW="waist-up view, standing, facing the camera, full costume visible";;
  *) echo "front, threequarter, profile or waist"; exit 1;;
esac
case $1 in wren) DESC=$WREN;; mother) DESC=$MOTHER;; *) echo "wren or mother"; exit 1;; esac
P="Photoreal cinematic portrait, $VIEW, soft warm window light from the left, plain dark stone background. $DESC $TAIL"
if [[ $2 == front ]]; then
  python3 $G "$1-front.png" "$P"
else
  python3 $G "$1-$2.png" "The reference image shows this exact person. Keep the same face, hair, age, skin and costume exactly; change only the camera angle. $P" "$1-front.png"
fi
