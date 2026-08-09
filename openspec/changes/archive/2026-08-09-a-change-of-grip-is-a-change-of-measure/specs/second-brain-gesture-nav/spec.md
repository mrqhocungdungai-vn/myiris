## ADDED Requirements

### Requirement: A camera drive re-seeds when its measurement changes, not only when the drive does

A camera drive's seeded reference SHALL belong to the **measurement** it was taken with, not merely to the drive. The two zoom pose pairs are one drive and do one job, but they read different landmarks — two open palms from their fingertips, a fist and a palm from the fist's wrist — so a change from one to the other SHALL re-seed the reference exactly as a change of drive does.

Without this the reference keeps the old basis while the current span is read in the new one, and because the zoom law is a ratio of the two, the entire discontinuity is applied as camera travel in a single frame. This lands precisely on the gesture it is worst for: closing one of two zooming palms into a fist to reel in on the note just locked.

What a reference belongs to SHALL be stored as **one value**, so that the drive and the measurement can never be compared separately, and that value SHALL be typed so that storing a bare drive in its place is rejected at compile time. The gesture loop has no tests — it requires a live force-graph and a camera — so an invariant there holds structurally or not at all.

#### Scenario: Closing a palm into a fist does not jump the camera

- **WHEN** the user is zooming with two open palms and closes one into a fist while a note is locked
- **THEN** the reel-in begins from where the camera already is, with no jump

#### Scenario: Opening a fist back into a palm does not jump the camera

- **WHEN** the user is reeling in with a fist and an open palm and opens the fist into a second palm
- **THEN** the free zoom continues from where the camera already is

#### Scenario: Holding one pose pair does not re-seed

- **WHEN** the user holds the same pose pair and moves their hands
- **THEN** the reference is kept, so the spread already spent keeps counting
