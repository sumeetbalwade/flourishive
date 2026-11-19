// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger loads startup files with require(), and its ESM support varies
// between hosts, so this CommonJS shim loads the compiled ESM app instead.
import('./dist/main.js').catch((err) => {
  console.error('Flourishive API failed to start', err);
  process.exit(1);
});
