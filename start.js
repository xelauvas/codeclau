// Bootstrap entry with exit tracing
const _origExit = process.exit;
process.exit = function(code) {
  const err = new Error();
  require('fs').appendFileSync('/tmp/app_exit.log',
    `EXIT code=${code} at ${new Date().toISOString()}\n${err.stack}\n\n`);
  _origExit.call(process, code);
};

process.on('unhandledRejection', (err) => {
  require('fs').appendFileSync('/tmp/app_exit.log',
    `REJECTION: ${err}\n${err?.stack || ''}\n\n`);
});
process.on('uncaughtException', (err) => {
  require('fs').appendFileSync('/tmp/app_exit.log',
    `UNCAUGHT: ${err}\n${err?.stack || ''}\n\n`);
});

await import('./src/entrypoints/cli.tsx');
