// Interactive Cooking Game Module

import { audioService, speechService, celebrate } from '../app.js';

// SVG graphic elements for cooking composite canvas
const cookingSVGs = {
  board: `<svg viewBox="0 0 200 200">
    <ellipse cx="100" cy="120" rx="80" ry="45" fill="#D7CCC8" stroke="#8D6E63" stroke-width="6"/>
    <ellipse cx="100" cy="115" rx="74" ry="40" fill="#EFEBE9"/>
  </svg>`,
  bread_white: `<path d="M55 70 C50 65 52 50 65 48 C75 46 95 48 100 48 C105 48 125 46 135 48 C148 50 150 65 145 70 C140 76 142 120 135 125 C125 130 75 130 65 125 C58 120 60 76 55 70 Z" fill="#FFF9C4" stroke="#D7CCC8" stroke-width="4"/>`,
  bread_wheat: `<path d="M55 70 C50 65 52 50 65 48 C75 46 95 48 100 48 C105 48 125 46 135 48 C148 50 150 65 145 70 C140 76 142 120 135 125 C125 130 75 130 65 125 C58 120 60 76 55 70 Z" fill="#D7CCC8" stroke="#8D6E63" stroke-width="4"/>`,
  
  spread_butter: `<path d="M65 72 C60 68 70 58 85 58 C115 58 135 62 135 72 C135 90 125 118 100 118 C75 118 70 90 65 72 Z" fill="#FFF176" opacity="0.95"/>`,
  spread_jelly: `<path d="M65 72 C60 68 70 58 85 58 C115 58 135 62 135 72 C135 90 125 118 100 118 C75 118 70 90 65 72 Z" fill="#E91E63" opacity="0.85"/>`,
  
  topping_cheese: `<rect x="68" y="68" width="64" height="52" rx="6" transform="rotate(8, 100, 94)" fill="#FFD54F" stroke="#FFB300" stroke-width="2"/>`,
  topping_lettuce: `<path d="M60 85 Q75 60 100 70 Q125 60 140 85 Q145 105 100 118 Q55 105 60 85 Z" fill="#81C784" stroke="#4CAF50" stroke-width="2" opacity="0.9"/>`,
  topping_tomato: `<g>
    <circle cx="85" cy="85" r="16" fill="#E53935" stroke="#B71C1C" stroke-width="2"/>
    <circle cx="85" cy="85" r="12" fill="#EF5350"/>
    <circle cx="115" cy="98" r="16" fill="#E53935" stroke="#B71C1C" stroke-width="2"/>
    <circle cx="115" cy="98" r="12" fill="#EF5350"/>
  </g>`,
  topping_egg: `<g>
    <ellipse cx="80" cy="85" rx="14" ry="10" fill="#FFFFFF" stroke="#CFD8DC" stroke-width="2" transform="rotate(-15, 80, 85)"/>
    <circle cx="80" cy="85" r="5" fill="#FFD54F"/>
    <ellipse cx="118" cy="95" rx="14" ry="10" fill="#FFFFFF" stroke="#CFD8DC" stroke-width="2" transform="rotate(20, 118, 95)"/>
    <circle cx="118" cy="95" r="5" fill="#FFD54F"/>
  </g>`,
  topping_paneer: `<g>
    <rect x="75" y="70" width="28" height="24" rx="3" fill="#F5F5F5" stroke="#E0E0E0" stroke-width="2" transform="rotate(5, 75, 70)"/>
    <rect x="95" y="90" width="28" height="24" rx="3" fill="#F5F5F5" stroke="#E0E0E0" stroke-width="2" transform="rotate(-15, 95, 90)"/>
  </g>`,
  topping_cucumber: `<g>
    <circle cx="70" cy="80" r="12" fill="#81C784" stroke="#2E7D32" stroke-width="2"/>
    <circle cx="70" cy="80" r="8" fill="#C8E6C9"/>
    <circle cx="110" cy="74" r="12" fill="#81C784" stroke="#2E7D32" stroke-width="2"/>
    <circle cx="110" cy="74" r="8" fill="#C8E6C9"/>
    <circle cx="95" cy="100" r="12" fill="#81C784" stroke="#2E7D32" stroke-width="2"/>
    <circle cx="95" cy="100" r="8" fill="#C8E6C9"/>
  </g>`,
  topping_capsicum: `<g>
    <path d="M68 95 C62 90 60 76 74 72 C88 68 84 85 82 92 Z" fill="none" stroke="#43A047" stroke-width="6" stroke-linecap="round"/>
    <path d="M124 90 C118 85 110 74 120 70 C130 66 128 82 126 88 Z" fill="none" stroke="#2E7D32" stroke-width="6" stroke-linecap="round"/>
  </g>`,

  mascot_happy: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="#C8E6C9" stroke="#4CAF50" stroke-width="3"/>
    <circle cx="38" cy="42" r="4" fill="#1B5E20"/>
    <circle cx="62" cy="42" r="4" fill="#1B5E20"/>
    <path d="M36 60 Q50 82 64 60 Z" fill="#E53935" stroke="#1B5E20" stroke-width="3"/>
    <circle cx="28" cy="50" r="4" fill="#FF8A80"/>
    <circle cx="72" cy="50" r="4" fill="#FF8A80"/>
  </g>`,
  mascot_hungry: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="#FFE082" stroke="#FFB300" stroke-width="3"/>
    <circle cx="38" cy="42" r="4" fill="#5D4037"/>
    <circle cx="62" cy="42" r="4" fill="#5D4037"/>
    <circle cx="50" cy="62" r="12" fill="#3E2723"/>
    <path d="M46 32 Q50 35 54 32" fill="none" stroke="#5D4037" stroke-width="2"/>
  </svg>`
};

const recipeState = {
  currentStep: 1,
  selectedBread: null, // 'white' or 'wheat'
  selectedSpread: null, // 'butter' or 'jelly'
  toppings: [], // list containing 'cheese', 'lettuce', 'tomato'
  finished: false
};

export function initCooking() {
  recipeState.currentStep = 1;
  recipeState.selectedBread = null;
  recipeState.selectedSpread = null;
  recipeState.toppings = [];
  recipeState.finished = false;

  setupStepUI();
  renderCanvas();
  renderDock();
}

function setupStepUI() {
  // Sync dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    const s = parseInt(dot.getAttribute('data-step'), 10);
    dot.className = 'step-dot';
    if (s < recipeState.currentStep) dot.classList.add('done');
    if (s === recipeState.currentStep) dot.classList.add('active');
  });

  // Sync instruction texts
  const instructionEl = document.getElementById('cooking-instructions-text');
  let currentInstruction = '';
  switch (recipeState.currentStep) {
    case 1:
      currentInstruction = "Let's start! Tap a bread in the kitchen cabinet to put it on the cutting board.";
      break;
    case 2:
      currentInstruction = "Yummy! Now choose a tasty spread (Butter or Jelly) for your bread.";
      break;
    case 3:
      currentInstruction = "Add some colorful toppings to make it healthy! Tap the cheese, lettuce, or tomato.";
      break;
    case 4:
      currentInstruction = "Perfect! Top it off with another slice of bread and let's serve our hungry friend!";
      break;
  }
  
  instructionEl.textContent = currentInstruction;
  speechService.speak(currentInstruction);

  // Next Step button hides/shows based on step actions completed
  document.getElementById('btn-cooking-next-step').classList.add('hidden');
}

function renderCanvas() {
  const canvas = document.getElementById('cooking-canvas');
  canvas.innerHTML = '';

  let htmlSvg = `<svg viewBox="0 0 200 200" style="width: 100%; height: 100%;">
    <!-- Background Board -->
    <ellipse cx="100" cy="120" rx="85" ry="48" fill="#E0A96D" stroke="#D7CCC8" stroke-width="4"/>
    <ellipse cx="100" cy="116" rx="80" ry="44" fill="#F5F5F5"/>
  `;

  // Draw Bottom Bread
  if (recipeState.selectedBread) {
    htmlSvg += cookingSVGs[`bread_${recipeState.selectedBread}`];
  }

  // Draw Spread
  if (recipeState.selectedSpread) {
    htmlSvg += cookingSVGs[`spread_${recipeState.selectedSpread}`];
  }

  // Draw Toppings
  recipeState.toppings.forEach(top => {
    htmlSvg += cookingSVGs[`topping_${top}`];
  });

  // Draw Top Bread (Step 4 finalization)
  if (recipeState.currentStep === 4 && recipeState.finished) {
    // Top bread slightly offset for depth
    htmlSvg += `<g transform="translate(4, -8)">
      ${cookingSVGs[`bread_${recipeState.selectedBread || 'white'}`]}
    </g>`;
  }

  htmlSvg += `</svg>`;
  canvas.innerHTML = htmlSvg;
}

function renderDock() {
  const dock = document.getElementById('cooking-dock-items');
  dock.innerHTML = '';

  switch (recipeState.currentStep) {
    case 1:
      // Show Bread options
      createDockItem('white', 'White Bread', cookingSVGs.bread_white, () => selectBread('white'));
      createDockItem('wheat', 'Wheat Bread', cookingSVGs.bread_wheat, () => selectBread('wheat'));
      break;
    case 2:
      // Show Spread options
      createDockItem('butter', 'Creamy Butter', cookingSVGs.spread_butter, () => selectSpread('butter'));
      createDockItem('jelly', 'Sweet Jelly', cookingSVGs.spread_jelly, () => selectSpread('jelly'));
      break;
    case 3:
      // Show Toppings
      createDockItem('cheese', 'Cheese Slice', cookingSVGs.topping_cheese, () => toggleTopping('cheese'));
      createDockItem('lettuce', 'Crispy Lettuce', cookingSVGs.topping_lettuce, () => toggleTopping('lettuce'));
      createDockItem('tomato', 'Juicy Tomato', cookingSVGs.topping_tomato, () => toggleTopping('tomato'));
      createDockItem('egg', 'Boiled Egg', cookingSVGs.topping_egg, () => toggleTopping('egg'));
      createDockItem('paneer', 'Paneer Slice', cookingSVGs.topping_paneer, () => toggleTopping('paneer'));
      createDockItem('cucumber', 'Cucumber Slices', cookingSVGs.topping_cucumber, () => toggleTopping('cucumber'));
      createDockItem('capsicum', 'Capsicum Ring', cookingSVGs.topping_capsicum, () => toggleTopping('capsicum'));
      
      // Allow moving to step 4 when at least one topping is added
      if (recipeState.toppings.length > 0) {
        showNextStepButton();
      }
      break;
    case 4:
      if (!recipeState.finished) {
        createDockItem('top-bread', 'Top Bread', cookingSVGs[`bread_${recipeState.selectedBread}`], () => finishSandwich());
      } else {
        // Show hungry character to serve
        createDockItem('serve', 'Feed Friend! 😋', cookingSVGs.mascot_hungry, () => feedCharacter());
      }
      break;
  }
}

function createDockItem(id, labelText, svgContent, onClick) {
  const dock = document.getElementById('cooking-dock-items');
  
  const card = document.createElement('div');
  card.className = 'cooking-item-tool';
  card.setAttribute('data-id', id);

  const graphic = document.createElement('div');
  graphic.style.width = '46px';
  graphic.style.height = '46px';
  graphic.innerHTML = `<svg viewBox="0 0 200 200" width="100%" height="100%">${svgContent}</svg>`;

  const label = document.createElement('span');
  label.className = 'cooking-item-label';
  label.textContent = labelText;

  card.appendChild(graphic);
  card.appendChild(label);
  
  card.addEventListener('click', () => {
    audioService.playPop();
    onClick();
  });

  dock.appendChild(card);
}

function selectBread(type) {
  recipeState.selectedBread = type;
  renderCanvas();
  
  // Slide down pop sound
  audioService.playPop();
  
  // Advance automatically to next step
  recipeState.currentStep = 2;
  setTimeout(() => {
    setupStepUI();
    renderDock();
  }, 800);
}

function selectSpread(type) {
  recipeState.selectedSpread = type;
  renderCanvas();

  // Spreading audio mimic
  audioService.playPop();

  recipeState.currentStep = 3;
  setTimeout(() => {
    setupStepUI();
    renderDock();
  }, 800);
}

function toggleTopping(type) {
  const idx = recipeState.toppings.indexOf(type);
  if (idx === -1) {
    recipeState.toppings.push(type);
    speechService.speak(`Added ${type}!`);
  } else {
    recipeState.toppings.splice(idx, 1);
    speechService.speak(`Removed ${type}`);
  }
  
  renderCanvas();
  renderDock(); // Redraws so Next Step button updates its availability
}

function showNextStepButton() {
  const nextBtn = document.getElementById('btn-cooking-next-step');
  nextBtn.classList.remove('hidden');
  nextBtn.textContent = 'Put top bread on! 🥪';
  
  nextBtn.onclick = () => {
    audioService.playPop();
    recipeState.currentStep = 4;
    setupStepUI();
    renderDock();
    renderCanvas();
  };
}

function finishSandwich() {
  recipeState.finished = true;
  renderCanvas();
  renderDock();

  speechService.speak("Hooray! The sandwich looks delicious. Tap the friend to feed them!");
}

function feedCharacter() {
  // Eat chomp chomp chomp animation representation
  audioService.playSuccess();
  speechService.speak("Chomp, chomp, chomp... Yum! Thank you for the delicious sandwich!");

  // Change canvas illustration to clean plate + happy mascot
  const canvas = document.getElementById('cooking-canvas');
  canvas.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center;">
    <div style="width:120px; height:120px;">${cookingSVGs.mascot_happy}</div>
    <p style="font-family:'Fredoka', sans-serif; font-size:20px; color:var(--color-cooking-dark); font-weight:700;">Happy Tummy!</p>
  </div>`;

  setTimeout(() => {
    celebrate("You cooked a wonderful healthy sandwich and fed your friend!", () => {
      initCooking();
    });
  }, 1500);
}
