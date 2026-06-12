#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# random-slug.sh
# Generate a playful 3-word hyphenated slug for use as a default
# subdomain / app name during /gz:webapp:new-app.
#
# Format: {adjective}-{adjective}-{noun}
# Example output: "swimming-ancient-shrubbery"
#
# Pure bash; no dependencies beyond a POSIX shell and $RANDOM.
# ──────────────────────────────────────────────────────────────────

ADJ_1=(
  swimming ancient purple happy grumpy tiny giant shiny sleepy zesty
  cosmic electric silly fuzzy mighty velvet silent dancing whispering roaring
  soaring glowing rusty crisp bold gentle clever wise brave quirky
  spicy mellow frosty dusty golden crimson wandering spiraling drifting flickering
  humming buzzing chattering prancing galloping lurking perched nestled
)

ADJ_2=(
  curious stellar twilight midnight ember forest mountain ocean meadow canyon
  river crystal silver copper bronze echo storm thunder whisper shadow
  amber topaz violet sage willow cedar oak pine marble granite
  harbor tundra desert savanna glacier nebula comet lunar solar monsoon
  verdant azure scarlet ochre obsidian onyx pewter emerald
)

NOUNS=(
  shrubbery elephant kettle badger otter penguin narwhal pangolin anvil teapot
  umbrella compass lantern cactus sprocket widget cauldron beacon harbor orchard
  trestle ledger quilt tambourine accordion fiddle gramophone typewriter telescope microscope
  kaleidoscope sundial hedgehog wombat platypus capybara meerkat lemur fox raccoon
  doorknob mailbox pinecone acorn driftwood seashell inkwell pocketwatch dandelion thimble
)

a1=${ADJ_1[$RANDOM % ${#ADJ_1[@]}]}
a2=${ADJ_2[$RANDOM % ${#ADJ_2[@]}]}
n=${NOUNS[$RANDOM % ${#NOUNS[@]}]}

echo "${a1}-${a2}-${n}"
