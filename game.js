let chips = 100; // starting chips
let currentBet = 0; // Added this to track the bet globally
let betting = true;
let cards = [2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,11,11,11]; // the deck
let drawn = []; //what you have
let dealer = []; /// what dealer has
let playerTotal = 0;// total of what you have
let dealerTotal = 0;//total of what dealer has
let playerStay = false;

function setup() {
  createCanvas(800, 800);
}

function draw() {
  background(100);
  if (betting && chips > 0) { //resets the deck, hand, and totals while giving 2 cards to dealer and you.
    cards = [2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,11,11,11];
    drawn = []; 
    dealer = [];
    playerTotal = 0;
    dealerTotal = 0;
    playerStay = false;

    let input = prompt("Enter Bet. You currently have " + chips + " chips."); 
    currentBet = parseInt(input); // Convert the text input to a number. where you bet

    // Validation: Make sure it's a number and they have enough chips
    if (isNaN(currentBet) || currentBet <= 0 || currentBet > chips) {
      alert("Invalid bet! Please enter a number between 1 and " + chips);
      return; // Keep betting = true and restart the loop
    }

    // Deal cards
    drawCard();
    drawCard();
    dealerCard();
    dealerCard();
    betting = false;
  }

  if (betting == false) {
    // Draw Buttons
    fill(255);
    rect(100, 600, 200, 75); 
    rect(500, 600, 200, 75); 
    
    fill(0);
    textAlign(CENTER);
    textSize(20);
    text("STAY", 200, 645);
    text("HIT", 600, 645);
    
    // Display Hand Info
    fill(255);
    textAlign(LEFT);
    text("Your Hand: " + drawn.join(", "), 100, 100);
    text("Total: " + playerTotal, 100, 130);
    text("Current Bet: " + currentBet, 100, 160);
    //Dealer Hand Info
    if (!playerStay) {
      text("Dealer Hand: " + dealer[0] + ", ?", 500, 100);
      text("Total: ?", 500, 130);
    } else {
      text("Dealer Hand: " + dealer.join(", "), 500, 100);
      text("Total: " + dealerTotal, 500, 130);
    }

    // Win/Loss Messages
    textAlign(CENTER);
    textSize(40);

    if (playerTotal > 21) {
      text("YOU BUST!", 400, 400);
      handleGameOver("lose");
    } else if (playerStay) {
      if (dealerTotal > 21 || playerTotal > dealerTotal) {
        text("YOU WIN!", 400, 400);
        handleGameOver("win");
      } else if (playerTotal < dealerTotal) {
        text("DEALER WINS!", 400, 400);
        handleGameOver("lose");
      } else {
        text("PUSH (TIE)", 400, 400);
        handleGameOver("tie");
      }
    }
  }
}

// Helper function to handle money
function handleGameOver(result) {
  if (result === "win") {
    chips += currentBet;
  } else if (result === "lose") {
    chips -= currentBet;
  }
  
  // Brief pause
  noLoop(); 
  setTimeout(() => {
    betting = true;
    loop();
  }, 2000);
}

function drawCard() { //gets a random card from cards array and then removes it from the array and gives it to the player hand
  if (cards.length > 0) {
    let randomIndex = Math.floor(Math.random() * cards.length);
    let removedCard = cards.splice(randomIndex, 1)[0];
    drawn.push(removedCard);
    calculateTotal();
  }
}

function dealerCard() { //same as draw card but dealer hand
  if (cards.length > 0) {
    let randomIndex = Math.floor(Math.random() * cards.length);
    let removedCard = cards.splice(randomIndex, 1)[0];
    dealer.push(removedCard);
    calculateDealerTotal();
  }
}

function calculateTotal() {  // gets the total of the players hand and makes aces do what there supposed to
  playerTotal = 0;
  let aceCount = 0;
  for (let card of drawn) {
    playerTotal += card;
    if (card === 11) aceCount++;
  }
  while (playerTotal > 21 && aceCount > 0) {
    playerTotal -= 10;
    aceCount--;
  }
}

function calculateDealerTotal() { // same as above but for dealer hand
  dealerTotal = 0;
  let dealerAceCount = 0;
  for (let card of dealer) {
    dealerTotal += card;
    if (card === 11) dealerAceCount++;
  }
  while (dealerTotal > 21 && dealerAceCount > 0) {
    dealerTotal -= 10;
    dealerAceCount--;
  }
}

function mousePressed() {  // making buttons clickable
  if (mouseY > 600 && mouseY < 675 && mouseX > 500 && mouseX < 700) {
    if (playerTotal < 21 && !playerStay && !betting) {
      drawCard();
    }
  }
  
  if (mouseY > 600 && mouseY < 675 && mouseX > 100 && mouseX < 300) {
    if (!playerStay && playerTotal <= 21 && !betting) {
      playerStay = true;
      runDealerTurn();
    }
  }
}

function runDealerTurn() { // makes dealer draw if he has under 17 total like real blackjack
  while (dealerTotal < 17) {
    dealerCard();
  }
}
