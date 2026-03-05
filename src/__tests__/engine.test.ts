import { gameReducer, applyExchange, clampStat, drawCard } from "../../engine/gameEngine";
import { createInitialState } from "../../engine/initialState";
import { GameState, Card, PlayerState, PlayerStats } from "../../domain/types";
import { CARD_REGISTRY } from "../../engine/cardRegistry";

// ============================================================
// Helpers
// ============================================================

const makeExchangeCard = (): Card => ({
  id: "test_exchange",
  name: "両替",
  type: "EXCHANGE",
  mpCost: 0,
  effect: { type: "REDISTRIBUTE", targetHp: 0, targetMp: 0, targetPay: 0 },
});

const makeAtkPlusCard = (): Card => ({
  id: "test_atk_plus",
  name: "連撃",
  type: "ATTACK",
  mpCost: 5,
  effect: { type: "DAMAGE", power: 10, element: "FIRE" },
  attackPlus: true,
});

const makeAtkCard = (): Card => ({
  id: "test_atk",
  name: "攻撃",
  type: "ATTACK",
  mpCost: 5,
  effect: { type: "DAMAGE", power: 10, element: "FIRE" },
});

// ============================================================
describe("clampStat", () => {
  test("上限99を超えた分は消滅", () => {
    expect(clampStat(100)).toBe(99);
    expect(clampStat(200)).toBe(99);
  });

  test("下限0未満は0", () => {
    expect(clampStat(-1)).toBe(0);
    expect(clampStat(-100)).toBe(0);
  });

  test("通常値はそのまま", () => {
    expect(clampStat(50)).toBe(50);
    expect(clampStat(0)).toBe(0);
    expect(clampStat(99)).toBe(99);
  });
});

// ============================================================
describe("applyExchange", () => {
  test("合計値を保ったまま再分配できる", () => {
    const stats: PlayerStats = { hp: 40, mp: 10, pay: 20 };
    const result = applyExchange(stats, {
      type: "REDISTRIBUTE",
      targetHp: 9,
      targetMp: 54,
      targetPay: 7,
    });
    expect(result.hp).toBe(9);
    expect(result.mp).toBe(54);
    expect(result.pay).toBe(7);
  });

  test("合計値が違う場合はエラー", () => {
    const stats: PlayerStats = { hp: 40, mp: 10, pay: 20 };
    expect(() =>
      applyExchange(stats, { type: "REDISTRIBUTE", targetHp: 10, targetMp: 10, targetPay: 10 })
    ).toThrow();
  });

  test("STAT_MAX超えはエラー", () => {
    const stats: PlayerStats = { hp: 50, mp: 30, pay: 20 };
    expect(() =>
      applyExchange(stats, { type: "REDISTRIBUTE", targetHp: 100, targetMp: 0, targetPay: 0 })
    ).toThrow();
  });
});

// ============================================================
describe("HP=0自発両替 → 即敗北", () => {
  test("両替でHP=0にするとGAME_OVERになる", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player = state.players[activeId];
    const total = player.stats.hp + player.stats.mp + player.stats.pay;

    // EXCHANGE_PHASEに進める
    state = { ...state, phase: "EXCHANGE_PHASE" };

    const exchangeCard = makeExchangeCard();
    const stateWithCard: GameState = {
      ...state,
      players: {
        ...state.players,
        [activeId]: { ...player, hand: [exchangeCard, ...player.hand] },
      },
    };

    const next = gameReducer(stateWithCard, {
      type: "USE_EXCHANGE",
      card: exchangeCard,
      targetHp: 0,
      targetMp: total,
      targetPay: 0,
    });

    expect(next.phase).toBe("GAME_OVER");
    expect(next.winner).not.toBeNull();
    expect(next.winner).not.toBe(activeId);
  });
});

// ============================================================
describe("drawCard", () => {
  test("デッキから1枚ドロー", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player = state.players[activeId];
    const deckBefore = player.deck.length;
    const handBefore = player.hand.length;

    const { player: newPlayer } = drawCard(player);
    expect(newPlayer.hand.length).toBe(handBefore + 1);
    expect(newPlayer.deck.length).toBe(deckBefore - 1);
  });

  test("デッキ切れ時に捨て札がシャッフルされてデッキに戻る", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player = state.players[activeId];

    // デッキを空にして捨て札に10枚追加
    const emptyDeckPlayer: PlayerState = {
      ...player,
      deck: [],
      discardPile: CARD_REGISTRY.slice(0, 10) as Card[],
    };

    const { player: newPlayer, drawnCard } = drawCard(emptyDeckPlayer);
    expect(drawnCard).not.toBeNull();
    expect(newPlayer.discardPile.length).toBe(0);
    expect(newPlayer.deck.length).toBe(9); // 10枚→1枚ドロー後9枚
  });

  test("デッキも捨て札も空 → drawnCard は null", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player: PlayerState = { ...state.players[activeId], deck: [], discardPile: [] };
    const { drawnCard } = drawCard(player);
    expect(drawnCard).toBeNull();
  });
});

// ============================================================
describe("攻撃フェーズ", () => {
  test("攻撃カードなし → PRAY で1枚ドロー & END_CHECK に遷移", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player = state.players[activeId];

    // 手札から攻撃カードをすべて除去
    const noAtkHand = player.hand.filter(
      (c) => c.type !== "ATTACK" && c.type !== "MIRACLE_ATK"
    );
    const handBefore = noAtkHand.length;

    state = {
      ...state,
      phase: "ATTACK_PHASE",
      players: { ...state.players, [activeId]: { ...player, hand: noAtkHand } },
    };

    const next = gameReducer(state, { type: "PRAY" });
    expect(next.phase).toBe("END_CHECK");
    expect(next.players[activeId].hand.length).toBe(handBefore + 1);
  });

  test("attackPlus カード使用後 → 続けて攻撃カードを使用できる", () => {
    let state = createInitialState(2);
    const activeId = state.turnOrder[0];
    const player = state.players[activeId];

    const atkPlusCard = makeAtkPlusCard();
    const atkCard = makeAtkCard();
    state = {
      ...state,
      phase: "ATTACK_PHASE",
      players: {
        ...state.players,
        [activeId]: {
          ...player,
          hand: [atkPlusCard, atkCard, ...player.hand],
          stats: { ...player.stats, mp: 99 },
        },
      },
    };

    // attackPlusカードを使用
    let next = gameReducer(state, { type: "USE_ATTACK", card: atkPlusCard });
    expect(next.battleContext?.attackUsedCount).toBe(1);
    expect(next.battleContext?.attackPlusActive).toBe(true);

    // 続けて追加攻撃
    next = gameReducer(next, { type: "USE_ATTACK", card: atkCard });
    expect(next.battleContext?.attackUsedCount).toBe(2);
    expect(next.battleContext?.attackTotal).toBe(20);
  });
});

// ============================================================
describe("ターン交代", () => {
  test("P1→P2→P1 の順でターンが交代する", () => {
    let state = createInitialState(2);
    state = { ...state, phase: "END_CHECK" };

    const first = state.turnOrder[0];
    const second = state.turnOrder[1];

    let next = gameReducer(state, { type: "END_TURN" });
    expect(next.turnOrder[next.activePlayerIndex]).toBe(second);

    next = { ...next, phase: "END_CHECK" };
    next = gameReducer(next, { type: "END_TURN" });
    expect(next.turnOrder[next.activePlayerIndex]).toBe(first);
  });
});
