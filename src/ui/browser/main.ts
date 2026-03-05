import { GameState, GameAction, Card, PlayerId, Phase, Element } from "../../domain/types";
import { createInitialState } from "../../engine/initialState";
import { gameReducer, MAX_STAT } from "../../engine/gameEngine";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCAL_PLAYER: PlayerId = "P1";
const AI_PLAYER: PlayerId = "P2";
/** Number of card slots shown in the hand area (initial draw = 7, +1 per draw). */
const HAND_DISPLAY_SLOTS = 8;

const ELEMENT_EMOJI: Record<Element, string> = {
  FIRE: "🔥",
  WATER: "💧",
  WOOD: "🌿",
  EARTH: "🪨",
  LIGHT: "☀️",
  DARK: "🌑",
  NEUTRAL: "⬜",
};

const ELEMENT_LABEL: Record<Element, string> = {
  FIRE: "火",
  WATER: "水",
  WOOD: "木",
  EARTH: "土",
  LIGHT: "光",
  DARK: "闇",
  NEUTRAL: "無",
};

const TYPE_LABEL: Record<string, string> = {
  ATTACK: "攻",
  DEFENSE: "守",
  EXCHANGE: "両替",
  MIRACLE_ATK: "奇跡攻",
  MIRACLE_DEF: "奇跡守",
  SELL: "売",
  BUY: "買",
};

const PHASE_LABEL: Record<Phase, string> = {
  DRAW_PHASE: "ドロー",
  EXCHANGE_PHASE: "両替",
  ATTACK_PHASE: "攻撃",
  DEFENSE_PHASE: "防御",
  RESOLVE_PHASE: "解決",
  END_CHECK: "終了確認",
  GAME_OVER: "ゲームオーバー",
};

// ─── Mutable State ────────────────────────────────────────────────────────────

let gameState: GameState = createInitialState([LOCAL_PLAYER, AI_PLAYER]);
let selectedCards: Card[] = [];
let hoveredCard: Card | null = null;
let turnCount = 1;
let logMessages: string[] = [];
let showLog = false;
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActiveId(): PlayerId {
  return gameState.playerOrder[gameState.activePlayerIndex];
}

function isLocalPlayerActive(): boolean {
  return getActiveId() === LOCAL_PLAYER;
}

function addLog(msg: string): void {
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  logMessages.push(`[${ts}] ${msg}`);
  if (logMessages.length > 100) logMessages.shift();
}

function isAttackCard(card: Card): boolean {
  return card.type === "ATTACK" || card.type === "MIRACLE_ATK";
}

function isDefenseCard(card: Card): boolean {
  return card.type === "DEFENSE" || card.type === "MIRACLE_DEF";
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

function dispatch(action: GameAction): void {
  const prev = gameState;
  gameState = gameReducer(gameState, action);
  if (prev.activePlayerIndex !== gameState.activePlayerIndex) {
    turnCount++;
  }
  selectedCards = [];
  render();
  scheduleAutoAdvance();
}

// ─── Auto-Advance ────────────────────────────────────────────────────────────

function scheduleAutoAdvance(): void {
  if (autoAdvanceTimer !== null) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }

  if (gameState.phase === "GAME_OVER") return;

  const activeId = getActiveId();

  // Always auto-advance RESOLVE_PHASE and END_CHECK regardless of who is active
  if (gameState.phase === "RESOLVE_PHASE") {
    autoAdvanceTimer = setTimeout(() => {
      dispatch({ type: "RESOLVE" });
    }, 800);
    return;
  }

  if (gameState.phase === "END_CHECK") {
    autoAdvanceTimer = setTimeout(() => {
      dispatch({ type: "END_TURN" });
    }, 600);
    return;
  }

  // AI's turn
  if (activeId === AI_PLAYER) {
    handleAITurn();
    return;
  }

  // Local player's turn
  if (activeId === LOCAL_PLAYER) {
    // Auto-draw: player never clicks DRAW manually
    if (gameState.phase === "DRAW_PHASE") {
      autoAdvanceTimer = setTimeout(() => {
        addLog("カードをドローしました");
        dispatch({ type: "DRAW" });
      }, 400);
      return;
    }

    // Auto-end exchange (simplified — no exchange UI)
    if (gameState.phase === "EXCHANGE_PHASE") {
      autoAdvanceTimer = setTimeout(() => {
        dispatch({ type: "END_EXCHANGE" });
      }, 300);
      return;
    }

    // ATTACK_PHASE: player takes action manually → nothing to auto-advance
    if (gameState.phase === "ATTACK_PHASE") return;
  }

  // DEFENSE_PHASE: handle all non-active player confirmations
  if (gameState.phase === "DEFENSE_PHASE") {
    const defenders = gameState.playerOrder.filter((id) => id !== activeId);
    // Auto-confirm AI's defense (when P1 is attacking)
    if (
      activeId === LOCAL_PLAYER &&
      defenders.includes(AI_PLAYER) &&
      !gameState.confirmedDefenders.includes(AI_PLAYER)
    ) {
      autoAdvanceTimer = setTimeout(() => {
        dispatch({ type: "CONFIRM_DEFENSE", playerId: AI_PLAYER });
      }, 600);
    }
    // When P2 is attacking, P1 defends manually — no auto-advance
  }
}

function handleAITurn(): void {
  const ai = gameState.players[AI_PLAYER];
  if (!ai) return;

  if (gameState.phase === "DRAW_PHASE") {
    autoAdvanceTimer = setTimeout(() => {
      addLog("P2がカードをドローしました");
      dispatch({ type: "DRAW" });
    }, 900);
    return;
  }

  if (gameState.phase === "EXCHANGE_PHASE") {
    autoAdvanceTimer = setTimeout(() => {
      dispatch({ type: "END_EXCHANGE" });
    }, 600);
    return;
  }

  if (gameState.phase === "ATTACK_PHASE") {
    // If attackPlus is active and we have cards in play, decide to confirm or add more
    if (gameState.attackCards.length > 0 && gameState.attackPlusActive) {
      const usableAttacks = ai.hand.filter(
        (c) => isAttackCard(c) && ai.stats.mp >= c.mpCost
      );
      if (usableAttacks.length > 0 && Math.random() < 0.5) {
        // Add another attack card
        const card = usableAttacks[Math.floor(Math.random() * usableAttacks.length)];
        autoAdvanceTimer = setTimeout(() => {
          addLog(`P2が追加で「${card.name}」を使用！`);
          dispatch({ type: "ATTACK", cards: [card] });
        }, 900);
      } else {
        // Confirm the attack
        autoAdvanceTimer = setTimeout(() => {
          dispatch({ type: "CONFIRM_ATTACK" });
        }, 700);
      }
      return;
    }

    const usableAttacks = ai.hand.filter(
      (c) => isAttackCard(c) && ai.stats.mp >= c.mpCost
    );
    const hasAnyAttackInHand = ai.hand.some((c) => isAttackCard(c));

    if (usableAttacks.length > 0) {
      const card = usableAttacks[Math.floor(Math.random() * usableAttacks.length)];
      autoAdvanceTimer = setTimeout(() => {
        addLog(`P2が「${card.name}」で攻撃！`);
        dispatch({ type: "ATTACK", cards: [card] });
      }, 1000);
    } else if (!hasAnyAttackInHand) {
      // No attack cards in hand at all → PRAY
      autoAdvanceTimer = setTimeout(() => {
        addLog("P2は祈りを捧げました（カードをドロー）");
        dispatch({ type: "PRAY" });
      }, 1000);
    } else {
      // Has attack cards but MP too low → confirm if cards in play, else skip (stuck edge case)
      if (gameState.attackCards.length > 0) {
        autoAdvanceTimer = setTimeout(() => {
          dispatch({ type: "CONFIRM_ATTACK" });
        }, 700);
      }
      // else: stuck edge case — game engine doesn't allow PRAY with attack cards in hand
      // No action possible; would need the engine to support a "skip" action
    }
    return;
  }

  // DEFENSE_PHASE when AI is the active attacker — do nothing, P1 defends manually
}

// ─── Player Actions ───────────────────────────────────────────────────────────

function handleAttack(): void {
  if (!isLocalPlayerActive()) return;
  if (gameState.phase !== "ATTACK_PHASE" && gameState.phase !== "EXCHANGE_PHASE") return;
  if (selectedCards.length === 0) return;
  if (!selectedCards.every(isAttackCard)) {
    addLog("攻撃カードのみ選択してください");
    return;
  }
  const card = selectedCards[0];
  addLog(`「${card.name}」で攻撃！`);
  dispatch({ type: "ATTACK", cards: selectedCards });
}

function handleConfirmAttack(): void {
  if (!isLocalPlayerActive()) return;
  if (gameState.phase !== "ATTACK_PHASE") return;
  dispatch({ type: "CONFIRM_ATTACK" });
}

function handlePray(): void {
  if (!isLocalPlayerActive()) return;
  const ph = gameState.phase;
  if (ph !== "ATTACK_PHASE" && ph !== "EXCHANGE_PHASE") return;
  addLog("祈りを捧げました（カードをドロー）");
  dispatch({ type: "PRAY" });
}

function handleDefend(): void {
  if (gameState.phase !== "DEFENSE_PHASE") return;
  if (selectedCards.length === 0) {
    // Confirm with no cards
    addLog("防御なしで確定");
    dispatch({ type: "CONFIRM_DEFENSE", playerId: LOCAL_PLAYER });
    return;
  }
  if (!selectedCards.every(isDefenseCard)) {
    addLog("防御カードのみ選択してください");
    return;
  }
  const cardsToDefend = [...selectedCards];
  dispatch({ type: "DEFEND", playerId: LOCAL_PLAYER, cards: cardsToDefend });
  addLog(`防御カードを使用: ${cardsToDefend.map((c) => c.name).join(", ")}`);
  dispatch({ type: "CONFIRM_DEFENSE", playerId: LOCAL_PLAYER });
}

function handleCardClick(card: Card): void {
  const idx = selectedCards.findIndex((c) => c.id === card.id);
  if (idx !== -1) {
    selectedCards = selectedCards.filter((_, i) => i !== idx);
  } else {
    selectedCards = [...selectedCards, card];
  }
  render();
}

function handleRestart(): void {
  if (autoAdvanceTimer !== null) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  gameState = createInitialState([LOCAL_PLAYER, AI_PLAYER]);
  selectedCards = [];
  hoveredCard = null;
  turnCount = 1;
  logMessages = [];
  addLog("新しいゲームを開始しました");
  render();
  scheduleAutoAdvance();
}

// ─── Render Helpers ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (HTMLElement | string | null)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") e.className = String(v);
    else if (k === "textContent") e.textContent = String(v);
    else if (k.startsWith("data-")) e.setAttribute(k, String(v));
    else if (typeof v === "boolean") {
      if (v) e.setAttribute(k, "");
    } else {
      (e as unknown as Record<string, string>)[k] = v;
    }
  }
  for (const child of children) {
    if (child === null) continue;
    if (typeof child === "string") e.appendChild(document.createTextNode(child));
    else e.appendChild(child);
  }
  return e;
}

function makeCardTile(card: Card, selected: boolean, onClick?: () => void, small = false): HTMLElement {
  const cls = small ? "card-tile-sm" : "card-tile";
  const typeLabel = TYPE_LABEL[card.type] ?? card.type;
  const powerText = card.power > 0 ? `${typeLabel}${card.power}` : typeLabel;

  const tile = el("div", { className: `${cls} el-${card.element}${selected ? " selected" : ""}` });

  const emojiEl = el("span", { className: `${cls}__element`, textContent: ELEMENT_EMOJI[card.element] });
  const nameEl = el("span", { className: `${cls}__name`, textContent: card.name });
  const powerEl = el("span", { className: `${cls}__power`, textContent: powerText });

  if (!small) {
    const typeEl = el("span", { className: "card-tile__type", textContent: `MP:${card.mpCost}` });
    tile.append(emojiEl, nameEl, powerEl, typeEl);
  } else {
    tile.append(emojiEl, nameEl, powerEl);
  }

  tile.addEventListener("mouseenter", () => {
    hoveredCard = card;
    renderCardDetail();
  });
  tile.addEventListener("mouseleave", () => {
    hoveredCard = null;
    renderCardDetail();
  });

  if (onClick) {
    tile.addEventListener("click", onClick);
  }

  return tile;
}

// ─── Component Renders ────────────────────────────────────────────────────────

let cardDetailContainer: HTMLElement | null = null;

function renderCardDetail(): void {
  if (!cardDetailContainer) return;
  cardDetailContainer.innerHTML = "";

  const h3 = el("h3", { textContent: "カード詳細" });
  cardDetailContainer.appendChild(h3);

  if (!hoveredCard) {
    cardDetailContainer.appendChild(el("p", { className: "card-detail-empty", textContent: "カードにホバーで詳細表示" }));
    return;
  }

  const c = hoveredCard;
  const thumb = el("div", { className: `card-detail__thumb el-${c.element}` });
  thumb.appendChild(el("span", { textContent: ELEMENT_EMOJI[c.element] }));
  thumb.appendChild(el("span", { textContent: c.name, className: "card-detail__name" }));

  const rows: [string, string][] = [
    ["属性", `${ELEMENT_EMOJI[c.element]} ${ELEMENT_LABEL[c.element]}`],
    ["タイプ", TYPE_LABEL[c.type] ?? c.type],
    ["威力", c.power > 0 ? String(c.power) : "—"],
    ["MPコスト", String(c.mpCost)],
  ];

  cardDetailContainer.appendChild(thumb);
  for (const [label, val] of rows) {
    const row = el("div", { className: "card-detail__row" });
    row.appendChild(el("span", { textContent: label }));
    row.appendChild(el("span", { className: "card-detail__val", textContent: val }));
    cardDetailContainer.appendChild(row);
  }
}

// ─── Full Render ──────────────────────────────────────────────────────────────

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = "";

  app.appendChild(buildTopBar());
  app.appendChild(buildMainArea());
  app.appendChild(buildHandArea());
  app.appendChild(buildBottomBar());

  if (gameState.phase === "GAME_OVER") {
    app.appendChild(buildGameOverOverlay());
  }

  if (showLog) {
    app.appendChild(buildLogPanel());
  }
}

function buildTopBar(): HTMLElement {
  const bar = el("div", { className: "top-bar" });

  // Left
  const left = el("div", { className: "top-bar__left" });
  const backBtn = el("button", { className: "btn-icon", textContent: "← 戻る" });
  backBtn.addEventListener("click", () => {
    if (confirm("ゲームを終了しますか？")) handleRestart();
  });
  const stageLabel = el("span", { className: "top-bar__stage", textContent: "ステージ 1" });
  left.append(backBtn, stageLabel);

  // Center
  const center = el("div", { className: "top-bar__center" });
  const gfLabel = el("span", { className: "top-bar__gf", textContent: `G.F.  ${turnCount} / 99` });

  // Phase badge
  const activeId = getActiveId();
  const phaseName = PHASE_LABEL[gameState.phase] ?? gameState.phase;
  const isAiPhase = activeId === AI_PLAYER && gameState.phase !== "GAME_OVER";
  const phaseClass = `phase-badge${isAiPhase ? " ai" : " active"}`;
  const phaseBadge = el("span", { className: phaseClass, textContent: phaseName });
  if (isAiPhase) {
    phaseBadge.appendChild(el("span", { className: "thinking-dot" }));
  }
  center.append(gfLabel, phaseBadge);

  // Right
  const right = el("div", { className: "top-bar__right" });
  const bagBtn = el("button", { className: "btn-icon", textContent: "🎒" });
  const codexBtn = el("button", { className: "btn-icon", textContent: "📖 教典" });
  right.append(bagBtn, codexBtn);

  bar.append(left, center, right);
  return bar;
}

function buildMainArea(): HTMLElement {
  const main = el("div", { className: "main-area" });

  // Left: local player panel
  main.appendChild(buildLocalPlayerPanel());

  // Right column
  const right = el("div", { className: "right-column" });
  right.appendChild(buildOpponentsArea());
  right.appendChild(buildMiddleRow());
  main.appendChild(right);

  return main;
}

function buildLocalPlayerPanel(): HTMLElement {
  const panel = el("div", { className: "player-panel" });
  const p1 = gameState.players[LOCAL_PLAYER];

  // Avatar row
  const avatarRow = el("div", { className: "avatar-row" });
  const avatar = el("div", { className: "avatar p1", textContent: "P1" });
  const nameSpan = el("span", { className: "avatar-name", textContent: "Player 1" });
  avatarRow.append(avatar, nameSpan);
  panel.appendChild(avatarRow);

  if (p1) {
    const statsBox = el("div", { className: "stats-box" });
    const stats: Array<["hp" | "mp" | "pay", string, number]> = [
      ["hp", "HP", p1.stats.hp],
      ["mp", "MP", p1.stats.mp],
      ["pay", "¥", p1.stats.pay],
    ];
    for (const [cls, label, val] of stats) {
      const row = el("div", { className: "stat-row" });
      const lbl = el("span", { className: `stat-label ${cls}`, textContent: label });
      const bar = el("div", { className: "stat-bar" });
      const fill = el("div", { className: `stat-bar-fill ${cls}` });
      fill.style.width = `${(val / MAX_STAT) * 100}%`;
      bar.appendChild(fill);
      const valEl = el("span", { className: "stat-val", textContent: String(val) });
      row.append(lbl, bar, valEl);
      statsBox.appendChild(row);
    }
    panel.appendChild(statsBox);
  }

  return panel;
}

function buildOpponentsArea(): HTMLElement {
  const area = el("div", { className: "opponents-area" });
  const activeId = getActiveId();

  for (const id of gameState.playerOrder) {
    if (id === LOCAL_PLAYER) continue;
    const p = gameState.players[id];
    if (!p) continue;

    const isActive = id === activeId;
    const row = el("div", { className: `opponent-row${isActive ? " is-active" : ""}` });

    const avCls = id === "P2" ? "p2" : "p1";
    const avatar = el("div", { className: `avatar ${avCls}`, textContent: id });
    const name = el("span", { className: "opp-name", textContent: `Player ${id.slice(1)}` });

    const statsArea = el("div", { className: "opponent-stats" });
    const statDefs: Array<["hp" | "mp" | "pay", string, number]> = [
      ["hp", "HP", p.stats.hp],
      ["mp", "MP", p.stats.mp],
      ["pay", "¥", p.stats.pay],
    ];
    for (const [cls, label, val] of statDefs) {
      const s = el("div", { className: "opp-stat" });
      s.appendChild(el("span", { className: `opp-stat-label ${cls}`, textContent: label }));
      s.appendChild(el("span", { className: "opp-stat-val", textContent: String(val) }));
      statsArea.appendChild(s);
    }

    const handCount = el("span", { className: "opp-hand-count", textContent: `手札 ${p.hand.length}枚` });

    row.append(avatar, name, statsArea, handCount);
    area.appendChild(row);
  }

  return area;
}

function buildMiddleRow(): HTMLElement {
  const row = el("div", { className: "middle-row" });

  const battleArea = el("div", { className: "battle-area" });

  // Attack cards in play
  const attackPanel = el("div", { className: "battle-cards-panel" });
  attackPanel.appendChild(el("h3", { textContent: "⚔ 場の攻撃カード" }));
  const attackList = el("div", { className: "battle-cards-list" });
  if (gameState.attackCards.length > 0) {
    for (const c of gameState.attackCards) {
      attackList.appendChild(makeCardTile(c, false, undefined, true));
    }
  } else {
    attackList.appendChild(el("span", { className: "miracle-empty", textContent: "攻撃カードなし" }));
  }
  attackPanel.appendChild(attackList);
  battleArea.appendChild(attackPanel);

  // Miracle panel
  const miraclePanel = el("div", { className: "miracle-panel" });
  miraclePanel.appendChild(el("h3", { textContent: "✦ 起こした奇跡" }));
  const miracles = gameState.attackCards.filter((c) => c.type === "MIRACLE_ATK");
  if (miracles.length > 0) {
    for (const m of miracles) {
      miraclePanel.appendChild(el("span", { textContent: `${m.name} (威力${m.power})` }));
    }
  } else {
    miraclePanel.appendChild(el("span", { className: "miracle-empty", textContent: "奇跡なし" }));
  }
  battleArea.appendChild(miraclePanel);

  // Actions panel (only shown when local player is active and in relevant phase)
  battleArea.appendChild(buildActionsPanel());

  row.appendChild(battleArea);

  // Card detail panel (right side of middle row)
  const detailPanel = el("div", { className: "card-detail-panel" });
  cardDetailContainer = detailPanel;
  renderCardDetail();
  row.appendChild(detailPanel);

  return row;
}

function buildActionsPanel(): HTMLElement {
  const panel = el("div", { className: "actions-panel" });
  panel.appendChild(el("span", { className: "actions-panel__title", textContent: "アクション" }));

  const btnRow = el("div", { className: "actions-buttons" });
  const activeId = getActiveId();
  const isLocal = activeId === LOCAL_PLAYER;
  const p1 = gameState.players[LOCAL_PLAYER];
  const phase = gameState.phase;

  // DEFENSE_PHASE: P1 may need to defend even if P1 is not the active player
  if (phase === "DEFENSE_PHASE") {
    const defenders = gameState.playerOrder.filter((id) => id !== activeId);
    const p1IsDefender = defenders.includes(LOCAL_PLAYER);
    const alreadyConfirmed = gameState.confirmedDefenders.includes(LOCAL_PLAYER);

    if (p1IsDefender && !alreadyConfirmed && p1) {
      const hasDefSelected = selectedCards.length > 0 && selectedCards.every(isDefenseCard);

      const defendBtn = el("button", { className: "btn-action defend", textContent: "🛡 防御確定" });
      defendBtn.addEventListener("click", handleDefend);
      btnRow.appendChild(defendBtn);

      const skipBtn = el("button", { className: "btn-action secondary", textContent: "スキップ" });
      skipBtn.addEventListener("click", () => {
        addLog("防御なしで確定");
        dispatch({ type: "CONFIRM_DEFENSE", playerId: LOCAL_PLAYER });
      });
      btnRow.appendChild(skipBtn);

      const hint = el("p", {
        className: "action-hint",
        textContent: hasDefSelected
          ? `防御: ${selectedCards.map((c) => c.name).join(", ")}`
          : "防御カードを選択するかスキップ",
      });
      panel.append(btnRow, hint);
      return panel;
    } else if (alreadyConfirmed) {
      panel.appendChild(el("span", { className: "action-hint", textContent: "✔ 防御確定済み — 相手の確定待ち" }));
      return panel;
    } else if (!p1IsDefender) {
      panel.appendChild(el("span", { className: "action-hint", textContent: "相手が防御中..." }));
      return panel;
    }
  }

  if (!isLocal || !p1) {
    // AI's turn — show status
    panel.appendChild(el("span", { className: "action-hint", textContent: "相手のターン..." }));
    return panel;
  }

  if (phase === "ATTACK_PHASE" || phase === "EXCHANGE_PHASE") {
    const hasAttackSelected = selectedCards.length > 0 && selectedCards.every(isAttackCard);
    // Engine rejects PRAY if ANY attack card is in hand (regardless of MP cost)
    const hasAnyAttackInHand = p1.hand.some((c) => isAttackCard(c));

    // Attack button
    const attackBtn = el("button", { className: "btn-action attack", textContent: `⚔ 攻撃` });
    if (!hasAttackSelected) attackBtn.setAttribute("disabled", "");
    attackBtn.addEventListener("click", handleAttack);
    btnRow.appendChild(attackBtn);

    // Confirm attack (if cards already in play and attackPlus)
    if (gameState.attackCards.length > 0 && gameState.attackPlusActive) {
      const confirmBtn = el("button", { className: "btn-action confirm", textContent: "✔ 攻撃確定" });
      confirmBtn.addEventListener("click", handleConfirmAttack);
      btnRow.appendChild(confirmBtn);
    }

    // Pray (only if no attack cards in hand at all — engine rule)
    const prayBtn = el("button", {
      className: "btn-action pray",
      textContent: "🙏 祈る",
    });
    if (hasAnyAttackInHand) prayBtn.setAttribute("disabled", "");
    prayBtn.addEventListener("click", handlePray);
    btnRow.appendChild(prayBtn);

    const hint = el("p", {
      className: "action-hint",
      textContent: hasAttackSelected
        ? `選択中: ${selectedCards.map((c) => c.name).join(", ")}`
        : "手札カードをクリックして選択",
    });
    panel.append(btnRow, hint);
  } else if (phase === "RESOLVE_PHASE" || phase === "END_CHECK") {
    panel.appendChild(el("span", { className: "action-hint", textContent: "解決中..." }));
  } else {
    panel.appendChild(el("span", { className: "action-hint", textContent: `フェーズ: ${PHASE_LABEL[phase] ?? phase}` }));
  }

  return panel;
}

function buildHandArea(): HTMLElement {
  const hand = el("div", { className: "hand-area" });
  hand.appendChild(el("span", { className: "hand-label", textContent: "手札" }));

  const cardRow = el("div", { className: "hand-cards" });
  const p1 = gameState.players[LOCAL_PLAYER];
  const cards = p1?.hand ?? [];
  const phase = gameState.phase;
  const isLocal = isLocalPlayerActive();

  const canSelectAttack = isLocal && (phase === "ATTACK_PHASE" || phase === "EXCHANGE_PHASE");
  const canSelectDefense = phase === "DEFENSE_PHASE" && gameState.playerOrder.filter((id) => id !== getActiveId()).includes(LOCAL_PLAYER);

  for (const card of cards) {
    const selected = selectedCards.some((c) => c.id === card.id);
    const clickable =
      (canSelectAttack && isAttackCard(card)) ||
      (canSelectDefense && isDefenseCard(card));
    const tile = makeCardTile(
      card,
      selected,
      clickable ? () => handleCardClick(card) : undefined
    );
    if (!clickable) tile.style.opacity = "0.55";
    cardRow.appendChild(tile);
  }

  // Empty slots up to 8
  const maxSlots = Math.max(HAND_DISPLAY_SLOTS, cards.length);
  for (let i = cards.length; i < maxSlots; i++) {
    cardRow.appendChild(el("div", { className: "card-tile empty-slot" }));
  }

  hand.appendChild(cardRow);
  return hand;
}

function buildBottomBar(): HTMLElement {
  const bar = el("div", { className: "bottom-bar" });

  // Player info
  const playerArea = el("div", { className: "bottom-bar__player" });
  playerArea.appendChild(el("div", { className: "avatar p1", textContent: "P1" }));
  playerArea.appendChild(el("span", { className: "bottom-bar__player-name", textContent: "Player 1" }));
  bar.appendChild(playerArea);

  // Log preview — last message
  const lastMsg = logMessages.at(-1) ?? "— ゲームログ —";
  const msgArea = el("div", { className: "bottom-bar__msg", textContent: lastMsg });
  bar.appendChild(msgArea);

  // Center buttons
  const centerBtns = el("div", { className: "bottom-bar__center-btns" });
  const broadcastBtn = el("button", { className: "btn-bottom", textContent: "同 全体にお告げ" });
  broadcastBtn.addEventListener("click", () => {
    const p1 = gameState.players[LOCAL_PLAYER];
    if (!p1) return;
    addLog(`Player 1: 頑張るぞ！ (HP:${p1.stats.hp} MP:${p1.stats.mp})`);
    render();
  });

  const logBtn = el("button", { className: "btn-bottom", textContent: "ʺ お告げの記録" });
  logBtn.addEventListener("click", () => {
    showLog = !showLog;
    render();
  });
  centerBtns.append(broadcastBtn, logBtn);
  bar.appendChild(centerBtns);

  // Icons
  const icons = el("div", { className: "bottom-bar__icons" });
  const sendBtn = el("button", { className: "btn-icon", textContent: "📤" });
  const muteBtn = el("button", { className: "btn-icon", textContent: "🔇" });
  const volBtn = el("button", { className: "btn-icon", textContent: "🔊" });
  icons.append(sendBtn, muteBtn, volBtn);
  bar.appendChild(icons);

  return bar;
}

function buildGameOverOverlay(): HTMLElement {
  const overlay = el("div", { className: "gameover-overlay" });
  const card = el("div", { className: "gameover-card" });

  const winner = gameState.winner;
  const isWin = winner === LOCAL_PLAYER;

  const title = el("h1", {
    className: `gameover-title ${isWin ? "win" : "lose"}`,
    textContent: isWin ? "🎉 勝利！" : "💀 敗北",
  });

  const subtitle = el("p", {
    className: "gameover-subtitle",
    textContent: winner ? `${winner} の勝利` : "引き分け",
  });

  const restartBtn = el("button", { className: "btn-restart", textContent: "もう一度プレイ" });
  restartBtn.addEventListener("click", handleRestart);

  card.append(title, subtitle, restartBtn);
  overlay.appendChild(card);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) handleRestart();
  });

  return overlay;
}

function buildLogPanel(): HTMLElement {
  const overlay = el("div", { className: "log-panel-overlay" });
  const panel = el("div", { className: "log-panel" });

  const header = el("div", { className: "log-panel__header" });
  header.appendChild(el("span", { textContent: "ʺ お告げの記録" }));
  const closeBtn = el("button", { className: "btn-icon", textContent: "✕" });
  closeBtn.addEventListener("click", () => {
    showLog = false;
    render();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = el("div", { className: "log-panel__body" });
  if (logMessages.length === 0) {
    body.appendChild(el("p", { className: "log-entry", textContent: "ログなし" }));
  } else {
    for (const msg of [...logMessages].reverse()) {
      body.appendChild(el("p", { className: "log-entry", textContent: msg }));
    }
  }
  panel.appendChild(body);
  overlay.appendChild(panel);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      showLog = false;
      render();
    }
  });

  return overlay;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

addLog("ゲーム開始！ P1 vs P2");
render();
scheduleAutoAdvance();
