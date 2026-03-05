import { shuffleDeck, drawRandomCard } from "./initialState";

// Other code remains the same...

function drawCard(player: PlayerState): PlayerState {
  const drawn = drawRandomCard();
  return {
    ...player,
    hand: [...player.hand, drawn],
  };
}

// Rest of the file remains intact...