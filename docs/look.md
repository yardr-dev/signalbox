# Look

The ground and the labels are in the manner of Mini Motorways (Dinosaur
Polo Club, https://dinopoloclub.com/games/mini-motorways/): a cream ground
with nothing behind it, the depots as pads a little darker, a track as a warm
grey ribbon, thin labels on white pills, one sun and one soft shadow. On that
stand the kit's own models, in the texture the packs paint them from: their
iron, white, glass and dark as they came. What rolls keeps the kit's colours
too. Only on a building, where a pack had painted a face in a colour, does
one of Catppuccin's accents (https://github.com/catppuccin/palette) go
instead.

What a colour of the kit's is, is one rule (`COLOUR` in `src/kit.ts`): the
saturation of the texture where the face lies on it, over 0.45. The packs'
texture is swatches, and they lie well apart on that: white, the irons, the
darks, the pale glass and the creams are 0.38 at most, and the reds, oranges,
yellow, green, blues, purple and pink 0.48 at least. So do the browns of
wood and brick: no saturation parts them from a blue. A test reads both
textures and names the swatches on each side.

A building has its kind's two accents. The lightest of the colours the pack
gave it goes in the first, its walls', and any colour of another hue in the
second, its roof's. The pack's buildings are iron and white with a little
yellow, so that is a trim: the row of doors in a station's front in teal, a
works' doors and the bands of its chimneys in lavender, a hut's door in
yellow and an office's in sky, and the bush that stands by each of those two
in peach and in sapphire. A silo has no colour but its band, which is
its provider's. The scene's own buildings, which are boxes, are their accents
all over: a signal box, the telegraph's poles, a peer's board. The colour
says nothing: a hut is a hut's in every depot.

| building | walls | roof |
| --- | --- | --- |
| a people's station | teal | green |
| a builders' hut | yellow | peach |
| a reviewers' office | sky | sapphire |
| a works | lavender | mauve |
| a signal box | rosewater | flamingo |
| a silo | pink | pink |
| the telegraph's poles | yellow | yellow |
| a peer's board | sapphire | sapphire |

A wagon is the kit's, in the colours the pack painted it: a blue, a green or
a red container, a tank with red ends, a load of logs, by the bead's id, so a
bead keeps its wagon. A train's locomotive is the pack's green steam engine
with red beams and wheels, a shunter its yellow diesel, and a peer's line is
worked by the locomotive too: its goods ride behind one, in the two kinds
the pack left iron all over, the box van and the coal wagon. The paint says nothing of the bead: its type is read from its label
and its card, not from its wagon. Red and maroon are no building's: red is a
fault's and a stop lamp's.

What means something is put on the kit's paint, and a test measures how far
each is from every colour of every wagon, fresh, dull and rusted, in the sun
and in the shade (`test/scene.test.ts`, the distance in Oklab, where 0.1 is
told at a glance):

| on | clear lamp | amber lamp | stop lamp / fault red | flag | chocks |
| --- | --- | --- | --- | --- | --- |
| the blue container | 0.39 | 0.33 | 0.11 | 0.05 | 0.18 |
| the green container | 0.18 | 0.21 | 0.29 | 0.26 | 0.21 |
| the red container | 0.44 | 0.24 | 0.02 | 0.01 | 0.11 |
| the tank | 0.44 | 0.24 | 0.02 | 0.01 | 0.11 |
| the logs | 0.31 | 0.11 | 0.09 | 0.08 | 0.05 |
| the locomotive | 0.18 | 0.21 | 0.03 | 0.01 | 0.12 |

The clear lamp is a brighter green (`0x55f744`) so it reads even on the kit's
green container and locomotive. The amber of a wait lies on the roof and
reads on all of them. The kit's red is a fault's red (the blue container has
it too, at its darkest), and its logs are near the chocks' orange: by colour
alone a red lamp and a flag are not told from a red container. They stand on
a post over the roof, and chocks lie on the rail, so what they are seen
against is the ground, the platform and the track, and the iron of frame and
wheels: there each is 0.13 or more, by day and by night. The weather tints the whole wagon, the kit's texture
with it: dull is 0.14 or more from fresh on every colour and iron (0.09 on
the darks of a frame, which have little to lose), and rust
goes on from dull on the blue, the green and the iron (0.08 to 0.13), while
on the kit's red and on the logs rust is their own hue (0.03 to 0.05) and
the iron beside them says it. Moss is 0.16 or more from the rust it lies on.

The people are the kit's own, in its texture as it came; a hard hat is ours,
hi-vis yellow for a builder and white for a reviewer.

`src/palette.ts` is the one place that names a colour of the picture, the
labels' ink and pill too. Its tones are the greys and creams of the ground,
the track and the platforms, one set by day and one by night. Its accents are
Latte's by day and Mocha's by night under the same names, so what is mauve is
mauve in both. A lamp, a fault and the weather are the same in both, and so
is the kit's texture, a wagon's colours with it: it is lit as the people are
and not recoloured. Night is
the same picture on a near-black blue with the labels turned round. The page takes it when the
reader's system is dark; Night on the bar says otherwise, and the browser
remembers that until it is what the system says anyway. The camera looks down
at an angle and is orthographic, as it was: nothing grows smaller with
distance, so the yard reads as a map.

A browser that refuses or drops the picture gets a light one (`src/canvas.ts`):
no shadow, no antialiasing and one pixel to one of the page's, with the yard,
its labels, the replay and the controls as they were. `?light` on the page's
address asks for it outright, and the note then says "light picture".

The page takes it on its own at three moments, and the note says which.
Refused at the start, it asks once more for the light one ("the browser
refused the picture; drawing it lighter"), and only that refused too is the
note of what helps. Lost once, it waits three seconds for the browser to give
the picture back, and draws it light when it does not; lost a second time, it
draws it light at once ("the browser dropped the picture; drawing it
lighter"). After any of these the browser remembers, and the page starts
light there until `?full` is on the address.

A phone or a tablet starts light, as its browser drops the full picture: a
coarse pointer and a viewport whose shorter side is under 900 CSS px
(`handheld`), with the note "light picture on a phone: ?full asks for the
full one", and `?full` draws the full one there too.

