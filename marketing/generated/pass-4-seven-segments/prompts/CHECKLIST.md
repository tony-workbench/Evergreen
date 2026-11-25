# Checks to run on every generated segment before it is shown or built on

## Automatic
- Scene-change detection at 0.12: zero hits inside a segment.
- Freeze detection (0.4 s): zero hits.
- Duration equals the requested duration.

## By eye, frames at 2-6 per second
1. Camera: only the move written for that range; no cut, no jump, no zoom.
2. Desk: one short desk; one paper stack left of the laptop; one cup and one phone right of it; phone flat, same place, same angle from first frame to last.
3. Sticky notes: three, on the screen frame corners and the palm rest; none on the lid's back.
4. Hands: the hand named in the prompt does the action; resting hands lie still (no tapping).
5. Her head never turns more than about 30 degrees on a body that faces the desk.
6. Tree: cream-white; feet on a surface (desk wood or floor), never on the laptop, never in the air for more than a short drop; three cups tall on the desk, tip just below the chair seat on the floor; same size next to her at the door.
7. Laptop: closes on its hinge over about two seconds; nothing between screen and keyboard; stays shut afterwards.
8. Chair: turns only while her hand is on its back; afterwards she faces what she looks at.
9. Shoes: exactly two; her foot's size at the door, when pushed, when worn; both on her feet when she stands; none left on the floor.
10. Laces: each one pulled out, crossed, looped, tightened.
11. Door: opens only while her hand is on the knob; same size before and after; tree goes out first; no hand-holding.

## Joins
- Put the last frame of segment N beside the first frame of segment N+1: framing, brightness, every prop.
- For a first/last-frame segment, compare its end image with its start frame item by item BEFORE submitting.
- Compare frames across groups too (desk close-ups against floor wides), not only inside a group.

## Money
- State the segment and its price and wait for a yes before each submission that is not already inside an approved total.
- Any retry: stop, say why, say the price, wait.
