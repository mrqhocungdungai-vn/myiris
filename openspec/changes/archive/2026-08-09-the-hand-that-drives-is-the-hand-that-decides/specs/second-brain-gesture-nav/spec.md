## MODIFIED Requirements

### Requirement: A lowered hand releases every camera drive

A hand that has dropped to the lower part of the camera frame SHALL NOT drive the
galaxy camera: a camera drive in progress SHALL be released, and a new one
SHALL NOT engage, until the hand is raised again.

**The hands asked SHALL be the hands the drive reads** — both palms of a
two-palm zoom, both hands of a reel-in, the fist that turns the view — and ANY
of them being low SHALL release it. The primary hand SHALL NOT be used for this:
the primary is chosen with a preference for pointing hands, no camera drive has
one, and the fallback is whichever hand was primary before. Deciding a drive's
fate on that makes the same gesture live or die according to history the user
cannot see, and an intermittent release reads as roughness rather than as a
release.

Mid-air gesture control is physically tiring, so a user resting their arm is a
routine event rather than an edge case — and the pose a hand falls into while being
lowered is not chosen deliberately. Without this, lowering a tired arm drags the
camera across the graph, which both loses the view the user had worked to reach and
teaches them that putting their arm down is unsafe.

The release SHALL behave exactly like any other exit from a drive: the drive's
reference is released rather than frozen, mouse control returns intact, and raising
the hand and re-engaging seeds a fresh reference from the live camera, so nothing
jumps.

This SHALL apply to the camera drives only. It SHALL NOT suppress the dwell, the
inspect reveal, or the step rail — those are deliberate acts that already require
the hand to be held at a target, and a lowered hand simply will not be at one.

#### Scenario: Lowering the hands stops the camera drive

- **WHEN** the user is flying the camera with two open palms and lowers their hands toward the bottom of the frame
- **THEN** the drive is released and the camera stops moving, leaving the view where it was

#### Scenario: A drive does not engage from a lowered hand

- **WHEN** the user's hand is resting low in the frame and happens to read as a fist or as two open palms
- **THEN** no camera drive engages

#### Scenario: Raising the hand again resumes cleanly

- **WHEN** the user lowers their hand mid-drive and later raises it and re-engages
- **THEN** the drive seeds a fresh reference from the camera's live position and applies no motion on its first frame

#### Scenario: Mouse control survives a lowered-hand release

- **WHEN** a camera drive is released because the hand was lowered
- **THEN** mouse drag and zoom work immediately afterwards, exactly as after any other release

#### Scenario: A low holding fist releases the reel-in

- **WHEN** the user reels in with a fist held low in the frame and an open palm held high
- **THEN** the drive is released, whichever hand the app last treated as primary
