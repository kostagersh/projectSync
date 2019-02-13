const fs = require('fs');
const { createServer } = require('http');
const io = require('socket.io');
const path = require('path');
const webpack = require('webpack');

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
        this.pageDictionary = data.reduce((fileDictionary, datum) => {
          const fileDict = this.createCodeHeirarchy(datum, basePath);
          return Object.assign({}, fileDictionary, fileDict);
        }, {});
        console.log('pageDictionary', this.pageDictionary);
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

  transformFileIfNeeded({ fileRelativePath, fileContent, filePath }) {
    return new Promise((resolve, reject) => {
      if (path.basename(fileRelativePath) === 'vendors.js') {
        const rand = Math.floor(Math.random() * 10000);
        webpack(
          {
            entry: filePath,
            output: {
              path: path.resolve(path.dirname(filePath), '../../'),
              filename: `.vendors.${rand}.js`,
              libraryTarget: 'umd',
            },
          },
          (err, stats) => {
            if (err || stats.hasErrors()) {
              // Handle errors here
            }
            const newPath = filePath.replace(
              'vendors.js',
              `../../.vendors.${rand}.js`,
            );
            const newFileContent = fs.readFileSync(newPath).toString();
            fs.unlinkSync(newPath);
            // Done processing
            resolve({ fileRelativePath, fileContent: newFileContent });
          },
        );
      } else {
        const basename = path.basename(fileRelativePath);
        const dirname = path.dirname(fileRelativePath);
        let fixedPath = fileRelativePath;
        if (dirname === 'public/pages') {
          fixedPath =
            path.dirname(fileRelativePath) +
            '/' +
            this.pageDictionary[basename] +
            '.js';
        }
        resolve({ fileRelativePath: fixedPath, fileContent });
      }
    });
  }

  watch() {
    fs.watch(
      this.basePath,
      { recursive: true },
      async (eventType, fileRelativePath) => {
        console.log(`event type is: ${eventType}`);
        if (fileRelativePath) {
          console.log(`filename provided: ${fileRelativePath}`);
          const filePath = this.basePath + '/' + fileRelativePath;
          const fileContent = fs.readFileSync(filePath, {
            encoding: 'utf8',
          });
          const data = await this.transformFileIfNeeded({
            fileRelativePath,
            fileContent,
            filePath,
          });
          console.log('pushing file', data);
          this.socket.emit('codesync:ide:syncSingle', data);
        } else {
          console.log('filename not provided');
        }
      },
    );
  }

  async init() {
    await this.initServer(() =>
      this.socket.emit('codesync:ide:syncAllRequest'),
    );
    this.watch();
  }
};
