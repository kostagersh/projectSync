const fs = require('fs');
const { createServer } = require('http');
const io = require('socket.io');
const path = require('path');

const PORT = 8001;

module.exports = class Watcher {
  constructor(basePath) {
    //should be dir
    this.basePath = basePath;
  }

  getPath(pathToResolve) {
    return path.resolve(pathToResolve);
  }

  createCodeHeirarchy(node, itemPath) {
    console.log('creating', node);
    try {
      if (node.type === 'dir') {
        const dirPath = `${itemPath}/${node.name}`;
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath);
        }
        if (node.children) {
          return node.children.reduce((fileDictionary, child) => {
            const subFiles = this.createCodeHeirarchy(
              child,
              `${itemPath}/${node.name}`,
            );
            return Object.assign({}, fileDictionary, subFiles);
          }, {});
        }
      } else if (node.type === 'file') {
        const { pageName, content } = node;
        if (pageName) {
          const name = this.normalizeName(pageName);
          const relativePath = `${itemPath}/${name}`;
          this.writeFileIfNeed(relativePath, content);
          return { [name]: node.name.split('.').shift() };
        } else {
          // do nothing, it's system file
          return {};
        }
      }
    } catch (error) {
      console.log('error', error);
    }
  }

  needToCreateFile(relativePath, content) {
    if (!fs.existsSync(relativePath)) {
      return true;
    }
    const currentFileContent = fs.readFileSync(relativePath, {
      encoding: 'utf8',
    });
    return currentFileContent !== content;
  }

  writeFileIfNeed(relativePath, content) {
    if (this.needToCreateFile(relativePath, content)) {
      return fs.writeFileSync(relativePath, content);
    } else {
      return Promise.resolve();
    }
  }

  normalizeName(pageName) {
    const jsExt = '.js';
    let clearedNameFromEllipsis = pageName
      // remove ellipsis dots from the name due it's not valid in file system
      .replace(/\.\./g, '')
      // add .js after cleaning ellipsis
      .replace(/(\.)$/, jsExt)
      // escape file name
      .replace(/\//g, '_');
    console.log(clearedNameFromEllipsis);
    if (!path.extname(clearedNameFromEllipsis)) {
      clearedNameFromEllipsis += jsExt;
    }
    return clearedNameFromEllipsis;
  }

  initListeners(ioServer, onConnect) {
    const basePath = this.getPath(this.basePath);
    console.log('basePath', basePath);
    ioServer.on('connection', socket => {
      this.socket = socket;
      onConnect();
      console.log('client connected');
      this.socket.on('codesync:wcode:syncAllResponse', data => {
        console.log('received data', data);
        if (!fs.existsSync(this.basePath)) {
          fs.mkdirSync(`${this.basePath}`);
        }
        const pageDictionary = data.reduce((fileDictionary, datum) => {
          const fileDict = this.createCodeHeirarchy(datum, basePath);
          return Object.assign({}, fileDictionary, fileDict);
        }, {});
        console.log('pageDictionary', pageDictionary);
      });
      this.socket.on('disconnect', () => {
        console.log('Disconnected');
      });
    });
  }

  initServer(onConnect) {
    const app = createServer();
    const ioServer = io(app);

    try {
      app.listen(PORT, () => this.initListeners(ioServer, onConnect));
    } catch (e) {
      console.log(`Failed to initialize Server: ${e}`);
    }
  }

  watch() {
    fs.watch(this.basePath, { recursive: true }, (eventType, filename) => {
      console.log(`event type is: ${eventType}`);
      if (filename) {
        console.log(`filename provided: ${filename}`);
      } else {
        console.log('filename not provided');
      }
    });
  }

  async init() {
    await this.initServer(() =>
      this.socket.emit('codesync:ide:syncAllRequest'),
    );
    this.watch();
  }
};
