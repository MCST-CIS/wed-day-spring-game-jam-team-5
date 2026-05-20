const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- Lobby + Game State ---
const lobbies = {}; // lobbyId -> lobby state
const MIN_PLAYERS = 1;
const BET_TURN_TIME = 15;
const RESULT_TIME = 6;
const TURN_TIME = 10;
const AUCTION_TIME = 10;
const DRAFT_TIME = 10;

const POWERUP_DEFS = [
  { id: 'sabotage', name: 'Sabotage', cost: 40, phase: 'playing', action: 'target', targetMode: 'other', type: 'offense', description: 'Force a player to draw a card.' },
  { id: 'card_swap', name: 'Card Swap', cost: 55, phase: 'playing', action: 'target', targetMode: 'other', type: 'offense', description: 'Swap a random card with another player.' },
  { id: 'peek_leak', name: 'Peek & Leak', cost: 25, phase: 'playing', action: 'none', targetMode: 'none', type: 'info', description: 'See dealer hole card (another player also sees it).' },
  { id: 'bet_hijack', name: 'Bet Hijack', cost: 65, phase: 'betting', action: 'target', targetMode: 'other', type: 'offense', description: 'You profit from a target\'s loss; pay their wins.' },
  { id: 'card_bomb', name: 'Card Bomb', cost: 70, phase: 'playing', action: 'target', targetMode: 'other', type: 'offense', description: 'Replace a target\'s highest card at round end.' },
  { id: 'freeze', name: 'Freeze', cost: 45, phase: 'playing', action: 'target', targetMode: 'other', type: 'offense', description: 'Force a target to auto-stay on their turn.' },
  { id: 'mirror', name: 'Swap Hands', cost: 80, phase: 'playing', action: 'target', targetMode: 'other', type: 'offense', description: 'Swap hands with another player.' },
  { id: 'shield', name: 'Shield', cost: 30, phase: 'any', action: 'none', targetMode: 'self', type: 'defense', description: 'Block one incoming offensive powerup.' },
  { id: 'mulligan', name: 'Mulligan', cost: 50, phase: 'playing', action: 'none', targetMode: 'self', type: 'defense', oncePerGame: true, description: 'Redraw 2 cards. Fee: 25% of your bet.' },
  { id: 'insurance_plus', name: 'Insurance Plus', cost: 20, phase: 'passive', action: 'passive', targetMode: 'self', type: 'defense', passive: true, description: 'If sabotage busts you, only lose half your bet.' },
  { id: 'anchor', name: 'Anchor', cost: 25, phase: 'playing', action: 'cardIndex', targetMode: 'self', type: 'defense', description: 'Lock one card from swaps/bombs.' },
  { id: 'earthquake_round', name: 'Earthquake Round', cost: 75, phase: 'playing', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'Shuffle all players\' cards and redeal.' },
  { id: 'reverse_round', name: 'Reverse Round', cost: 60, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'Lowest hand wins (no busts).'},
  { id: 'communal_card', name: 'Communal Card', cost: 55, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'One card counts for everyone.' },
  { id: 'bounty_round', name: 'Bounty Round', cost: 50, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'If the bounty target loses, everyone else gets +50.' },
  { id: 'wildcard_round', name: 'Wildcard Round', cost: 45, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'A random card value is wild (Ace-like).' },
  { id: 'dealer_exposed', name: 'Dealer Exposed', cost: 40, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'Dealer cards face-up; dealer hits to 19.' },
  { id: 'double_round', name: 'Double or Nothing', cost: 70, phase: 'betting', action: 'none', targetMode: 'none', type: 'chaos', global: true, description: 'All bets are doubled.' },
  { id: 'auction_card', name: 'Auction Card', cost: 50, phase: 'betting', action: 'none', targetMode: 'none', type: 'economy', global: true, description: 'Auction a bonus card before the deal.' },
  { id: 'bust_pool', name: 'Bust Pool', cost: 25, phase: 'betting', action: 'none', targetMode: 'none', type: 'economy', global: true, description: 'Open a pool that pays if others bust.' },
  { id: 'loan_shark', name: 'Loan Shark', cost: 0, phase: 'any', action: 'none', targetMode: 'self', type: 'economy', description: 'Borrow 500 chips; -20% winnings for 3 rounds.' },
  { id: 'bounty_hunter', name: 'Bounty Hunter', cost: 25, phase: 'betting', action: 'targetAmount', targetMode: 'other', type: 'economy', description: 'Side bet: if target busts, win 3x.' },
  { id: 'tax_round', name: 'Tax Round', cost: 40, phase: 'betting', action: 'none', targetMode: 'none', type: 'economy', global: true, description: 'Winners pay 25% to the poorest player.' },
  { id: 'blind_round', name: 'Blind Round', cost: 30, phase: 'betting', action: 'none', targetMode: 'self', type: 'strategy', description: 'Your second card is hidden from you.' },
  { id: 'countdown_round', name: 'Countdown', cost: 20, phase: 'betting', action: 'none', targetMode: 'none', type: 'strategy', global: true, description: '10s turn timer; auto hit/stay on timeout.' },
  { id: 'draft_round', name: 'Draft Round', cost: 75, phase: 'betting', action: 'none', targetMode: 'none', type: 'strategy', global: true, description: 'Draft cards in a snake order.' },
  { id: 'prediction_bonus', name: 'Prediction Bonus', cost: 35, phase: 'betting', action: 'prediction', targetMode: 'self', type: 'strategy', description: 'Predict final total to multiply winnings.' },
  { id: 'ghost_hand', name: 'Ghost Hand', cost: 50, phase: 'betting', action: 'none', targetMode: 'none', type: 'strategy', global: true, description: 'A ghost hand can tax everyone if it wins.' },
];

const POWERUP_BY_ID = Object.fromEntries(POWERUP_DEFS.map(def => [def.id, def]));

function defaultRoundModifiers() {
  return {
    communalCard: null,
    reverseRound: false,
    bountyTargetId: null,
    wildcardLabel: null,
    dealerExposed: false,
    dealerHitThreshold: 17,
    doubleBets: false,
    ghostHand: null,
    taxRound: false,
    countdown: false,
    draftRound: false,
    bustPoolOpen: false,
  };
}

function createLobbyId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    id = '';
    for (let i = 0; i < 5; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (lobbies[id]);
  return id;
}

function createLobby(hostId) {
  return {
    id: createLobbyId(),
    hostId,
    players: {},
    gamePhase: 'lobby',
    deck: [],
    dealerHand: [],
    dealerTotal: 0,
    roundTimer: null,
    turnTimer: null,
    bettingTimeLeft: 0,
    turnTimeLeft: 0,
    sabotageVotes: {},
    sabotageApplied: {},
    playerOrder: [],
    currentTurnIndex: 0,
    bettingOrder: [],
    bettingTurnIndex: 0,
    currentBettingId: null,
    roundModifiers: defaultRoundModifiers(),
    auction: null,
    bustPool: null,
    draft: null,
    gameActive: false,
    roundCount: 0,
  };
}

function buildDeck(numDecks = 2) {
  let d = [];
  const singleDeck = [
    { value: 2, label: '2' }, { value: 2, label: '2' }, { value: 2, label: '2' }, { value: 2, label: '2' },
    { value: 3, label: '3' }, { value: 3, label: '3' }, { value: 3, label: '3' }, { value: 3, label: '3' },
    { value: 4, label: '4' }, { value: 4, label: '4' }, { value: 4, label: '4' }, { value: 4, label: '4' },
    { value: 5, label: '5' }, { value: 5, label: '5' }, { value: 5, label: '5' }, { value: 5, label: '5' },
    { value: 6, label: '6' }, { value: 6, label: '6' }, { value: 6, label: '6' }, { value: 6, label: '6' },
    { value: 7, label: '7' }, { value: 7, label: '7' }, { value: 7, label: '7' }, { value: 7, label: '7' },
    { value: 8, label: '8' }, { value: 8, label: '8' }, { value: 8, label: '8' }, { value: 8, label: '8' },
    { value: 9, label: '9' }, { value: 9, label: '9' }, { value: 9, label: '9' }, { value: 9, label: '9' },
    { value: 10, label: '10' }, { value: 10, label: '10' }, { value: 10, label: '10' }, { value: 10, label: '10' },
    { value: 10, label: 'J' }, { value: 10, label: 'J' }, { value: 10, label: 'J' }, { value: 10, label: 'J' },
    { value: 10, label: 'Q' }, { value: 10, label: 'Q' }, { value: 10, label: 'Q' }, { value: 10, label: 'Q' },
    { value: 10, label: 'K' }, { value: 10, label: 'K' }, { value: 10, label: 'K' }, { value: 10, label: 'K' },
    { value: 11, label: 'A' }, { value: 11, label: 'A' }, { value: 11, label: 'A' }, { value: 11, label: 'A' },
  ];
  for (let i = 0; i < numDecks; i++) {
    d = d.concat(JSON.parse(JSON.stringify(singleDeck)));
  }
  // Shuffle (Fisher-Yates)
  for (let i = d.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function drawFromDeck(lobby) {
  if (lobby.deck.length === 0) lobby.deck = buildDeck();
  return lobby.deck.pop();
}

function calcTotal(hand, options = {}) {
  const communalCard = options.communalCard || null;
  const wildcardLabel = options.wildcardLabel || null;
  const cards = communalCard ? hand.concat([communalCard]) : hand.slice();
  let total = 0;
  let aces = 0;
  let wilds = 0;
  for (let card of cards) {
    let value = card.value;
    if (wildcardLabel && card.label === wildcardLabel) {
      value = 11;
      wilds++;
    }
    total += value;
    if (card.value === 11) aces++;
  }
  let adjustables = aces + wilds;
  while (total > 21 && adjustables > 0) {
    total -= 10;
    adjustables--;
  }
  return total;
}

function getActivePlayerIds(lobby) {
  return Object.keys(lobby.players).filter(id => lobby.players[id] && lobby.players[id].inRound);
}

function getLobbyBySocket(socket) {
  const lobbyId = socket.data.lobbyId;
  return lobbyId ? lobbies[lobbyId] : null;
}

function sendServerMessage(lobby, text) {
  io.to(lobby.id).emit('chatMessage', { from: 'SERVER', text });
}

function announcePowerup(lobby, text) {
  io.to(lobby.id).emit('powerupUsed', { text });
}

function broadcastLobbyState(lobby) {
  const players = Object.keys(lobby.players).map(id => ({
    id,
    name: lobby.players[id].name,
    chips: lobby.players[id].chips,
    isHost: lobby.hostId === id,
  }));

  io.to(lobby.id).emit('lobbyState', {
    lobbyId: lobby.id,
    hostId: lobby.hostId,
    players,
    gameActive: lobby.gameActive,
    phase: lobby.gamePhase,
  });
}

function emitPowerupState(lobby, playerId) {
  const p = lobby.players[playerId];
  if (!p) return;
  const list = (p.powerups || []).map((powerup, index) => ({
    slotId: index,
    id: powerup.id,
    name: powerup.name,
    description: powerup.description,
    cost: powerup.cost,
    phase: powerup.phase,
    action: powerup.action,
    targetMode: powerup.targetMode || 'none',
    used: powerup.used || false,
    passive: powerup.passive || false,
    global: powerup.global || false,
    oncePerGame: powerup.oncePerGame || false,
    funded: powerup.funded !== false,
  }));

  io.to(playerId).emit('powerupState', list);
}

function buildStateForViewer(lobby, viewerId, extras = {}) {
  const viewer = lobby.players[viewerId];
  const options = {
    communalCard: lobby.roundModifiers.communalCard,
    wildcardLabel: lobby.roundModifiers.wildcardLabel,
  };
  const playerList = {};
  for (let id in lobby.players) {
    const p = lobby.players[id];
    let handView = p.hand;
    if (id === viewerId && p.blindRoundActive && p.hand.length > 1 && lobby.gamePhase === 'playing') {
      handView = p.hand.map((card, idx) => idx === 1 ? { value: 0, label: '?' } : card);
    }
    playerList[id] = {
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      hand: handView,
      total: calcTotal(p.hand, options),
      stayed: p.stayed,
      busted: p.busted,
      inRound: p.inRound,
      sabotaged: p.sabotaged || false,
      blackjack: p.blackjack || false,
      result: p.result || null,
      winAmount: p.winAmount || 0,
      powerupCount: (p.powerups || []).length,
      frozen: p.frozen || false,
      loanCount: p.loans ? p.loans.length : 0,
      winCount: p.winCount || 0,
    };
  }

  const dealerHandView = (lobby.gamePhase === 'dealer' || lobby.gamePhase === 'results' || lobby.roundModifiers.dealerExposed)
    ? lobby.dealerHand
    : (lobby.dealerHand.length > 0 ? [lobby.dealerHand[0], { value: 0, label: '?' }] : []);
  const dealerTotalView = (lobby.gamePhase === 'dealer' || lobby.gamePhase === 'results' || lobby.roundModifiers.dealerExposed)
    ? calcTotal(lobby.dealerHand, options)
    : '?';

  const state = {
    phase: lobby.gamePhase,
    roundCount: lobby.roundCount,
    players: playerList,
    dealer: {
      hand: dealerHandView,
      total: dealerTotalView,
    },
    currentTurn: lobby.playerOrder[lobby.currentTurnIndex] || null,
    currentBetterId: lobby.currentBettingId,
    roundModifiers: {
      communalCard: lobby.roundModifiers.communalCard,
      reverseRound: lobby.roundModifiers.reverseRound,
      bountyTargetId: lobby.roundModifiers.bountyTargetId,
      wildcardLabel: lobby.roundModifiers.wildcardLabel,
      dealerExposed: lobby.roundModifiers.dealerExposed,
      doubleBets: lobby.roundModifiers.doubleBets,
      ghostHand: lobby.roundModifiers.ghostHand,
      taxRound: lobby.roundModifiers.taxRound,
      countdown: lobby.roundModifiers.countdown,
      draftRound: lobby.roundModifiers.draftRound,
      bustPoolOpen: lobby.roundModifiers.bustPoolOpen,
      auctionActive: !!lobby.auction,
    },
    timers: {
      bettingTimeLeft: lobby.bettingTimeLeft,
      turnTimeLeft: lobby.turnTimeLeft,
    },
    auction: lobby.auction ? {
      card: lobby.auction.card,
      highestBid: lobby.auction.highestBid || 0,
      highestBidderId: lobby.auction.highestBidderId || null,
      timeLeft: lobby.auction.timeLeft,
      yourBid: lobby.auction.bids[viewerId] || 0,
    } : null,
    bustPool: lobby.bustPool ? {
      total: lobby.bustPool.total,
      yourContribution: lobby.bustPool.contributors[viewerId] || 0,
    } : null,
    draft: lobby.draft ? {
      pool: lobby.draft.pool,
      round: lobby.draft.round,
      currentPickerId: lobby.draft.currentPickerId,
      order: lobby.draft.order,
      timeLeft: lobby.draft.timeLeft,
    } : null,
    ...extras,
  };

  return state;
}

function broadcastState(lobby, extras = {}) {
  for (let id in lobby.players) {
    io.to(id).emit('gameState', buildStateForViewer(lobby, id, extras));
    emitPowerupState(lobby, id);
  }
}

function clearTurnTimer(lobby) {
  if (lobby.turnTimer) {
    clearInterval(lobby.turnTimer);
    lobby.turnTimer = null;
  }
  lobby.turnTimeLeft = 0;
}

function clearBettingTimer(lobby) {
  if (lobby.roundTimer) {
    clearInterval(lobby.roundTimer);
    lobby.roundTimer = null;
  }
  lobby.bettingTimeLeft = 0;
}

function findNextBettingIndex(lobby, startIndex) {
  const order = lobby.bettingOrder || [];
  if (order.length === 0) return -1;
  for (let offset = 1; offset <= order.length; offset++) {
    const idx = (startIndex + offset) % order.length;
    const pid = order[idx];
    const p = lobby.players[pid];
    if (p && !p.betPlaced) return idx;
  }
  return -1;
}

function autoPlaceBet(lobby, playerId) {
  const p = lobby.players[playerId];
  if (!p || p.betPlaced) return;
  const amount = Math.min(10, p.chips);
  p.bet = amount;
  p.betPlaced = true;
  if (amount > 0) {
    sendServerMessage(lobby, `${p.name} auto-bet ${amount} chips.`);
  } else {
    sendServerMessage(lobby, `${p.name} sits out this round.`);
  }
}

function startBettingTurnTimer(lobby) {
  clearBettingTimer(lobby);
  lobby.bettingTimeLeft = BET_TURN_TIME;
  lobby.roundTimer = setInterval(() => {
    lobby.bettingTimeLeft--;
    io.to(lobby.id).emit('bettingTimer', lobby.bettingTimeLeft);
    if (lobby.bettingTimeLeft <= 0) {
      clearBettingTimer(lobby);
      if (lobby.currentBettingId) {
        autoPlaceBet(lobby, lobby.currentBettingId);
      }
      advanceBettingTurn(lobby);
    }
  }, 1000);
}

function advanceBettingTurn(lobby) {
  const nextIndex = findNextBettingIndex(lobby, lobby.bettingTurnIndex);
  if (nextIndex === -1) {
    clearBettingTimer(lobby);
    startPlayingPhase(lobby);
    return;
  }
  lobby.bettingTurnIndex = nextIndex;
  lobby.currentBettingId = lobby.bettingOrder[nextIndex] || null;
  startBettingTurnTimer(lobby);
  broadcastState(lobby);
}

function removeFromBettingOrder(lobby, playerId) {
  const idx = lobby.bettingOrder.indexOf(playerId);
  if (idx === -1) return;
  lobby.bettingOrder.splice(idx, 1);
  if (lobby.bettingTurnIndex >= idx) {
    lobby.bettingTurnIndex = Math.max(0, lobby.bettingTurnIndex - 1);
  }
  if (lobby.currentBettingId === playerId) {
    lobby.currentBettingId = null;
  }
}

function startTurnTimer(lobby) {
  clearTurnTimer(lobby);
  if (!lobby.roundModifiers.countdown) return;
  lobby.turnTimeLeft = TURN_TIME;
  lobby.turnTimer = setInterval(() => {
    lobby.turnTimeLeft--;
    io.to(lobby.id).emit('turnTimer', {
      timeLeft: lobby.turnTimeLeft,
      currentTurn: lobby.playerOrder[lobby.currentTurnIndex] || null,
    });
    if (lobby.turnTimeLeft <= 0) {
      clearTurnTimer(lobby);
      const currentId = lobby.playerOrder[lobby.currentTurnIndex];
      const p = lobby.players[currentId];
      if (!p || p.stayed || p.busted) {
        advanceTurn(lobby);
        return;
      }
      const randomHit = Math.random() < 0.5;
      if (randomHit) {
        p.hand.push(drawFromDeck(lobby));
        if (!checkPlayerDone(lobby, currentId)) {
          broadcastState(lobby);
        }
      } else {
        p.stayed = true;
        broadcastState(lobby);
        setTimeout(() => advanceTurn(lobby), 500);
      }
    }
  }, 1000);
}

function advanceTurn(lobby) {
  clearTurnTimer(lobby);
  while (true) {
    lobby.currentTurnIndex++;
    if (lobby.currentTurnIndex >= lobby.playerOrder.length) {
      runDealerTurn(lobby);
      return;
    }
    const pid = lobby.playerOrder[lobby.currentTurnIndex];
    if (lobby.players[pid] && lobby.players[pid].inRound && !lobby.players[pid].stayed && !lobby.players[pid].busted) {
      break;
    }
  }

  const currentId = lobby.playerOrder[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentId];
  if (currentPlayer && currentPlayer.frozen) {
    currentPlayer.frozen = false;
    currentPlayer.stayed = true;
    io.to(lobby.id).emit('chatMessage', { from: 'SERVER', text: `${currentPlayer.name} was frozen and auto-stayed.` });
    broadcastState(lobby);
    setTimeout(() => advanceTurn(lobby), 800);
    return;
  }

  startTurnTimer(lobby);
  broadcastState(lobby);
}

function checkPlayerDone(lobby, pid) {
  const p = lobby.players[pid];
  if (!p) return;
  const total = calcTotal(p.hand, {
    communalCard: lobby.roundModifiers.communalCard,
    wildcardLabel: lobby.roundModifiers.wildcardLabel,
  });
  if (total > 21) {
    p.busted = true;
    p.stayed = true;
    broadcastState(lobby);
    setTimeout(() => advanceTurn(lobby), 1000);
    return true;
  }
  if (total === 21) {
    p.stayed = true;
    broadcastState(lobby);
    setTimeout(() => advanceTurn(lobby), 1000);
    return true;
  }
  return false;
}

function runDealerTurn(lobby) {
  lobby.gamePhase = 'dealer';
  broadcastState(lobby);

  function dealerDraw() {
    lobby.dealerTotal = calcTotal(lobby.dealerHand, {
      communalCard: lobby.roundModifiers.communalCard,
      wildcardLabel: lobby.roundModifiers.wildcardLabel,
    });
    if (lobby.dealerTotal < lobby.roundModifiers.dealerHitThreshold) {
      lobby.dealerHand.push(drawFromDeck(lobby));
      lobby.dealerTotal = calcTotal(lobby.dealerHand, {
        communalCard: lobby.roundModifiers.communalCard,
        wildcardLabel: lobby.roundModifiers.wildcardLabel,
      });
      broadcastState(lobby);
      setTimeout(dealerDraw, 1000);
    } else {
      resolveRound(lobby);
    }
  }

  setTimeout(dealerDraw, 1000);
}

function applyCardBombs(lobby) {
  for (let id in lobby.players) {
    const p = lobby.players[id];
    if (!p.inRound || !p.cardBombed) continue;
    if (p.hand.length === 0) continue;

    const eligible = p.hand
      .map((card, index) => ({ card, index }))
      .filter(entry => entry.index !== p.anchoredCardIndex);

    if (eligible.length === 0) continue;
    const maxValue = Math.max(...eligible.map(entry => entry.card.value));
    const maxCards = eligible.filter(entry => entry.card.value === maxValue);
    const chosen = maxCards[Math.floor(Math.random() * maxCards.length)];
    p.hand[chosen.index] = drawFromDeck(lobby);
    p.cardBombed = false;
  }
}

function resolveRound(lobby) {
  lobby.gamePhase = 'results';
  clearTurnTimer(lobby);
  applyCardBombs(lobby);

  const options = {
    communalCard: lobby.roundModifiers.communalCard,
    wildcardLabel: lobby.roundModifiers.wildcardLabel,
  };
  lobby.dealerTotal = calcTotal(lobby.dealerHand, options);
  const activeIds = getActivePlayerIds(lobby);

  for (let id of activeIds) {
    const p = lobby.players[id];
    const pTotal = calcTotal(p.hand, options);
    p.busted = pTotal > 21;

    if (p.busted) {
      p.result = 'lose';
      p.winAmount = -p.bet;
    } else if (p.blackjack && p.hand.length === 2) {
      if (lobby.dealerTotal === 21 && lobby.dealerHand.length === 2) {
        p.result = 'push';
        p.winAmount = 0;
      } else {
        p.result = 'blackjack';
        p.winAmount = Math.floor(p.bet * 1.5);
      }
    } else if (lobby.dealerTotal > 21) {
      p.result = 'win';
      p.winAmount = p.bet;
    } else if (lobby.roundModifiers.reverseRound) {
      if (pTotal < lobby.dealerTotal) {
        p.result = 'win';
        p.winAmount = p.bet;
      } else if (pTotal > lobby.dealerTotal) {
        p.result = 'lose';
        p.winAmount = -p.bet;
      } else {
        p.result = 'push';
        p.winAmount = 0;
      }
    } else if (pTotal > lobby.dealerTotal) {
      p.result = 'win';
      p.winAmount = p.bet;
    } else if (pTotal < lobby.dealerTotal) {
      p.result = 'lose';
      p.winAmount = -p.bet;
    } else {
      p.result = 'push';
      p.winAmount = 0;
    }

    if (p.sabotageBusted && p.insurancePlusActive) {
      p.result = 'lose';
      p.winAmount = -Math.floor(p.bet / 2);
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    if (p.betHijackTargetId && lobby.players[p.betHijackTargetId]) {
      const target = lobby.players[p.betHijackTargetId];
      if (target.inRound) {
        p.winAmount -= target.winAmount;
      }
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    if (p.result === 'win' || p.result === 'blackjack') {
      p.winCount = (p.winCount || 0) + 1;
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    if (p.bountyHunter && lobby.players[p.bountyHunter.targetId]) {
      const target = lobby.players[p.bountyHunter.targetId];
      if (target.inRound && target.busted) {
        p.winAmount += p.bountyHunter.amount * 3;
      }
    }
  }

  if (lobby.roundModifiers.bountyTargetId && lobby.players[lobby.roundModifiers.bountyTargetId]) {
    const bountyTarget = lobby.players[lobby.roundModifiers.bountyTargetId];
    if (bountyTarget.inRound && bountyTarget.result === 'lose') {
      for (let id of activeIds) {
        if (id !== lobby.roundModifiers.bountyTargetId) {
          lobby.players[id].winAmount += 50;
        }
      }
    }
  }

  if (lobby.roundModifiers.ghostHand && lobby.roundModifiers.ghostHand.length > 0) {
    const ghostTotal = calcTotal(lobby.roundModifiers.ghostHand, options);
    const ghostBeatsAll = ghostTotal <= 21 && activeIds.every(id => {
      const p = lobby.players[id];
      const pTotal = calcTotal(p.hand, options);
      return p.busted || ghostTotal > pTotal;
    });
    if (ghostBeatsAll) {
      for (let id of activeIds) {
        const p = lobby.players[id];
        p.winAmount -= Math.floor(p.bet * 0.25);
      }
    }
  }

  if (lobby.roundModifiers.taxRound) {
    const allIds = Object.keys(lobby.players);
    let poorestId = allIds[0];
    for (let id of allIds) {
      if (lobby.players[id].chips < lobby.players[poorestId].chips) poorestId = id;
    }
    if (poorestId) {
      for (let id of activeIds) {
        const p = lobby.players[id];
        if (p.winAmount > 0) {
          const tax = Math.floor(p.winAmount * 0.25);
          p.winAmount -= tax;
          lobby.players[poorestId].winAmount = (lobby.players[poorestId].winAmount || 0) + tax;
        }
      }
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    if (p.prediction != null && p.winAmount > 0) {
      const total = calcTotal(p.hand, options);
      const diff = Math.abs(total - p.prediction);
      if (diff === 0) {
        p.winAmount = p.winAmount * 2;
      } else if (diff === 1) {
        p.winAmount = Math.floor(p.winAmount * 1.5);
      }
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    const loanCount = p.loans ? p.loans.length : 0;
    if (loanCount > 0 && p.winAmount > 0) {
      const penalty = Math.floor(p.winAmount * 0.2 * loanCount);
      p.winAmount -= penalty;
    }
  }

  if (lobby.bustPool && lobby.bustPool.total > 0) {
    const busters = activeIds.filter(id => lobby.players[id].busted);
    if (busters.length > 0) {
      const contributors = Object.keys(lobby.bustPool.contributors).filter(id => busters.some(busterId => busterId !== id));
      if (contributors.length > 0) {
        const share = Math.floor(lobby.bustPool.total / contributors.length);
        for (let id of contributors) {
          lobby.players[id].winAmount += share;
        }
      }
    }
  }

  for (let id of activeIds) {
    const p = lobby.players[id];
    p.chips = Math.max(0, p.chips + p.winAmount);
  }

  broadcastState(lobby);

  setTimeout(() => {
    for (let id in lobby.players) {
      if (lobby.players[id].chips <= 0) {
        io.to(id).emit('broke', 'You ran out of chips! Use Loan Shark or wait for the host to reset.');
      }
    }
    if (lobby.gameActive) {
      startNewRound(lobby);
    } else {
      lobby.gamePhase = 'lobby';
      broadcastLobbyState(lobby);
    }
  }, RESULT_TIME * 1000);
}

function resetPlayerForRound(p) {
  p.hand = [];
  p.bet = 0;
  p.betPlaced = false;
  p.stayed = false;
  p.busted = false;
  p.inRound = false;
  p.sabotaged = false;
  p.sabotageBusted = false;
  p.blackjack = false;
  p.result = null;
  p.winAmount = 0;
  p.shieldActive = false;
  p.anchoredCardIndex = null;
  p.blindRoundActive = false;
  p.insurancePlusActive = false;
  p.betHijackTargetId = null;
  p.mirrorTargetId = null;
  p.cardBombed = false;
  p.frozen = false;
  p.bountyHunter = null;
  p.prediction = null;
  p.powerups = [];
}

function applyPassivePowerup(p, def) {
  if (def.id === 'insurance_plus') {
    p.insurancePlusActive = true;
  }
}

function rollPowerupsForLobby(lobby) {
  for (let id in lobby.players) {
    const p = lobby.players[id];
    p.powerups = [];
    p.insurancePlusActive = false;

    const pool = POWERUP_DEFS.filter(def => !(def.oncePerGame && p.mulliganUsed));
    const shuffled = pool.sort(() => Math.random() - 0.5);
    for (let i = 0; i < 5 && i < shuffled.length; i++) {
      const def = shuffled[i];
      const powerup = {
        ...def,
        used: false,
        funded: true,
      };
      if (def.cost > 0) {
        if (p.chips >= def.cost) {
          p.chips -= def.cost;
        } else {
          powerup.funded = false;
        }
      }
      if (def.passive && powerup.funded) {
        applyPassivePowerup(p, def);
      }
      p.powerups.push(powerup);
    }
  }
}

function startNewRound(lobby) {
  lobby.roundCount += 1;
  clearBettingTimer(lobby);
  for (let id in lobby.players) {
    const p = lobby.players[id];
    resetPlayerForRound(p);
    if (p.loans && p.loans.length > 0) {
      p.loans.forEach(loan => loan.roundsLeft--);
      p.loans = p.loans.filter(loan => loan.roundsLeft > 0);
    }
  }

  lobby.dealerHand = [];
  lobby.dealerTotal = 0;
  lobby.sabotageVotes = {};
  lobby.sabotageApplied = {};
  lobby.playerOrder = [];
  lobby.currentTurnIndex = 0;
  lobby.bettingOrder = [];
  lobby.bettingTurnIndex = 0;
  lobby.currentBettingId = null;
  if (lobby.auction && lobby.auction.timer) clearInterval(lobby.auction.timer);
  if (lobby.draft && lobby.draft.timer) clearInterval(lobby.draft.timer);
  lobby.roundModifiers = defaultRoundModifiers();
  lobby.auction = null;
  lobby.bustPool = null;
  lobby.draft = null;

  if (Object.keys(lobby.players).length >= MIN_PLAYERS) {
    startBettingPhase(lobby);
  } else {
    lobby.gamePhase = 'lobby';
    broadcastLobbyState(lobby);
  }
}

function startBettingPhase(lobby) {
  lobby.gamePhase = 'betting';
  clearTurnTimer(lobby);
  clearBettingTimer(lobby);
  lobby.deck = buildDeck();
  lobby.bettingOrder = Object.keys(lobby.players);
  lobby.bettingTurnIndex = -1;
  lobby.currentBettingId = null;

  rollPowerupsForLobby(lobby);
  advanceBettingTurn(lobby);
}

function startDraftPhase(lobby) {
  lobby.gamePhase = 'draft';
  const playerIds = Object.keys(lobby.players).filter(id => lobby.players[id].inRound);
  const order = playerIds.sort((a, b) => lobby.players[a].chips - lobby.players[b].chips);
  lobby.draft = {
    round: 1,
    order,
    pool: [],
    currentPickerIndex: 0,
    currentPickerId: order[0] || null,
    timeLeft: DRAFT_TIME,
    timer: null,
  };

  lobby.draft.pool = order.map(() => drawFromDeck(lobby));

  startDraftTimer(lobby);
  broadcastState(lobby);
}

function startDraftTimer(lobby) {
  if (!lobby.draft) return;
  if (lobby.draft.timer) clearInterval(lobby.draft.timer);
  lobby.draft.timeLeft = DRAFT_TIME;
  lobby.draft.timer = setInterval(() => {
    lobby.draft.timeLeft--;
    io.to(lobby.id).emit('draftTimer', lobby.draft.timeLeft);
    if (lobby.draft.timeLeft <= 0) {
      clearInterval(lobby.draft.timer);
      lobby.draft.timer = null;
      const pickerId = lobby.draft.currentPickerId;
      if (pickerId) {
        const randomIndex = Math.floor(Math.random() * lobby.draft.pool.length);
        handleDraftPick(lobby, pickerId, randomIndex);
      }
    }
  }, 1000);
}

function advanceDraft(lobby) {
  if (!lobby.draft) return;
  if (lobby.draft.pool.length === 0) {
    if (lobby.draft.round === 1) {
      lobby.draft.round = 2;
      lobby.draft.order = lobby.draft.order.slice().reverse();
      lobby.draft.pool = lobby.draft.order.map(() => drawFromDeck(lobby));
      lobby.draft.currentPickerIndex = 0;
      lobby.draft.currentPickerId = lobby.draft.order[0] || null;
      startDraftTimer(lobby);
      broadcastState(lobby);
      return;
    }

    lobby.draft = null;
    finalizeDealingAfterDraft(lobby);
    return;
  }

  lobby.draft.currentPickerIndex++;
  if (lobby.draft.currentPickerIndex >= lobby.draft.order.length) {
    lobby.draft.currentPickerIndex = 0;
  }
  lobby.draft.currentPickerId = lobby.draft.order[lobby.draft.currentPickerIndex];
  startDraftTimer(lobby);
  broadcastState(lobby);
}

function handleDraftPick(lobby, playerId, cardIndex) {
  if (!lobby.draft || lobby.draft.currentPickerId !== playerId) return;
  const card = lobby.draft.pool[cardIndex];
  if (!card) return;

  lobby.draft.pool.splice(cardIndex, 1);
  const p = lobby.players[playerId];
  if (p) p.hand.push(card);
  advanceDraft(lobby);
}

function refreshPlayerStatus(lobby, playerId) {
  const p = lobby.players[playerId];
  if (!p || !p.inRound) return;
  const total = calcTotal(p.hand, {
    communalCard: lobby.roundModifiers.communalCard,
    wildcardLabel: lobby.roundModifiers.wildcardLabel,
  });
  if (total > 21) {
    p.busted = true;
    p.stayed = true;
  } else if (total === 21) {
    p.stayed = true;
  }
  p.blackjack = total === 21 && p.hand.length === 2;
}

function advanceIfCurrentDone(lobby, playerId) {
  if (lobby.gamePhase !== 'playing') return;
  const currentId = lobby.playerOrder[lobby.currentTurnIndex];
  if (currentId !== playerId) return;
  const p = lobby.players[playerId];
  if (!p) return;
  const total = calcTotal(p.hand, {
    communalCard: lobby.roundModifiers.communalCard,
    wildcardLabel: lobby.roundModifiers.wildcardLabel,
  });
  if (total >= 21 || p.busted) {
    p.stayed = true;
    setTimeout(() => advanceTurn(lobby), 800);
  }
}

function finalizeDealingAfterDraft(lobby) {
  lobby.dealerHand = [drawFromDeck(lobby), drawFromDeck(lobby)];
  if (lobby.roundModifiers.ghostHand && lobby.roundModifiers.ghostHand.length === 0) {
    lobby.roundModifiers.ghostHand = [drawFromDeck(lobby), drawFromDeck(lobby)];
  }

  lobby.playerOrder = Object.keys(lobby.players).filter(id => lobby.players[id].hand.length > 0);
  lobby.currentTurnIndex = 0;
  lobby.gamePhase = 'playing';

  for (let id of lobby.playerOrder) {
    const p = lobby.players[id];
    const total = calcTotal(p.hand, {
      communalCard: lobby.roundModifiers.communalCard,
      wildcardLabel: lobby.roundModifiers.wildcardLabel,
    });
    if (total === 21 && p.hand.length === 2) {
      p.blackjack = true;
      p.stayed = true;
    }
    if (total > 21) {
      p.busted = true;
      p.stayed = true;
    }
    p.inRound = true;
  }

  while (lobby.currentTurnIndex < lobby.playerOrder.length) {
    const pid = lobby.playerOrder[lobby.currentTurnIndex];
    if (lobby.players[pid] && !lobby.players[pid].stayed && !lobby.players[pid].busted) break;
    lobby.currentTurnIndex++;
  }

  if (lobby.currentTurnIndex >= lobby.playerOrder.length) {
    runDealerTurn(lobby);
    return;
  }

  startTurnTimer(lobby);
  broadcastState(lobby);
}

function startPlayingPhase(lobby) {
  clearBettingTimer(lobby);
  lobby.currentBettingId = null;
  for (let id in lobby.players) {
    const p = lobby.players[id];
    if (p.bet <= 0) {
      p.bet = Math.min(10, p.chips);
    }
    if (lobby.roundModifiers.doubleBets) {
      p.bet = Math.min(p.bet * 2, p.chips);
    }
    p.inRound = p.bet > 0;
  }

  if (lobby.roundModifiers.draftRound) {
    startDraftPhase(lobby);
    return;
  }

  for (let id in lobby.players) {
    const p = lobby.players[id];
    if (!p.inRound) continue;
    p.hand.push(drawFromDeck(lobby));
    p.hand.push(drawFromDeck(lobby));
  }

  if (lobby.auction && lobby.auction.winnerId && lobby.auction.card) {
    const winner = lobby.players[lobby.auction.winnerId];
    if (winner) winner.hand.push(lobby.auction.card);
  }

  lobby.dealerHand = [drawFromDeck(lobby), drawFromDeck(lobby)];

  if (lobby.roundModifiers.ghostHand && lobby.roundModifiers.ghostHand.length === 0) {
    lobby.roundModifiers.ghostHand = [drawFromDeck(lobby), drawFromDeck(lobby)];
  }

  lobby.playerOrder = Object.keys(lobby.players).filter(id => lobby.players[id].inRound);
  lobby.currentTurnIndex = 0;
  lobby.gamePhase = 'playing';

  for (let id in lobby.players) {
    const p = lobby.players[id];
    if (!p.inRound) continue;
    const total = calcTotal(p.hand, {
      communalCard: lobby.roundModifiers.communalCard,
      wildcardLabel: lobby.roundModifiers.wildcardLabel,
    });
    if (total === 21 && p.hand.length === 2) {
      p.blackjack = true;
      p.stayed = true;
    }
    if (total > 21) {
      p.busted = true;
      p.stayed = true;
    }
  }

  while (lobby.currentTurnIndex < lobby.playerOrder.length) {
    const pid = lobby.playerOrder[lobby.currentTurnIndex];
    if (lobby.players[pid] && !lobby.players[pid].stayed && !lobby.players[pid].busted) break;
    lobby.currentTurnIndex++;
  }

  if (lobby.currentTurnIndex >= lobby.playerOrder.length) {
    runDealerTurn(lobby);
    return;
  }

  startTurnTimer(lobby);
  broadcastState(lobby);
}

// --- Socket Handling ---
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createLobby', ({ name }) => {
    name = (name || 'Player').substring(0, 16).trim();
    if (!name) name = 'Player';

    const lobby = createLobby(socket.id);
    lobbies[lobby.id] = lobby;
    socket.data.lobbyId = lobby.id;
    socket.join(lobby.id);

    lobby.players[socket.id] = {
      name,
      chips: 1000,
      winCount: 0,
      hand: [],
      bet: 0,
      betPlaced: false,
      stayed: false,
      busted: false,
      inRound: false,
      sabotaged: false,
      sabotageBusted: false,
      blackjack: false,
      result: null,
      winAmount: 0,
      shieldActive: false,
      anchoredCardIndex: null,
      blindRoundActive: false,
      insurancePlusActive: false,
      betHijackTargetId: null,
      mirrorTargetId: null,
      cardBombed: false,
      frozen: false,
      bountyHunter: null,
      prediction: null,
      powerups: [],
      mulliganUsed: false,
      loans: [],
    };

    sendServerMessage(lobby, `${name} created lobby ${lobby.id}`);
    broadcastLobbyState(lobby);
  });

  socket.on('joinLobby', ({ name, lobbyId }) => {
    name = (name || 'Player').substring(0, 16).trim();
    if (!name) name = 'Player';
    lobbyId = (lobbyId || '').toUpperCase();
    const lobby = lobbies[lobbyId];
    if (!lobby) {
      socket.emit('error', 'Lobby not found');
      return;
    }

    socket.data.lobbyId = lobbyId;
    socket.join(lobbyId);
    lobby.players[socket.id] = {
      name,
      chips: 1000,
      winCount: 0,
      hand: [],
      bet: 0,
      betPlaced: false,
      stayed: false,
      busted: false,
      inRound: false,
      sabotaged: false,
      sabotageBusted: false,
      blackjack: false,
      result: null,
      winAmount: 0,
      shieldActive: false,
      anchoredCardIndex: null,
      blindRoundActive: false,
      insurancePlusActive: false,
      betHijackTargetId: null,
      mirrorTargetId: null,
      cardBombed: false,
      frozen: false,
      bountyHunter: null,
      prediction: null,
      powerups: [],
      mulliganUsed: false,
      loans: [],
    };

    sendServerMessage(lobby, `${name} joined the lobby`);
    broadcastLobbyState(lobby);
    if (lobby.gameActive) {
      broadcastState(lobby);
    }
  });

  socket.on('leaveLobby', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby) return;
    const p = lobby.players[socket.id];
    if (p) {
      sendServerMessage(lobby, `${p.name} left the lobby.`);
    }
    delete lobby.players[socket.id];
    socket.leave(lobby.id);
    socket.data.lobbyId = null;

    if (lobby.gamePhase === 'betting') {
      const wasCurrent = lobby.currentBettingId === socket.id;
      removeFromBettingOrder(lobby, socket.id);
      if (wasCurrent) {
        advanceBettingTurn(lobby);
      }
    }

    if (lobby.hostId === socket.id) {
      const remaining = Object.keys(lobby.players);
      lobby.hostId = remaining[0] || null;
      if (lobby.hostId) {
        sendServerMessage(lobby, `${lobby.players[lobby.hostId].name} is now the host.`);
      }
    }

    if (Object.keys(lobby.players).length === 0) {
      clearTurnTimer(lobby);
      if (lobby.roundTimer) clearInterval(lobby.roundTimer);
      if (lobby.auction && lobby.auction.timer) clearInterval(lobby.auction.timer);
      if (lobby.draft && lobby.draft.timer) clearInterval(lobby.draft.timer);
      delete lobbies[lobby.id];
      return;
    }

    if (lobby.gamePhase === 'playing' && lobby.playerOrder[lobby.currentTurnIndex] === socket.id) {
      advanceTurn(lobby);
    }

    broadcastLobbyState(lobby);
    if (lobby.gameActive && lobby.gamePhase !== 'lobby') {
      broadcastState(lobby);
    }
  });

  socket.on('startGame', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.hostId !== socket.id) return;
    for (let id in lobby.players) {
      lobby.players[id].winCount = 0;
    }
    lobby.gameActive = true;
    startNewRound(lobby);
  });

  socket.on('endGame', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.hostId !== socket.id) return;
    const leaderboard = Object.keys(lobby.players).map(id => ({
      id,
      name: lobby.players[id].name,
      wins: lobby.players[id].winCount || 0,
    }));
    const maxWins = leaderboard.reduce((max, entry) => Math.max(max, entry.wins), 0);
    const winners = leaderboard.filter(entry => entry.wins === maxWins && maxWins > 0);
    io.to(lobby.id).emit('gameOver', { winners, leaderboard });
    lobby.gameActive = false;
    if (lobby.roundTimer) clearInterval(lobby.roundTimer);
    clearTurnTimer(lobby);
    for (let id in lobby.players) {
      resetPlayerForRound(lobby.players[id]);
    }
    if (lobby.auction && lobby.auction.timer) clearInterval(lobby.auction.timer);
    if (lobby.draft && lobby.draft.timer) clearInterval(lobby.draft.timer);
    lobby.dealerHand = [];
    lobby.dealerTotal = 0;
    lobby.playerOrder = [];
    lobby.currentTurnIndex = 0;
    lobby.roundModifiers = defaultRoundModifiers();
    lobby.auction = null;
    lobby.bustPool = null;
    lobby.draft = null;
    lobby.gamePhase = 'lobby';
    broadcastLobbyState(lobby);
  });

  socket.on('placeBet', (amount) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.gamePhase !== 'betting') return;
    const p = lobby.players[socket.id];
    if (!p) return;
    if (lobby.currentBettingId && lobby.currentBettingId !== socket.id) {
      socket.emit('error', 'It is not your betting turn.');
      return;
    }

    amount = parseInt(amount, 10);
    if (isNaN(amount) || amount <= 0 || amount > p.chips) {
      socket.emit('error', 'Invalid bet amount');
      return;
    }

    p.bet = amount;
    p.betPlaced = true;
    io.to(lobby.id).emit('chatMessage', { from: 'SERVER', text: `${p.name} bet ${amount} chips` });
    advanceBettingTurn(lobby);
  });

  socket.on('hit', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.gamePhase !== 'playing') return;
    const currentId = lobby.playerOrder[lobby.currentTurnIndex];
    if (socket.id !== currentId) return;

    const p = lobby.players[socket.id];
    if (!p || p.stayed || p.busted || p.frozen) return;

    p.hand.push(drawFromDeck(lobby));

    if (!checkPlayerDone(lobby, socket.id)) {
      broadcastState(lobby);
    }
  });

  socket.on('stay', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.gamePhase !== 'playing') return;
    const currentId = lobby.playerOrder[lobby.currentTurnIndex];
    if (socket.id !== currentId) return;

    const p = lobby.players[socket.id];
    if (!p || p.stayed || p.busted) return;

    p.stayed = true;
    broadcastState(lobby);
    setTimeout(() => advanceTurn(lobby), 500);
  });

  socket.on('placeAuctionBid', (amount) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || !lobby.auction || lobby.gamePhase !== 'betting') return;
    const p = lobby.players[socket.id];
    if (!p) return;
    amount = parseInt(amount, 10);
    if (isNaN(amount) || amount <= 0 || amount > p.chips) return;
    if (amount <= (lobby.auction.highestBid || 0)) return;
    lobby.auction.bids[socket.id] = amount;
    lobby.auction.highestBid = amount;
    lobby.auction.highestBidderId = socket.id;
    broadcastState(lobby);
  });

  socket.on('contributeBustPool', (amount) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || !lobby.bustPool || lobby.gamePhase !== 'betting') return;
    const p = lobby.players[socket.id];
    if (!p) return;
    amount = parseInt(amount, 10);
    if (isNaN(amount) || amount <= 0 || amount > p.chips) return;
    p.chips -= amount;
    lobby.bustPool.total += amount;
    lobby.bustPool.contributors[socket.id] = (lobby.bustPool.contributors[socket.id] || 0) + amount;
    broadcastState(lobby);
  });

  socket.on('draftPick', (cardIndex) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby || lobby.gamePhase !== 'draft') return;
    cardIndex = parseInt(cardIndex, 10);
    if (isNaN(cardIndex)) return;
    handleDraftPick(lobby, socket.id, cardIndex);
  });

  socket.on('activatePowerup', ({ slotId, targetId, amount, prediction, cardIndex }) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby) return;
    const p = lobby.players[socket.id];
    if (!p) return;
    const powerup = p.powerups[slotId];
    if (!powerup || powerup.used || powerup.funded === false) return;

    const def = POWERUP_BY_ID[powerup.id];
    if (!def) return;

    if (def.phase === 'betting' && lobby.gamePhase !== 'betting') return;
    if (def.phase === 'playing' && lobby.gamePhase !== 'playing') return;
    if (def.phase === 'passive') return;

    if (def.id === 'shield') {
      p.shieldActive = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} activated Shield.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'loan_shark') {
      if (p.chips > 0) return;
      p.chips += 500;
      p.loans.push({ roundsLeft: 3 });
      powerup.used = true;
      announcePowerup(lobby, `${p.name} took a Loan Shark loan.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'mulligan') {
      if (p.mulliganUsed || !p.inRound || p.busted) return;
      const fee = Math.floor(p.bet * 0.25);
      if (p.chips < fee) return;
      p.chips -= fee;
      p.hand = [drawFromDeck(lobby), drawFromDeck(lobby)];
      p.mulliganUsed = true;
      powerup.used = true;
      p.busted = false;
      p.stayed = false;
      announcePowerup(lobby, `${p.name} used Mulligan and redrew.`);
      refreshPlayerStatus(lobby, socket.id);
      advanceIfCurrentDone(lobby, socket.id);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'anchor') {
      if (!p.inRound || p.hand.length === 0) return;
      if (cardIndex == null || cardIndex < 0 || cardIndex >= p.hand.length) return;
      p.anchoredCardIndex = cardIndex;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} anchored a card.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'blind_round') {
      if (lobby.gamePhase !== 'betting') return;
      p.blindRoundActive = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} activated Blind Round.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'prediction_bonus') {
      if (lobby.gamePhase !== 'betting') return;
      prediction = parseInt(prediction, 10);
      if (isNaN(prediction) || prediction < 2 || prediction > 21) return;
      p.prediction = prediction;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} locked in Prediction Bonus.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'bounty_hunter') {
      if (lobby.gamePhase !== 'betting') return;
      amount = parseInt(amount, 10);
      if (isNaN(amount) || amount <= 0 || amount > 50 || amount > p.chips) return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Bounty Hunter.`);
        sendServerMessage(lobby, `${target.name} blocked a Bounty Hunter attempt.`);
        broadcastState(lobby);
        return;
      }
      p.chips -= amount;
      p.bountyHunter = { targetId, amount };
      powerup.used = true;
      announcePowerup(lobby, `${p.name} placed a bounty bet on ${target.name}.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'bet_hijack') {
      if (lobby.gamePhase !== 'betting') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Bet Hijack.`);
        sendServerMessage(lobby, `${target.name} blocked a Bet Hijack.`);
        broadcastState(lobby);
        return;
      }
      if (target.bet <= 0) return;
      p.betHijackTargetId = targetId;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} hijacked ${target.name}'s bet.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'sabotage') {
      if (lobby.gamePhase !== 'playing') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id || !target.inRound || target.stayed || target.busted) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Sabotage.`);
        sendServerMessage(lobby, `${target.name} blocked a Sabotage.`);
        broadcastState(lobby);
        return;
      }
      target.sabotaged = true;
      target.hand.push(drawFromDeck(lobby));
      const total = calcTotal(target.hand, {
        communalCard: lobby.roundModifiers.communalCard,
        wildcardLabel: lobby.roundModifiers.wildcardLabel,
      });
      if (total > 21) {
        target.busted = true;
        target.stayed = true;
        target.sabotageBusted = true;
      }
      announcePowerup(lobby, `${p.name} sabotaged ${target.name}.`);
      sendServerMessage(lobby, `${target.name} was sabotaged and forced to draw!`);
      powerup.used = true;
      refreshPlayerStatus(lobby, targetId);
      advanceIfCurrentDone(lobby, targetId);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'card_swap') {
      if (lobby.gamePhase !== 'playing') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id || !target.inRound) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Card Swap.`);
        sendServerMessage(lobby, `${target.name} blocked a Card Swap.`);
        broadcastState(lobby);
        return;
      }
      const myEligible = p.hand.map((card, index) => ({ card, index }))
        .filter(entry => entry.index !== p.anchoredCardIndex);
      const theirEligible = target.hand.map((card, index) => ({ card, index }))
        .filter(entry => entry.index !== target.anchoredCardIndex);
      if (myEligible.length === 0 || theirEligible.length === 0) return;
      const myPick = myEligible[Math.floor(Math.random() * myEligible.length)];
      const theirPick = theirEligible[Math.floor(Math.random() * theirEligible.length)];
      const temp = p.hand[myPick.index];
      p.hand[myPick.index] = target.hand[theirPick.index];
      target.hand[theirPick.index] = temp;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} swapped a card with ${target.name}.`);
      sendServerMessage(lobby, `${p.name} swapped a card with ${target.name}.`);
      refreshPlayerStatus(lobby, socket.id);
      refreshPlayerStatus(lobby, targetId);
      advanceIfCurrentDone(lobby, socket.id);
      advanceIfCurrentDone(lobby, targetId);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'peek_leak') {
      if (lobby.gamePhase !== 'playing') return;
      if (lobby.dealerHand.length < 2) return;
      const card = lobby.dealerHand[1];
      const otherPlayers = Object.keys(lobby.players).filter(id => id !== socket.id);
      const randomOther = otherPlayers.length > 0
        ? otherPlayers[Math.floor(Math.random() * otherPlayers.length)]
        : null;
      io.to(socket.id).emit('peekLeakReveal', { label: card.label });
      if (randomOther) {
        io.to(randomOther).emit('peekLeakReveal', { label: card.label });
      }
      powerup.used = true;
      announcePowerup(lobby, `${p.name} used Peek & Leak.`);
      return;
    }

    if (def.id === 'card_bomb') {
      if (lobby.gamePhase !== 'playing') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id || !target.inRound) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Card Bomb.`);
        sendServerMessage(lobby, `${target.name} blocked a Card Bomb.`);
        broadcastState(lobby);
        return;
      }
      target.cardBombed = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} planted a Card Bomb on ${target.name}.`);
      sendServerMessage(lobby, `${p.name} planted a bomb on ${target.name}.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'freeze') {
      if (lobby.gamePhase !== 'playing') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id || !target.inRound) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Freeze.`);
        sendServerMessage(lobby, `${target.name} blocked a Freeze.`);
        broadcastState(lobby);
        return;
      }
      target.frozen = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} froze ${target.name}.`);
      sendServerMessage(lobby, `${target.name} has been frozen.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'mirror') {
      if (lobby.gamePhase !== 'playing') return;
      const target = lobby.players[targetId];
      if (!target || targetId === socket.id || !target.inRound) return;
      if (target.shieldActive) {
        target.shieldActive = false;
        powerup.used = true;
        announcePowerup(lobby, `${target.name} blocked ${p.name}'s Swap Hands.`);
        sendServerMessage(lobby, `${target.name} blocked a Swap Hands.`);
        broadcastState(lobby);
        return;
      }
      const myHand = p.hand.slice();
      p.hand = target.hand.slice();
      target.hand = myHand;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} swapped hands with ${target.name}.`);
      sendServerMessage(lobby, `${p.name} swapped hands with ${target.name}.`);
      refreshPlayerStatus(lobby, socket.id);
      refreshPlayerStatus(lobby, targetId);
      advanceIfCurrentDone(lobby, socket.id);
      advanceIfCurrentDone(lobby, targetId);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'earthquake_round') {
      if (lobby.gamePhase !== 'playing') return;
      const pool = [];
      const counts = {};
      for (let id in lobby.players) {
        const player = lobby.players[id];
        if (!player.inRound) continue;
        counts[id] = player.hand.length;
        pool.push(...player.hand);
        player.hand = [];
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let id in counts) {
        const count = counts[id];
        lobby.players[id].hand = pool.splice(0, count);
      }
      powerup.used = true;
      announcePowerup(lobby, `${p.name} triggered Earthquake Round.`);
      sendServerMessage(lobby, 'Earthquake! Cards reshuffled.');
      for (let id in counts) {
        refreshPlayerStatus(lobby, id);
      }
      const currentId = lobby.playerOrder[lobby.currentTurnIndex];
      if (currentId) advanceIfCurrentDone(lobby, currentId);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'reverse_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.reverseRound) return;
      lobby.roundModifiers.reverseRound = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} activated Reverse Round.`);
      sendServerMessage(lobby, 'Reverse Round activated! Lowest hand wins.');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'communal_card') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.communalCard) return;
      lobby.roundModifiers.communalCard = drawFromDeck(lobby);
      powerup.used = true;
      announcePowerup(lobby, `${p.name} revealed a Communal Card.`);
      sendServerMessage(lobby, `Communal Card is ${lobby.roundModifiers.communalCard.label}.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'bounty_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.bountyTargetId) return;
      const ids = Object.keys(lobby.players);
      if (ids.length === 0) return;
      lobby.roundModifiers.bountyTargetId = ids[Math.floor(Math.random() * ids.length)];
      powerup.used = true;
      if (lobby.players[lobby.roundModifiers.bountyTargetId]) {
        announcePowerup(lobby, `${p.name} started Bounty Round. Target: ${lobby.players[lobby.roundModifiers.bountyTargetId].name}.`);
      }
      sendServerMessage(lobby, `${lobby.players[lobby.roundModifiers.bountyTargetId].name} has the bounty.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'wildcard_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.wildcardLabel) return;
      const labels = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
      lobby.roundModifiers.wildcardLabel = labels[Math.floor(Math.random() * labels.length)];
      powerup.used = true;
      announcePowerup(lobby, `${p.name} set Wildcard to ${lobby.roundModifiers.wildcardLabel}.`);
      sendServerMessage(lobby, `Wildcard is ${lobby.roundModifiers.wildcardLabel}.`);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'dealer_exposed') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.dealerExposed) return;
      lobby.roundModifiers.dealerExposed = true;
      lobby.roundModifiers.dealerHitThreshold = 19;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} exposed the dealer.`);
      sendServerMessage(lobby, 'Dealer Exposed activated: Dealer hits to 19.');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'double_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.doubleBets) return;
      lobby.roundModifiers.doubleBets = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} triggered Double or Nothing.`);
      sendServerMessage(lobby, 'Double or Nothing round activated!');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'auction_card') {
      if (lobby.gamePhase !== 'betting' || lobby.auction) return;
      lobby.auction = {
        card: drawFromDeck(lobby),
        bids: {},
        highestBid: 0,
        highestBidderId: null,
        timeLeft: AUCTION_TIME,
        winnerId: null,
      };
      powerup.used = true;
      announcePowerup(lobby, `${p.name} started an Auction Card.`);
      sendServerMessage(lobby, 'Auction started! Place your bids.');
      startAuctionTimer(lobby);
      broadcastState(lobby);
      return;
    }

    if (def.id === 'bust_pool') {
      if (lobby.gamePhase !== 'betting' || lobby.bustPool) return;
      lobby.bustPool = { total: 0, contributors: {} };
      lobby.roundModifiers.bustPoolOpen = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} opened the Bust Pool.`);
      sendServerMessage(lobby, 'Bust Pool is open. Contribute now.');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'tax_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.taxRound) return;
      lobby.roundModifiers.taxRound = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} activated Tax Round.`);
      sendServerMessage(lobby, 'Tax Round activated.');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'countdown_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.countdown) return;
      lobby.roundModifiers.countdown = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} triggered Countdown.`);
      sendServerMessage(lobby, 'Countdown active: 10s turns.');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'draft_round') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.draftRound) return;
      lobby.roundModifiers.draftRound = true;
      powerup.used = true;
      announcePowerup(lobby, `${p.name} started Draft Round.`);
      sendServerMessage(lobby, 'Draft Round activated!');
      broadcastState(lobby);
      return;
    }

    if (def.id === 'ghost_hand') {
      if (lobby.gamePhase !== 'betting' || lobby.roundModifiers.ghostHand) return;
      lobby.roundModifiers.ghostHand = [drawFromDeck(lobby), drawFromDeck(lobby)];
      powerup.used = true;
      announcePowerup(lobby, `${p.name} summoned the Ghost Hand.`);
      sendServerMessage(lobby, 'Ghost Hand joins the round.');
      broadcastState(lobby);
      return;
    }
  });

  socket.on('chat', (msg) => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby) return;
    const p = lobby.players[socket.id];
    if (!p) return;
    msg = (msg || '').substring(0, 200).trim();
    if (msg) {
      io.to(lobby.id).emit('chatMessage', { from: p.name, text: msg });
    }
  });

  socket.on('disconnect', () => {
    const lobby = getLobbyBySocket(socket);
    if (!lobby) return;
    const p = lobby.players[socket.id];
    if (p) {
      sendServerMessage(lobby, `${p.name} left the table.`);
    }
    delete lobby.players[socket.id];
    socket.leave(lobby.id);
    socket.data.lobbyId = null;

    if (lobby.gamePhase === 'betting') {
      const wasCurrent = lobby.currentBettingId === socket.id;
      removeFromBettingOrder(lobby, socket.id);
      if (wasCurrent) {
        advanceBettingTurn(lobby);
      }
    }

    if (lobby.hostId === socket.id) {
      const remaining = Object.keys(lobby.players);
      lobby.hostId = remaining[0] || null;
      if (lobby.hostId) {
        sendServerMessage(lobby, `${lobby.players[lobby.hostId].name} is now the host.`);
      }
    }

    if (lobby.gamePhase === 'playing' && lobby.playerOrder[lobby.currentTurnIndex] === socket.id) {
      advanceTurn(lobby);
    }

    if (Object.keys(lobby.players).length === 0) {
      clearTurnTimer(lobby);
      if (lobby.roundTimer) clearInterval(lobby.roundTimer);
      if (lobby.auction && lobby.auction.timer) clearInterval(lobby.auction.timer);
      if (lobby.draft && lobby.draft.timer) clearInterval(lobby.draft.timer);
      delete lobbies[lobby.id];
      return;
    }

    broadcastLobbyState(lobby);
    if (lobby.gameActive && lobby.gamePhase !== 'lobby') {
      broadcastState(lobby);
    }
  });
});

function startAuctionTimer(lobby) {
  if (!lobby.auction) return;
  if (lobby.auction.timer) clearInterval(lobby.auction.timer);
  lobby.auction.timeLeft = AUCTION_TIME;
  lobby.auction.timer = setInterval(() => {
    lobby.auction.timeLeft--;
    io.to(lobby.id).emit('auctionTimer', lobby.auction.timeLeft);
    if (lobby.auction.timeLeft <= 0) {
      clearInterval(lobby.auction.timer);
      lobby.auction.timer = null;
      lobby.auction.winnerId = lobby.auction.highestBidderId;
      if (lobby.auction.winnerId && lobby.players[lobby.auction.winnerId]) {
        const winner = lobby.players[lobby.auction.winnerId];
        const bid = lobby.auction.highestBid;
        winner.chips = Math.max(0, winner.chips - bid);
        sendServerMessage(lobby, `${winner.name} won the auction for ${bid} chips.`);
      } else {
        sendServerMessage(lobby, 'Auction ended with no winner.');
      }
      broadcastState(lobby);
    }
  }, 1000);
}

// --- Start Server ---
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏 Multiplayer Blackjack Server Running!`);
  console.log(`\nLocal:    http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  for (let name in interfaces) {
    for (let iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Network:  http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`\nShare the Network URL with friends on the same WiFi!\n`);
});
