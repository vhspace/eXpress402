import WebSocket from 'ws';

console.log('Testing WebSocket connection to Yellow clearnode...');

const ws = new WebSocket('wss://clearnet-sandbox.yellow.com/ws');

ws.on('open', () => {
  console.log('✅ WebSocket connection established');
  ws.close();
});

ws.on('error', (error) => {
  console.log('❌ WebSocket connection failed:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: ${code}, ${reason}`);
});