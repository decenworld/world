# Character Movement Game

A simple game where you can move a character around with mouse clicks on a map. The character will animate based on the direction of movement.

## Features

- Click-to-move character control
- Character animations based on movement direction (walking up, down, left, right)
- Multiplayer support via Socket.IO
- Map background

## Prerequisites

- Node.js (v12 or higher)
- npm (v6 or higher)

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

## Running the Game

1. Start the server:

```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

## How to Play

- Click anywhere on the map to move the character to that position
- The character will automatically animate based on the direction of movement
- If other players join, you'll see them as red characters moving around

## Assets

The game uses the following assets:
- `human.aseprite` - Character sprite with animations
- `image.png` - Map background

## Technical Details

- Built with Node.js and Express
- Uses Phaser 3 for game rendering and physics
- Socket.IO for real-time multiplayer functionality
- Custom Aseprite parser for handling character animations

## License

ISC 