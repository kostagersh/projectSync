const Watcher = require('./watcher');

const args = process.argv.slice(2);

new Watcher('/tmp/sync', args[1]).init(args[0]);
