const Watcher = require('./watcher');

const args = process.argv.slice(2);

new Watcher('/tmp/sync', args[0]).init();
