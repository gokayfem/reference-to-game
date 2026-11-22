# Reference image to game development sheet

Attach a screenshot, illustration, sketch, or representative frame in an image editor that accepts a reference image and a text instruction. Choose the question your sheet should answer and paste its entire prompt. Each works on its own. If you have a game title or an established mechanic, add it in one sentence. A 4:3 landscape canvas matches the worked examples.

| What should the sheet explain? | Worked example | Input | Finished sheet |
|---|---|---|---|
| [How does the player move through a level?](#movement-and-level-design) | Jungle Jetboat Jump | [Gameplay image](../examples/jungle-jetboat-jump/references/ref-001-gameplay-original.png) | [Visual development sheet](../examples/jungle-jetboat-jump/references/ref-002-asset-sheet.png) |
| [How do pieces interact to solve a puzzle?](#systems-and-puzzle-design) | Jellyworks | [Gameplay image](../examples/jellyworks/references/ref-001-gameplay-original.png) | [System sheet](../examples/jellyworks/references/ref-002-asset-sheet.png) |
| [What can the player find and do in this world?](#world-and-discovery) | Petal Pals | [Gameplay image](../examples/petal-pals/references/ref-001-gameplay-original.png) | [World and discovery sheet](../examples/petal-pals/references/ref-002-asset-sheet.png) |

The pairs above come from the original, game-specific prompts. The versions below carry their drawing and design instructions over to a new subject.

## Movement and level design

```text
Use the attached image as the visual reference for one 4:3 landscape game development sheet. Give the largest panel to a playable moment seen from the reference viewpoint. Preserve the main subject's silhouette and scale in the frame, the relative area of each color, the lighting, and the way edges and surfaces are rendered. Pull the sheet background and divider colors from quieter areas of the image. Use the supplied or visible title if available, followed by “Visual Development”.

Show what moves. Isolate the player-controlled subject in side, front, rear, and three-quarter views where its form supports them. Keep distinctive markings, equipment, and proportions in register across views. Enlarge the detail that explains how movement works. If a rider or crew is present, keep their positions consistent and show how their posture changes during a maneuver. Give an abstract or flat subject the equivalent facing and motion states in its own visual language.

Show where it moves. Break the setting into reusable traversable surfaces, boundaries, landmarks, and obstacles. Draw two small stretches built from the same pieces, one open and one constrained. Beside them, map a continuous route from entry to goal. Mark travel direction, a decision point, and the space needed to clear the hardest maneuver. Use the same landmark silhouettes in the scene, kit, and map legend. Design unseen terrain as a proposed route.

Show how the maneuver feels in a strip of five frames. Choose an action suited to this subject. Draw its approach, input, commitment, resolution, and recovery from a consistent camera direction. Place an arrow where the path changes and a visual effect where the action has a consequence. Isolate the most useful effects below the strip so an artist could reproduce their timing and shape.

Finish with one in-context HUD and its key components at a readable scale. Show how one indicator changes before and after the maneuver. Reuse visible interface shapes and labels. If the source has no interface, group new elements under “Proposed UI”. Add small palette and surface samples taken from the subject and setting. Give each panel a short heading and let the drawings carry the explanation.
```

## Systems and puzzle design

```text
Expand the attached image into one 4:3 landscape game-system sheet. Center the composition on a legible puzzle in progress. Keep the source's forms, relative scale, palette, viewpoint, surface finish, and treatment of depth. Use its title if supplied or visible. Identify one rule that suits the objects in the image. If the image establishes only an appearance, group the invented rule and layout under “Proposed Puzzle”.

Draw a kit of the working parts. Isolate the pieces the player can change, the objects or states they affect, and the goal. Show the most important component from two useful angles, with a close-up of the connection, contact point, or marking that determines a legal move. Draw compatible parts at the same scale and orientation. Preserve differences in silhouette or markings so the reader can distinguish their roles even when their colors are similar.

Explain the rule with a small set of illustrated equations. Follow a starting piece or state through a legal action to its result, then show a second case where changing one condition produces a different result. For transformations, track what goes in and what comes out. For matching or spatial rules, show the exact arrangement that satisfies the goal. Reuse the kit drawings in each equation. Pair one invalid move with its smallest repair, highlighting only the piece that changes.

Draw the central puzzle and a simplified planning diagram of that same position. Match piece locations, orientations, and goals between the two. Trace one complete solution from the illustrated start. For a flow puzzle, connect every active output to a valid input or destination. For a placement puzzle, show legal intermediate positions. Add three compact level cards that teach the rule, combine it with a second constraint, then test it in less space.

Show the player's controls for the moves just illustrated, including available, selected, and unavailable states. Pair a move or progress counter with the actual before-and-after positions it describes. Show success feedback at the object and in the interface. Match visible UI lettering and materials where present. Arrange material swatches and scenery outside the playing area. Keep arrows directional, labels short, and the smallest pieces readable.
```

## World and discovery

```text
Use the attached image to create one illustrated 4:3 landscape world and discovery sheet. Build the page around a large scene that shows what draws the player into this place. Preserve the reference's framing, rendering medium, light, color balance, surface detail, and characteristic shapes. Use a quieter value from the image behind the studies. Set the supplied or visible title above “World & Discovery”.

Identify who or what the player follows and what they can discover. Draw the focal subject from several useful views at a common scale. Preserve identifying details on the correct side. Show the gestures or states needed to approach, inspect, and interact. Give two or three discoveries distinct silhouettes, a close view, and contrasting states visible during play. These may be inhabitants, artifacts, plants, structures, or phenomena suited to the source. Where both a category and an individual have names, keep those labels distinct and consistent across the sheet.

Build a region from the visible setting. Draw a top-down map with connected paths, an arrival point, distinct landmarks, places to stop and observe, and a destination worth reaching. Derive barriers and crossings from this world's geography. Give the map icons the same profiles as the objects they mark. Set out a reusable environment kit with scale variations, ground transitions, and a coordinated group of props for one landmark. Show two small scenes where the placement of a discovery makes sense in its surroundings. Keep traversable space easy to follow.

Tell one interaction in consecutive frames. Establish the discovery in the world, show a player action, draw the visible response, then record the outcome. Carry the same subject, markings, and scale through the sequence. Reuse that exact discovery in an observation card, a map marker, and a journal or inventory entry. Show the entry before and after the interaction with one clearly changed field.

Finish with an in-context interface and isolated components for orientation, interaction, and recording progress. Derive their shapes, contrast, and lettering from visible interface details or the source artwork. Group invented locations and interactions as proposed additions. Use short labels, aligned studies, and enough space to read the smallest map symbol.
```

Compare the result with the original at the same display size. Check one identifying detail across views, then trace the route, puzzle solution, or discovery from its first panel to its last. If a panel breaks continuity, name the exact correction in a follow-up edit, such as “Turn the elbow in the plan so it connects the same two pieces as the main board.” When building the game, supply both images and identify which proposed mechanics you want to keep.
