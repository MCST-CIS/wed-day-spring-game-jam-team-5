const socket = io();

let myId = null;
let lobbyState = null;
let gameState = null;
let powerups = [];
let modalContext = null;
let pendingRoundModal = null;
let lastRoundModal = null;
let powerupRound = null;
let eventBannerTimer = null;
let gameOverPayload = null;

const MAIN_RAIL_LIMIT = 4;

const screens = {
  menu: document.getElementById('menuScreen'),
  lobby: document.getElementById('lobbyScreen'),
  game: document.getElementById('gameScreen'),
};

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function getPlayerName() {
  return document.getElementById('nameInput').value.trim() || 'Player';
}

function getLobbyCode() {
  return document.getElementById('lobbyCodeInput').value.trim().toUpperCase();
}

document.getElementById('createLobbyBtn').addEventListener('click', () => {
  socket.emit('createLobby', { name: getPlayerName() });
});

document.getElementById('joinLobbyBtn').addEventListener('click', () => {
  socket.emit('joinLobby', { name: getPlayerName(), lobbyId: getLobbyCode() });
});

document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
  socket.emit('leaveLobby');
  showScreen('menu');
});

document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

document.getElementById('endGameBtn').addEventListener('click', () => {
  socket.emit('endGame');
});

document.getElementById('endGameTopBtn').addEventListener('click', () => {
  socket.emit('endGame');
});

document.getElementById('auctionBidBtn').addEventListener('click', () => {
  const amount = document.getElementById('auctionBidInput').value;
  if (amount) socket.emit('placeAuctionBid', parseInt(amount, 10));
});

document.getElementById('bustPoolBtn').addEventListener('click', () => {
  const amount = document.getElementById('bustPoolInput').value;
  if (amount) socket.emit('contributeBustPool', parseInt(amount, 10));
});

document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (getLobbyCode()) {
      socket.emit('joinLobby', { name: getPlayerName(), lobbyId: getLobbyCode() });
    } else {
      socket.emit('createLobby', { name: getPlayerName() });
    }
  }
});

// --- Socket Events ---
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('lobbyState', (state) => {
  lobbyState = state;
  renderLobby();
  if (!state.gameActive || state.phase === 'lobby') {
    showScreen('lobby');
  }
  updateHostControls();
});

socket.on('gameState', (state) => {
  gameState = state;
  if (state.phase !== 'lobby') {
    showScreen('game');
  }
  renderGame();
  queueRoundStartModal();
  updateHostControls();
});

socket.on('powerupState', (list) => {
  powerups = list || [];
  if (gameState && gameState.roundCount != null) {
    powerupRound = gameState.roundCount;
  }
  renderPowerups();
  queueRoundStartModal();
});

socket.on('bettingTimer', (payload) => {
  const time = typeof payload === 'object' && payload !== null ? payload.timeLeft : payload;
  if (gameState && gameState.phase === 'betting') {
    document.getElementById('timerInfo').textContent = `Betting: ${time}s`;
  }
});

socket.on('turnTimer', ({ timeLeft, currentTurn }) => {
  if (!gameState || gameState.phase !== 'playing') return;
  if (currentTurn === myId) {
    document.getElementById('timerInfo').textContent = `Your turn: ${timeLeft}s`;
  } else {
    document.getElementById('timerInfo').textContent = `Turn: ${timeLeft}s`;
  }
});

socket.on('auctionTimer', (timeLeft) => {
  if (!gameState || !gameState.auction) return;
  gameState.auction.timeLeft = timeLeft;
  if (gameState.phase === 'betting') {
    const highest = gameState.auction.highestBid || 0;
    document.getElementById('auctionInfo').textContent = `Highest bid: ${highest} | Time: ${timeLeft}s`;
  }
});

socket.on('draftTimer', (timeLeft) => {
  if (!gameState || !gameState.draft) return;
  gameState.draft.timeLeft = timeLeft;
  if (gameState.phase === 'draft') {
    const currentName = gameState.players[gameState.draft.currentPickerId]
      ? gameState.players[gameState.draft.currentPickerId].name
      : 'Waiting';
    document.getElementById('draftInfo').textContent = `Round ${gameState.draft.round} | Picking: ${currentName} | Time: ${timeLeft}s`;
  }
});

socket.on('powerupUsed', (payload) => {
  if (!payload || !payload.text) return;
  showEventBanner(payload.text);
});

socket.on('gameOver', (payload) => {
  gameOverPayload = payload || null;
  showGameOverModal();
});

socket.on('chatMessage', (msg) => {
  addChatMessage(msg);
});

socket.on('peekLeakReveal', (data) => {
  showToast(`Dealer hole card: ${data.label}`);
});

socket.on('broke', (msg) => {
  showToast(msg);
});

socket.on('error', (msg) => {
  showToast(msg);
});

// --- Actions ---
function placeBet(amount) {
  socket.emit('placeBet', amount);
}

function placeBetAll() {
  if (gameState && gameState.players[myId]) {
    socket.emit('placeBet', gameState.players[myId].chips);
  }
}

function placeBetCustom() {
  const val = document.getElementById('customBet').value;
  if (val) socket.emit('placeBet', parseInt(val, 10));
}

function doHit() {
  socket.emit('hit');
}

function doStay() {
  socket.emit('stay');
}

function activatePowerup(slotId, payload = {}) {
  socket.emit('activatePowerup', { slotId, ...payload });
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (msg) {
    socket.emit('chat', msg);
    input.value = '';
  }
}

function addChatMessage(msg) {
  const div = document.getElementById('chatMessages');
  const p = document.createElement('p');

  if (msg.from === 'SERVER') {
    p.className = 'server-msg';
    p.textContent = msg.text;
  } else {
    p.innerHTML = `<strong style="color:#f5c542">${escapeHtml(msg.from)}:</strong> ${escapeHtml(msg.text)}`;
  }

  div.appendChild(p);
  div.scrollTop = div.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(text) {
  const container = document.getElementById('toastArea');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function showEventBanner(text) {
  const banner = document.getElementById('eventBanner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove('hidden');
  if (eventBannerTimer) clearTimeout(eventBannerTimer);
  eventBannerTimer = setTimeout(() => {
    banner.classList.add('hidden');
  }, 3500);
}

function updateHostControls() {
  const endTop = document.getElementById('endGameTopBtn');
  const isHost = lobbyState && lobbyState.hostId === myId;
  if (endTop) {
    endTop.classList.toggle('hidden', !isHost);
  }
}

// --- Lobby Rendering ---
function renderLobby() {
  if (!lobbyState) return;
  document.getElementById('lobbyCode').textContent = lobbyState.lobbyId;
  const list = document.getElementById('lobbyPlayers');
  list.innerHTML = '';

  lobbyState.players.forEach(player => {
    const div = document.createElement('div');
    div.className = 'lobby-player';
    div.innerHTML = `
      <div>${escapeHtml(player.name)}</div>
      <div>${player.isHost ? 'Host' : 'Guest'} | ${player.chips} chips</div>
    `;
    list.appendChild(div);
  });

  const isHost = lobbyState.hostId === myId;
  document.getElementById('startGameBtn').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('endGameBtn').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('lobbyStatus').textContent = lobbyState.gameActive
    ? 'Game running. You can end it anytime.'
    : 'Waiting for host to start the game.';
}

// --- Game Rendering ---
function renderGame() {
  if (!gameState || !gameState.players || !gameState.players[myId]) return;
  const me = gameState.players[myId];
  const loanText = me.loanCount ? ` | Loans: ${me.loanCount}` : '';
  const winText = me.winCount != null ? ` | Wins: ${me.winCount}` : '';
  document.getElementById('playerInfo').textContent = `Chips: ${me.chips} | Bet: ${me.bet}${winText}${loanText}`;

  const phaseNames = {
    lobby: 'Waiting for players',
    betting: 'Place your bets',
    draft: 'Drafting cards',
    playing: 'Round in progress',
    dealer: 'Dealer turn',
    results: 'Results',
  };
  let phaseText = phaseNames[gameState.phase] || gameState.phase;
  if (gameState.phase === 'betting') {
    const bettor = gameState.currentBetterId && gameState.players[gameState.currentBetterId]
      ? gameState.players[gameState.currentBetterId].name
      : 'Waiting';
    phaseText = `Betting: ${bettor}`;
  } else if (gameState.phase === 'playing') {
    const current = gameState.currentTurn && gameState.players[gameState.currentTurn]
      ? gameState.players[gameState.currentTurn].name
      : 'Playing';
    phaseText = `Turn: ${current}`;
  } else if (gameState.phase === 'draft') {
    const picker = gameState.draft && gameState.players[gameState.draft.currentPickerId]
      ? gameState.players[gameState.draft.currentPickerId].name
      : 'Drafting';
    phaseText = `Drafting: ${picker}`;
  }
  document.getElementById('phaseInfo').textContent = phaseText;

  if (gameState.phase === 'betting' && gameState.timers) {
    document.getElementById('timerInfo').textContent = `Betting: ${gameState.timers.bettingTimeLeft}s`;
  } else if (gameState.phase === 'playing' && !gameState.roundModifiers.countdown) {
    document.getElementById('timerInfo').textContent = '';
  } else if (gameState.phase !== 'playing') {
    document.getElementById('timerInfo').textContent = '';
  }

  renderCardRow('dealerCards', gameState.dealer.hand);
  document.getElementById('dealerTotalDisplay').textContent =
    gameState.dealer.hand.length > 0 ? `Total: ${gameState.dealer.total}` : '';

  renderOtherPlayers();

  renderCardRow('yourCards', me.hand);
  const yourArea = document.getElementById('yourArea');
  if (gameState.phase === 'playing' && gameState.currentTurn === myId) {
    yourArea.classList.add('your-turn');
    document.getElementById('yourLabel').textContent = 'Your Turn';
  } else {
    yourArea.classList.remove('your-turn');
    document.getElementById('yourLabel').textContent = 'Your Hand';
  }
  document.getElementById('yourTotalDisplay').textContent =
    me.hand.length > 0 ? `Total: ${me.total}` : '';

  const resultEl = document.getElementById('resultDisplay');
  if (gameState.phase === 'results' && me.result) {
    const resultTexts = {
      win: `Win +${me.winAmount}`,
      lose: `Lose ${me.winAmount}`,
      push: 'Push',
      blackjack: `Blackjack +${me.winAmount}`,
    };
    resultEl.textContent = resultTexts[me.result] || '';
    resultEl.className = `result-${me.result}`;
  } else if (me.busted) {
    resultEl.textContent = 'Busted';
    resultEl.className = 'result-lose';
  } else {
    resultEl.textContent = '';
    resultEl.className = '';
  }

  const bettingUI = document.getElementById('bettingUI');
  if (gameState.phase === 'betting') {
    bettingUI.classList.remove('hidden');
    const isMyTurn = gameState.currentBetterId === myId;
    const prompt = document.getElementById('bettingPrompt');
    const currentName = gameState.currentBetterId && gameState.players[gameState.currentBetterId]
      ? gameState.players[gameState.currentBetterId].name
      : 'Waiting';
    prompt.textContent = isMyTurn ? 'Your turn to bet.' : `Waiting for ${currentName} to bet.`;
    setBettingControlsEnabled(isMyTurn);
    bettingUI.classList.toggle('waiting', !isMyTurn);
    document.getElementById('currentBetDisplay').textContent =
      me.bet > 0 ? `Current bet: ${me.bet}` : '';
  } else {
    bettingUI.classList.add('hidden');
  }

  const actionBtns = document.getElementById('actionButtons');
  if (gameState.phase === 'playing' && gameState.currentTurn === myId && !me.stayed && !me.busted) {
    actionBtns.classList.remove('hidden');
    document.getElementById('hitBtn').disabled = !!me.frozen;
  } else {
    actionBtns.classList.add('hidden');
  }

  renderRoundModifiers();
  renderCommunal();
  renderGhost();
  renderDraft();
  renderAuction();
  renderBustPool();
  renderResultsModal();
}

function renderCardRow(elementId, hand) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';
  for (let card of hand || []) {
    const div = document.createElement('div');
    div.className = 'card';
    if (card.label === '?') {
      div.className = 'card hidden-card';
      div.textContent = '?';
    } else {
      const redLabels = ['A', 'K', 'Q', 'J'];
      if (redLabels.includes(card.label)) div.classList.add('red');
      div.textContent = card.label;
    }
    container.appendChild(div);
  }
}

function renderOtherPlayers() {
  const container = document.getElementById('otherPlayers');
  const sideContainer = document.getElementById('sidePlayers');
  const sidePanel = document.getElementById('sidePlayersPanel');
  container.innerHTML = '';
  sideContainer.innerHTML = '';

  const entries = Object.keys(gameState.players)
    .filter(id => id !== myId)
    .map(id => ({ id, player: gameState.players[id] }));

  const mainEntries = entries.slice(0, MAIN_RAIL_LIMIT);
  const sideEntries = entries.slice(MAIN_RAIL_LIMIT);

  mainEntries.forEach(({ id, player }) => {
    container.appendChild(renderPlayerCard(id, player));
  });

  sideEntries.forEach(({ id, player }) => {
    sideContainer.appendChild(renderPlayerCard(id, player));
  });

  if (sideEntries.length > 0) {
    sidePanel.classList.remove('hidden');
  } else {
    sidePanel.classList.add('hidden');
  }
}

function renderPlayerCard(id, p) {
  const div = document.createElement('div');
  div.className = 'other-player';
  if (gameState.currentTurn === id && gameState.phase === 'playing') div.classList.add('active-turn');
  if (gameState.currentBetterId === id && gameState.phase === 'betting') div.classList.add('betting-turn');
  if (p.busted) div.classList.add('busted');

  let statusText = '';
  if (gameState.phase === 'betting' && gameState.currentBetterId === id) statusText = 'BETTING';
  else if (p.busted) statusText = 'BUST';
  else if (p.stayed && gameState.phase === 'playing') statusText = 'STAY';
  else if (p.blackjack) statusText = 'BLACKJACK';
  if (p.frozen) statusText = `${statusText} FROZEN`;

  let resultHtml = '';
  if (gameState.phase === 'results' && p.result) {
    resultHtml = `<div class="small-text">${p.result.toUpperCase()} ${p.winAmount > 0 ? '+' : ''}${p.winAmount}</div>`;
  }

  const wins = p.winCount != null ? ` | Wins: ${p.winCount}` : '';

  div.innerHTML = `
    <h3>${escapeHtml(p.name)}${statusText ? ` | ${statusText}` : ''}</h3>
    <div class="info">Chips: ${p.chips} | Bet: ${p.bet}${wins}</div>
    <div class="card-row" style="justify-content:flex-start;">
      ${(p.hand || []).map(c => `<div class="card" style="width:36px;height:52px;font-size:14px;">${c.label}</div>`).join('')}
    </div>
    <div class="info">Total: ${p.total}</div>
    ${resultHtml}
  `;
  return div;
}

function renderRoundModifiers() {
  const panel = document.getElementById('roundModifiersPanel');
  const container = document.getElementById('roundModifiers');
  container.innerHTML = '';
  const mods = [];
  const rm = gameState.roundModifiers || {};
  if (rm.communalCard) mods.push(`Communal: ${rm.communalCard.label}`);
  if (rm.reverseRound) mods.push('Reverse Round');
  if (rm.wildcardLabel) mods.push(`Wildcard: ${rm.wildcardLabel}`);
  if (rm.doubleBets) mods.push('Double Bets');
  if (rm.dealerExposed) mods.push('Dealer Exposed');
  if (rm.bountyTargetId && gameState.players[rm.bountyTargetId]) {
    mods.push(`Bounty: ${gameState.players[rm.bountyTargetId].name}`);
  }
  if (rm.taxRound) mods.push('Tax Round');
  if (rm.countdown) mods.push('Countdown');
  if (rm.draftRound) mods.push('Draft Round');
  if (rm.ghostHand) mods.push('Ghost Hand');
  if (rm.bustPoolOpen) mods.push('Bust Pool');
  if (rm.auctionActive) mods.push('Auction Live');

  if (mods.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  mods.forEach(text => {
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = text;
    container.appendChild(badge);
  });
}

function renderCommunal() {
  const area = document.getElementById('communalArea');
  if (gameState.roundModifiers && gameState.roundModifiers.communalCard) {
    area.classList.remove('hidden');
    renderCardRow('communalCards', [gameState.roundModifiers.communalCard]);
  } else {
    area.classList.add('hidden');
  }
}

function renderGhost() {
  const area = document.getElementById('ghostArea');
  if (gameState.roundModifiers && gameState.roundModifiers.ghostHand) {
    area.classList.remove('hidden');
    renderCardRow('ghostCards', gameState.roundModifiers.ghostHand);
    const total = calcClientTotal(gameState.roundModifiers.ghostHand);
    document.getElementById('ghostTotalDisplay').textContent = `Total: ${total}`;
  } else {
    area.classList.add('hidden');
  }
}

function renderDraft() {
  const area = document.getElementById('draftArea');
  if (gameState.phase !== 'draft' || !gameState.draft) {
    area.classList.add('hidden');
    return;
  }
  area.classList.remove('hidden');
  const draft = gameState.draft;
  const info = document.getElementById('draftInfo');
  const currentName = gameState.players[draft.currentPickerId]
    ? gameState.players[draft.currentPickerId].name
    : 'Waiting';
  const timeText = draft.timeLeft ? ` | Time: ${draft.timeLeft}s` : '';
  info.textContent = `Round ${draft.round} | Picking: ${currentName}${timeText}`;

  const pool = document.getElementById('draftPool');
  pool.innerHTML = '';
  draft.pool.forEach((card, index) => {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.textContent = card.label;
    btn.disabled = draft.currentPickerId !== myId;
    btn.onclick = () => socket.emit('draftPick', index);
    pool.appendChild(btn);
  });
}

function renderAuction() {
  const panel = document.getElementById('auctionPanel');
  if (!gameState.auction || gameState.phase !== 'betting') {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  renderCardRow('auctionCard', [gameState.auction.card]);
  const highest = gameState.auction.highestBid || 0;
  document.getElementById('auctionInfo').textContent = `Highest bid: ${highest} | Time: ${gameState.auction.timeLeft}s`;
}

function renderBustPool() {
  const panel = document.getElementById('bustPoolPanel');
  if (!gameState.bustPool || gameState.phase !== 'betting') {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const total = gameState.bustPool.total || 0;
  const mine = gameState.bustPool.yourContribution || 0;
  document.getElementById('bustPoolInfo').textContent = `Total: ${total} | Yours: ${mine}`;
}

function renderPowerups() {
  const container = document.getElementById('powerupList');
  if (!container) return;
  container.innerHTML = '';
  powerups.forEach(powerup => {
    const card = document.createElement('div');
    card.className = 'powerup-card';
    if (powerup.used) card.classList.add('used');
    if (!powerup.funded) card.classList.add('locked');

    const meta = `Cost: ${powerup.cost} | Phase: ${powerup.phase}`;
    card.innerHTML = `
      <div class="powerup-title">${powerup.name}</div>
      <div class="powerup-desc">${powerup.description}</div>
      <div class="powerup-meta">${meta}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'powerup-actions';
    if (powerup.passive) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Passive';
      actions.appendChild(badge);
    } else if (!powerup.used && powerup.funded) {
      const btn = document.createElement('button');
      btn.textContent = 'Use';
      btn.disabled = !canUsePowerup(powerup);
      btn.onclick = () => handlePowerupUse(powerup);
      actions.appendChild(btn);
    } else if (!powerup.funded) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Unfunded';
      actions.appendChild(badge);
    }
    card.appendChild(actions);
    container.appendChild(card);
  });
}

function handlePowerupUse(powerup) {
  if (!gameState) return;
  if (!canUsePowerup(powerup)) return;
  const needsModal = ['target', 'targetAmount', 'prediction', 'cardIndex'].includes(powerup.action);
  if (!needsModal) {
    activatePowerup(powerup.slotId);
    return;
  }
  openPowerupModal(powerup);
}

function canUsePowerup(powerup) {
  if (!gameState) return false;
  if (powerup.used || powerup.passive || !powerup.funded) return false;
  if (powerup.phase === 'any') return true;
  return powerup.phase === gameState.phase;
}

function openPowerupModal(powerup) {
  const modal = document.getElementById('powerupModal');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = powerup.name;
  body.innerHTML = '';
  modalContext = { powerup, fields: {} };

  const desc = document.createElement('div');
  desc.className = 'small-text';
  desc.textContent = powerup.description;
  body.appendChild(desc);

  if (powerup.action === 'target' || powerup.action === 'targetAmount') {
    const select = document.createElement('select');
    select.id = 'modalTarget';
    const options = getTargetOptions(powerup.targetMode);
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    body.appendChild(select);
  }

  if (powerup.action === 'targetAmount') {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '50';
    input.placeholder = 'Amount (max 50)';
    input.id = 'modalAmount';
    body.appendChild(input);
  }

  if (powerup.action === 'prediction') {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '2';
    input.max = '21';
    input.placeholder = 'Predict total (2-21)';
    input.id = 'modalPrediction';
    body.appendChild(input);
  }

  if (powerup.action === 'cardIndex') {
    const select = document.createElement('select');
    select.id = 'modalCardIndex';
    const hand = gameState.players[myId].hand || [];
    hand.forEach((card, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `Card ${index + 1} (${card.label})`;
      select.appendChild(option);
    });
    body.appendChild(select);
  }

  modal.classList.remove('hidden');
}

document.getElementById('modalCancel').addEventListener('click', () => {
  closePowerupModal();
});

document.getElementById('modalConfirm').addEventListener('click', () => {
  if (!modalContext) return;
  const powerup = modalContext.powerup;
  const payload = {};
  if (powerup.action === 'target' || powerup.action === 'targetAmount') {
    const target = document.getElementById('modalTarget');
    if (target) payload.targetId = target.value;
  }
  if (powerup.action === 'targetAmount') {
    const amount = document.getElementById('modalAmount');
    if (amount && amount.value) payload.amount = parseInt(amount.value, 10);
  }
  if (powerup.action === 'prediction') {
    const pred = document.getElementById('modalPrediction');
    if (pred && pred.value) payload.prediction = parseInt(pred.value, 10);
  }
  if (powerup.action === 'cardIndex') {
    const idx = document.getElementById('modalCardIndex');
    if (idx) payload.cardIndex = parseInt(idx.value, 10);
  }
  activatePowerup(powerup.slotId, payload);
  closePowerupModal();
});

function closePowerupModal() {
  modalContext = null;
  document.getElementById('powerupModal').classList.add('hidden');
}

document.getElementById('roundModalClose').addEventListener('click', () => {
  closeRoundStartModal();
});

function getTargetOptions(mode) {
  const options = [];
  for (let id in gameState.players) {
    if (mode === 'other' && id === myId) continue;
    if (mode === 'self' && id !== myId) continue;
    const p = gameState.players[id];
    if (!p) continue;
    if (gameState.phase === 'playing' && !p.inRound) continue;
    options.push({ id, label: p.name });
  }
  return options;
}

function calcClientTotal(hand) {
  const communal = gameState.roundModifiers ? gameState.roundModifiers.communalCard : null;
  const wildcard = gameState.roundModifiers ? gameState.roundModifiers.wildcardLabel : null;
  const cards = communal ? hand.concat([communal]) : hand.slice();
  let total = 0;
  let aces = 0;
  let wilds = 0;
  cards.forEach(card => {
    let value = card.value;
    if (wildcard && card.label === wildcard) {
      value = 11;
      wilds++;
    }
    total += value;
    if (card.value === 11) aces++;
  });
  let adjustables = aces + wilds;
  while (total > 21 && adjustables > 0) {
    total -= 10;
    adjustables--;
  }
  return total;
}

function setBettingControlsEnabled(enabled) {
  const bettingUI = document.getElementById('bettingUI');
  if (!bettingUI) return;
  const buttons = bettingUI.querySelectorAll('button');
  const inputs = bettingUI.querySelectorAll('input');
  buttons.forEach(btn => btn.disabled = !enabled);
  inputs.forEach(input => input.disabled = !enabled);
}

function queueRoundStartModal() {
  if (!gameState || gameState.phase !== 'betting') return;
  if (gameState.roundCount == null) return;
  if (lastRoundModal === gameState.roundCount) return;
  if (powerupRound !== gameState.roundCount) return;
  pendingRoundModal = gameState.roundCount;
  if (powerups.length >= 1) {
    showRoundStartModal();
  }
}

function showRoundStartModal() {
  if (pendingRoundModal == null || lastRoundModal === pendingRoundModal) return;
  const modal = document.getElementById('roundStartModal');
  const grid = document.getElementById('roundPowerupGrid');
  if (!modal || !grid) return;
  grid.innerHTML = '';
  powerups.slice(0, 5).forEach((powerup, index) => {
    const card = document.createElement('div');
    card.className = 'round-powerup spin';
    card.style.animationDelay = `${index * 0.08}s`;
    card.innerHTML = `
      <div class="powerup-title">${powerup.name}</div>
      <div class="small-text">${powerup.description}</div>
    `;
    grid.appendChild(card);
  });
  modal.classList.remove('hidden');
  lastRoundModal = pendingRoundModal;
  pendingRoundModal = null;
}

function closeRoundStartModal() {
  const modal = document.getElementById('roundStartModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

document.getElementById('resultsClose').addEventListener('click', () => {
  closeResultsModal();
});

document.getElementById('gameOverClose').addEventListener('click', () => {
  closeGameOverModal();
});

function renderResultsModal() {
  const modal = document.getElementById('resultsModal');
  if (!modal) return;
  if (gameState.phase !== 'results') {
    modal.classList.add('hidden');
    return;
  }

  const list = document.getElementById('resultsList');
  const summary = document.getElementById('resultsSummary');
  list.innerHTML = '';
  const players = Object.keys(gameState.players).map(id => ({
    id,
    name: gameState.players[id].name,
    winCount: gameState.players[id].winCount || 0,
    result: gameState.players[id].result,
    winAmount: gameState.players[id].winAmount || 0,
  }));

  const sorted = players.sort((a, b) => b.winCount - a.winCount || b.winAmount - a.winAmount);
  const topWins = sorted.length > 0 ? sorted[0].winCount : 0;
  const leaders = sorted.filter(p => p.winCount === topWins).map(p => p.name).join(', ');
  summary.textContent = topWins > 0
    ? `Round ${gameState.roundCount} | Leaders: ${leaders} (${topWins} wins)`
    : `Round ${gameState.roundCount} | No wins yet.`;

  sorted.forEach(player => {
    const row = document.createElement('div');
    row.className = 'results-row';
    if (player.result === 'win' || player.result === 'blackjack') {
      row.classList.add('winner');
    }
    const resultText = player.result ? player.result.toUpperCase() : 'OUT';
    row.innerHTML = `
      <div class="results-name">${escapeHtml(player.name)}</div>
      <div class="results-meta">${resultText} | ${player.winAmount > 0 ? '+' : ''}${player.winAmount} | Wins: ${player.winCount}</div>
    `;
    list.appendChild(row);
  });

  modal.classList.remove('hidden');
}

function closeResultsModal() {
  const modal = document.getElementById('resultsModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function showGameOverModal() {
  if (!gameOverPayload) return;
  const modal = document.getElementById('gameOverModal');
  const list = document.getElementById('gameOverList');
  const summary = document.getElementById('gameOverSummary');
  if (!modal || !list || !summary) return;
  list.innerHTML = '';
  const leaders = (gameOverPayload.winners || []).map(item => item.name).join(', ');
  summary.textContent = leaders ? `Winner: ${leaders}` : 'Game complete.';

  const leaderboard = gameOverPayload.leaderboard || [];
  leaderboard.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'results-row';
    if ((gameOverPayload.winners || []).some(winner => winner.id === entry.id)) {
      row.classList.add('winner');
    }
    row.innerHTML = `
      <div class="results-name">${escapeHtml(entry.name)}</div>
      <div class="results-meta">Wins: ${entry.wins}</div>
    `;
    list.appendChild(row);
  });

  modal.classList.remove('hidden');
}

function closeGameOverModal() {
  const modal = document.getElementById('gameOverModal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (lobbyState) {
    showScreen('lobby');
  }
}
