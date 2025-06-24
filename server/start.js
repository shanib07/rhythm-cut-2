const { spawn } = require('child_process');
const path = require('path');

// Function to spawn a process and pipe its output
function spawnProcess(command, args, name) {
  const process = spawn(command, args, {
    stdio: 'pipe',
    shell: true
  });

  process.stdout.on('data', (data) => {
    console.log(`[${name}] ${data.toString().trim()}`);
  });

  process.stderr.on('data', (data) => {
    console.error(`[${name}] ${data.toString().trim()}`);
  });

  process.on('close', (code) => {
    console.log(`[${name}] Process exited with code ${code}`);
  });

  return process;
}

// Start the Next.js app
const app = spawnProcess('npm', ['run', 'start:app'], 'Next.js');

// Start the worker
const worker = spawnProcess('npm', ['run', 'start:worker'], 'Worker');

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down...');
  app.kill();
  worker.kill();
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down...');
  app.kill();
  worker.kill();
}); 