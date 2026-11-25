# Movement pictures

Each movement on the workout page can show one picture: the start position on the left, the end on the right, and the working muscles in green. Twelve movements have one: those of a three-day week at home as the engine first plans it, with nothing to train with and with a backpack, plus the next step up for pushing (the table edge). Other movements, and the later steps of each chain, show their steps only until they have a picture. The pictures are in [`app/Evergreen/Resources/Movements`](../app/Evergreen/Resources/Movements) and each movement lists its picture under `images` in [`recommend-agent/data/movements.json`](../recommend-agent/data/movements.json). A movement without a picture shows its steps only.

| Movement | Picture |
| --- | --- |
| Sit down and stand up | `sit_to_stand.jpg` |
| Squat | `bodyweight_squat.jpg` |
| Push the hips back | `hip_hinge.jpg` |
| Split squat holding the wall | `wall_split_squat.jpg` |
| Hip lift on the floor | `glute_bridge.jpg` |
| Push-up against the wall | `wall_push_up.jpg` |
| Push-up on the table edge | `table_push_up.jpg` |
| Backpack press overhead | `backpack_press.jpg` |
| Backpack row | `backpack_row.jpg` |
| Arms up lying face down | `prone_arm_raise.jpg` |
| Opposite arm and leg out, on hands and knees | `bird_dog.jpg` |
| Opposite arm and leg out, lying on your back | `dead_bug.jpg` |

## How they are made

Images come from Gemini (`gemini-3-pro-image`) at 4:3, two panels side by side.

1. **One look for every picture.** [`character-sheet.jpg`](movement-pictures/character-sheet.jpg) is the person, front and side. It is attached to every request as the look reference.
2. **The pose from a photo.** A pair of photos of the movement (start and end, from the free-exercise-db collection, used as a reference only and not kept here) is joined side by side and attached as the pose reference. The prompt says to take only the body position below the neck from it, and to swap any dumbbell for a backpack.
3. **The same words around every movement:**

   > Instructional exercise illustration for a fitness app. Clean flat vector style, even dark-grey outlines, plain off-white background, no text, no letters, no numbers, no logos. Two equal panels side by side with a thin grey divider: LEFT panel = start position, RIGHT panel = end position. Exactly one person in each panel, the same person, seen strictly from the side, facing the same direction in both panels, full body visible, nothing cropped by the panel edges. Tint the working muscles soft green (#3E8E5A) in the RIGHT panel only, nowhere else. No arrows, no motion lines, no symbols. Anatomically correct, exactly two arms and two legs. Props, when present, always look the same: a plain dark-grey school backpack; a plain light-grey thin floor mat; a simple light-wood chair; a wall drawn as a plain light-grey vertical band at the panel edge.

   After them, one sentence for each panel saying where every joint is, taken from the movement's `setup`, `steps` and `pass`, and which muscles are green (from `feel`).
4. **Checked one by one** before it goes in: the pose matches `pass`, the body could hold it, elbows and knees bend the right way, only the working muscles are green, no arrows or text, the props match, the person matches the character sheet, nothing is cut off. A failed picture is made again with one sentence changed.

## What went wrong, and the rule it gave

| Problem | Rule |
| --- | --- |
| With another movement's picture attached, its pose came back | Attach only the character sheet for the look; the pose comes from photos of this movement |
| With only the character sheet attached, the person stood upright whatever the words said | The pose always comes from a picture, never from words alone |
| Arrows came out crooked | No arrows: the two panels already show the movement |
| A panel with no photo copied the character sheet's front view | Give a photo for both panels |
| "Fill the panel" drew two people in one panel | Size the person by cropping afterwards, never in the prompt |
| A raised backpack was cut off at the top | Say how tall the person is in the panel and that space stays above |
| The end panel of "Arms up lying face down" turned the face upwards three times | That panel was made on its own from the start panel and joined to it |
