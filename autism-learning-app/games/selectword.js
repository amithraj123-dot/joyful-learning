// Select the Word (Word Matching Game) Module

import { audioService, speechService, celebrate, gameSettings } from '../app.js';

// SVG assets for the game prompts (reusing localized illustrations)
const wordAssets = {
  cat: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="65" rx="26" ry="20" fill="#FFB74D"/>
    <circle cx="50" cy="40" r="16" fill="#FFB74D"/>
    <polygon points="36 32 26 14 42 26" fill="#FFB74D"/>
    <polygon points="64 32 74 14 58 26" fill="#FFB74D"/>
    <circle cx="44" cy="38" r="3" fill="#37474F"/>
    <circle cx="56" cy="38" r="3" fill="#37474F"/>
    <path d="M46 44 Q50 48 54 44" fill="none" stroke="#37474F" stroke-width="2"/>
  </svg>`,
  dog: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="62" rx="28" ry="22" fill="#8D6E63"/>
    <circle cx="50" cy="38" r="18" fill="#8D6E63"/>
    <path d="M30 32 C22 32 18 45 24 52" fill="none" stroke="#5D4037" stroke-width="6" stroke-linecap="round"/>
    <path d="M70 32 C78 32 82 45 76 52" fill="none" stroke="#5D4037" stroke-width="6" stroke-linecap="round"/>
    <circle cx="44" cy="36" r="3" fill="#3E2723"/>
    <circle cx="56" cy="36" r="3" fill="#3E2723"/>
    <ellipse cx="50" cy="44" rx="4" ry="2.5" fill="#212121"/>
  </svg>`,
  apple: `<svg viewBox="0 0 100 100">
    <path d="M50 82 C32 82 22 68 22 45 C22 28 36 18 50 24 C64 18 78 28 78 45 C78 68 68 82 50 82 Z" fill="#EF5350"/>
    <path d="M50 22 Q54 12 62 10" fill="none" stroke="#8D6E63" stroke-width="4"/>
  </svg>`,
  banana: `<svg viewBox="0 0 100 100">
    <path d="M22 22 C42 22 78 40 78 72 C78 76 74 76 70 76 C60 76 32 48 22 22 Z" fill="#FFD54F"/>
    <path d="M75 70 L80 76" stroke="#8D6E63" stroke-width="4"/>
  </svg>`,
  sun: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="22" fill="#FFCA28" stroke="#F57F17" stroke-width="2"/>
    <g stroke="#FFB300" stroke-width="4" stroke-linecap="round">
      <line x1="50" y1="15" x2="50" y2="24"/><line x1="50" y1="76" x2="50" y2="85"/>
      <line x1="15" y1="50" x2="24" y2="50"/><line x1="76" y1="50" x2="85" y2="50"/>
    </g>
  </svg>`,
  duck: `<svg viewBox="0 0 100 100">
    <ellipse cx="45" cy="60" rx="28" ry="18" fill="#FFCA28"/>
    <circle cx="62" cy="35" r="14" fill="#FFCA28"/>
    <polygon points="72 32 84 36 72 40" fill="#FF8A80"/>
    <circle cx="64" cy="30" r="2.5" fill="#3E2723"/>
  </svg>`,
  car: `<svg viewBox="0 0 100 100">
    <path d="M15 58 L15 48 Q15 40 22 40 L30 40 Q34 28 44 28 L72 28 Q80 28 82 40 L85 40 Q90 40 90 48 L90 58 Z" fill="#42A5F5" stroke="#1E88E5" stroke-width="2"/>
    <circle cx="32" cy="62" r="9" fill="#37474F"/>
    <circle cx="70" cy="62" r="9" fill="#37474F"/>
  </svg>`,
  star: `<svg viewBox="0 0 100 100">
    <path d="M50 8 L62 36 L92 38 L68 58 L76 88 L50 72 L24 88 L32 58 L8 38 L38 36 Z" fill="#FFE082" stroke="#FFB300" stroke-width="3"/>
  </svg>`,
  mango: `<svg viewBox="0 0 100 100">
    <path d="M50 80 C20 80 15 50 30 30 C45 15 65 15 70 25 C75 35 75 70 55 80 C53 81 51 80 50 80 Z" fill="#FFC107" stroke="#FFA000" stroke-width="3"/>
    <path d="M50 18 Q55 8 60 5" fill="none" stroke="#795548" stroke-width="4" stroke-linecap="round"/>
    <path d="M52 14 Q65 10 65 2 Q54 6 52 14" fill="#4CAF50"/>
  </svg>`,
  peacock: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="65" r="25" fill="#00ACC1"/>
    <circle cx="50" cy="42" r="14" fill="#00838F"/>
    <path d="M50 65 L20 30 M50 65 L30 18 M50 65 L50 10 M50 65 L70 18 M50 65 L80 30" stroke="#00E676" stroke-width="4" stroke-linecap="round"/>
    <polygon points="46 44 54 44 50 50" fill="#FFB300"/>
  </svg>`,
  lotus: `<svg viewBox="0 0 100 100">
    <path d="M50 80 C30 70 20 50 50 25 C80 50 70 70 50 80 Z" fill="#F06292"/>
    <path d="M50 80 C20 75 10 60 40 40 C70 60 80 75 50 80 Z" fill="#EC407A"/>
    <ellipse cx="50" cy="85" rx="35" ry="8" fill="#4CAF50"/>
  </svg>`,
  idli: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="55" rx="35" ry="24" fill="#ECEFF1" stroke="#CFD8DC" stroke-width="3"/>
    <ellipse cx="48" cy="52" rx="30" ry="20" fill="#F5F7F8"/>
  </svg>`,
  dosa: `<svg viewBox="0 0 100 100">
    <path d="M10 70 C10 70 45 40 90 20" fill="none" stroke="#D7CCC8" stroke-width="12" stroke-linecap="round"/>
    <path d="M10 70 C10 70 45 40 90 20" fill="none" stroke="#FFE082" stroke-width="8" stroke-linecap="round"/>
    <circle cx="35" cy="55" r="2.5" fill="#8D6E63"/>
  </svg>`,
  samosa: `<svg viewBox="0 0 100 100">
    <polygon points="50 15 15 80 85 80" fill="#FFE082" stroke="#F57C00" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,
  egg: `<svg viewBox="0 0 100 100">
    <path d="M50 85 C32 85 22 72 22 55 C22 32 36 15 50 15 C64 15 78 32 78 55 C78 72 68 85 50 85 Z" fill="#FFFFFF" stroke="#CFD8DC" stroke-width="3"/>
    <circle cx="50" cy="58" r="18" fill="#FFCA28"/>
  </svg>`
};

const selectWordItems = [
  { id: 'cat', label: 'Cat', svg: wordAssets.cat },
  { id: 'dog', label: 'Dog', svg: wordAssets.dog },
  { id: 'apple', label: 'Apple', svg: wordAssets.apple },
  { id: 'banana', label: 'Banana', svg: wordAssets.banana },
  { id: 'sun', label: 'Sun', svg: wordAssets.sun },
  { id: 'duck', label: 'Duck', svg: wordAssets.duck },
  { id: 'car', label: 'Car', svg: wordAssets.car },
  { id: 'star', label: 'Star', svg: wordAssets.star },
  { id: 'mango', label: 'Mango', svg: wordAssets.mango },
  { id: 'peacock', label: 'Peacock', svg: wordAssets.peacock },
  { id: 'lotus', label: 'Lotus', svg: wordAssets.lotus },
  { id: 'idli', label: 'Idli', svg: wordAssets.idli },
  { id: 'dosa', label: 'Dosa', svg: wordAssets.dosa },
  { id: 'samosa', label: 'Samosa', svg: wordAssets.samosa },
  { id: 'egg', label: 'Egg', svg: wordAssets.egg }
];

let currentTargetItem = null;
let currentScore = 0;
let answeredInRound = false;

export function initSelectWord() {
  currentScore = 0;
  updateScoreDisplay(0);
  nextRound();

  const nextBtn = document.getElementById('btn-selectword-next');
  const newNextBtn = nextBtn.cloneNode(true);
  nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
  newNextBtn.addEventListener('click', () => {
    audioService.playPop();
    nextRound();
  });
}

function updateScoreDisplay(val) {
  currentScore += val;
  document.getElementById('selectword-score').textContent = currentScore;
}

function nextRound() {
  answeredInRound = false;

  // Pick target item randomly
  const targetIdx = Math.floor(Math.random() * selectWordItems.length);
  currentTargetItem = selectWordItems[targetIdx];

  // Render Target SVG
  document.getElementById('selectword-image-container').innerHTML = currentTargetItem.svg;

  // Announce the visual matching instruction
  speechService.speak("What matches this picture? Tap the correct word card.");

  // Build choice options based on difficulty level
  const decoys = selectWordItems.filter(item => item.id !== currentTargetItem.id);
  const shuffledDecoys = decoys.sort(() => 0.5 - Math.random());

  let choicesCount = 3; // Medium default (4 choices total)
  if (gameSettings.difficulty === 'easy') {
    choicesCount = 1; // 2 choices total
  } else if (gameSettings.difficulty === 'hard') {
    choicesCount = 5; // 6 choices total
  }

  const choices = [currentTargetItem];
  for (let i = 0; i < choicesCount; i++) {
    if (shuffledDecoys[i]) {
      choices.push(shuffledDecoys[i]);
    }
  }

  // Shuffle option position
  const shuffledChoices = choices.sort(() => 0.5 - Math.random());

  renderChoices(shuffledChoices);
}

function renderChoices(choices) {
  const container = document.getElementById('selectword-choices-container');
  container.innerHTML = '';

  // Setup columns according to choice sizes
  if (choices.length === 2) {
    container.style.gridTemplateColumns = '1fr 1fr';
  } else if (choices.length === 6) {
    container.style.gridTemplateColumns = 'repeat(3, 1fr)';
  } else {
    container.style.gridTemplateColumns = '1fr 1fr'; // default 4 choices (2x2)
  }

  choices.forEach(option => {
    const card = document.createElement('div');
    card.className = 'selectword-option-card';
    card.setAttribute('data-id', option.id);
    card.textContent = option.label;

    card.addEventListener('click', () => {
      handleChoiceClick(card, option);
    });

    container.appendChild(card);
  });
}

function handleChoiceClick(cardEl, option) {
  if (answeredInRound) return; // Prevent multiple clicks

  // Speak word when selected to help phonics learning
  speechService.speak(option.label);

  if (option.id === currentTargetItem.id) {
    answeredInRound = true;
    cardEl.classList.add('correct');
    
    audioService.playSuccess();
    updateScoreDisplay(1);

    speechService.speak(`Excellent! That is the word: ${currentTargetItem.label}!`);

    // Celebrate and finish at 5 points
    if (currentScore >= 5) {
      setTimeout(() => {
        celebrate("Fantastic job! You matched all the words correctly!", () => {
          currentScore = 0;
          updateScoreDisplay(0);
          nextRound();
        });
      }, 1500);
    } else {
      setTimeout(() => {
        nextRound();
      }, 2500);
    }
  } else {
    cardEl.classList.add('incorrect');
    audioService.playOops();
    speechService.speak(`Not quite. Try again! Find the word ${currentTargetItem.label}`);

    setTimeout(() => {
      cardEl.classList.remove('incorrect');
    }, 500);
  }
}
