import { audioService, speechService, celebrate, gameSettings } from '../app.js';

// Item SVG Graphics
const itemAssets = {
  apple: `<svg viewBox="0 0 100 100"><path d="M50 82 C30 82 20 68 20 45 C20 28 35 18 50 24 C65 18 80 28 80 45 C80 68 70 82 50 82 Z" fill="#EF5350"/></svg>`,
  heart: `<svg viewBox="0 0 100 100"><path d="M50 85 C15 60 10 35 30 20 C45 10 50 25 50 25 C50 25 55 10 70 20 C90 35 85 60 50 85 Z" fill="#E53935"/></svg>`,
  strawberry: `<svg viewBox="0 0 100 100"><path d="M50 85 C25 85 25 40 30 28 C35 15 45 10 50 15 C55 10 65 15 70 28 C75 40 75 85 50 85 Z" fill="#E53935"/><circle cx="42" cy="40" r="2" fill="#FFE082"/><circle cx="58" cy="45" r="2" fill="#FFE082"/><circle cx="50" cy="60" r="2" fill="#FFE082"/><circle cx="45" cy="70" r="2" fill="#FFE082"/></svg>`,
  
  balloon: `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="45" rx="25" ry="32" fill="#42A5F5"/><path d="M50 77 L46 83 L54 83 Z" fill="#1E88E5"/><path d="M50 83 Q55 90 48 95" fill="none" stroke="#90A4AE" stroke-width="2"/></svg>`,
  fish: `<svg viewBox="0 0 100 100"><path d="M85 50 C85 65 55 75 35 65 C25 60 10 65 15 50 C10 35 25 40 35 35 C55 25 85 35 85 50 Z" fill="#42A5F5"/><polygon points="15 50 2 35 2 65" fill="#1E88E5"/><circle cx="70" cy="45" r="3" fill="#FFFFFF"/></svg>`,
  droplet: `<svg viewBox="0 0 100 100"><path d="M50 15 C50 15 80 50 80 65 C80 80 65 90 50 90 C35 90 20 80 20 65 C20 50 50 15 50 15 Z" fill="#29B6F6"/></svg>`,
  
  leaf: `<svg viewBox="0 0 100 100"><path d="M50 85 C20 70 15 45 40 20 C45 15 50 10 50 10 C50 10 55 15 60 20 C85 45 80 70 50 85 Z" fill="#66BB6A"/><line x1="50" y1="12" x2="50" y2="85" stroke="#388E3C" stroke-width="3"/></svg>`,
  frog: `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="60" rx="30" ry="22" fill="#66BB6A"/><circle cx="35" cy="40" r="10" fill="#66BB6A"/><circle cx="65" cy="40" r="10" fill="#66BB6A"/><circle cx="35" cy="40" r="4" fill="#FFFFFF"/><circle cx="65" cy="40" r="4" fill="#FFFFFF"/><ellipse cx="50" cy="65" rx="14" ry="8" fill="#AED581"/></svg>`,
  clover: `<svg viewBox="0 0 100 100"><path d="M50 50 Q30 30 50 20 Q70 30 50 50 Q30 70 20 50 Q30 30 50 50 Q70 70 50 80 Q30 70 50 50" fill="#43A047"/><path d="M50 50 Q50 95 35 95" fill="none" stroke="#2E7D32" stroke-width="4"/></svg>`,

  star: `<svg viewBox="0 0 100 100"><path d="M50 5 L63 36 L95 38 L70 59 L78 92 L50 74 L22 92 L30 59 L5 38 L37 36 Z" fill="#FFCA28"/></svg>`,
  banana: `<svg viewBox="0 0 100 100"><path d="M20 20 C40 20 80 40 80 75 C80 80 75 80 70 80 C60 80 30 50 20 20 Z" fill="#FFD54F"/><path d="M78 74 L84 82" stroke="#8D6E63" stroke-width="4" stroke-linecap="round"/></svg>`,
  lemon: `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="35" ry="24" fill="#FFE082" stroke="#FFCA28" stroke-width="3"/><circle cx="50" cy="50" r="15" fill="#FFF9C4" opacity="0.6"/></svg>`,
  
  orange: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#FF9800" stroke="#F57C00" stroke-width="3"/><circle cx="48" cy="40" r="2" fill="#FFE082"/><circle cx="56" cy="48" r="2.5" fill="#FFE082"/><path d="M52 20 Q56 12 50 8" fill="none" stroke="#4CAF50" stroke-width="3" stroke-linecap="round"/></svg>`,
  carrot: `<svg viewBox="0 0 100 100"><polygon points="35 22 65 22 50 85" fill="#FF9800" stroke="#E65100" stroke-width="2"/><path d="M50 22 Q40 6 35 12 M50 22 Q60 6 65 12" fill="none" stroke="#4CAF50" stroke-width="3"/></svg>`,
  marigold: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="28" fill="#FF9800"/><circle cx="50" cy="50" r="20" fill="#FB8C00"/><circle cx="50" cy="50" r="10" fill="#FFE082"/></svg>`
};

const itemsPoolData = [
  // Red items
  { id: 'apple', label: 'Apple', color: 'red', svg: itemAssets.apple },
  { id: 'heart', label: 'Heart', color: 'red', svg: itemAssets.heart },
  { id: 'strawberry', label: 'Strawberry', color: 'red', svg: itemAssets.strawberry },
  // Blue items
  { id: 'balloon', label: 'Balloon', color: 'blue', svg: itemAssets.balloon },
  { id: 'fish', label: 'Fish', color: 'blue', svg: itemAssets.fish },
  { id: 'droplet', label: 'Water drop', color: 'blue', svg: itemAssets.droplet },
  // Green items
  { id: 'leaf', label: 'Leaf', color: 'green', svg: itemAssets.leaf },
  { id: 'frog', label: 'Frog', color: 'green', svg: itemAssets.frog },
  { id: 'clover', label: 'Clover', color: 'green', svg: itemAssets.clover },
  // Yellow items
  { id: 'star', label: 'Star', color: 'yellow', svg: itemAssets.star },
  { id: 'banana', label: 'Banana', color: 'yellow', svg: itemAssets.banana },
  { id: 'lemon', label: 'Lemon', color: 'yellow', svg: itemAssets.lemon },
  // Orange items
  { id: 'orange', label: 'Orange', color: 'orange', svg: itemAssets.orange },
  { id: 'carrot', label: 'Carrot', color: 'orange', svg: itemAssets.carrot },
  { id: 'marigold', label: 'Marigold', color: 'orange', svg: itemAssets.marigold }
];

let score = 0;
let activeDraggable = null;
let dragStartX = 0;
let dragStartY = 0;
let selectedElement = null; // Accessibility selection fallback

export function initSorting() {
  score = 0;
  updateScore(0);
  renderBuckets();
  generateNewItems();

  document.getElementById('btn-sorting-reset').addEventListener('click', () => {
    audioService.playPop();
    score = 0;
    updateScore(0);
    generateNewItems();
  });
}

function updateScore(value) {
  score += value;
  document.getElementById('sorting-score').textContent = score;
}

function renderBuckets() {
  const container = document.getElementById('sorting-buckets-container');
  container.innerHTML = '';

  const allColors = [
    { name: 'red', label: 'Red' },
    { name: 'blue', label: 'Blue' },
    { name: 'green', label: 'Green' },
    { name: 'yellow', label: 'Yellow' },
    { name: 'orange', label: 'Orange' }
  ];

  let colors = [];
  if (gameSettings.difficulty === 'easy') {
    colors = allColors.slice(0, 2); // Red, Blue
  } else if (gameSettings.difficulty === 'hard') {
    colors = allColors.slice(0, 5); // Red, Blue, Green, Yellow, Orange
  } else {
    colors = allColors.slice(0, 4); // Red, Blue, Green, Yellow (Medium)
  }

  colors.forEach(col => {
    const bucket = document.createElement('div');
    bucket.className = `color-bucket bucket-${col.name}`;
    bucket.setAttribute('data-color', col.name);
    
    // Inject styling manually if orange since it's dynamically added
    if (col.name === 'orange') {
      bucket.style.backgroundColor = '#FF9800';
      bucket.style.borderColor = '#E65100';
      bucket.style.color = '#FFFFFF';
    }

    const label = document.createElement('span');
    label.className = 'bucket-label';
    label.textContent = col.label;

    bucket.appendChild(label);

    // Drop logic listener
    bucket.addEventListener('click', () => {
      if (selectedElement) {
        verifyDrop(selectedElement, col.name);
      }
    });

    container.appendChild(bucket);
  });
}

function generateNewItems() {
  const container = document.getElementById('sorting-items-pool');
  container.innerHTML = '';
  selectedElement = null;

  // Filter pool based on active difficulty color buckets
  let activeColors = ['red', 'blue'];
  if (gameSettings.difficulty === 'hard') {
    activeColors = ['red', 'blue', 'green', 'yellow', 'orange'];
  } else if (gameSettings.difficulty === 'medium') {
    activeColors = ['red', 'blue', 'green', 'yellow'];
  }
  
  const availableItems = itemsPoolData.filter(item => activeColors.includes(item.color));

  // Pick 4 random items matching difficulty colors
  const shuffled = [...availableItems].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 4);

  selected.forEach(item => {
    const el = document.createElement('div');
    el.className = 'sorting-item';
    el.setAttribute('data-id', item.id);
    el.setAttribute('data-color', item.color);
    el.setAttribute('data-label', item.label);
    el.innerHTML = item.svg;

    // Pointer events for Drag-and-Drop (touch + mouse)
    el.addEventListener('pointerdown', (e) => {
      onPointerDown(e, el);
    });

    // Tap-to-select accessibility fallback
    el.addEventListener('click', (e) => {
      // Prevent double triggers with pointer handlers
      if (el.style.position === 'absolute') return;

      audioService.playPop();
      document.querySelectorAll('.sorting-item').forEach(i => i.style.borderColor = 'transparent');
      
      selectedElement = el;
      el.style.border = '4px dashed var(--color-speech-primary)';
      speechService.speak(item.label);
    });

    container.appendChild(el);
  });
}

// Drag & Drop Pointer Handlers
function onPointerDown(e, el) {
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  activeDraggable = el;

  const rect = el.getBoundingClientRect();
  dragStartX = e.clientX - rect.left;
  dragStartY = e.clientY - rect.top;

  el.style.position = 'absolute';
  el.style.zIndex = '1000';
  moveAt(e.clientX, e.clientY);

  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
}

function moveAt(clientX, clientY) {
  if (!activeDraggable) return;
  const parentRect = document.getElementById('app-container').getBoundingClientRect();
  activeDraggable.style.left = `${clientX - parentRect.left - dragStartX}px`;
  activeDraggable.style.top = `${clientY - parentRect.top - dragStartY}px`;
}

function onPointerMove(e) {
  if (!activeDraggable) return;
  moveAt(e.clientX, e.clientY);

  // Check collision for hover class triggers
  const hoveredBucket = getBucketAt(e.clientX, e.clientY);
  document.querySelectorAll('.color-bucket').forEach(b => b.classList.remove('drag-over'));
  if (hoveredBucket) {
    hoveredBucket.classList.add('drag-over');
  }
}

function onPointerUp(e) {
  if (!activeDraggable) return;
  
  activeDraggable.removeEventListener('pointermove', onPointerMove);
  activeDraggable.removeEventListener('pointerup', onPointerUp);

  const bucket = getBucketAt(e.clientX, e.clientY);
  document.querySelectorAll('.color-bucket').forEach(b => b.classList.remove('drag-over'));

  if (bucket) {
    const colorTarget = bucket.getAttribute('data-color');
    verifyDrop(activeDraggable, colorTarget);
  } else {
    // Reset position
    activeDraggable.style.position = 'static';
    activeDraggable.style.zIndex = 'auto';
  }

  activeDraggable = null;
}

function getBucketAt(clientX, clientY) {
  const buckets = document.querySelectorAll('.color-bucket');
  for (let bucket of buckets) {
    const rect = bucket.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
      return bucket;
    }
  }
  return null;
}

function verifyDrop(element, bucketColor) {
  const itemColor = element.getAttribute('data-color');
  const itemLabel = element.getAttribute('data-label');

  if (itemColor === bucketColor) {
    // Correct!
    audioService.playSuccess();
    updateScore(1);
    
    speechService.speak(`${itemLabel} goes to ${bucketColor}!`);
    element.remove();
    selectedElement = null;

    // Check if pool is empty
    const remaining = document.querySelectorAll('.sorting-item');
    if (remaining.length === 0) {
      celebrate(`You sorted all the colors correctly! Current Score: ${score}`, () => {
        generateNewItems();
      });
    }
  } else {
    // Incorrect
    audioService.playOops();
    speechService.speak(`Oops! Let's try matching ${itemLabel} again.`);
    
    // Reset style & drag positions
    element.style.position = 'static';
    element.style.zIndex = 'auto';
    element.style.borderColor = 'transparent';
    selectedElement = null;
  }
}
